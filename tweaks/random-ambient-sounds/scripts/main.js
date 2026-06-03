const PATCH_KEY = Symbol.for("vorfaleTweaks.randomAmbientSounds.patch");
const FLAG_SCOPE_LEGACY = "random-ambient-sounds";
const FLAG_KEY = "config";
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba", "webm"]);
const FILE_CACHE = new Map();
const LAST_PICKED = new Map();
const AUDIO_DURATIONS = new Map();
const PLAYBACK = new WeakMap();

let context;

export function init(tweakContext) {
  context = tweakContext;

  patchAmbientSoundSync();

  for (const hook of ["renderAmbientSoundConfig", "renderAmbientSoundSheet"]) {
    Hooks.on(hook, (app, html) => injectRandomSoundControls(app, html));
  }

  Hooks.on("deleteAmbientSound", document => stopRandomPlayback(document?.object));
  Hooks.on("updateAmbientSound", (document, changed = {}) => {
    const sound = document?.object;
    if (!sound) return;
    const configChanged = hasRandomConfigChanged(changed);
    const pathChanged = hasRandomPathChanged(changed);
    const randomEnabled = isRandomEnabled(document);
    if (!randomEnabled && !configChanged) return;

    if (pathChanged) resetAudioFileCaches();
    if (!context?.isEnabled?.() || !randomEnabled || document.hidden) stopRandomPlayback(sound);
    else handleRandomSoundUpdate(sound, pathChanged);
    debug("ambient sound updated", {
      id: document.id,
      pathChanged,
      enabled: randomEnabled,
      randomPath: getConfig(document).path,
      changed
    });
    canvas.sounds?.refresh?.();
  });

  context.onChange(() => {
    stopAllRandomPlayback();
    canvas.sounds?.refresh?.();
  });
}

function patchAmbientSoundSync() {
  const AmbientSoundClass = foundry.canvas?.placeables?.AmbientSound ?? CONFIG.AmbientSound?.objectClass ?? globalThis.AmbientSound;
  if (!AmbientSoundClass?.prototype || AmbientSoundClass.prototype[PATCH_KEY]) return;

  const original = AmbientSoundClass.prototype.sync;
  AmbientSoundClass.prototype[PATCH_KEY] = { original };

  AmbientSoundClass.prototype.sync = async function vorfaleRandomAmbientSoundSync(isAudible, volume, options = {}) {
    if (!context?.isEnabled?.() || !isRandomEnabled(this.document) || this.document?.hidden) {
      stopRandomPlayback(this);
      return original.call(this, isAudible, volume, options);
    }

    await original.call(this, false, volume, options);
    debug("sync", {
      id: this.document?.id,
      isAudible,
      volume,
      muffled: options?.muffled,
      effects: this.document?.effects,
      walls: this.document?.walls,
      randomPath: getConfig(this.document).path
    });
    startRandomPlayback(this, volume, options, isAudible);
  };
}

