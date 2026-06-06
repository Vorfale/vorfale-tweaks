const ARCHIVE_INDEX_SETTING = "chatArchiveIndex";
const ARCHIVE_FALLBACK_SETTING = "chatArchiveFallbackStore";
const ARCHIVE_DIR = "vorfale-chat-archives";
const MIN_ACTIVE_MESSAGES = 500;
const ARCHIVE_BATCH_LIMIT = 2000;
const MAX_ARCHIVE_PREVIEW_MESSAGES = 250;
const STARTUP_PROMPT_DELAY_MS = 2500;

const state = {
  context: null,
  activeMode: "active",
  archiveCache: new Map(),
  startupPromptShown: false,
  archiving: false
};

export function init(tweakContext) {
  state.context = tweakContext;
  registerArchiveSettings(tweakContext.moduleId);

  Hooks.on("renderChatLog", chatLog => scheduleEnhanceChat(chatLog));
  Hooks.on("renderSidebar", () => scheduleEnhanceChat(ui.chat));
  Hooks.once("ready", () => {
    scheduleEnhanceChat(ui.chat);
    scheduleStartupArchivePrompt();
  });

  tweakContext.onChange(enabled => {
    if (enabled) scheduleEnhanceChat(ui.chat);
    else restoreChatMode();
  });
}

function scheduleStartupArchivePrompt() {
  if (!state.context?.isEnabled?.() || !game.user?.isGM || state.startupPromptShown) return;

  state.startupPromptShown = true;
  window.setTimeout(() => {
    if (!state.context?.isEnabled?.() || !game.user?.isGM) return;
    const candidates = getArchiveCandidates();
    console.info("vorfale-tweaks/chat-session-archive | Startup scan.", {
      loadedMessages: getLoadedMessages().length,
      archiveCandidates: candidates.length,
      keepActivePublicMessages: MIN_ACTIVE_MESSAGES,
      batchLimit: ARCHIVE_BATCH_LIMIT
    });
    if (!candidates.length) return;
    showStartupArchiveDialog(candidates.length);
  }, STARTUP_PROMPT_DELAY_MS);
}

function showStartupArchiveDialog(count) {
  Dialog.confirm({
    title: localize("StartupArchiveTitle"),
    content: `
      <p>${game.i18n.format("VORFALE_TWEAKS.chat-render-optimizer.StartupArchiveContent", {
        count,
        keep: MIN_ACTIVE_MESSAGES
      })}</p>
      <p>${escapeHTML(localize("StartupArchiveHint"))}</p>
    `,
    yes: () => archiveOldChat({ skipConfirm: true }),
    no: () => {},
    defaultYes: false
  });
}

function registerArchiveSettings(moduleId) {
  game.settings.register(moduleId, ARCHIVE_INDEX_SETTING, {
    name: "Chat Archive Index",
    scope: "world",
    config: false,
    type: Object,
    default: { archives: [] }
  });

  game.settings.register(moduleId, ARCHIVE_FALLBACK_SETTING, {
    name: "Chat Archive Fallback Store",
    scope: "world",
    config: false,
    type: Object,
    default: { archives: {} }
  });
}

function scheduleEnhanceChat(chatLog) {
  if (!state.context?.isEnabled?.()) return;

  window.setTimeout(() => {
    const root = getChatRoot(chatLog);
    const log = getChatLogElement(chatLog);
    if (!root || !log) return;

    ensureTabs(root, log);
    ensureActiveArchiveControl(root, log);
    renderArchivePanel(root);
    applyMode(root, log, state.activeMode);
  }, 0);
}

