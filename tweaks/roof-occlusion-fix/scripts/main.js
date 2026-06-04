const PATCH_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.patch");
const TOKEN_PATCH_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.tokenPatch");
const NAMEPLATE_REFRESH_DELAY = 32;
const NAMEPLATE_MASK_KEY = Symbol.for("vorfaleTweaks.roofOcclusionFix.nameplateMask");

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
  if (typeof originalRefreshState !== "function") return;

  TokenClass.prototype._refreshState = function vorfaleRoofOcclusionRefreshState(...args) {
    originalRefreshState.apply(this, args);
    updateNameplateRoofMask(this);
  };

  if (typeof originalRefreshPosition === "function") {
    TokenClass.prototype._refreshPosition = function vorfaleRoofOcclusionRefreshPosition(...args) {
      originalRefreshPosition.apply(this, args);
      updateNameplateRoofMask(this);
    };
  }

  TokenClass.prototype[TOKEN_PATCH_KEY] = { originalRefreshState, originalRefreshPosition };
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

function updateNameplateRoofMask(token) {
  if (!token?.nameplate) return;

  const roofBounds = getClosedFadeRoofBoundsForNameplate(token);
  if (!context?.isEnabled?.() || !roofBounds.length) {
    clearNameplateRoofMask(token);
    return;
  }

  const mask = getNameplateRoofMask(token);
  drawInverseNameplateMask(token, mask, roofBounds);
  token.nameplate.mask = mask;
}

function getClosedFadeRoofBoundsForNameplate(token) {
  if (canTokenFadeRoof(token)) return [];

  const nameBounds = getNameplateCanvasBounds(token);
  if (!nameBounds) return [];

  const candidates = canvas.primary?.quadtree?.getObjects?.(nameBounds) ?? [];
  const roofBounds = [];
  for (const pco of candidates) {
    if (!shouldLimitFadeOcclusion(pco)) continue;
    if (isRoofCurrentlyRevealed(pco)) return [];
    if (!pco.canvasBounds?.intersects?.(nameBounds)) continue;
    roofBounds.push(pco.canvasBounds);
  }

  return roofBounds;
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
  for (const token of canvas.tokens?.placeables ?? []) updateNameplateRoofMask(token);
}

function isTile(object) {
  return object?.document?.documentName === "Tile";
}

function getNameplateCanvasBounds(token) {
  if (!token?.nameplate?.visible) return null;
  try {
    return token.nameplate.getBounds();
  } catch (_error) {
    return null;
  }
}

function getNameplateRoofMask(token) {
  if (token[NAMEPLATE_MASK_KEY]?.destroyed === false) return token[NAMEPLATE_MASK_KEY];

  const mask = new PIXI.LegacyGraphics();
  mask.name = "vorfale-roof-nameplate-mask";
  token[NAMEPLATE_MASK_KEY] = mask;
  token.addChild(mask);
  return mask;
}

function clearNameplateRoofMask(token) {
  const mask = token?.[NAMEPLATE_MASK_KEY];
  if (token?.nameplate?.mask === mask) token.nameplate.mask = null;
  mask?.clear?.();
}

function drawInverseNameplateMask(token, mask, roofBounds) {
  mask.clear();
  mask.beginFill(0xFFFFFF, 1);
  mask.drawRect(-100000, -100000, 200000, 200000);

  for (const bounds of roofBounds) {
    const points = rectangleBoundsToLocalPolygon(token, bounds);
    if (!points.length) continue;
    mask.beginHole();
    mask.drawPolygon(points);
    mask.endHole();
  }

  mask.endFill();
}

function rectangleBoundsToLocalPolygon(token, bounds) {
  const corners = [
    [bounds.left, bounds.top],
    [bounds.right, bounds.top],
    [bounds.right, bounds.bottom],
    [bounds.left, bounds.bottom]
  ];

  const points = [];
  for (const [x, y] of corners) {
    const point = token.worldTransform.applyInverse(new PIXI.Point(x, y));
    points.push(point.x, point.y);
  }
  return points;
}
