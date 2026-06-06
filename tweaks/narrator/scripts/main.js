const FLAG_TYPE = "type";
const TYPE_NARRATION = "narration";
const TYPE_DESCRIPTION = "description";
const STATE_SETTING = "narratorState";
const BOX_VISIBLE_HEIGHT = 290;
const BOX_MAX_HEIGHT = 310;
const DEFAULT_DURATION_MULTIPLIER = 1;

let context;
let currentNarrationId = 0;
let openTimeout = 0;
let closeTimeout = 0;
let scrollTimeout = 0;
let scrollAnimation = 0;

export function init(tweakContext) {
  context = tweakContext;

  registerSettings();

  Hooks.once("ready", () => {
    createNarratorElement();
    registerChatCommands();
    registerChatCommanderCommands();
    renderNarratorState(getNarratorState());
  });

  Hooks.on("chatCommandsReady", registerChatCommanderCommands);
  Hooks.on("renderChatMessageHTML", decorateChatMessage);
  Hooks.on("renderChatMessage", (message, html) => decorateChatMessage(message, normalizeElement(html)));
}

function registerSettings() {
  game.settings.register(context.moduleId, STATE_SETTING, {
    name: "Narrator State",
    scope: "world",
    config: false,
    type: Object,
    default: defaultState(),
    onChange: state => renderNarratorState(state)
  });
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
    fn: chatLogCommand(TYPE_NARRATION)
  };
  ChatLog.CHAT_COMMANDS.describe = {
    rgx: new RegExp(`^(/desc(?:ribe|ription)?\\s+)${any}`, "i"),
    fn: chatLogCommand(TYPE_DESCRIPTION)
  };
}

function registerChatCommanderCommands(chatCommands = game.chatCommands) {
  if (!context?.isEnabled?.()) return;
  if (!chatCommands?.register) return;
  if (registerChatCommanderCommands.registered) return;
  registerChatCommanderCommands.registered = true;

  chatCommands.register({
    name: "/describe",
    module: context.moduleId,
    aliases: ["/desc", "/description"],
    icon: "<i class='fas fa-sticky-note'></i>",
    description: "Display a description in chat",
    requiredRole: "ASSISTANT",
    callback: async (_chat, parameters) => {
      await createNarratorMessage(TYPE_DESCRIPTION, parameters);
      return {};
    }
  });

  chatCommands.register({
    name: "/narrate",
    module: context.moduleId,
    aliases: ["/narration"],
    icon: "<i class='fas fa-sticky-note'></i>",
    description: "Narrate a message for all to see",
    requiredRole: "ASSISTANT",
    callback: async (_chat, parameters) => {
      await createNarratorMessage(TYPE_NARRATION, parameters);
      return {};
    }
  });
}

function chatLogCommand(type) {
  return async function(_command, match) {
    await createNarratorMessage(type, match?.[2] ?? "");
    return false;
  };
}

async function createNarratorMessage(type, rawMessage) {
  if (!context?.isEnabled?.()) return;
  if (!canUseNarrator()) {
    ui.notifications.warn(context.localize("PermissionDenied"));
    return;
  }

  const message = normalizeCommandMessage(rawMessage);
  if (!message) {
    ui.notifications.warn(context.localize("EmptyMessage"));
    return;
  }

  const content = renderNarratorMessage(message);
  const chatData = {
    user: game.user.id,
    content,
    speaker: {
      alias: context.localize("Narrator"),
      scene: game.user?.viewedScene
    },
    flags: {
      [context.moduleId]: {
        [context.id]: { [FLAG_TYPE]: type }
      }
    }
  };

  if (type === TYPE_NARRATION) await setNarratorState({
    id: getNarratorState().narration.id + 1,
    display: true,
    message: content,
    plainText: message,
    paused: false
  });

  return ChatMessage.create(chatData, { messageMode: "public" });
}

function decorateChatMessage(message, html) {
  if (!context?.isEnabled?.() || !html) return;

  const type = getNarratorType(message);
  if (!type) return;

  html.classList.add("narrator-chat");
  html.classList.toggle("narrator-narrative", type === TYPE_NARRATION);
  html.classList.toggle("narrator-description", type === TYPE_DESCRIPTION);
}

function createNarratorElement() {
  if (document.getElementById("vorfale-narrator")) return;

  const root = document.createElement("div");
  root.id = "vorfale-narrator";
  root.className = "narrator";
  root.innerHTML = `
    <div class="narrator-bg"></div>
    <div class="narrator-frame">
      <div class="narrator-frameBG"></div>
      <div class="narrator-box"><div class="narrator-content"></div></div>
      <div class="narrator-buttons" style="opacity:0;">
        <button type="button" class="NT-btn-close"><i class="fas fa-times-circle"></i> ${escapeHTML(game.i18n.localize("Close"))}</button>
      </div>
    </div>`;

  root.querySelector(".NT-btn-close")?.addEventListener("click", closeNarration);
  document.body.append(root);
  updateBackground(root);
}

