const QUICK_INSERT_MODULE_ID = "quick-insert";
const SHADOWRUN_SYSTEM_ID = "shadowrun5e";
const QUICK_INSERT_DEFAULT_BINDING = { key: "Space", modifiers: ["Control"] };
const QUICK_INSERT_MAC_BINDING = { key: "AltRight", modifiers: ["Control"] };
const PROMPT_SUCCESS_DEFAULT_BINDING = { key: "KeyZ", modifiers: [] };
const PROMPT_SUCCESS_MAC_BINDING = { key: "Quote", modifiers: [] };
const DEBUG_KEY = "vorfaleTweaks.linklameMacosKeybindDebug";

let context;

export function init(tweakContext) {
  context = tweakContext;
  Hooks.once("ready", applyMacKeybinds);
}

async function applyMacKeybinds() {
  if (!context?.isEnabled?.()) return;
  if (!isMacClient()) return debug("skipped", { reason: "not macOS" });

  await applyQuickInsertKeybind();
  await applyPromptSuccessTestKeybind();
}

async function applyQuickInsertKeybind() {
  if (game.modules?.get?.(QUICK_INSERT_MODULE_ID)?.active !== true) return debug("skipped", { reason: "Quick Insert inactive" });

  const action = findQuickInsertToggleAction();
  if (!action) return debug("skipped", { reason: "Quick Insert toggle keybinding not found" });

  await replaceDefaultKeybinding({
    namespace: QUICK_INSERT_MODULE_ID,
    action,
    defaultBinding: QUICK_INSERT_DEFAULT_BINDING,
    macBinding: QUICK_INSERT_MAC_BINDING,
    label: "Quick Insert"
  });
}

async function applyPromptSuccessTestKeybind() {
  if (game.system?.id !== SHADOWRUN_SYSTEM_ID) return debug("skipped", { reason: "Shadowrun 5e inactive" });

  const action = findPromptSuccessTestAction();
  if (!action) return debug("skipped", { reason: "Prompt Success Test keybinding not found" });

  await replaceDefaultKeybinding({
    namespace: SHADOWRUN_SYSTEM_ID,
    action,
    defaultBinding: PROMPT_SUCCESS_DEFAULT_BINDING,
    macBinding: PROMPT_SUCCESS_MAC_BINDING,
    label: "Prompt Success Test"
  });
}

async function replaceDefaultKeybinding({ namespace, action, defaultBinding, macBinding, label }) {
  const current = game.keybindings.get(namespace, action);
  if (bindingsEqual(current, [macBinding])) return debug("skipped", { reason: "already configured", namespace, action, label });
  if (!shouldReplaceBinding(namespace, action, current, defaultBinding)) {
    return debug("skipped", { reason: "custom binding detected", namespace, action, label, current });
  }

  try {
    await game.keybindings.set(namespace, action, [macBinding]);
    debug("applied", { namespace, action, label, binding: macBinding });
  } catch (error) {
    console.warn(`vorfale-tweaks/linklame-macos-keybind | Could not set ${label} keybinding.`, error);
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
    if (bindingsEqual(action?.editable ?? [], [QUICK_INSERT_DEFAULT_BINDING])) return idToAction(id);
  }

  return null;
}

function findPromptSuccessTestAction() {
  const nameMatches = [
    "prompt success test",
    "promptsuccesstest",
    "success test prompt"
  ];

  for (const [id, action] of game.keybindings.actions ?? []) {
    if (action?.namespace !== SHADOWRUN_SYSTEM_ID) continue;

    const actionId = idToAction(id);
    const labels = [
      actionId,
      action?.name,
      action?.name ? game.i18n.localize(action.name) : "",
      action?.hint,
      action?.hint ? game.i18n.localize(action.hint) : ""
    ].map(normalizeText);

    if (labels.some(label => nameMatches.some(match => label.includes(match)))) return actionId;
    if (bindingsEqual(action?.editable ?? [], [PROMPT_SUCCESS_DEFAULT_BINDING])) return actionId;
  }

  return null;
}

function shouldReplaceBinding(namespace, action, current, defaultBinding) {
  const configured = game.settings.get("core", "keybindings")?.[`${namespace}.${action}`];
  if (!configured) return true;
  return bindingsEqual(current, [defaultBinding]) || bindingsEqual(configured, [defaultBinding]);
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

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isMacClient() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? navigator.appVersion ?? "";
  const isAppleTouchDevice = navigator.maxTouchPoints > 1 && /Mac/i.test(platform);

  return /Mac/i.test(platform) && !isAppleTouchDevice && !/iPhone|iPad|iPod/i.test(userAgent);
}

function debug(message, data) {
  if (localStorage.getItem(DEBUG_KEY) !== "true") return;
  console.debug(`vorfale-tweaks/linklame-macos-keybind | ${message}`, data);
}