function injectRandomSoundControls(app, html) {
  if (!context.isEnabled()) return;

  const element = normalizeElement(html);
  if (!element) return;

  const soundDocument = getAmbientSoundDocument(app, element);
  if (!soundDocument) return;

  const form = element.querySelector("form") ?? element;
  if (form.querySelector(".vorfale-random-ambient-sounds-toggle")) return;

  const config = getConfig(soundDocument);
  const randomPath = normalizeAudioPatternValue(config.path ?? "");

  const toggle = globalThis.document.createElement("div");
  toggle.className = "form-group vorfale-random-ambient-sounds-toggle";
  toggle.innerHTML = `
      <label>${context.localize("Enable")}</label>
      <div class="form-fields">
        <input type="checkbox" name="flags.${context.moduleId}.${FLAG_KEY}.enabled" ${config.enabled ? "checked" : ""}>
      </div>
      <p class="hint">${context.localize("EnableHint")}</p>
  `;

  const options = globalThis.document.createElement("section");
  options.className = "vorfale-random-ambient-sounds-options";
  options.hidden = !config.enabled;
  options.innerHTML = `
    <div class="form-group">
      <label>${context.localize("Path")}</label>
      <div class="form-fields vorfale-random-ambient-sounds-path-fields">
        <input type="text" name="flags.${context.moduleId}.${FLAG_KEY}.path" value="${escapeHTML(randomPath)}" placeholder="sounds/rain/*">
        <button type="button" class="icon fa-solid fa-folder-open vorfale-random-ambient-sounds-browse" data-tooltip="${escapeHTML(context.localize("Browse"))}" aria-label="${escapeHTML(context.localize("Browse"))}"></button>
      </div>
      <p class="hint">${context.localize("PathHint")}</p>
    </div>
    <div class="form-group">
      <label>${context.localize("Interval")}</label>
      <div class="form-fields">
        <input type="number" min="0" step="1" name="flags.${context.moduleId}.${FLAG_KEY}.min" value="${Number(config.min ?? 30)}">
        <span>${context.localize("Seconds")}</span>
        <input type="number" min="0" step="1" name="flags.${context.moduleId}.${FLAG_KEY}.max" value="${Number(config.max ?? 90)}">
        <span>${context.localize("Seconds")}</span>
      </div>
    </div>
  `;

  toggle.addEventListener("change", () => {
    const checked = toggle.querySelector("input")?.checked;
    options.hidden = !checked;
  });
  options.querySelector(".vorfale-random-ambient-sounds-browse")?.addEventListener("click", () => {
    const input = options.querySelector(`[name="flags.${context.moduleId}.${FLAG_KEY}.path"]`);
    browseRandomSoundPath(input);
  });
  installRandomPathSubmitGuard(form, options);

  const anchor = findInsertionAnchor(form);
  if (anchor) {
    anchor.insertAdjacentElement("afterend", options);
    anchor.insertAdjacentElement("afterend", toggle);
  } else {
    form.append(toggle, options);
  }
}

function installRandomPathSubmitGuard(form, options) {
  if (form.dataset.vorfaleRandomAmbientPathGuard === "true") return;
  form.dataset.vorfaleRandomAmbientPathGuard = "true";

  form.addEventListener("submit", () => {
    const input = options.querySelector(`[name="flags.${context.moduleId}.${FLAG_KEY}.path"]`);
    if (input) input.value = normalizeAudioPatternValue(input.value);
  }, true);
}

function normalizeElement(html) {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? null;
  if (html?.jquery) return html[0] ?? null;
  return null;
}

function getAmbientSoundDocument(app, element) {
  const document = app?.document ?? app?.object;
  if (isAmbientSoundDocument(document)) return document;

  const appId = element.closest?.("[data-appid]")?.dataset?.appid;
  const windowApp = appId ? ui.windows?.[appId] ?? foundry.applications?.instances?.get?.(appId) : null;
  const windowDocument = windowApp?.document ?? windowApp?.object;
  return isAmbientSoundDocument(windowDocument) ? windowDocument : null;
}

function isAmbientSoundDocument(document) {
  return document?.documentName === "AmbientSound";
}

function findInsertionAnchor(form) {
  return form.querySelector("[name='path']")?.closest(".form-group")
    ?? form.querySelector("[name='volume']")?.closest(".form-group")
    ?? form.querySelector(".tab.active .form-group:last-of-type")
    ?? form.querySelector(".form-group:last-of-type");
}

function getConfig(document) {
  return document?.getFlag?.(context.moduleId, FLAG_KEY)
    ?? document?.flags?.[context.moduleId]?.[FLAG_KEY]
    ?? document?.flags?.[FLAG_SCOPE_LEGACY]?.[FLAG_KEY]
    ?? {};
}

function isRandomEnabled(document) {
  return getConfig(document).enabled === true;
}

function hasRandomPathChanged(changed) {
  return hasChangedPath(changed, ["flags", context.moduleId, FLAG_KEY, "path"])
    || hasChangedPath(changed, ["flags", FLAG_SCOPE_LEGACY, FLAG_KEY, "path"]);
}

function hasRandomConfigChanged(changed) {
  return hasChangedPath(changed, ["flags", context.moduleId, FLAG_KEY])
    || hasChangedPath(changed, ["flags", FLAG_SCOPE_LEGACY, FLAG_KEY]);
}

function hasChangedPath(changed, parts) {
  const dotted = parts.join(".");
  if (Object.hasOwn(changed ?? {}, dotted)) return true;
  return foundry.utils?.hasProperty?.(changed, dotted) === true;
}