function ensureTabs(root, log) {
  if (root.querySelector(".vorfale-chat-tabs")) return;

  const tabs = document.createElement("nav");
  tabs.className = "vorfale-chat-tabs";
  tabs.innerHTML = `
    <button type="button" data-vorfale-chat-mode="active">${escapeHTML(localize("ActiveChat"))}</button>
    <button type="button" data-vorfale-chat-mode="archive">${escapeHTML(localize("ArchiveChat"))}</button>
  `;

  tabs.addEventListener("click", event => {
    const button = event.target?.closest?.("[data-vorfale-chat-mode]");
    if (!button) return;

    state.activeMode = button.dataset.vorfaleChatMode;
    const currentRoot = getChatRoot(ui.chat) ?? root;
    const currentLog = getChatLogElement(ui.chat) ?? log;
    renderArchivePanel(currentRoot);
    applyMode(currentRoot, currentLog, state.activeMode);
  });

  const reference = log.previousElementSibling ?? log;
  reference.parentElement?.insertBefore(tabs, reference);
}

function ensureActiveArchiveControl(root, log) {
  if (!game.user?.isGM) return;
  if (root.querySelector(".vorfale-chat-active-archive-control")) return;

  const control = document.createElement("div");
  control.className = "vorfale-chat-active-archive-control";
  control.innerHTML = `
    <button type="button" class="primary" data-vorfale-action="archive-old-chat">
      <i class="fa-solid fa-box-archive" inert></i>
      ${escapeHTML(localize("ArchiveOldChat"))}
    </button>
    <p>${escapeHTML(localize("ActiveArchiveHint"))}</p>
  `;

  control.querySelector("[data-vorfale-action='archive-old-chat']")?.addEventListener("click", archiveOldChat);
  log.parentElement?.insertBefore(control, log);
}

function renderArchivePanel(root) {
  if (!root) return;

  let panel = root.querySelector(".vorfale-chat-archive-panel");
  if (!panel) {
    panel = document.createElement("section");
    panel.className = "vorfale-chat-archive-panel";
    getChatLogElement()?.insertAdjacentElement("afterend", panel);
  }

  const index = getArchiveIndex();
  const archiveButtons = index.archives.map(archive => `
    <button type="button" class="vorfale-chat-archive-entry" data-archive-id="${escapeAttribute(archive.id)}">
      <span>${escapeHTML(archive.label)}</span>
      <small>${escapeHTML(formatArchiveMeta(archive))}</small>
    </button>
  `).join("");

  const archiveControl = game.user?.isGM ? `
    <button type="button" class="primary" data-vorfale-action="archive-old-chat">
      <i class="fa-solid fa-box-archive" inert></i>
      ${escapeHTML(localize("ArchiveOldChat"))}
    </button>
  ` : "";

  panel.innerHTML = `
    <div class="vorfale-chat-archive-toolbar">
      ${archiveControl}
      <button type="button" data-vorfale-action="refresh-archive">
        <i class="fa-solid fa-rotate" inert></i>
        ${escapeHTML(localize("RefreshArchive"))}
      </button>
    </div>
    <p class="vorfale-chat-archive-note">${escapeHTML(localize("ArchiveHint"))}</p>
    <div class="vorfale-chat-archive-list">
      ${archiveButtons || `<p class="vorfale-chat-archive-empty">${escapeHTML(localize("NoArchives"))}</p>`}
    </div>
    <div class="vorfale-chat-archive-viewer"></div>
  `;

  panel.querySelector("[data-vorfale-action='archive-old-chat']")?.addEventListener("click", archiveOldChat);
  panel.querySelector("[data-vorfale-action='refresh-archive']")?.addEventListener("click", () => renderArchivePanel(root));
  panel.querySelectorAll(".vorfale-chat-archive-entry").forEach(button => {
    button.addEventListener("click", () => loadArchiveIntoPanel(panel, button.dataset.archiveId));
  });
}

