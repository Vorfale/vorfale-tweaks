const PATCH_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.patch");
const TOKEN_PATCH_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.tokenPatch");
const NAMEPLATE_REFRESH_DELAY = 32;
const PRIMARY_NAMEPLATE_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.primaryNameplate");

let context;
let nameplateRefreshTimer = null;

export function init(tweakContext) {
  context = tweakContext;

  patchPrimarySpriteMesh();
  patchTokenNameplates();
  Hooks.once("ready", patchPrimarySpriteMesh);
  Hooks.once("ready", patchTokenNameplates);
  Hooks.on("controlToken", refreshOcclusion);
  Hooks.on("updateToken", refreshOcclusion);
  Hooks.on("deleteToken", (_document, _options, _userId) => scheduleNameplateRefresh());
  Hooks.on("canvasReady", installNameplateHoverRefresh);
  context.onChange(refreshOcclusion);

  if (game.ready) refreshOcclusion();
  else Hooks.once("ready", refreshOcclusion);
}

function patchPrimarySpriteMesh() {
  const MeshClass = foundry.canvas?.primary?.PrimarySpriteMesh;
  if (!MeshClass?.prototype || MeshClass.prototype[PATCH_KEY]) return;

  const original = MeshClass.prototype.testOcclusion;
  if (typeof original !== "function") return;

  MeshClass.prototype.testOcclusion = function vorfaleRoofOcclusionTest(token) {
    if (context?.isEnabled?.() && shouldLimitFadeOcclusion(this) && !canTokenFadeRoof(token)) return false;
    return original.call(this, token);
  };

  MeshClass.prototype[PATCH_KEY] = { original };
}

function patchTokenNameplates() {
  const TokenClass = foundry.canvas?.placeables?.Token;
  if (!TokenClass?.prototype || TokenClass.prototype[TOKEN_PATCH_KEY]) return;

  const originalRefreshState = TokenClass.prototype._refreshState;
  const originalRefreshPosition = TokenClass.prototype._refreshPosition;
  const originalRefreshNameplate = TokenClass.prototype._refreshNameplate;
  const originalRefreshElevation = TokenClass.prototype._refreshElevation;
  const originalDestroy = TokenClass.prototype.destroy;
  if (typeof originalRefreshState !== "function") return;

  TokenClass.prototype._refreshState = function vorfaleRoofOcclusionRefreshState(...args) {
    originalRefreshState.apply(this, args);
    updatePrimaryNameplate(this);
  };

  if (typeof originalRefreshPosition === "function") {
    TokenClass.prototype._refreshPosition = function vorfaleRoofOcclusionRefreshPosition(...args) {
      originalRefreshPosition.apply(this, args);
      updatePrimaryNameplate(this);
    };
  }

  if (typeof originalRefreshNameplate === "function") {
    TokenClass.prototype._refreshNameplate = function vorfaleRoofOcclusionRefreshNameplate(...args) {
      originalRefreshNameplate.apply(this, args);
      invalidatePrimaryNameplateTexture(this);
      updatePrimaryNameplate(this);
    };
  }

  if (typeof originalRefreshElevation === "function") {
    TokenClass.prototype._refreshElevation = function vorfaleRoofOcclusionRefreshElevation(...args) {
      originalRefreshElevation.apply(this, args);
      updatePrimaryNameplate(this);
    };
  }

  if (typeof originalDestroy === "function") {
    TokenClass.prototype.destroy = function vorfaleRoofOcclusionDestroy(...args) {
      destroyPrimaryNameplate(this);
      return originalDestroy.apply(this, args);
    };
  }

  TokenClass.prototype[TOKEN_PATCH_KEY] = {
    originalRefreshState,
    originalRefreshPosition,
    originalRefreshNameplate,
    originalRefreshElevation,
    originalDestroy
  };
}

function shouldLimitFadeOcclusion(mesh) {
  const tile = mesh?.object;
  if (!isTile(tile)) return false;

  const modes = Number(mesh.occlusionMode ?? 0);
  const fade = CONST?.OCCLUSION_MODES?.FADE ?? CONST?.TILE_OCCLUSION_MODES?.FADE ?? 0;
  return fade !== 0 && (modes & fade) === fade;
}

function canTokenFadeRoof(token) {
  if (!token?.visible || !token?.interactive) return false;
  if (token.controlled) return true;
  if (token.vision?.active) return true;

  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length) return controlled.includes(token);

  return token === canvas.tokens?.hover;
}

function refreshOcclusion() {
  if (!canvas?.ready) return;
  canvas.perception?.update?.({
    refreshOcclusionStates: true,
    refreshOcclusionMask: true,
    refreshOccludedSurfaces: true
  });
  scheduleNameplateRefresh();
}

