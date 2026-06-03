const pendingScrolls = new Set();
const recentScrolls = new Map();

let context;

export function init(tweakContext) {
  context = tweakContext;

  Hooks.on("createChatMessage", message => {
    if (!context.isEnabled()) return;
    if (!shouldFollowMessage(message)) return;

    const id = message.id ?? message._id;
    if (id) pendingScrolls.add(id);
    scheduleChatScroll(id);
  });

  Hooks.on("renderChatMessageHTML", message => onMessageRendered(message));
  Hooks.on("renderChatMessage", message => onMessageRendered(message));
}

function onMessageRendered(message) {
  if (!context.isEnabled()) return;

  const id = message.id ?? message._id;
  if (!id || !pendingScrolls.has(id)) return;

  pendingScrolls.delete(id);
  scheduleChatScroll(id);
}

function shouldFollowMessage(message) {
  return isOwnMessage(message) || isChatAtBottom();
}

function isOwnMessage(message) {
  const user = message.user;
  const userId = typeof user === "string" ? user : user?.id;
  return userId === game.user?.id;
}

function isChatAtBottom() {
  if (ui.chat?.isAtBottom === true) return true;

  const log = getChatLogElement();
  if (!log) return false;

  const distance = log.scrollHeight - log.clientHeight - log.scrollTop;
  return distance <= 48;
}

function scheduleChatScroll(id) {
  const key = id ?? "__anonymous__";
  if (recentScrolls.has(key)) window.clearTimeout(recentScrolls.get(key));

  const timeout = window.setTimeout(async () => {
    recentScrolls.delete(key);
    await nextFrame();
    await scrollChatBottom();
  }, 75);

  recentScrolls.set(key, timeout);
}

async function scrollChatBottom() {
  try {
    if (typeof ui.chat?.scrollBottom === "function") {
      await ui.chat.scrollBottom({
        popout: true,
        waitImages: true,
        scrollOptions: { block: "end", behavior: "auto" }
      });
      return;
    }
  } catch (error) {
    console.debug("vorfale-tweaks/chat-auto-scroll-fix | ChatLog.scrollBottom failed.", error);
  }

  const log = getChatLogElement();
  if (log) log.scrollTop = log.scrollHeight;
}

function getChatLogElement() {
  const root = ui.chat?.element ?? document.querySelector("#chat");
  return root?.querySelector?.(".chat-log, [data-application-part='log'], .scrollable") ?? null;
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
