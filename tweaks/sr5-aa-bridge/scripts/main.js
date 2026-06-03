const DEBUG_KEY = "vorfaleTweaks.sr5AABridgeDebug";
const RECENT_KEY = "vorfaleTweaks.sr5AABridgeRecent";
const AA_MODULE_ID = "autoanimations";
const AA_AUTOREC_KEY = "aaAutorec";
const BACKUP_KEY = "aaAutorecBackup";

let context;
let originalSettingsSet;
let settingsReady = false;
let restoringAutorec = false;
let startupProtectionUntil = 0;
let menuObserver;
let autosaveTimer;
let lastSavedAutorecHash;

export function init(tweakContext) {
  context = tweakContext;

  patchAutorecSettingsSet();
  patchChatMessageUserAccessor();
  suppressNativeSR5AAHook();
  Hooks.once("ready", async () => {
    settingsReady = true;
    startupProtectionUntil = Date.now() + 15000;
    suppressNativeSR5AAHook();
    await restoreAutorecBackupIfNeeded();
    for (const delay of [500, 2000, 5000, 10000]) window.setTimeout(restoreAutorecBackupIfNeeded, delay);
    startAutorecMenuWatcher();
  });
  for (const delay of [250, 1000, 3000]) window.setTimeout(suppressNativeSR5AAHook, delay);

  Hooks.on("createChatMessage", message => {
    if (!context.isEnabled()) return;
    if (game.system?.id !== "shadowrun5e") return;
    suppressNativeSR5AAHook();
    if (!isOwnMessage(message)) return;

    window.setTimeout(() => handleChatMessage(message), 50);
  });
}

function patchAutorecSettingsSet() {
  if (game.settings.__vorfaleSR5AAAutorecPatch) return;

  originalSettingsSet = game.settings.set.bind(game.settings);
  game.settings.set = async function vorfaleSR5AAAutorecSettingsSet(namespace, key, value, ...args) {
    const result = await originalSettingsSet(namespace, key, value, ...args);

    if (namespace === AA_MODULE_ID && key === AA_AUTOREC_KEY && settingsReady && !restoringAutorec && context?.isEnabled?.()) {
      const backup = getAutorecBackup();
      const incomingHash = hashValue(value);
      if (backup?.hash && incomingHash !== backup.hash && Date.now() < startupProtectionUntil) {
        debug("restore scheduled", { reason: "startup AA overwrite", incomingHash, backupHash: backup.hash });
        window.setTimeout(restoreAutorecBackupIfNeeded, 50);
        return result;
      }

      await saveAutorecBackup(value);
    }

    return result;
  };

  Object.defineProperty(game.settings, "__vorfaleSR5AAAutorecPatch", { value: true });
}

function patchChatMessageUserAccessor() {
  if (game.system?.id !== "shadowrun5e") return;
  const prototype = globalThis.ChatMessage?.prototype;
  if (!prototype || prototype.__vorfaleSR5AAUserPatch) return;

  const descriptor = Object.getOwnPropertyDescriptor(prototype, "user");
  Object.defineProperty(prototype, "user", {
    configurable: true,
    get() {
      const original = descriptor?.get?.call(this) ?? descriptor?.value;
      if (original?.id) return original;

      const userId = this._source?.user ?? this.userId ?? this.author?.id;
      return game.users?.get?.(userId) ?? original ?? null;
    }
  });

  Object.defineProperty(prototype, "__vorfaleSR5AAUserPatch", { value: true });
}

function suppressNativeSR5AAHook() {
  if (game.system?.id !== "shadowrun5e") return;

  const stores = [Hooks.events, Hooks._hooks].filter(Boolean);
  for (const store of stores) {
    const entries = store.createChatMessage;
    if (!Array.isArray(entries)) continue;

    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      const fn = entry?.fn ?? entry;
      if (!isNativeSR5AAHook(fn)) continue;

      entries.splice(index, 1);
      debug("Suppressed native Automated Animations SR5 hook.", { fn: String(fn) });
    }
  }
}

function isNativeSR5AAHook(fn) {
  const source = String(fn ?? "");
  return source.includes("checkChatMessage")
    || source.includes("aa-shadowrun5e")
    || (source.includes("systemData.make") && source.includes("shadowrun"));
}