function applyMode(root, log, mode) {
  const archivePanel = root.querySelector(".vorfale-chat-archive-panel");
  const tabs = root.querySelector(".vorfale-chat-tabs");
  const activeControl = root.querySelector(".vorfale-chat-active-archive-control");

  root.classList.toggle("vorfale-chat-archive-mode", mode === "archive");
  log?.classList.toggle("vorfale-chat-pane-hidden", mode === "archive");
  archivePanel?.classList.toggle("vorfale-chat-pane-hidden", mode !== "archive");
  activeControl?.classList.toggle("vorfale-chat-pane-hidden", mode === "archive");

  for (const button of tabs?.querySelectorAll("[data-vorfale-chat-mode]") ?? []) {
    button.classList.toggle("active", button.dataset.vorfaleChatMode === mode);
  }
}

function restoreChatMode() {
  const root = getChatRoot(ui.chat);
  const log = getChatLogElement(ui.chat);
  if (!root || !log) return;

  root.querySelector(".vorfale-chat-tabs")?.remove();
  root.querySelector(".vorfale-chat-active-archive-control")?.remove();
  root.querySelector(".vorfale-chat-archive-panel")?.remove();
  root.classList.remove("vorfale-chat-archive-mode");
  log.classList.remove("vorfale-chat-pane-hidden");
}

async function archiveOldChat({ skipConfirm = false } = {}) {
  if (!state.context?.isEnabled?.() || !game.user?.isGM) return;
  if (state.archiving) return;

  const candidates = getArchiveCandidates();
  if (!candidates.length) {
    ui.notifications?.info?.(localize("NothingToArchive"));
    return;
  }

  const confirmed = skipConfirm ? true : await confirmArchive(candidates.length);
  if (!confirmed) return;

  state.archiving = true;
  try {
    ui.notifications?.info?.(localize("ArchivingStarted"));
    const archive = await writeArchiveFile(candidates);
    await appendArchiveIndex(archive);
    await ChatMessage.deleteDocuments(candidates.map(message => message.id));
    state.archiveCache.set(archive.id, archive);
    const root = getChatRoot(ui.chat);
    renderArchivePanel(root);
    if (root) applyMode(root, getChatLogElement(ui.chat), "archive");
    ui.notifications?.info?.(game.i18n.format("VORFALE_TWEAKS.chat-render-optimizer.ArchivingDone", { count: candidates.length }));
  } catch (error) {
    console.error("vorfale-tweaks/chat-render-optimizer | Could not archive chat messages.", error);
    ui.notifications?.error?.(localize("ArchivingFailed"));
  } finally {
    state.archiving = false;
  }
}

function getArchiveCandidates() {
  const messages = getLoadedMessages()
    .filter(message => message?.id)
    .filter(message => isPublicMessage(message))
    .sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

  const activeFloor = Math.max(0, messages.length - MIN_ACTIVE_MESSAGES);
  return messages
    .slice(0, activeFloor)
    .slice(0, ARCHIVE_BATCH_LIMIT);
}

function getLoadedMessages() {
  if (Array.isArray(game.messages?.contents)) return game.messages.contents;
  return Array.from(game.messages ?? []);
}

function isPublicMessage(message) {
  const whisper = message.whisper ?? message._source?.whisper ?? [];
  return !message.blind && !message._source?.blind && !whisper.length;
}

async function confirmArchive(count) {
  return Dialog.confirm({
    title: localize("ConfirmArchiveTitle"),
    content: `<p>${game.i18n.format("VORFALE_TWEAKS.chat-render-optimizer.ConfirmArchiveContent", {
      count,
      keep: MIN_ACTIVE_MESSAGES
    })}</p>`,
    yes: () => true,
    no: () => false,
    defaultYes: false
  });
}