function handleRandomSoundUpdate(sound, pathChanged) {
  const state = PLAYBACK.get(sound);
  if (!state) return;
  if (pathChanged) {
    const previousSound = state.currentSound?.src;
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = null;
    state.sequence = (state.sequence ?? 0) + 1;
    state.pathKey = null;
    stopCurrentSound(state);
    if (state.active && state.audible) scheduleNext(sound, 0);
    debug("random path changed, current sound stopped and next pick will use new folder", {
      id: sound.document?.id,
      randomPath: getConfig(sound.document).path,
      previousSound
    });
  }
}

function startRandomPlayback(sound, volume, options, isAudible = true) {
  const state = getPlaybackState(sound);
  state.volume = volume ?? sound.document?.volume ?? 1;
  state.options = options ?? {};
  const wasAudible = state.audible;
  state.audible = isAudible;

  if (state.active) {
    syncCurrentSoundVolume(state, options?.fade);
    applyCurrentSoundEffects(state.currentSound, sound, state);
    if (isAudible && !state.playing && !state.currentSound) scheduleNext(sound, wasAudible ? 0 : 1);
    return;
  }

  state.active = true;
  scheduleNext(sound, 0);
}

function stopRandomPlayback(sound) {
  const state = PLAYBACK.get(sound);
  if (!state) return;

  if (state.timer) window.clearTimeout(state.timer);
  state.timer = null;
  state.active = false;
  state.sequence = (state.sequence ?? 0) + 1;
  stopCurrentSound(state);
}

function stopAllRandomPlayback() {
  for (const sound of canvas.sounds?.placeables ?? []) stopRandomPlayback(sound);
}

function getPlaybackState(sound) {
  let state = PLAYBACK.get(sound);
  if (!state) {
    state = {
      active: false,
      audible: true,
      timer: null,
      volume: 1,
      options: {},
      currentSound: null,
      currentSrc: null,
      currentEffectKey: null,
      playing: false,
      sequence: 0
    };
    PLAYBACK.set(sound, state);
  }
  return state;
}

function scheduleNext(sound, delayMs) {
  const state = getPlaybackState(sound);
  if (state.playing) {
    debug("schedule skipped because a random sound is still playing", {
      id: sound.document?.id,
      currentSrc: state.currentSrc,
      delayMs
    });
    return;
  }
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => playRandomSound(sound), delayMs);
}

async function playRandomSound(sound) {
  const state = getPlaybackState(sound);
  if (!state.active || sound?.document?.hidden) {
    stopRandomPlayback(sound);
    return;
  }

  if (state.playing) {
    debug("play skipped because a random sound is already in progress", {
      id: sound.document?.id,
      currentSrc: state.currentSrc
    });
    return;
  }

  state.playing = true;
  state.timer = null;
  state.sequence = (state.sequence ?? 0) + 1;
  const sequence = state.sequence;

  const config = getConfig(sound.document);
  const path = config.path || sound.document?.path;
  const pathKey = getAudioSourceCacheKey(parseAudioPattern(path));
  if (state.pathKey && state.pathKey !== pathKey) resetPlaybackQueue(state.pathKey);
  state.pathKey = pathKey;

  if (!state.audible) {
    state.timer = null;
    state.playing = false;
    return;
  }

  const src = await pickRandomFile(path);
  if (!src) {
    state.playing = false;
    ui.notifications?.warn?.(context.localize("NoFiles"));
    stopRandomPlayback(sound);
    return;
  }
  state.currentSrc = src;

  try {
    let ended = null;
    const endedPromise = new Promise(resolve => {
      ended = resolve;
    });
    const playedSound = await canvas.sounds.playAtPosition(src, sound.center, getSoundRadius(sound), {
      ...getPositionalPlaybackOptions(sound, state),
      playbackOptions: {
        volume: state.volume,
        loop: false,
        fade: state.options?.fade,
        onended: ended
      },
      sourceData: getSoundSourceData(sound, state)
    });

    state.currentSound = playedSound ?? null;
    state.currentEffectKey = null;
    applyCurrentSoundEffects(playedSound, sound, state);
    debug("playing random sound", {
      id: sound.document?.id,
      src,
      randomPath: path,
      volume: state.volume,
      audible: state.audible,
      options: getPositionalPlaybackOptions(sound, state),
      sourceData: getSoundSourceData(sound, state),
      returnedSound: Boolean(playedSound),
      playing: state.playing
    });
    syncCurrentSoundVolume(state, 0);
    await waitForSoundEnd(playedSound, endedPromise, src);
  } catch (error) {
    console.warn("vorfale-tweaks/random-ambient-sounds | Could not play random ambient sound.", error);
  } finally {
    if (state.sequence === sequence) {
      debug("random sound finished", {
        id: sound.document?.id,
        src: state.currentSrc
      });
      state.currentSound = null;
      state.currentSrc = null;
      state.currentEffectKey = null;
      state.playing = false;
    }
  }

  if (!state.active || state.sequence !== sequence || sound?.document?.hidden) return;
  scheduleNext(sound, randomIntervalMs(config));
}