async function handleChatMessage(message) {
  if (!hasAutomatedAnimations()) {
    debug("Automated Animations API not found.", { message });
    return;
  }

  if (wasAlreadyHandled(message)) return;

  const data = resolveSR5RollData(message);
  debug("Resolved SR5 roll data.", data);

  if (isSR5FollowUpMessage(data)) {
    debug("Skipped: SR5 follow-up defense/resist test.", data);
    return;
  }
  if (!data.isAttackLike) return;
  if (!data.sourceToken) {
    debug("Skipped: source token not found.", data);
    return;
  }
  if (!data.item?.name) {
    debug("Skipped: item name not found.", data);
    return;
  }

  markHandled(message);

  try {
    await AutomatedAnimations.playAnimation(data.sourceToken, data.item, {
      targets: data.targets,
      hitTargets: data.targets,
      playOnMiss: true
    });
    debug("Triggered Automated Animations.", data);
  } catch (error) {
    console.warn("vorfale-tweaks/sr5-aa-bridge | Failed to trigger Automated Animations.", error, data);
  }
}

function resolveSR5RollData(message) {
  const speaker = message.speaker ?? message._source?.speaker ?? {};
  const actor = resolveActor(message, speaker);
  const sourceToken = resolveToken(message, speaker, actor);
  const html = parseHTML(message.content ?? message._source?.content ?? "");
  const flags = message.flags ?? message._source?.flags ?? {};
  const itemId = findItemId(message, html, flags);
  const itemName = findItemName(message, html, flags);
  const item = resolveItem(actor, itemId, itemName);
  const targets = Array.from(game.user?.targets ?? []);
  const isAttackLike = looksLikeSR5Attack(message, html, item, itemName);

  return {
    message,
    speaker,
    actor,
    sourceToken,
    item,
    itemId,
    itemName,
    targets,
    isAttackLike
  };
}

function resolveActor(message, speaker) {
  const actorId = speaker.actor
    ?? getProperty(message, "flags.shadowrun5e.actorId")
    ?? getProperty(message, "flags.sr5.actorId")
    ?? getProperty(message, "flags.sr5e.actorId")
    ?? findDeepValue(message.flags, ["actorId", "actor"]);

  return game.actors?.get(actorId)
    ?? canvas.tokens?.get(speaker.token)?.actor
    ?? game.actors?.getName(speaker.alias)
    ?? null;
}

function resolveToken(message, speaker, actor) {
  const tokenId = speaker.token
    ?? getProperty(message, "flags.shadowrun5e.tokenId")
    ?? getProperty(message, "flags.sr5.tokenId")
    ?? findDeepValue(message.flags, ["tokenId", "token"]);

  const token = canvas.tokens?.get(tokenId)
    ?? canvas.tokens?.placeables?.find(placeable => placeable.document?.id === tokenId)
    ?? canvas.tokens?.placeables?.find(placeable => placeable.actor?.id === actor?.id)
    ?? canvas.tokens?.controlled?.find(placeable => placeable.actor?.id === actor?.id)
    ?? null;

  return token;
}

function resolveItem(actor, itemId, itemName) {
  const item = actor?.items?.get?.(itemId)
    ?? actor?.items?.find?.(candidate => normalize(candidate.name) === normalize(itemName))
    ?? actor?.items?.find?.(candidate => normalize(itemName).includes(normalize(candidate.name)))
    ?? actor?.items?.find?.(candidate => normalize(candidate.name).includes(normalize(itemName)));

  if (item) return item;
  if (itemName) return { name: itemName };
  return null;
}

function findItemId(message, html, flags) {
  const candidates = [
    getProperty(message, "flags.shadowrun5e.itemId"),
    getProperty(message, "flags.sr5.itemId"),
    getProperty(message, "flags.sr5e.itemId"),
    getProperty(message, "flags.core.sourceId"),
    html.querySelector("[data-item-id]")?.dataset?.itemId,
    html.querySelector("[data-item]")?.dataset?.item,
    findDeepValue(flags, ["itemId", "itemUuid", "item"])
  ].filter(Boolean);

  return candidates.map(value => String(value).split(".").pop()).find(Boolean) ?? null;
}