async function writeArchiveFile(messages) {
  const createdAt = new Date();
  const id = `chat-archive-${createdAt.toISOString().replace(/[:.]/g, "-")}`;
  const filename = `${id}.json`;
  const directory = getArchiveDirectory();
  await ensureArchiveDirectory(directory);

  const archive = {
    id,
    label: makeArchiveLabel(messages, createdAt),
    createdAt: createdAt.toISOString(),
    messageCount: messages.length,
    firstTimestamp: getMessageTimestamp(messages[0]),
    lastTimestamp: getMessageTimestamp(messages.at(-1)),
    file: `${directory}/${filename}`,
    messages: messages.map(serializeMessage)
  };

  const file = new File([JSON.stringify(archive)], filename, { type: "application/json" });
  try {
    await FilePicker.upload("data", directory, file, { notify: false });
  } catch (error) {
    console.warn("vorfale-tweaks/chat-session-archive | File archive failed, using world setting fallback.", error);
    await saveFallbackArchive(archive);
    archive.file = null;
    archive.storage = "setting";
  }

  return archive;
}

async function ensureArchiveDirectory(directory) {
  try {
    await FilePicker.browse("data", directory);
  } catch (_error) {
    await FilePicker.createDirectory("data", directory);
  }
}

async function appendArchiveIndex(archive) {
  const index = getArchiveIndex();
  const entry = {
    id: archive.id,
    label: archive.label,
    createdAt: archive.createdAt,
    messageCount: archive.messageCount,
    firstTimestamp: archive.firstTimestamp,
    lastTimestamp: archive.lastTimestamp,
    file: archive.file,
    storage: archive.storage ?? "file"
  };

  index.archives = [entry, ...index.archives.filter(item => item.id !== entry.id)];
  await game.settings.set(state.context.moduleId, ARCHIVE_INDEX_SETTING, index);
}

async function loadArchiveIntoPanel(panel, archiveId) {
  const viewer = panel.querySelector(".vorfale-chat-archive-viewer");
  if (!viewer) return;

  const archiveMeta = getArchiveIndex().archives.find(archive => archive.id === archiveId);
  if (!archiveMeta) return;

  viewer.innerHTML = `<p class="vorfale-chat-archive-loading">${escapeHTML(localize("LoadingArchive"))}</p>`;

  try {
    const archive = await loadArchive(archiveMeta);
    viewer.innerHTML = renderArchiveMessages(archive);
  } catch (error) {
    console.error("vorfale-tweaks/chat-render-optimizer | Could not load chat archive.", error);
    viewer.innerHTML = `<p class="vorfale-chat-archive-empty">${escapeHTML(localize("ArchiveLoadFailed"))}</p>`;
  }
}

async function loadArchive(archiveMeta) {
  if (state.archiveCache.has(archiveMeta.id)) return state.archiveCache.get(archiveMeta.id);

  if (archiveMeta.storage === "setting") {
    const fallback = game.settings.get(state.context.moduleId, ARCHIVE_FALLBACK_SETTING);
    const archive = fallback?.archives?.[archiveMeta.id];
    if (!archive) throw new Error(`Missing fallback archive: ${archiveMeta.id}`);
    state.archiveCache.set(archiveMeta.id, archive);
    return archive;
  }

  const response = await fetch(archiveMeta.file);
  if (!response.ok) throw new Error(`Could not fetch archive: ${archiveMeta.file}`);

  const archive = await response.json();
  state.archiveCache.set(archiveMeta.id, archive);
  return archive;
}

async function saveFallbackArchive(archive) {
  const fallback = game.settings.get(state.context.moduleId, ARCHIVE_FALLBACK_SETTING);
  const archives = foundry.utils.deepClone(fallback?.archives ?? {});
  archives[archive.id] = archive;
  await game.settings.set(state.context.moduleId, ARCHIVE_FALLBACK_SETTING, { archives });
}

function renderArchiveMessages(archive) {
  const messages = (archive.messages ?? []).slice(-MAX_ARCHIVE_PREVIEW_MESSAGES);
  const skipped = Math.max(0, (archive.messages?.length ?? 0) - messages.length);

  const skippedNote = skipped ? `
    <p class="vorfale-chat-archive-note">${escapeHTML(game.i18n.format("VORFALE_TWEAKS.chat-render-optimizer.ArchivePreviewLimited", {
      shown: messages.length,
      total: archive.messages.length
    }))}</p>
  ` : "";

  return `
    <header class="vorfale-chat-archive-viewer-header">
      <h3>${escapeHTML(archive.label)}</h3>
      <small>${escapeHTML(formatArchiveMeta(archive))}</small>
    </header>
    ${skippedNote}
    <ol class="vorfale-chat-archive-messages">
      ${messages.map(renderArchiveMessage).join("")}
    </ol>
  `;
}

