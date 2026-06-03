const FLAG_HIDE = "hideTokensUnderBackground";
const LEGACY_LEVELS_MODULE_ID = "level-token-cull-v14";
const SAMPLERS = new Map();

let context;
let refreshTimer = null;

export function init(tweakContext) {
  context = tweakContext;

  if (!game.ready) {
    Hooks.once("ready", start);
    return;
  }

  start();
}

function start() {
  console.info("vorfale-tweaks/levels | Starting Levels tweak.");
  installRenderHooks();
  observeLevelConfigDialogs();
  installCanvasHooks();
  injectIntoOpenApplications();

  context.onChange(() => {
    removeOpenControls();
    injectIntoOpenApplications();
    restoreTokens();
    scheduleTokenCullRefresh();
  });
}

function installRenderHooks() {
  for (const hook of ["renderLevelConfig", "renderLevelSheet", "renderLevelApplication", "renderSceneConfig"]) {
    Hooks.on(hook, (app, html) => injectLevelControl(app, html));
  }

  Hooks.on("renderApplicationV2", (app, html) => injectLevelControl(app, html));
  Hooks.on("renderApplication", (app, html) => injectLevelControl(app, html));
}

function installCanvasHooks() {
  for (const hook of ["canvasReady", "canvasPan", "controlToken", "updateToken", "createToken", "deleteToken", "updateLevel", "updateScene", "sightRefresh", "lightingRefresh", "refreshToken"]) {
    Hooks.on(hook, scheduleTokenCullRefresh);
  }

  scheduleTokenCullRefresh();
}

function observeLevelConfigDialogs() {
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        maybeInjectObservedElement(node);
        node.querySelectorAll?.(".application, .app, dialog").forEach(maybeInjectObservedElement);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function maybeInjectObservedElement(element) {
  const app = getApplicationForElement(element);
  if (app) {
    window.setTimeout(() => injectLevelControl(app, element), 0);
    return;
  }

  window.setTimeout(() => injectLevelControl(findLevelApplicationForElement(element), element), 0);
}

function getApplicationForElement(element) {
  const appId = element.dataset?.appid ?? element.closest?.("[data-appid]")?.dataset?.appid;
  if (!appId) return null;
  return ui.windows?.[appId] ?? foundry.applications.instances?.get?.(appId) ?? null;
}

function injectIntoOpenApplications() {
  for (const app of Object.values(ui.windows ?? {})) {
    injectLevelControl(app, app.element);
  }

  const instances = foundry.applications?.instances;
  if (instances?.values) {
    for (const app of instances.values()) injectLevelControl(app, app.element);
  }
}

function findLevelApplicationForElement(element) {
  const candidates = [
    ...Object.values(ui.windows ?? {}),
    ...Array.from(foundry.applications?.instances?.values?.() ?? [])
  ];

  return candidates.find(app => {
    const appElement = normalizeElement(app.element);
    return appElement?.contains?.(element) && isLevel(app.document ?? app.object);
  }) ?? null;
}

function injectLevelControl(app, html) {
  const element = normalizeElement(html);
  if (!element) return;
  const root = element.closest?.(".application, .app, dialog") ?? element;

  if (!context.isEnabled()) {
    removeControlsIn(root);
    return;
  }

  const level = getLevelDocument(app, element);
  if (!level) return;

  const form = element.querySelector("form") ?? element;
  const formExisting = normalizeExistingControls(root);
  if (formExisting) {
    syncExistingControl(formExisting, level);
    return;
  }

  const anchor = findInsertionAnchor(form);
  if (!anchor) return;

  anchor.insertAdjacentElement("afterend", buildControl(level));
  console.info("vorfale-tweaks/levels | Injected Level control.", level.name ?? level.id);
}

function normalizeElement(html) {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? null;
  if (html?.jquery) return html[0] ?? null;
  return null;
}

function getLevelDocument(app, element) {
  const doc = app?.document ?? app?.object;
  if (isLevel(doc)) return doc;

  const uuid = element.querySelector("[name='uuid']")?.value ?? element.dataset?.documentUuid;
  const fromUuid = uuid ? fromUuidSyncSafe(uuid) : null;
  if (isLevel(fromUuid)) return fromUuid;

  return null;
}

function fromUuidSyncSafe(uuid) {
  try {
    return globalThis.fromUuidSync?.(uuid) ?? null;
  } catch (_error) {
    return null;
  }
}

function isLevel(document) {
  return document?.documentName === "Level";
}

function findInsertionAnchor(form) {
  return form.querySelector("[name='background.alphaThreshold']")?.closest(".form-group")
    ?? form.querySelector("[name='background.src']")?.closest(".form-group")
    ?? form.querySelector("[name='visibility.mode']")?.closest(".form-group")
    ?? form.querySelector("[name='visibility.enabled']")?.closest(".form-group")
    ?? form.querySelector(".tab.active .form-group:last-of-type")
    ?? form.querySelector(".form-group:last-of-type");
}

function buildControl(level) {
  const wrapper = document.createElement("section");
  wrapper.className = "level-token-cull-v14-control";

  const checked = getLevelHideFlag(level);
  wrapper.innerHTML = `
    <div class="form-group">
      <label>${context.localize("HideTokensUnderFloor")}</label>
      <div class="form-fields">
        <input type="checkbox" ${checked ? "checked" : ""}>
      </div>
      <p class="hint">${context.localize("HideTokensUnderFloorHint")}</p>
    </div>
  `;

  const checkbox = wrapper.querySelector("input");
  checkbox.addEventListener("change", async () => {
    await level.setFlag(context.moduleId, FLAG_HIDE, checkbox.checked);
    scheduleTokenCullRefresh();
  });

  return wrapper;
}

function syncExistingControl(control, level) {
  const checkbox = control.querySelector("input[type='checkbox']");
  if (!checkbox) return;
  checkbox.checked = getLevelHideFlag(level);
}

function removeOpenControls() {
  for (const control of document.querySelectorAll(".level-token-cull-v14-control")) control.remove();
}

function removeControlsIn(element) {
  for (const control of element.querySelectorAll(".level-token-cull-v14-control")) control.remove();
}

function normalizeExistingControls(container) {
  const controls = Array.from(container.querySelectorAll(".level-token-cull-v14-control"));
  const [first, ...duplicates] = controls;
  for (const duplicate of duplicates) duplicate.remove();
  return first ?? null;
}

function scheduleTokenCullRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshTokenCull, 50);
}