function findItemName(message, html, flags) {
  const direct = [
    getProperty(message, "flags.shadowrun5e.itemName"),
    getProperty(message, "flags.sr5.itemName"),
    getProperty(message, "flags.sr5e.itemName"),
    findDeepValue(flags, ["itemName", "weaponName", "name"])
  ].filter(Boolean).find(value => typeof value === "string");
  if (direct) return direct.trim();

  const selectors = [
    "[data-item-name]",
    ".item-name",
    ".sr5-item-name",
    ".roll-title",
    ".card-title",
    "h1",
    "h2",
    "h3",
    "h4"
  ];

  for (const selector of selectors) {
    const element = html.querySelector(selector);
    const name = element?.dataset?.itemName ?? element?.textContent;
    if (name && cleanName(name)) return cleanName(name);
  }

  return cleanName(message.flavor ?? message._source?.flavor ?? html.textContent ?? "");
}

function looksLikeSR5Attack(message, html, item, itemName) {
  const type = String(item?.type ?? item?.system?.type ?? "").toLowerCase();
  if (["weapon", "range_weapon", "melee_weapon", "spell", "complex_form"].includes(type)) return true;

  const system = item?.system ?? {};
  if (system.action || system.weaponType || system.category === "weapon" || system.type === "weapon") return true;

  const text = `${message.flavor ?? ""} ${html.textContent ?? ""} ${itemName ?? ""}`.toLowerCase();
  const attackWords = [
    "attack",
    "weapon",
    "firearm",
    "shoot",
    "shot",
    "melee",
    "ranged",
    "spellcasting",
    "кидать",
    "атака",
    "оруж",
    "стрель",
    "выстрел",
    "заклин"
  ];
  const rollWords = ["hits", "success", "успех", "хит", "куб", "dice"];

  return attackWords.some(word => text.includes(word)) || (itemName && rollWords.some(word => text.includes(word)));
}

function isSR5FollowUpMessage(data) {
  const html = parseHTML(data.message?.content ?? "");
  const candidates = [
    data.message?.flavor,
    data.itemName,
    html.querySelector(".roll-title")?.textContent,
    html.querySelector(".card-title")?.textContent,
    html.querySelector(".test-title")?.textContent,
    html.querySelector("h1")?.textContent,
    html.querySelector("h2")?.textContent,
    html.querySelector("h3")?.textContent,
    html.querySelector("h4")?.textContent
  ].filter(Boolean).map(value => cleanName(value).toLowerCase());

  const followUpWords = [
    "physical defense",
    "ranged defense",
    "melee defense",
    "defense test",
    "defence test",
    "damage resist",
    "damage resistance",
    "physical damage resist",
    "matrix defense",
    "spell defense",
    "resist",
    "resistance",
    "soak",
    "dodge",
    "defense",
    "defence",
    "защит",
    "сопротив",
    "резист",
    "уклон",
    "поглощ"
  ];

  return candidates.some(text => followUpWords.some(word => text.includes(word)));
}

function hasAutomatedAnimations() {
  return typeof globalThis.AutomatedAnimations?.playAnimation === "function";
}

function isOwnMessage(message) {
  const user = message.user;
  const userId = typeof user === "string" ? user : user?.id;
  return userId === game.user?.id || message._source?.user === game.user?.id;
}

function wasAlreadyHandled(message) {
  const id = message.id ?? message._id;
  if (!id) return false;

  const recent = getRecent();
  return recent.includes(id);
}

function markHandled(message) {
  const id = message.id ?? message._id;
  if (!id) return;

  const recent = getRecent().filter(existing => existing !== id).slice(-20);
  recent.push(id);
  sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function getRecent() {
  try {
    return JSON.parse(sessionStorage.getItem(RECENT_KEY) ?? "[]");
  } catch (_error) {
    return [];
  }
}

function parseHTML(content) {
  const element = document.createElement("div");
  element.innerHTML = String(content ?? "");
  return element;
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^(attack|weapon|roll|test|атака|бросок|тест)\s*[:\-]\s*/i, "")
    .trim();
}

function normalize(value) {
  return cleanName(value).toLowerCase();
}

function getProperty(object, path) {
  return foundry.utils?.getProperty?.(object, path) ?? path.split(".").reduce((value, key) => value?.[key], object);
}

function findDeepValue(object, names) {
  const queue = [object];
  const seen = new Set();

  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    for (const name of names) {
      if (typeof value[name] === "string" && value[name]) return value[name];
      if (value[name]?.id) return value[name].id;
      if (value[name]?.name) return value[name].name;
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }

  return null;
}

function startAutorecMenuWatcher() {
  if (menuObserver) return;

  menuObserver = new MutationObserver(() => bindAutorecMenus());
  menuObserver.observe(document.body, { childList: true, subtree: true });
  bindAutorecMenus();
}

