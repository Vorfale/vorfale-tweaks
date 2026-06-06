const FLAG_TYPE = "type";
const TYPE_NARRATION = "narration";
const TYPE_DESCRIPTION = "description";
const OVERLAY_VISIBLE_CLASS = "vorfale-narrator-overlay-visible";

let context;
let overlayTimeout = 0;

export function init(tweakContext) {
  context = tweakContext;

  Hooks.once("ready", registerChatCommands);
  Hooks.on("createChatMessage", onCreateChatMessage);
  Hooks.on("renderChatMessageHTML", decorateChatMessage);
  Hooks.on("renderChatMessage", (_message, html) => decorateChatMessage(_message, normalizeElement(html)));
}

function registerChatCommands() {
  const ChatLog = foundry.applications?.sidebar?.tabs?.ChatLog;
  if (!ChatLog?.CHAT_COMMANDS) {
    console.warn("vorfale-tweaks/narrator | ChatLog.CHAT_COMMANDS is unavailable.");
    return;
  }

  const any = "([^]*)";
  ChatLog.CHAT_COMMANDS.narrate = {
    rgx: new RegExp(`^(/narrate(?:ion)?\\s+)${any}`, "i"),
    fn: narratorCommand(TYPE_NARRATION)
  };
  ChatLog.CHAT_COMMANDS.describe = {
    rgx: new RegExp(`^(/desc(?:ribe|ription)?\\s+)${any}`, "i"),
    fn: narratorCommand(TYPE_DESCRIPTION)
  };
}

function narratorCommand(type) {
  return async function(_command, match, chatData, createOptions) {
    if (!context?.isEnabled?.()) return false;
    if (!game.user?.isGM) {
      ui.notifications.warn(context.localize("PermissionDenied"));
      return false;
    }

    const raw = String(match?.[2] ?? "").trim();
    if (!raw) {
      ui.notifications.warn(context.localize("EmptyMessage"));
      return false;
    }

    chatData.content = renderNarratorMessage(raw);
    chatData.speaker = {
      alias: context.localize("Narrator"),
      scene: game.user?.viewedScene
    };
    chatData.flags ??= {};
    chatData.flags[context.moduleId] ??= {};
    chatData.flags[context.moduleId][context.id] = { [FLAG_TYPE]: type };
    createOptions.messageMode = "public";
  };
}

function onCreateChatMessage(message) {
  if (!context?.isEnabled?.()) return;
  if (getNarratorType(message) !== TYPE_NARRATION) return;
  showNarrationOverlay(message.content);
}

function decorateChatMessage(message, html) {
  if (!context?.isEnabled?.() || !html) return;

  const type = getNarratorType(message);
  if (!type) return;

  html.classList.add("vorfale-narrator-chat");
  html.classList.toggle("vorfale-narrator-narration", type === TYPE_NARRATION);
  html.classList.toggle("vorfale-narrator-description", type === TYPE_DESCRIPTION);
}

function showNarrationOverlay(content) {
  const overlay = getOverlay();
  const body = overlay.querySelector(".vorfale-narrator-overlay-content");
  body.innerHTML = content;

  window.clearTimeout(overlayTimeout);
  requestAnimationFrame(() => overlay.classList.add(OVERLAY_VISIBLE_CLASS));

  const duration = Math.max(3500, Math.min(18000, getPlainText(content).length * 85 + 1800));
  overlayTimeout = window.setTimeout(() => {
    overlay.classList.remove(OVERLAY_VISIBLE_CLASS);
  }, duration);
}

function getOverlay() {
  let overlay = document.querySelector(".vorfale-narrator-overlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.className = "vorfale-narrator-overlay";
  overlay.innerHTML = `<div class="vorfale-narrator-overlay-content"></div>`;
  document.body.append(overlay);
  return overlay;
}

function renderNarratorMessage(raw) {
  return `<div class="vorfale-narrator-message">${raw}</div>`;
}

function getNarratorType(message) {
  return message?.getFlag?.(context.moduleId, `${context.id}.${FLAG_TYPE}`) ?? null;
}

function getPlainText(html) {
  const template = document.createElement("template");
  template.innerHTML = html ?? "";
  return template.content.textContent ?? "";
}

function normalizeElement(html) {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? null;
  if (html?.jquery) return html[0] ?? null;
  return null;
}
