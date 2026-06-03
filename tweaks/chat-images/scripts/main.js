const CSS = {
  button: "chat-media-v14-button",
  controls: "chat-media-v14-controls",
  dragging: "chat-media-v14-dragging",
  busy: "chat-media-v14-busy"
};

const MEDIA_TYPES = {
  image: /^image\//i,
  video: /^video\//i,
  audio: /^audio\//i
};

let context;

export function init(tweakContext) {
  context = tweakContext;

  Hooks.on("renderChatInput", (app, elements) => {
    const root = getChatRoot(app, elements);
    if (!root) return;
    refreshChatControl(root);
    bindChatInputMediaHandlers(root);
  });

  Hooks.on("renderChatLog", (app, html) => {
    const root = normalizeElement(html) ?? app?.element ?? document.querySelector("#chat");
    if (!root) return;
    refreshChatControl(root);
    bindChatInputMediaHandlers(root);
  });

  Hooks.on("preCreateChatMessage", message => {
    if (!context.isEnabled()) return;

    const content = getPlainText(message.content ?? message._source?.content).trim();
    const match = content.match(/^c(image|video|audio)\s+(.+)$/i);
    if (!match) return;

    message.updateSource({ content: renderMediaHTML(match[2].trim(), match[1].toLowerCase()) });
  });

  Hooks.on("renderChatMessageHTML", (_message, html) => renderPlainMediaLinks(html));
  Hooks.on("renderChatMessage", (_message, html) => renderPlainMediaLinks(normalizeElement(html)));
  Hooks.on("renderImagePopout", (app, html) => addOpenInBrowserButton(app, normalizeElement(html)));

  context.onChange(() => refreshChatControl(document.querySelector("#chat")));
}

function getChatRoot(app, elements) {
  const fromElements = Object.values(elements ?? {}).find(element => element instanceof HTMLElement)?.closest("#chat");
  return fromElements ?? app?.element ?? document.querySelector("#chat");
}

function normalizeElement(html) {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? null;
  if (html?.jquery) return html[0] ?? null;
  return null;
}

function refreshChatControl(root) {
  if (!root) return;
  const existing = root.querySelector(`.${CSS.controls}`);
  if (!context.isEnabled()) {
    existing?.remove();
    root.classList.remove(CSS.dragging, CSS.busy);
    return;
  }
  injectChatControl(root);
}

