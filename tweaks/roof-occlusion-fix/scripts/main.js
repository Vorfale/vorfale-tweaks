const PATCH_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.patch");
const TOKEN_PATCH_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.tokenPatch");

let context;
let originalTestOcclusion = null;
let nameplateRefreshFrame = null;

export function init(tweakContext) {
  context = tweakContext;

  patchPrimarySpriteMesh();
  patchTokenNameplates();
  Hooks.once("ready", patchPrimarySpriteMesh);
  Hooks.once("ready", patchTokenNameplates);
  Hooks.on("controlToken", refreshOcclusion);
  Hooks.on("updateToken", refreshOcclusion);
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
  originalTestOcclusion = original;

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
  const originalRefreshVisibility = TokenClass.prototype._refreshVisibility;
  if (typeof originalRefreshState !== "function") return;

  TokenClass.prototype._refreshState = function vorfaleRoofOcclusionRefreshState(...args) {
    originalRefreshState.apply(this, args);
    applyRoofNameplateVisibility(this);
  };

  if (typeof originalRefreshVisibility === "function") {
    TokenClass.prototype._refreshVisibility = function vorfaleRoofOcclusionRefreshVisibility(...args) {
      originalRefreshVisibility.apply(this, args);
      this._refreshState?.();
    };
  }

  TokenClass.prototype[TOKEN_PATCH_KEY] = { originalRefreshState, originalRefreshVisibility };
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

function shouldHideTokenNameplateUnderRoof(token) {
  if (!token?.nameplate?.visible) return false;
  if (!token.visible) return false;
  if (canTokenFadeRoof(token)) return false;
  return isTokenUnderClosedFadeRoof(token);
}

function applyRoofNameplateVisibility(token) {
  // Never force-show names. Foundry decides whether the nameplate may be visible;
  // this tweak can only additionally hide it while a closed fade roof covers the token.
  if (context?.isEnabled?.() && shouldHideTokenNameplateUnderRoof(token)) token.nameplate.visible = false;
}

function isTokenUnderClosedFadeRoof(token) {
  let underFadeRoof = false;
  const candidates = canvas.primary?.quadtree?.getObjects?.(token.bounds) ?? [];

  for (const pco of candidates) {
    if (!shouldLimitFadeOcclusion(pco)) continue;
    if (!testRoofOcclusion(pco, token)) continue;

    underFadeRoof = true;
    if (isRoofCurrentlyRevealed(pco)) return false;
  }

  return underFadeRoof;
}

function isRoofCurrentlyRevealed(mesh) {
  if (mesh.occluded) return true;
  const state = mesh._occlusionState ?? {};
  const hoverState = mesh._hoverFadeState ?? {};
  return Number(state.fade ?? 0) > 0
    || Number(state.radial ?? 0) > 0
    || Number(state.vision ?? 0) > 0
    || Number(hoverState.occlusion ?? 0) > 0;
}

function testRoofOcclusion(mesh, token) {
  const original = originalTestOcclusion ?? mesh?.[PATCH_KEY]?.original;
  if (typeof original !== "function") return false;
  try {
    return original.call(mesh, token) === true;
  } catch (_error) {
    return false;
  }
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
  if (nameplateRefreshFrame !== null) return;
  nameplateRefreshFrame = window.requestAnimationFrame(() => {
    nameplateRefreshFrame = null;
    refreshTokenNameplates();
  });
}

function refreshTokenNameplates() {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens?.placeables ?? []) token._refreshState?.();
}

function isTile(object) {
  return object?.document?.documentName === "Tile";
}
