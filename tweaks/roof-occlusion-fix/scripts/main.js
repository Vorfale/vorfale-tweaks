const PATCH_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.patch");

let context;

export function init(tweakContext) {
  context = tweakContext;

  patchPrimarySpriteMesh();
  Hooks.once("ready", patchPrimarySpriteMesh);
  Hooks.on("controlToken", refreshOcclusion);
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
}

function isTile(object) {
  return object?.document?.documentName === "Tile";
}
