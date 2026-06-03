const PORTRAIT_SIZE = 40;

let context;

export function init(tweakContext) {
  context = tweakContext;

  Hooks.on("renderChatMessageHTML", (message, html) => addPortraitToMessage(message, html));
  Hooks.on("renderChatMessage", (message, html) => addPortraitToMessage(message, html));

  context.onChange(enabled => {
    if (!enabled) removeExistingPortraits();
  });
}

function addPortraitToMessage(message, html) {
  if (!context.isEnabled()) return;

  const element = normalizeElement(html);
  if (!element || element.dataset.sr5ChatPortraitApplied === "true") return;

  const header = element.querySelector(".message-header");
  const sender = header?.querySelector(".message-sender");
  if (!header || !sender) return;

  const actor = getSpeakerActor(message);
  const image = getSpeakerImage(message, actor);
  if (!image) return;

  element.dataset.sr5ChatPortraitApplied = "true";
  element.classList.add("sr5-chat-portraits");
  element.style.setProperty("--sr5-chat-portrait-size", `${PORTRAIT_SIZE}px`);
  element.dataset.sr5ChatPortraitShape = "rounded";

  const portraitLink = document.createElement("span");
  portraitLink.className = "sr5-chat-portrait-link";
  portraitLink.role = "button";
  portraitLink.tabIndex = actor ? 0 : -1;
  portraitLink.title = actor?.name ? `Open ${actor.name}` : "Open speaker";

  const portrait = document.createElement("img");
  portrait.className = "sr5-chat-portrait";
  portrait.src = image;
  portrait.alt = actor?.name ? `${actor.name} portrait` : "Speaker portrait";
  portrait.loading = "lazy";

  portraitLink.append(portrait);
  portraitLink.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    actor?.sheet?.render(true);
  });
  portraitLink.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    actor?.sheet?.render(true);
  });

  sender.before(portraitLink);
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

function getSpeakerImage(message, actor) {
  const actorImage = cleanImage(actor?.img);
  const tokenImage = cleanImage(getSpeakerTokenImage(message));
  const prototypeImage = cleanImage(actor?.prototypeToken?.texture?.src);
  return tokenImage ?? prototypeImage ?? actorImage ?? null;
}

function getSpeakerTokenImage(message) {
  const speaker = message.speaker ?? message.data?.speaker;
  if (!speaker?.token) return null;

  const scene = speaker.scene ? game.scenes?.get(speaker.scene) : canvas?.scene;
  const tokenDocument = scene?.tokens?.get(speaker.token);
  return tokenDocument?.texture?.src ?? tokenDocument?.actor?.img ?? null;
}

function cleanImage(src) {
  if (!src || src === "icons/svg/mystery-man.svg") return null;
  return src;
}

function removeExistingPortraits() {
  for (const message of document.querySelectorAll(".chat-message.sr5-chat-portraits")) {
    message.querySelector(".sr5-chat-portrait-link")?.remove();
    message.classList.remove("sr5-chat-portraits");
    delete message.dataset.sr5ChatPortraitApplied;
    delete message.dataset.sr5ChatPortraitShape;
    message.style.removeProperty("--sr5-chat-portrait-size");
  }
}
