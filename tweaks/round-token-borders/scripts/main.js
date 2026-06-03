const PATCH_KEY = Symbol.for("vorfaleTweaks.roundTokenBorders.patch");

let context;

export function init(tweakContext) {
  context = tweakContext;
  patchTokenBorder();

  Hooks.on("canvasReady", refreshTokenBorders);
  context.onChange(refreshTokenBorders);
}

function patchTokenBorder() {
  const TokenClass = foundry.canvas?.placeables?.Token ?? globalThis.Token;
  if (!TokenClass?.prototype || TokenClass.prototype[PATCH_KEY]) return;

  const original = TokenClass.prototype._refreshBorder;
  TokenClass.prototype[PATCH_KEY] = { original };

  TokenClass.prototype._refreshBorder = function roundTokenBorderRefresh(...args) {
    const result = original?.apply(this, args);
    if (context?.isEnabled?.()) drawRoundBorder(this);
    return result;
  };
}

function drawRoundBorder(token) {
  const border = token?.border;
  if (!border?.clear) return;

  const width = token.w ?? token.document?.width ?? token.bounds?.width;
  const height = token.h ?? token.document?.height ?? token.bounds?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

  const color = getBorderColor(token);
  const lineWidth = Math.max(2, Math.round(Math.min(width, height) / 24));
  const alpha = border.alpha ?? 1;
  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.max(1, (width - lineWidth) / 2);
  const ry = Math.max(1, (height - lineWidth) / 2);

  border.clear();
  border.visible = true;

  if (token.document?.hidden) drawDashedEllipse(border, cx, cy, rx, ry, lineWidth, color, alpha);
  else drawEllipse(border, cx, cy, rx, ry, lineWidth, color, alpha);
}

function getBorderColor(token) {
  try {
    const color = token._getBorderColor?.();
    if (Number.isFinite(color)) return color;
  } catch (_error) {
    // Fall through to public disposition color.
  }

  try {
    return token.getDispositionColor?.() ?? 0xff9900;
  } catch (_error) {
    return 0xff9900;
  }
}

function drawEllipse(graphics, cx, cy, rx, ry, width, color, alpha) {
  applyLineStyle(graphics, width, color, alpha);
  graphics.drawEllipse(cx, cy, rx, ry);
}

function drawDashedEllipse(graphics, cx, cy, rx, ry, width, color, alpha) {
  applyLineStyle(graphics, width, color, alpha);

  const segments = 72;
  const dash = 3;
  const gap = 2;

  for (let i = 0; i < segments; i += dash + gap) {
    const start = (i / segments) * Math.PI * 2;
    const end = (Math.min(i + dash, segments) / segments) * Math.PI * 2;
    drawArcSegment(graphics, cx, cy, rx, ry, start, end, 8);
  }
}

function drawArcSegment(graphics, cx, cy, rx, ry, start, end, steps) {
  for (let step = 0; step <= steps; step++) {
    const t = start + ((end - start) * step) / steps;
    const x = cx + Math.cos(t) * rx;
    const y = cy + Math.sin(t) * ry;
    if (step === 0) graphics.moveTo(x, y);
    else graphics.lineTo(x, y);
  }
}

function applyLineStyle(graphics, width, color, alpha) {
  if (typeof graphics.lineStyle === "function") {
    graphics.lineStyle(width, color, alpha);
    return;
  }

  if (typeof graphics.setStrokeStyle === "function") {
    graphics.setStrokeStyle({ width, color, alpha });
  }
}

function refreshTokenBorders() {
  if (!context?.isEnabled?.()) return;
  for (const token of canvas.tokens?.placeables ?? []) drawRoundBorder(token);
}