function getSoundRadius(sound) {
  return Number(sound.document?.radius ?? sound.radius ?? 0);
}

function getPositionalPlaybackOptions(sound, state) {
  const effects = getPlaybackEffects(sound, state);
  return {
    walls: sound.document?.walls,
    easing: sound.document?.easing,
    volume: state.volume,
    baseEffect: effects.base,
    muffledEffect: effects.muffled
  };
}

function getSoundSourceData(sound, state) {
  const document = sound.document;
  const effects = getPlaybackEffects(sound, state);
  return {
    channel: "environment",
    darkness: document?.darkness,
    easing: document?.easing,
    effects: document?.effects,
    elevation: document?.elevation,
    fade: state.options?.fade ?? 0,
    gmAlways: false,
    radius: document?.radius,
    walls: document?.walls,
    baseEffect: effects.base,
    muffledEffect: effects.muffled,
    x: document?.x,
    y: document?.y
  };
}

function getPlaybackEffects(sound, state) {
  const effects = {
    base: getBaseEffect(sound, state.options),
    muffled: getMuffledEffect(sound, state.options)
  };
  if (effects.muffled && sound.document?.walls) {
    debug("muffled effect may be ignored by Foundry while walls constraint is enabled", {
      id: sound.document?.id,
      walls: sound.document?.walls,
      muffled: effects.muffled
    });
  }
  return effects;
}

function getBaseEffect(sound, options) {
  return normalizeSoundEffect(options?.baseEffect
    ?? sound?.baseEffect
    ?? sound?.source?.baseEffect
    ?? sound?.document?.effects?.base);
}

function getMuffledEffect(sound, options) {
  return normalizeSoundEffect(options?.muffledEffect
    ?? sound?.muffledEffect
    ?? sound?.source?.muffledEffect
    ?? sound?.document?.effects?.muffled);
}

function normalizeSoundEffect(effect) {
  if (effect?.toObject) effect = effect.toObject();
  else if (effect && typeof effect === "object") effect = foundry.utils?.deepClone?.(effect) ?? { ...effect };
  if (!effect?.type) return null;
  return {
    type: effect.type,
    intensity: Number(effect.intensity ?? 0)
  };
}

function applyCurrentSoundEffects(playedSound, ambientSound, state) {
  if (!playedSound?.applyEffects) return;

  const muffled = state.options?.muffled === true;
  const effect = muffled ? getMuffledEffect(ambientSound, state.options) : getBaseEffect(ambientSound, state.options);
  const effectKey = JSON.stringify({ muffled, effect });
  if (state.currentEffectKey === effectKey) return;

  const node = createAudioEffectNode(playedSound.context ?? game.audio?.environment, effect);
  state.currentEffectKey = effectKey;

  try {
    playedSound.applyEffects(node ? [node] : []);
    debug("random sound effect applied", {
      id: ambientSound.document?.id,
      src: state.currentSrc,
      muffled,
      effect,
      node: Boolean(node)
    });
  } catch (error) {
    console.warn("vorfale-tweaks/random-ambient-sounds | Could not apply ambient sound effect.", error);
  }
}

function createAudioEffectNode(context, effect) {
  if (!context || !effect?.type || !effect.intensity) return null;

  try {
    const configured = CONFIG?.soundEffects?.[effect.type]?.effectClass;
    if (configured) return new configured(context, { type: effect.type, intensity: effect.intensity });

    if (effect.type === "reverb" && foundry.audio?.ConvolverEffect) {
      return new foundry.audio.ConvolverEffect(context, { intensity: effect.intensity });
    }

    if (foundry.audio?.BiquadFilterEffect) {
      return new foundry.audio.BiquadFilterEffect(context, { type: effect.type, intensity: effect.intensity });
    }
  } catch (error) {
    console.warn("vorfale-tweaks/random-ambient-sounds | Could not create audio effect node.", error);
  }

  return null;
}