function injectChatControl(root) {
  const chatControls = root.querySelector(".chat-controls");
  if (!chatControls || chatControls.querySelector(`.${CSS.button}`)) return;

  const wrapper = document.createElement("div");
  wrapper.className = CSS.controls;

  const button = document.createElement("button");
  button.className = CSS.button;
  button.type = "button";
  button.title = context.localize("OpenPicker");
  button.innerHTML = `<i class="fa-solid fa-photo-film"></i>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    if (context.isEnabled()) openFileDialog(root);
  });

  wrapper.append(button);
  chatControls.prepend(wrapper);
}

function bindChatInputMediaHandlers(root) {
  if (root.dataset.vorfaleChatImagesBound === "true") return;
  root.dataset.vorfaleChatImagesBound = "true";

  const dropTargets = [root.querySelector(".chat-controls"), root.querySelector("textarea[name='chat-message']"), root]
    .filter(Boolean);

  for (const target of dropTargets) {
    target.addEventListener("dragover", event => {
      if (!context.isEnabled() || !hasMediaFiles(event.dataTransfer)) return;
      event.preventDefault();
      root.classList.add(CSS.dragging);
    });

    target.addEventListener("dragleave", event => {
      if (!root.contains(event.relatedTarget)) root.classList.remove(CSS.dragging);
    });

    target.addEventListener("drop", event => handleDrop(event, root));
    target.addEventListener("paste", event => handlePaste(event, root));
  }
}

function openFileDialog(root) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,video/*,audio/*";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) {
      ui.notifications.info(context.localize("NoFileSelected"));
      return;
    }
    await uploadAndPost(file, root);
  }, { once: true });
  input.click();
}

async function handleDrop(event, root) {
  if (!context.isEnabled() || !hasMediaFiles(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  root.classList.remove(CSS.dragging);

  for (const file of Array.from(event.dataTransfer.files ?? [])) await uploadAndPost(file, root);
}

async function handlePaste(event, root) {
  if (!context.isEnabled()) return;

  const mediaFiles = Array.from(event.clipboardData?.files ?? []).filter(isSupportedFile);
  if (!mediaFiles.length) return;

  event.preventDefault();
  event.stopPropagation();
  for (const file of mediaFiles) await uploadAndPost(file, root);
}

async function uploadAndPost(file, root) {
  if (!isSupportedFile(file)) {
    ui.notifications.warn(context.localize("UnsupportedFile"));
    return;
  }

  if (!canUploadFiles()) {
    ui.notifications.warn(context.localize("NoUploadPermission"));
    return;
  }

  setBusy(root, true);
  const notification = ui.notifications.info(context.localize("Uploading"), { permanent: true });

  try {
    const upload = await withTimeout(uploadFile(file), 60000);
    const src = upload.path ?? upload.url ?? upload.location ?? upload.file?.path;
    if (!src) throw new Error("Foundry did not return an uploaded file path.");

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ user: game.user }),
      content: renderMediaHTML(src, mediaTypeFromFile(file))
    });
  } catch (error) {
    console.error("vorfale-tweaks/chat-images | Media upload failed", error);
    ui.notifications.error(`${context.localize("UploadFailed")} ${error.message ?? error}`);
  } finally {
    ui.notifications.remove(notification);
    setBusy(root, false);
  }
}

async function uploadFile(file) {
  const picker = foundry.applications?.apps?.FilePicker ?? FilePicker;
  const path = "chat-media";
  await ensureUploadDirectory(picker, "data", path);
  return picker.upload("data", path, file, {}, { notify: true });
}

async function ensureUploadDirectory(picker, source, path) {
  try {
    await picker.browse(source, path);
  } catch (_error) {
    try {
      await picker.createDirectory(source, path, {});
    } catch (createError) {
      console.debug("vorfale-tweaks/chat-images | Could not create upload directory.", createError);
    }
  }
}

function renderMediaHTML(src, explicitType) {
  const safeSrc = escapeHTML(src);
  const type = explicitType ?? mediaTypeFromSource(src);

  if (type === "video") {
    return `<figure class="chat-media-v14-message"><video src="${safeSrc}" controls playsinline preload="metadata"></video></figure>`;
  }

  if (type === "audio") {
    return `<figure class="chat-media-v14-message"><audio src="${safeSrc}" controls preload="metadata"></audio></figure>`;
  }

  return `<figure class="chat-media-v14-message"><a href="${safeSrc}" target="_blank" rel="noopener" data-vorfale-image-popout="true"><img src="${safeSrc}" loading="lazy" alt=""></a></figure>`;
}

function renderPlainMediaLinks(html) {
  if (!context.isEnabled()) return;
  if (!html) return;

  bindImagePopoutLinks(html);
  if (html.dataset.vorfaleChatImagesRendered === "true") return;
  html.dataset.vorfaleChatImagesRendered = "true";

  for (const anchor of html.querySelectorAll(".message-content a[href]")) {
    if (anchor.closest(".chat-media-v14-message")) continue;
    const type = mediaTypeFromSource(anchor.href);
    if (!type) continue;

    const wrapper = document.createElement("span");
    wrapper.innerHTML = renderMediaHTML(anchor.href, type);
    anchor.replaceWith(wrapper.firstElementChild);
  }

  bindImagePopoutLinks(html);
}

function bindImagePopoutLinks(html) {
  if (html.dataset.vorfaleImagePopoutBound === "true") return;
  html.dataset.vorfaleImagePopoutBound = "true";

  html.addEventListener("click", event => {
    if (!context.isEnabled()) return;

    const image = event.target?.closest?.(".message-content img");
    const anchor = event.target?.closest?.(".chat-media-v14-message a[href]");
    if ((!image && !anchor) || (image && !html.contains(image)) || (anchor && !html.contains(anchor))) return;

    const src = image?.getAttribute("src") ?? anchor?.getAttribute("href") ?? anchor?.href;
    if (mediaTypeFromSource(src) !== "image") return;

    event.preventDefault();
    event.stopPropagation();
    openImagePopout(src);
  });
}

function openImagePopout(src) {
  const ImagePopoutClass = foundry.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;
  if (!ImagePopoutClass) {
    window.open(src, "_blank", "noopener");
    return;
  }

  const title = decodeURIComponent(src.split("/").pop()?.split("?")[0] || "Image");
  const popout = new ImagePopoutClass({
    src,
    window: { title }
  });
  popout.render(true).then(() => addOpenInBrowserButton(popout, popout.element));
}

function addOpenInBrowserButton(app, html) {
  if (!context?.isEnabled?.()) return;

  const element = html ?? app?.element;
  if (!element || element.dataset.vorfaleOpenBrowserBound === "true") return;

  const src = app?.options?.src ?? element.querySelector("img")?.getAttribute("src");
  if (!src) return;

  const header = element.querySelector(".window-header");
  if (!header) return;

  element.dataset.vorfaleOpenBrowserBound = "true";
  element.classList.add("vorfale-chat-image-popout");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control icon vorfale-chat-image-popout-open";
  button.title = "Open in browser";
  button.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square"></i>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    window.open(src, "_blank", "noopener");
  });

  const close = header.querySelector("[data-action='close'], .close");
  if (close) close.before(button);
  else header.append(button);
}

function hasMediaFiles(dataTransfer) {
  return Array.from(dataTransfer?.items ?? []).some(item => item.kind === "file")
    || Array.from(dataTransfer?.files ?? []).some(isSupportedFile);
}

function isSupportedFile(file) {
  return Boolean(file && Object.values(MEDIA_TYPES).some(pattern => pattern.test(file.type)));
}

function mediaTypeFromFile(file) {
  if (MEDIA_TYPES.video.test(file.type)) return "video";
  if (MEDIA_TYPES.audio.test(file.type)) return "audio";
  return "image";
}

function mediaTypeFromSource(src) {
  const clean = String(src ?? "").split(/[?#]/)[0].toLowerCase();
  if (/\.(webm|mp4|m4v|mov|ogv)$/.test(clean)) return "video";
  if (/\.(mp3|ogg|oga|wav|flac|m4a)$/.test(clean)) return "audio";
  if (/\.(apng|avif|gif|jpe?g|png|svg|webp)$/.test(clean)) return "image";
  return null;
}

function canUploadFiles() {
  return game.user?.can?.("FILES_UPLOAD") ?? game.user?.hasPermission?.("FILES_UPLOAD") ?? game.user?.isGM ?? false;
}

function setBusy(root, busy) {
  root?.classList.toggle(CSS.busy, busy);
}

function withTimeout(promise, timeout) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      window.setTimeout(() => reject(new Error(`Timed out after ${Math.round(timeout / 1000)} seconds.`)), timeout);
    })
  ]);
}

function getPlainText(content) {
  const raw = String(content ?? "");
  if (!raw.includes("<")) return raw;

  const element = document.createElement("div");
  element.innerHTML = raw;
  return element.textContent ?? "";
}

function escapeHTML(value) {
  return foundry.utils?.escapeHTML?.(String(value)) ?? String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}
