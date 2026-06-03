const QUICK_INSERT_MODULE_ID = "quick-insert";
const DEFAULT_BINDING = { key: "Space", modifiers: ["Control"] };
const MAC_BINDING = { key: "AltRight", modifiers: ["Control"] };
const DEBUG_KEY = "vorfaleTweaks.quickInsertMacKeybindDebug";

let context;

export function init(tweakContext) {
  context = tweakContext;
  Hooks.once("ready", applyMacKeybind);
}

async function applyMacKeybind() {
  if (!context?.isEnabled?.()) return;
  if (!isMacClient()) return debug("skipped", { reason: "not macOS" });
  if (game.modules?.get?.(QUICK_INSERT_MODULE_ID)?.active !== true) return debug("skipped", { reason: "Quick Insert inactive" });

  const action = findQuickInsertToggleAction();
  if (!action) return debug("skipped", { reason: "Quick Insert toggle keybinding not found" });

  const current = game.keybindings.get(QUICK_INSERT_MODULE_ID, action);
  if (bindingsEqual(current, [MAC_BINDING])) return debug("skipped", { reason: "already configured", action });
  if (!shouldReplaceBinding(action, current)) return debug("skipped", { reason: "custom binding detected", action, current });

  try {
    await game.keybindings.set(QUICK_INSERT_MODULE_ID, action, [MAC_BINDING]);
    debug("applied", { action, binding: MAC_BINDING });
  } catch (error) {
    console.warn("vorfale-tweaks/quick-insert-mac-keybind | Could not set Quick Insert keybinding.", error);
  }
}

function findQuickInsertToggleAction() {
  const candidates = [
    "toggleOpen",
    "toggle-open",
    "quickOpen",
    "quick-open",
    "open",
    "toggle",
    "TOGGLE_OPEN"
  ];

  for (const action of candidates) {
    if (game.keybindings.actions?.has?.(`${QUICK_INSERT_MODULE_ID}.${action}`)) return action;
  }

  for (const [id, action] of game.keybindings.actions ?? []) {
    if (action?.namespace !== QUICK_INSERT_MODULE_ID) continue;
    if (action?.name === "QUICKINSERT.SettingsQuickOpen") return idToAction(id);
    if (bindingsEqual(action?.editable ?? [], [DEFAULT_BINDING])) return idToAction(id);
  }

  return null;
}

function shouldReplaceBinding(action, current) {
  const configured = game.settings.get("core", "keybindings")?.[`${QUICK_INSERT_MODULE_ID}.${action}`];
  if (!configured) return true;
  return bindingsEqual(current, [DEFAULT_BINDING]) || bindingsEqual(configured, [DEFAULT_BINDING]);
}

function bindingsEqual(left, right) {
  const normalizedLeft = normalizeBindings(left);
  const normalizedRight = normalizeBindings(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function normalizeBindings(bindings) {
  return (bindings ?? []).map(binding => ({
    key: binding?.key ?? "",
    modifiers: [...(binding?.modifiers ?? [])].sort()
  }));
}

function idToAction(id) {
  return String(id).split(".").slice(1).join(".");
}

function isMacClient() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? navigator.appVersion ?? "";
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function debug(message, data) {
  if (localStorage.getItem(DEBUG_KEY) !== "true") return;
  console.debug(`vorfale-tweaks/quick-insert-mac-keybind | ${message}`, data);
}
