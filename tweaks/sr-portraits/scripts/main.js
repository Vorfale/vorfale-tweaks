const PORTRAIT_SIZE = 40;

let context;
let refreshTimer = 0;
const brokenImages = new Set();

export function init(tweakContext) {
  context = tweakContext;

  Hooks.on("renderChatMessageHTML", (message, html) => addPortraitToMessage(message, html));
  Hooks.on("renderChatMessage", (message, html) => addPortraitToMessage(message, html));
  Hooks.on("updateActor", (_actor, changes) => {
    clearBrokenImagesForImageChange(changes, ["img", "prototypeToken"]);
    scheduleVisiblePortraitRefresh();
  });
  Hooks.on("updateToken", (_token, changes) => {
    clearBrokenImagesForImageChange(changes, ["texture", "img"]);
    scheduleVisiblePortraitRefresh();
  });
  Hooks.on("updateUser", (_user, changes) => {
    clearBrokenImagesForImageChange(changes, ["avatar", "img", "image", "texture"]);
    scheduleVisiblePortraitRefresh();
  });

  context.onChange(enabled => {
    if (!enabled) removeExistingPortraits();
    else scheduleVisiblePortraitRefresh();
  });
}

function addPortraitToMessage(message, html) {
  if (!context.isEnabled()) return;

  const element = normalizeElement(html);
  if (!element) return;

  const header = element.querySelector(".message-header");
  const sender = header?.querySelector(".message-sender");
  if (!header || !sender) return;

  updatePortraitElement(message, element, sender);
}

function updatePortraitElement(message, element, sender = null) {
  const actor = getSpeakerActor(message);
  const user = getMessageUser(message);
  const image = getSpeakerImage(message, actor, user);
  if (!image) {
    removePortraitFromMessage(element);
    return;
  }

  element.dataset.sr5ChatPortraitApplied = "true";
  element.classList.add("sr5-chat-portraits");
  element.style.setProperty("--sr5-chat-portrait-size", `${PORTRAIT_SIZE}px`);
  element.dataset.sr5ChatPortraitShape = "rounded";

  const portraitLink = element.querySelector(".sr5-chat-portrait-link") ?? document.createElement("span");
  const portrait = portraitLink.querySelector(".sr5-chat-portrait") ?? document.createElement("img");
  const titleName = actor?.name ?? user?.name ?? "";

  portraitLink.className = "sr5-chat-portrait-link";
  portraitLink.role = actor ? "button" : "presentation";
  portraitLink.tabIndex = actor ? 0 : -1;
  portraitLink.title = actor?.name ? `Open ${actor.name}` : titleName;
  portraitLink.dataset.actorUuid = actor?.uuid ?? "";
  portraitLink.dataset.userId = user?.id ?? "";

  portrait.className = "sr5-chat-portrait";
  if (portrait.getAttribute("src") !== image) portrait.src = image;
  portrait.alt = titleName ? `${titleName} portrait` : "Speaker portrait";
  portrait.loading = "lazy";
  portrait.dataset.currentSrc = image;

  if (!portrait.dataset.sr5PortraitErrorBound) {
    portrait.dataset.sr5PortraitErrorBound = "true";
    portrait.addEventListener("error", () => handlePortraitImageError(message, element, portrait));
  }

  if (!portraitLink.dataset.sr5PortraitActionBound) {
    portraitLink.dataset.sr5PortraitActionBound = "true";
    portraitLink.addEventListener("click", event => openPortraitActor(event, portraitLink));
    portraitLink.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      openPortraitActor(event, portraitLink);
    });
  }

  if (!portrait.parentElement) portraitLink.append(portrait);
  if (!portraitLink.parentElement) {
    const targetSender = sender ?? element.querySelector(".message-header .message-sender");
    targetSender?.before(portraitLink);
  }
}

function normalizeElement(html) {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? null;
  if (html?.jquery) return html[0] ?? null;
  return null;
}

function getSpeakerActor(message) {
  if (message.speakerActor) return message.speakerActor;

  const speaker = message.speaker ?? message.data?.speaker;
  if (!speaker) return null;

  try {
    return ChatMessage.getSpeakerActor?.(speaker) ?? null;
  } catch (error) {
    console.debug("vorfale-tweaks/sr-portraits | Could not resolve chat speaker actor.", error);
    return null;
  }
}

function getSpeakerImage(message, actor, user = getMessageUser(message), excluded = new Set()) {
  const tokenDocument = getSpeakerTokenDocument(message);
  const tokenImage = cleanImage(getTokenDocumentImage(tokenDocument), excluded);
  const prototypeImage = cleanImage(getPrototypeTokenImage(actor), excluded);
  const actorImage = cleanImage(actor?.img, excluded);
  const userImage = cleanImage(getUserImage(user), excluded);
  const userCharacterImage = cleanImage(user?.character?.img, excluded);
  return tokenImage ?? prototypeImage ?? actorImage ?? userImage ?? userCharacterImage ?? null;
}