function renderNarratorState(state = defaultState()) {
  const root = document.getElementById("vorfale-narrator");
  if (!root || !context?.isEnabled?.()) return;

  const narration = state.narration ?? defaultState().narration;
  const content = root.querySelector(".narrator-content");
  const bg = root.querySelector(".narrator-bg");
  const buttons = root.querySelector(".narrator-buttons");
  if (!content || !bg || !buttons) return;

  if (!narration.display) {
    clearNarrationTimers();
    bg.style.height = "0px";
    buttons.style.opacity = "0";
    buttons.style.visibility = "hidden";
    content.style.opacity = "0";
    return;
  }

  if (narration.id !== currentNarrationId) {
    currentNarrationId = narration.id;
    clearNarrationTimers();
    content.style.opacity = "0";
    content.style.top = "0px";

    openTimeout = window.setTimeout(() => {
      content.innerHTML = narration.message ?? "";
      content.style.opacity = "1";
      content.style.top = "0px";

      const visibleHeight = Math.min(content.offsetHeight, BOX_MAX_HEIGHT);
      bg.style.height = `${visibleHeight * 3}px`;
      buttons.style.opacity = canUseNarrator() ? "1" : "0";
      buttons.style.visibility = canUseNarrator() ? "visible" : "hidden";
      buttons.style.top = `calc(50% + ${60 + visibleHeight / 2}px)`;
      openTimeout = 0;
      startNarrationScroll(narration);
    }, 500);
    return;
  }

  if (narration.paused) clearNarrationTimers({ keepOpen: true });
  else startNarrationScroll(narration);
}

function startNarrationScroll(narration) {
  const root = document.getElementById("vorfale-narrator");
  const content = root?.querySelector(".narrator-content");
  if (!content || narration.paused) return;

  const scrollDistance = content.offsetHeight - BOX_VISIBLE_HEIGHT;
  let duration = messageDuration(narration.plainText?.length ?? getPlainText(narration.message).length);

  if (scrollDistance > 20) {
    const currentTop = Number.parseFloat(content.style.top || "0") || 0;
    const remaining = Math.max(0, 1 - (currentTop / -scrollDistance));
    const scrollDuration = Math.max(1000, (duration - 500 - 4500 * DEFAULT_DURATION_MULTIPLIER) * remaining);

    const runScroll = () => {
      animateTop(content, currentTop, -scrollDistance, scrollDuration);
      scrollTimeout = 0;
    };

    if (currentTop === 0) scrollTimeout = window.setTimeout(runScroll, 3000 * DEFAULT_DURATION_MULTIPLIER);
    else {
      runScroll();
      duration = scrollDuration + 4500 * DEFAULT_DURATION_MULTIPLIER;
    }
  }

  if (canUseNarrator()) {
    window.clearTimeout(closeTimeout);
    closeTimeout = window.setTimeout(closeNarration, duration);
  }
}

function animateTop(element, from, to, duration) {
  window.cancelAnimationFrame(scrollAnimation);
  const startedAt = performance.now();

  const step = now => {
    const progress = Math.min(1, (now - startedAt) / duration);
    element.style.top = `${from + ((to - from) * progress)}px`;
    if (progress < 1) scrollAnimation = window.requestAnimationFrame(step);
    else scrollAnimation = 0;
  };

  scrollAnimation = window.requestAnimationFrame(step);
}

async function closeNarration() {
  const state = getNarratorState();
  if (!state.narration.display) return;

  clearNarrationTimers();
  await setNarratorState({
    ...state.narration,
    display: false,
    message: "",
    plainText: ""
  });
}

function clearNarrationTimers({ keepOpen = false } = {}) {
  window.clearTimeout(scrollTimeout);
  window.cancelAnimationFrame(scrollAnimation);
  scrollTimeout = 0;
  scrollAnimation = 0;

  if (!keepOpen) {
    window.clearTimeout(openTimeout);
    openTimeout = 0;
  }

  window.clearTimeout(closeTimeout);
  closeTimeout = 0;
}

function updateBackground(root) {
  const frameBG = root.querySelector(".narrator-frameBG");
  const bg = root.querySelector(".narrator-bg");
  const color = "#000000";
  if (frameBG) frameBG.style.boxShadow = `inset 0 0 2000px 100px ${color}`;
  if (bg) bg.style.background = `linear-gradient(transparent 0%, ${color}a8 40%, ${color}a8 60%, transparent 100%)`;
}

function messageDuration(length) {
  return (Math.max(2000, Math.min(length * 80, 20000)) + 3000) * DEFAULT_DURATION_MULTIPLIER + 500;
}

function renderNarratorMessage(message) {
  return `<div class="vorfale-narrator-message">${escapeHTML(message).replace(/\n/g, "<br>")}</div>`;
}

function normalizeCommandMessage(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value ?? "").replace(/<br\b[^>]*>/gi, "\n");
  return (template.content.textContent ?? String(value ?? "")).trim();
}

function getPlainText(html) {
  const template = document.createElement("template");
  template.innerHTML = html ?? "";
  return template.content.textContent ?? "";
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getNarratorType(message) {
  return message?.getFlag?.(context.moduleId, `${context.id}.${FLAG_TYPE}`) ?? null;
}

function canUseNarrator() {
  return game.user?.isGM === true || game.user?.hasRole?.("ASSISTANT") === true;
}

function getNarratorState() {
  try {
    return foundry.utils.mergeObject(defaultState(), game.settings.get(context.moduleId, STATE_SETTING) ?? {}, {
      inplace: false
    });
  } catch (_error) {
    return defaultState();
  }
}

async function setNarratorState(narration) {
  const state = getNarratorState();
  state.narration = narration;
  return game.settings.set(context.moduleId, STATE_SETTING, state);
}

function defaultState() {
  return {
    narration: {
      id: 0,
      display: false,
      message: "",
      plainText: "",
      paused: false
    }
  };
}

function normalizeElement(html) {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? null;
  if (html?.jquery) return html[0] ?? null;
  return null;
}
