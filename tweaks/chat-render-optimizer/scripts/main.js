const INITIAL_BATCH_LIMIT = 40;
const SCROLL_BATCH_LIMIT = 30;
const MAX_RENDERED_MESSAGES = 90;
const TARGET_RENDERED_MESSAGES = 70;
const PRUNE_DEBOUNCE_MS = 80;
const BOTTOM_DISTANCE = 80;
const MESSAGE_SELECTOR = ".chat-message, [data-message-id]";
const HISTORY_GATE_SELECTOR = ".vorfale-chat-history-gate";

const state = {
  context: null,
  patched: false,
  originalRenderBatch: null,
  observers: new WeakMap(),
  pruneTimers: new WeakMap(),
  hydratedLogs: new WeakSet()
};

export function init(tweakContext) {
  state.context = tweakContext;
  patchChatLogRenderBatch();

  Hooks.on("renderChatLog", chatLog => scheduleAttach(chatLog));
  Hooks.on("renderSidebar", () => scheduleAttach(ui.chat));
  Hooks.on("createChatMessage", () => schedulePruneAll());
  Hooks.on("renderChatMessageHTML", (_message, html) => prepareMessageElement(normalizeRenderedElement(html)));
  Hooks.on("renderChatMessage", (_message, html) => prepareMessageElement(normalizeRenderedElement(html)));

  Hooks.once("ready", () => {
    patchChatLogRenderBatch();
    scheduleAttach(ui.chat);
    schedulePruneAll();
  });

  tweakContext.onChange(enabled => {
    if (enabled) {
      scheduleAttach(ui.chat);
      schedulePruneAll();
    }
  });
}

function patchChatLogRenderBatch() {
  if (state.patched) return;

  const ChatLog = foundry?.applications?.sidebar?.tabs?.ChatLog ?? globalThis.ChatLog;
  const prototype = ChatLog?.prototype;
  if (!prototype || typeof prototype.renderBatch !== "function") {
    console.warn("vorfale-tweaks/chat-render-optimizer | ChatLog.renderBatch is unavailable.");
    return;
  }

  state.originalRenderBatch = prototype.renderBatch;
  prototype.renderBatch = async function vorfaleTweaksRenderBatch(size, ...args) {
    if (!state.context?.isEnabled?.()) return state.originalRenderBatch.call(this, size, ...args);

    const log = getChatLogElement(this);
    if (shouldDeferHistory(log)) {
      ensureHistoryGate(log, this);
      return;
    }

    const wasAtBottom = isAtBottom(log);
    const limit = getRenderedMessages(log).length ? SCROLL_BATCH_LIMIT : INITIAL_BATCH_LIMIT;
    const cappedSize = Math.min(Number(size) || limit, limit);
    const result = await state.originalRenderBatch.call(this, cappedSize, ...args);

    prepareLogImages(log);
    schedulePrune(this, { preserveBottom: wasAtBottom });
    return result;
  };

  state.patched = true;
}

function scheduleAttach(chatLog) {
  if (!state.context?.isEnabled?.()) return;

  window.setTimeout(() => {
    const log = getChatLogElement(chatLog);
    if (!log || state.observers.has(log)) return;

    const observer = new MutationObserver(() => schedulePrune(chatLog));
    observer.observe(log, { childList: true, subtree: false });
    state.observers.set(log, observer);

    prepareLogImages(log);
    if (shouldDeferHistory(log)) ensureHistoryGate(log, chatLog);
    schedulePrune(chatLog, { preserveBottom: true });
  }, 0);
}

function shouldDeferHistory(log) {
  if (!log) return false;
  if (state.hydratedLogs.has(log)) return false;
  return !getRenderedMessages(log).length || Boolean(log.querySelector(HISTORY_GATE_SELECTOR));
}