function renderArchiveMessage(message) {
  return `
    <li class="vorfale-chat-archive-message">
      <header>
        <strong>${escapeHTML(message.alias || message.user || localize("UnknownSpeaker"))}</strong>
        <time>${escapeHTML(formatTimestamp(message.timestamp))}</time>
      </header>
      <div class="vorfale-chat-archive-content">${sanitizeArchiveHTML(message.content)}</div>
    </li>
  `;
}

function serializeMessage(message) {
  const source = message.toObject?.(true) ?? message.toObject?.() ?? {};
  return {
    id: message.id,
    timestamp: getMessageTimestamp(message),
    alias: message.alias ?? message.speaker?.alias ?? "",
    user: game.users?.get(message.user?.id ?? message.user)?.name ?? "",
    type: message.type ?? source.type,
    speaker: source.speaker ?? {},
    whisper: source.whisper ?? [],
    blind: source.blind ?? false,
    content: source.content ?? message.content ?? "",
    rolls: source.rolls ?? []
  };
}

function sanitizeArchiveHTML(content) {
  const template = document.createElement("template");
  template.innerHTML = String(content ?? "");

  for (const element of template.content.querySelectorAll("script, iframe, object, embed, link, style")) {
    element.remove();
  }

  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
    }
  }

  return template.innerHTML;
}

function getArchiveIndex() {
  const index = game.settings.get(state.context.moduleId, ARCHIVE_INDEX_SETTING);
  return {
    archives: Array.isArray(index?.archives) ? index.archives : []
  };
}

function getArchiveDirectory() {
  return `worlds/${game.world.id}/${ARCHIVE_DIR}`;
}

function makeArchiveLabel(messages, createdAt) {
  const first = formatDate(getMessageTimestamp(messages[0]));
  const last = formatDate(getMessageTimestamp(messages.at(-1)));
  return `${first} - ${last} (${formatDate(createdAt.getTime())})`;
}

function formatArchiveMeta(archive) {
  return game.i18n.format("VORFALE_TWEAKS.chat-render-optimizer.ArchiveMeta", {
    count: archive.messageCount ?? archive.messages?.length ?? 0,
    first: formatDate(archive.firstTimestamp),
    last: formatDate(archive.lastTimestamp)
  });
}

function getMessageTimestamp(message) {
  const timestamp = message?.timestamp ?? message?._source?.timestamp;
  if (Number.isFinite(timestamp)) return timestamp;

  const createdTime = message?.createdTime ?? message?._stats?.createdTime;
  if (Number.isFinite(createdTime)) return createdTime;

  return 0;
}

function getChatRoot(chatLog = ui.chat) {
  return normalizeElement(chatLog?.element) ?? document.querySelector("#chat");
}

function getChatLogElement(chatLog = ui.chat) {
  const root = getChatRoot(chatLog);
  return root?.querySelector?.(".chat-log, [data-application-part='log'], .chat-log.scrollable, .scrollable") ?? null;
}

function formatDate(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
  return new Date(timestamp).toLocaleDateString(game.i18n.lang);
}

function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
  return new Date(timestamp).toLocaleString(game.i18n.lang);
}

function localize(key) {
  return state.context.localize(key);
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/`/g, "&#96;");
}

function normalizeElement(element) {
  if (element instanceof HTMLElement) return element;
  if (Array.isArray(element)) return element[0] ?? null;
  if (element?.jquery) return element[0] ?? null;
  return element?.[0] ?? null;
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