async function refreshTokenCull() {
  if (!canvas?.ready || !canvas.tokens) return;

  restoreTokens();
  if (!context.isEnabled()) return;

  const level = getViewedLevel();
  if (!getLevelHideFlag(level)) return;
  if (!level.background?.src) return;

  const sampler = await getBackgroundSampler(level);
  if (!sampler) return;

  const levelBottom = Number(level.elevation?.bottom ?? 0);
  const threshold = Number(level.background?.alphaThreshold ?? 0.75);

  for (const token of canvas.tokens.placeables ?? []) {
    if (!isTokenBelowLevel(token, levelBottom)) continue;
    const underOpaqueFloor = isPointOpaqueUnderBackground(token.center, sampler, threshold);
    const inActiveVision = isTokenInActiveVision(token);
    if (!underOpaqueFloor && inActiveVision) continue;
    setTokenCulled(token, true);
  }
}

function restoreTokens() {
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token[context.moduleId]?.culled) setTokenCulled(token, false);
  }
}

function getViewedLevel() {
  const levels = Array.from(canvas.scene?.levels ?? []);
  return levels.find(level => level.isView) ?? levels.find(level => level.isVisible);
}

function getLevelHideFlag(level) {
  return safeGetFlag(level, context.moduleId, FLAG_HIDE) === true
    || level?.flags?.[LEGACY_LEVELS_MODULE_ID]?.[FLAG_HIDE] === true;
}

function safeGetFlag(document, scope, key) {
  try {
    return document?.getFlag(scope, key);
  } catch (_error) {
    return undefined;
  }
}

function isTokenBelowLevel(token, levelBottom) {
  const elevation = Number(token.document?.elevation ?? token.elevation ?? 0);
  return elevation < levelBottom;
}

function isPointOpaqueUnderBackground(point, sampler, threshold) {
  if (!point) return false;

  const dimensions = canvas.dimensions;
  const sceneX = dimensions?.sceneX ?? 0;
  const sceneY = dimensions?.sceneY ?? 0;
  const sceneWidth = dimensions?.sceneWidth ?? canvas.scene?.width ?? 1;
  const sceneHeight = dimensions?.sceneHeight ?? canvas.scene?.height ?? 1;

  const normalizedX = (point.x - sceneX) / sceneWidth;
  const normalizedY = (point.y - sceneY) / sceneHeight;
  if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return false;

  return sampler.alphaAt(normalizedX, normalizedY) > threshold;
}

function isTokenInActiveVision(token) {
  const point = getTokenVisibilityPoint(token);

  try {
    return canvas.visibility?.testVisibility?.(point, { object: token, tolerance: 2 }) ?? true;
  } catch (error) {
    console.debug("vorfale-tweaks/levels | Could not test active vision for token.", token, error);
    return true;
  }
}

function getTokenVisibilityPoint(token) {
  const center = token.center ?? { x: token.x, y: token.y };
  const elevation = Number(token.document?.elevation ?? token.elevation ?? 0);
  return { x: center.x, y: center.y, elevation };
}

async function getBackgroundSampler(level) {
  const src = level.background?.src;
  if (!src) return null;

  if (!SAMPLERS.has(src)) {
    SAMPLERS.set(src, loadAlphaSampler(src).catch(error => {
      console.warn("vorfale-tweaks/levels | Could not sample level background transparency.", error);
      SAMPLERS.delete(src);
      return null;
    }));
  }

  return SAMPLERS.get(src);
}

async function loadAlphaSampler(src) {
  const image = await loadImage(src);
  const canvasElement = document.createElement("canvas");
  canvasElement.width = image.naturalWidth || image.width;
  canvasElement.height = image.naturalHeight || image.height;

  const context2d = canvasElement.getContext("2d", { willReadFrequently: true });
  context2d.drawImage(image, 0, 0);
  const imageData = context2d.getImageData(0, 0, canvasElement.width, canvasElement.height);

  return {
    alphaAt(normalizedX, normalizedY) {
      const x = clamp(Math.floor(normalizedX * (canvasElement.width - 1)), 0, canvasElement.width - 1);
      const y = clamp(Math.floor(normalizedY * (canvasElement.height - 1)), 0, canvasElement.height - 1);
      return imageData.data[((y * canvasElement.width) + x) * 4 + 3] / 255;
    }
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    image.src = src;
  });
}

function setTokenCulled(token, culled) {
  token[context.moduleId] ??= {};

  if (culled && !token[context.moduleId].culled) {
    token[context.moduleId].visible = token.visible;
    token[context.moduleId].renderable = token.renderable;
    token[context.moduleId].eventMode = token.eventMode;
  }

  token[context.moduleId].culled = culled;
  token.visible = culled ? false : token[context.moduleId].visible ?? true;
  token.renderable = culled ? false : token[context.moduleId].renderable ?? true;
  token.eventMode = culled ? "none" : token[context.moduleId].eventMode ?? "auto";

  if (!culled) delete token[context.moduleId];
}