function ensureHistoryGate(log, chatLog) {
  if (!log || log.querySelector(HISTORY_GATE_SELECTOR)) return;

  const gate = document.createElement("div");
  gate.className = "vorfale-chat-history-gate";
  gate.innerHTML = `
    <p>${escapeHTML(state.context.localize("HistoryDeferred"))}</p>
    <button type="button" class="primary">
      <i class="fa-solid fa-clock-rotate-left" inert></i>
      ${escapeHTML(state.context.localize("LoadHistory"))}
    </button>
  `;

  gate.querySelector("button")?.addEventListener("click", () => hydrateHistory(log, chatLog));
  log.prepend(gate);
}

async function hydrateHistory(log, chatLog) {
  if (!log || state.hydratedLogs.has(log)) return;

  state.hydratedLogs.add(log);
  log.querySelector(HISTORY_GATE_SELECTOR)?.remove();

  if (typeof state.originalRenderBatch !== "function" || typeof chatLog?.renderBatch !== "function") return;

  try {
    await state.originalRenderBatch.call(chatLog, INITIAL_BATCH_LIMIT);
    prepareLogImages(log);
    schedulePrune(chatLog, { preserveBottom: true });
    scrollToBottom(log);
  } catch (error) {
    console.debug("vorfale-tweaks/chat-render-optimizer | Could not hydrate chat history.", error);
  }
}

function schedulePrune(chatLog, options = {}) {
  if (!state.context?.isEnabled?.()) return;

  const log = getChatLogElement(chatLog);
  if (!log) return;

  const existing = state.pruneTimers.get(log);
  if (existing) window.clearTimeout(existing);

  const timer = window.setTimeout(() => {
    state.pruneTimers.delete(log);
    requestAnimationFrame(() => pruneRenderedMessages(log, options));
  }, PRUNE_DEBOUNCE_MS);
  state.pruneTimers.set(log, timer);
}

function schedulePruneAll() {
  if (!state.context?.isEnabled?.()) return;
  schedulePrune(ui.chat, { preserveBottom: true });
}

function pruneRenderedMessages(log, options = {}) {
  if (!log?.isConnected) return;

  prepareLogImages(log);

  const messages = getRenderedMessages(log);
  if (messages.length <= MAX_RENDERED_MESSAGES) return;

  const atBottom = options.preserveBottom ?? isAtBottom(log);
  const removeCount = Math.max(0, messages.length - TARGET_RENDERED_MESSAGES);
  if (!removeCount) return;

  if (atBottom) {
    removeMessages(messages.slice(0, removeCount));
    scrollToBottom(log);
    return;
  }

  removeMessages(messages.slice(-removeCount));
}

function removeMessages(messages) {
  for (const message of messages) message.remove();
}

function prepareMessageElement(element) {
  if (!element) return;

  const root = element.matches?.(MESSAGE_SELECTOR) ? element : element.querySelector?.(MESSAGE_SELECTOR);
  if (!root) return;
  prepareImages(root);
  schedulePruneAll();
}

function prepareLogImages(log) {
  if (!log) return;
  prepareImages(log);
}

function prepareImages(root) {
  for (const img of root.querySelectorAll?.("img") ?? []) {
    if (!img.hasAttribute("loading")) img.loading = "lazy";
    if (!img.hasAttribute("decoding")) img.decoding = "async";
  }
}

function getChatLogElement(chatLog = ui.chat) {
  const root = chatLog?.element ?? document.querySelector("#chat");
  if (!root) return null;
  return root.querySelector?.(".chat-log, [data-application-part='log'], .chat-log.scrollable, .scrollable");
}

function getRenderedMessages(log) {
  if (!log) return [];
  return Array.from(log.querySelectorAll(MESSAGE_SELECTOR))
    .filter(element => element.closest(".chat-log, [data-application-part='log'], .scrollable") === log);
}

function isAtBottom(log) {
  if (!log) return true;
  return log.scrollHeight - log.clientHeight - log.scrollTop <= BOTTOM_DISTANCE;
}

function scrollToBottom(log) {
  log.scrollTop = log.scrollHeight;
}

function normalizeRenderedElement(html) {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? null;
  if (html?.jquery) return html[0] ?? null;
  return html?.[0] ?? null;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}