function syncCurrentSoundVolume(state, fade = 0) {
  const sound = state.currentSound;
  if (!sound?.fade) return;

  const target = state.audible ? state.volume : 0;
  sound.fade(target, { duration: fade ?? 0 }).catch?.(() => {});
}

function stopCurrentSound(state) {
  const sound = state.currentSound;
  state.currentSound = null;
  state.currentSrc = null;
  state.currentEffectKey = null;
  state.playing = false;
  if (!sound?.stop) return;

  try {
    sound.stop({ fade: 250 });
  } catch {
    sound.stop();
  }
}

async function waitForSoundEnd(sound, endedPromise, src) {
  const duration = getSoundDurationMs(sound) || await getAudioDurationMs(src);
  const fallbackDelay = duration > 0 ? duration + 250 : 30000;
  debug("wait for sound end", { src, duration, fallbackDelay, hasSound: Boolean(sound) });
  await Promise.race([endedPromise, sleep(fallbackDelay)]);
}

function getSoundDurationMs(sound) {
  const duration = Number(sound?.duration ?? sound?.node?.buffer?.duration ?? sound?.buffer?.duration ?? 0);
  return Number.isFinite(duration) && duration > 0 ? Math.ceil(duration * 1000) : 0;
}

async function getAudioDurationMs(src) {
  if (!src) return 0;
  const cached = AUDIO_DURATIONS.get(src);
  if (cached !== undefined) return cached;

  const duration = await new Promise(resolve => {
    const audio = new Audio(src);
    const cleanup = () => {
      audio.removeAttribute("src");
      audio.load();
    };
    const finish = value => {
      cleanup();
      resolve(value);
    };

    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => {
      const seconds = Number(audio.duration);
      finish(Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 0);
    }, { once: true });
    audio.addEventListener("error", () => finish(0), { once: true });
    window.setTimeout(() => finish(0), 5000);
  });

  AUDIO_DURATIONS.set(src, duration);
  return duration;
}

function sleep(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function randomIntervalMs(config) {
  const min = Math.max(0, Number(config.min ?? 30));
  const max = Math.max(min, Number(config.max ?? 90));
  return Math.round((min + Math.random() * (max - min)) * 1000);
}

async function pickRandomFile(pattern) {
  const files = await resolveAudioFiles(pattern);
  if (!files.length) return null;
  const source = parseAudioPattern(pattern);
  const key = getAudioSourceCacheKey(source);
  const candidates = excludeLastPicked(files, LAST_PICKED.get(key));
  const selected = candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  if (selected) LAST_PICKED.set(key, selected);
  debug("pick random file", { pattern: normalizeAudioPatternValue(pattern), count: files.length, candidates: candidates.length, selected });
  return selected;
}

async function resolveAudioFiles(pattern) {
  const source = parseAudioPattern(pattern);
  if (!source.directory && !source.regex && !source.exact) return [];

  const cacheKey = getAudioSourceCacheKey(source);
  const cached = FILE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.time < 60000) return cached.files;

  const pickerClass = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
  if (!pickerClass) return [];

  try {
    const result = await pickerClass.browse(source.storage, source.directory);
    const files = (result.files ?? []).filter(file => {
      const name = file.split("/").pop() ?? file;
      if (!isAudioFile(file)) return false;
      if (!isDirectChildOfDirectory(file, source.directory)) return false;
      if (source.exact) return source.exact === file || source.exact === name;
      return !source.regex || source.regex.test(name);
    });
    FILE_CACHE.set(cacheKey, { time: Date.now(), files });
    debug("resolved audio files", {
      pattern: normalizeAudioPatternValue(pattern),
      directory: source.directory,
      regex: String(source.regex ?? ""),
      count: files.length,
      files
    });
    return files;
  } catch (error) {
    console.warn("vorfale-tweaks/random-ambient-sounds | Could not browse random sound folder.", error);
    return [];
  }
}

function getAudioSourceCacheKey(source) {
  return `${source.storage}:${source.directory}:${source.regex}:${source.exact ?? ""}`;
}

function resetAudioFileCaches() {
  FILE_CACHE.clear();
  LAST_PICKED.clear();
  debug("audio caches cleared");
}

function resetPlaybackQueue(key) {
  if (!key) return;
  LAST_PICKED.delete(key);
  debug("last picked cleared", { key });
}