function installNameplateHoverRefresh() {
  document.removeEventListener("mousemove", scheduleNameplateRefresh);
  document.addEventListener("mousemove", scheduleNameplateRefresh, { passive: true });
}

function scheduleNameplateRefresh() {
  window.clearTimeout(nameplateRefreshTimer);
  nameplateRefreshTimer = window.setTimeout(refreshTokenNameplates, NAMEPLATE_REFRESH_DELAY);
}

function refreshTokenNameplates() {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens?.placeables ?? []) updatePrimaryNameplate(token);
}

function isTile(object) {
  return object?.document?.documentName === "Tile";
}

function shouldUsePrimaryNameplate(token) {
  return !!context?.isEnabled?.()
    && !!canvas?.ready
    && !!token?.nameplate
    && !token.destroyed
    && token.visible
    && token.nameplate.visible;
}

function updatePrimaryNameplate(token) {
  if (!token?.nameplate) return;

  const usePrimary = shouldUsePrimaryNameplate(token);
  token.nameplate.renderable = !usePrimary;
  if (!usePrimary) {
    destroyPrimaryNameplate(token);
    return;
  }

  const data = getPrimaryNameplate(token);
  const texture = getPrimaryNameplateTexture(token, data);
  if (!texture) return;

  const mesh = data.mesh;
  mesh.texture = texture;
  mesh.visible = token.nameplate.visible && token.nameplate.renderable !== true;
  mesh.alpha = token.nameplate.worldAlpha ?? 1;
  mesh.position.copyFrom(token.toGlobal(token.nameplate.position));
  mesh.anchor.set(0.5, 0);
  mesh.scale.set(token.nameplate.worldTransform.a >= 0 ? 1 : -1, token.nameplate.worldTransform.d >= 0 ? 1 : -1);
  mesh.elevation = token.mesh?.elevation ?? token.document?.elevation ?? 0;
  mesh.sortLayer = token.mesh?.sortLayer ?? foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS.TOKENS;
  mesh.sort = token.mesh?.sort ?? token.document?.sort ?? 0;
  mesh.zIndex = (token.mesh?.zIndex ?? token.zIndex ?? 0) + 0.01;
  mesh.occlusionMode = CONST.OCCLUSION_MODES.NONE;
  mesh.hoverFade = false;
  mesh.hidden = token.document?.hidden ?? false;
  canvas.primary.sortDirty = true;
}

function getPrimaryNameplate(token) {
  const existing = token[PRIMARY_NAMEPLATE_KEY];
  if (existing?.mesh?.destroyed === false) return existing;

  const MeshClass = foundry.canvas?.primary?.PrimarySpriteMesh;
  const mesh = new MeshClass({
    name: `${token.objectId}.vorfale-nameplate`,
    texture: PIXI.Texture.EMPTY,
    object: token
  });
  canvas.primary.addChild(mesh);
  token[PRIMARY_NAMEPLATE_KEY] = { mesh, texture: null, signature: "" };
  return token[PRIMARY_NAMEPLATE_KEY];
}

function getPrimaryNameplateTexture(token, data) {
  const signature = getNameplateTextureSignature(token);
  if (data.texture && data.signature === signature) return data.texture;

  data.texture?.destroy?.(true);
  data.signature = signature;
  data.texture = null;

  const TextClass = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
  const text = new TextClass(token.nameplate.text, token.nameplate.style);
  const scale = token.nameplate.scale;
  text.anchor.set(0.5, 0);
  text.scale.set(scale.x, scale.y);
  try {
    data.texture = canvas.app.renderer.generateTexture(text, {
      resolution: canvas.app.renderer.resolution,
      multisample: PIXI.MSAA_QUALITY.NONE
    });
  } finally {
    text.destroy();
  }
  return data.texture;
}

function getNameplateTextureSignature(token) {
  const style = token.nameplate.style;
  return JSON.stringify({
    text: token.nameplate.text,
    scaleX: token.nameplate.scale.x,
    scaleY: token.nameplate.scale.y,
    style: style?.toFontString?.() ?? String(style)
  });
}

function invalidatePrimaryNameplateTexture(token) {
  const data = token?.[PRIMARY_NAMEPLATE_KEY];
  if (data) data.signature = "";
}

function destroyPrimaryNameplate(token) {
  const data = token?.[PRIMARY_NAMEPLATE_KEY];
  if (!data) return;
  if (token?.nameplate) token.nameplate.renderable = true;
  data.texture?.destroy?.(true);
  data.mesh?.destroy?.({ children: true });
  token[PRIMARY_NAMEPLATE_KEY] = null;
}
