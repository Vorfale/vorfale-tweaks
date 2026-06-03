let context;
let listenerAttached = false;

export function init(tweakContext) {
  context = tweakContext;
  attachPluginListener();
}

function attachPluginListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  document.addEventListener("plugins", onConfigureProseMirrorPlugins);
}

function onConfigureProseMirrorPlugins(event) {
  if (!context?.isEnabled?.()) return;
  if (!isChatInput(event.target)) return;

  const inputRules = foundry.prosemirror?.input?.inputRules;
  if (typeof inputRules !== "function") {
    console.warn("vorfale-tweaks/plain-chat-input | ProseMirror inputRules factory is unavailable.");
    return;
  }

  event.plugins.inputRules = inputRules({ rules: [] });
}

function isChatInput(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.id === "chat-message" || Boolean(target.closest?.("#chat-message"));
}