function getSpeakerTokenDocument(message) {
  const speaker = message.speaker ?? message.data?.speaker;
  if (!speaker?.token) return null;

  const scene = speaker.scene ? game.scenes?.get(speaker.scene) : canvas?.scene;
  return scene?.tokens?.get(speaker.token) ?? null;
}

function getTokenDocumentImage(tokenDocument) {
  if (!tokenDocument) return null;

  const src = tokenDocument.texture?.src;
  if (isWildcardToken(tokenDocument) && isWildcardPath(src)) return null;
  return src ?? tokenDocument.actor?.img ?? null;
}

function getPrototypeTokenImage(actor) {
  const prototypeToken = actor?.prototypeToken;
  if (!prototypeToken) return null;

  const src = prototypeToken.texture?.src;
  if (isWildcardToken(prototypeToken) || isWildcardPath(src)) return null;
  return src;
}

function getMessageUser(message) {
  if (message.author?.id) return message.author;

  const user = message.user;
  if (user?.id) return user;

  const userId = typeof user === "string"
    ? user
    : message.userId ?? message._source?.user ?? message.data?.user;
  return userId ? game.users?.get?.(userId) ?? null : null;
}

function getUserImage(user) {
  return user?.avatar ?? user?.img ?? user?.image ?? user?.texture?.src ?? null;
}

function cleanImage(src, excluded = new Set()) {
  if (!src || src === "icons/svg/mystery-man.svg") return null;
  if (excluded.has(src)) return null;
  if (brokenImages.has(src)) return null;
  if (isWildcardPath(src)) return null;
  return src;
}

function isWildcardToken(tokenDocument) {
  return Boolean(
    tokenDocument?.randomImg
    ?? tokenDocument?._source?.randomImg
  );
}

function isWildcardPath(src) {
  return typeof src === "string" && (src.includes("*") || /\{[^}]+}/.test(src));
}

function clearBrokenImagesForImageChange(changes, keys) {
  if (!changes || !keys.some(key => hasPropertyPath(changes, key))) return;
  brokenImages.clear();
}

function hasPropertyPath(object, path) {
  if (Object.keys(object).some(key => key === path || key.startsWith(`${path}.`))) return true;
  if (globalThis.foundry?.utils?.hasProperty) return foundry.utils.hasProperty(object, path);
  return path.split(".").reduce((value, key) => value?.[key], object) !== undefined;
}

function openPortraitActor(event, portraitLink) {
  const actor = portraitLink.dataset.actorUuid ? fromUuidSyncSafe(portraitLink.dataset.actorUuid) : null;
  if (!actor?.sheet) return;

  event.preventDefault();
  event.stopPropagation();
  actor.sheet.render(true);
}

function fromUuidSyncSafe(uuid) {
  try {
    return globalThis.fromUuidSync?.(uuid) ?? null;
  } catch (_error) {
    return null;
  }
}

function handlePortraitImageError(message, element, portrait) {
  const broken = portrait.dataset.currentSrc || portrait.getAttribute("src");
  if (broken) brokenImages.add(broken);

  const actor = getSpeakerActor(message);
  const user = getMessageUser(message);
  const replacement = getSpeakerImage(message, actor, user, new Set([broken]));

  if (replacement && replacement !== broken) {
    portrait.dataset.currentSrc = replacement;
    portrait.src = replacement;
    return;
  }

  element.querySelector(".sr5-chat-portrait-link")?.remove();
  element.classList.remove("sr5-chat-portraits");
  delete element.dataset.sr5ChatPortraitApplied;
}

function scheduleVisiblePortraitRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshVisiblePortraits, 150);
}

function refreshVisiblePortraits() {
  if (!context?.isEnabled?.()) return;

  for (const element of document.querySelectorAll(".chat-message")) {
    const message = getMessageFromElement(element);
    if (!message) continue;
    const sender = element.querySelector(".message-header .message-sender");
    if (!sender) continue;
    updatePortraitElement(message, element, sender);
  }
}

function getMessageFromElement(element) {
  const id = element.dataset.messageId ?? element.dataset.messageid ?? element.getAttribute("data-message-id");
  return id ? game.messages?.get?.(id) ?? null : null;
}

function removeExistingPortraits() {
  for (const message of document.querySelectorAll(".chat-message.sr5-chat-portraits")) {
    removePortraitFromMessage(message);
  }
}

function removePortraitFromMessage(message) {
  message.querySelector(".sr5-chat-portrait-link")?.remove();
  message.classList.remove("sr5-chat-portraits");
  delete message.dataset.sr5ChatPortraitApplied;
  delete message.dataset.sr5ChatPortraitShape;
  message.style.removeProperty("--sr5-chat-portrait-size");
}
