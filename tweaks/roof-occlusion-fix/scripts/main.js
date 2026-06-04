const PATCH_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.patch");
const TOKEN_PATCH_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.tokenPatch");

let context;
let originalTestOcclusion = null;

export function init(tweakContext) {
  context = tweakContext;

  patchPrimarySpriteMesh();
  patchTokenNameplates();
  Hooks.once("ready", patchPrimarySpriteMesh);
  Hooks.once("ready", patchTokenNameplates);
  Hooks.on("controlToken", refreshOcclusion);
  Hooks.on("updateToken", refreshOcclusion);
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

  const original = TokenClass.prototype._refreshState;
  if (typeof original !== "function") return;

  TokenClass.prototype._refreshState = function vorfaleRoofOcclusionRefreshState(...args) {
    original.apply(this, args);
    if (context?.isEnabled?.() && shouldHideTokenNameplateUnderRoof(this)) this.nameplate.visible = false;
  };

  TokenClass.prototype[TOKEN_PATCH_KEY] = { original };
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
  if (canTokenFadeRoof(token)) return false;
  return isTokenUnderLimitedFadeRoof(token);
}

function isTokenUnderLimitedFadeRoof(token) {
  const candidates = canvas.primary?.quadtree?.getObjects?.(token.bounds) ?? [];
  for (const pco of candidates) {
    if (!shouldLimitFadeOcclusion(pco)) continue;
    if (testRoofOcclusion(pco, token)) return true;
  }
  return false;
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
  for (const token of canvas.tokens?.placeables ?? []) refreshTokenNameplate(token);
}

function refreshTokenNameplate(token) {
  token?.renderFlags?.set?.({ refreshState: true, refreshNameplate: true });
}

function isTile(object) {
  return object?.document?.documentName === "Tile";
}