function bindAutorecMenus() {
  for (const menu of findAutorecMenus()) {
    if (menu.dataset.vorfaleSR5AAAutorecBound === "true") continue;
    menu.dataset.vorfaleSR5AAAutorecBound = "true";

    for (const eventName of ["change", "input", "click"]) {
      menu.addEventListener(eventName, () => scheduleCurrentAutorecSave(), true);
    }

    scheduleCurrentAutorecSave();
    debug("autorec menu bound", { menu });
  }
}

function findAutorecMenus() {
  return Array.from(document.querySelectorAll(".app, .application, dialog, [id^='app-']")).filter(element => {
    const title = element.querySelector?.(".window-title, header h1, .window-header h1")?.textContent ?? "";
    return title.includes("A-A Automatic Recognition Menu");
  });
}

function scheduleCurrentAutorecSave() {
  if (!context?.isEnabled?.()) return;
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(saveCurrentAutorecSetting, 350);
}

async function saveCurrentAutorecSetting() {
  if (!context?.isEnabled?.() || !game.modules?.get(AA_MODULE_ID)?.active) return;

  let current;
  try {
    current = game.settings.get(AA_MODULE_ID, AA_AUTOREC_KEY);
  } catch (error) {
    debug("AA setting unavailable", { reason: "autosave get failed", error });
    return;
  }

  const hash = hashValue(current);
  if (hash === lastSavedAutorecHash) return;

  try {
    await originalSettingsSet(AA_MODULE_ID, AA_AUTOREC_KEY, duplicateValue(current));
    await saveAutorecBackup(current);
    debug("current autorec persisted", { hash });
  } catch (error) {
    debug("AA setting unavailable", { reason: "autosave persist failed", error });
  }
}

async function restoreAutorecBackupIfNeeded() {
  if (!context?.isEnabled?.()) {
    debug("restore skipped", { reason: "tweak disabled" });
    return;
  }

  if (!game.modules?.get(AA_MODULE_ID)?.active) {
    debug("AA setting unavailable", { reason: "Automated Animations is not active" });
    return;
  }

  const backup = getAutorecBackup();
  let current;
  try {
    current = game.settings.get(AA_MODULE_ID, AA_AUTOREC_KEY);
  } catch (error) {
    debug("AA setting unavailable", { reason: "get failed", error });
    return;
  }

  if (!backup?.hash || backup.value === undefined) {
    await saveAutorecBackup(current);
    debug("restore skipped", { reason: "initial backup saved" });
    return;
  }

  const currentHash = hashValue(current);
  if (currentHash === backup.hash) {
    debug("restore skipped", { reason: "current matches backup", hash: currentHash });
    return;
  }

  restoringAutorec = true;
  try {
    await originalSettingsSet(AA_MODULE_ID, AA_AUTOREC_KEY, duplicateValue(backup.value));
    debug("backup restored", { currentHash, backupHash: backup.hash, savedAt: backup.savedAt });
  } catch (error) {
    debug("AA setting unavailable", { reason: "restore failed", error });
  } finally {
    restoringAutorec = false;
  }
}

async function saveAutorecBackup(value) {
  const hash = hashValue(value);
  if (hash === lastSavedAutorecHash) return;

  const backup = {
    value: duplicateValue(value),
    hash,
    savedAt: Date.now()
  };

  try {
    await originalSettingsSet(context.moduleId, BACKUP_KEY, backup);
    lastSavedAutorecHash = backup.hash;
    debug("backup saved", { hash: backup.hash, savedAt: backup.savedAt });
  } catch (error) {
    debug("AA setting unavailable", { reason: "backup save failed", error });
  }
}

function getAutorecBackup() {
  try {
    return game.settings.get(context.moduleId, BACKUP_KEY);
  } catch (error) {
    debug("restore skipped", { reason: "backup setting unavailable", error });
    return null;
  }
}

function duplicateValue(value) {
  return foundry.utils?.deepClone?.(value) ?? JSON.parse(JSON.stringify(value));
}

function hashValue(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value).sort().reduce((sorted, key) => {
    sorted[key] = sortValue(value[key]);
    return sorted;
  }, {});
}

function debug(message, data) {
  if (localStorage.getItem(DEBUG_KEY) !== "true") return;
  console.debug(`vorfale-tweaks/sr5-aa-bridge | ${message}`, data);
}