function excludeLastPicked(files, last) {
  if (files.length <= 1 || !last) return files;
  const filtered = files.filter(file => file !== last);
  return filtered.length ? filtered : files;
}

function isDirectChildOfDirectory(file, directory) {
  const normalizedFile = encodeFoundryPath(file);
  const normalizedDirectory = encodeFoundryPath(directory).replace(/\/+$/, "");
  const slash = normalizedFile.lastIndexOf("/");
  const parent = slash >= 0 ? normalizedFile.slice(0, slash) : "";
  if (!normalizedDirectory) return parent === "";
  return parent === normalizedDirectory || parent.endsWith(`/${normalizedDirectory}`);
}

function parseAudioPattern(pattern) {
  const raw = normalizeAudioPatternValue(pattern);
  if (!raw) return { storage: "data", directory: "", regex: null };

  const normalized = encodeFoundryPath(raw);
  const slash = normalized.lastIndexOf("/");
  const last = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const directory = slash >= 0 ? normalized.slice(0, slash) : "";

  if (last && isAudioFile(last) && !last.includes("*")) {
    return {
      storage: "data",
      directory,
      regex: wildcardToRegex(last),
      exact: normalized
    };
  }

  if (!last || !last.includes("*")) return { storage: "data", directory: normalized, regex: null };

  return {
    storage: "data",
    directory,
    regex: wildcardToRegex(last)
  };
}

function normalizeAudioPatternValue(value) {
  const raw = String(value ?? "").trim().replaceAll("\\", "/");
  if (!raw.includes(",")) return encodeFoundryPath(raw);

  const parts = raw.split(",")
    .map(part => encodeFoundryPath(part))
    .filter(Boolean);
  if (!parts.length) return "";

  const wildcard = parts.find(part => part.includes("*"));
  if (wildcard) return wildcard;

  const directory = parts.find(part => {
    if (isAudioFile(part)) return false;
    return parts.some(other => isAudioFile(other) && isPathInsideDirectory(other, part));
  });
  if (directory) return directory;

  return parts.at(-1) ?? "";
}

function isPathInsideDirectory(file, directory) {
  const normalizedFile = encodeFoundryPath(file);
  const normalizedDirectory = encodeFoundryPath(directory).replace(/\/+$/, "");
  return normalizedDirectory ? normalizedFile.startsWith(`${normalizedDirectory}/`) : !normalizedFile.includes("/");
}

function encodeFoundryPath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeFoundryPathSegment)
    .join("/");
}

function encodeFoundryPathSegment(segment) {
  if (segment === "*") return segment;

  try {
    return encodeURIComponent(decodeURIComponent(segment)).replaceAll("%2A", "*");
  } catch {
    return encodeURIComponent(segment).replaceAll("%2A", "*");
  }
}

function browseRandomSoundPath(input) {
  if (!input) return;

  const pickerClass = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
  if (!pickerClass) return;

  const current = getBrowseCurrentPath(input.value);
  const callback = path => {
    input.value = normalizePickedAudioPath(path);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  try {
    const picker = new pickerClass({ type: "audio", current, callback });
    picker.render(true);
  } catch (error) {
    console.warn("vorfale-tweaks/random-ambient-sounds | Could not open audio file picker.", error);
  }
}

function getBrowseCurrentPath(value) {
  const source = parseAudioPattern(value);
  return source.directory || normalizeAudioPatternValue(value);
}

function normalizePickedAudioPath(path) {
  const normalized = normalizeAudioPatternValue(path);
  if (!normalized) return "";
  if (!isAudioFile(normalized)) return normalized.endsWith("*") ? normalized : `${normalized.replace(/\/+$/, "")}/*`;

  const slash = normalized.lastIndexOf("/");
  const directory = slash >= 0 ? normalized.slice(0, slash) : "";
  return directory ? `${directory}/*` : "*";
}

function wildcardToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function isAudioFile(path) {
  const clean = String(path ?? "").split(/[?#]/)[0].toLowerCase();
  const ext = clean.split(".").pop();
  return AUDIO_EXTENSIONS.has(ext);
}

function escapeHTML(value) {
  return foundry.utils?.escapeHTML?.(String(value)) ?? String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function debug(message, data) {
  if (globalThis.localStorage?.getItem("vorfaleTweaks.randomAmbientSoundsDebug") !== "true") return;
  console.debug(`vorfale-tweaks/random-ambient-sounds | ${message}`, data ?? "");
}
