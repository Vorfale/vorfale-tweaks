const IMAGE_HOVER_MODULE_ID = "image-hover";
const IMAGE_HOVER_FLAG_KEY = "specificArt";
const DEFAULT_TOKEN_IMAGE = "icons/svg/mystery-man.svg";
const ACTOR_SHEET_HEADER_PATCH_KEY = Symbol.for("vorfaleTweaks.actorTokenSetup.actorSheetHeaderPatch");
const openedActors = new Set();

let context;

export function init(tweakContext) {
  context = tweakContext;
  patchActorSheetHeaderControls();
  Hooks.once("ready", patchActorSheetHeaderControls);

  Hooks.on("createActor", (actor, _options, userId) => {
    if (!context?.isEnabled?.()) return;
    if (userId !== game.userId) return;
    if (!actor?.id || actor.pack) return;
    if (!actor.canUserModify?.(game.user, "update")) return;
    openSetupDialogSoon(actor);
  });
}

function patchActorSheetHeaderControls() {
  const ActorSheetClass = foundry.applications?.sheets?.ActorSheetV2 ?? globalThis.ActorSheetV2;
  const prototype = ActorSheetClass?.prototype;
  if (!prototype || prototype[ACTOR_SHEET_HEADER_PATCH_KEY]) return;

  const original = prototype._getHeaderControls;
  if (typeof original !== "function") return;

  prototype[ACTOR_SHEET_HEADER_PATCH_KEY] = { original };
  prototype._getHeaderControls = function vorfaleActorTokenSetupHeaderControls(...args) {
    const controls = original.apply(this, args);
    addActorSheetHeaderControl(this, controls);
    return controls;
  };
}

function addActorSheetHeaderControl(sheet, controls) {
  if (!Array.isArray(controls)) return;

  const actor = sheet?.document;
  if (actor?.documentName !== "Actor") return;
  if (controls.some(control => control?.action === "vorfaleActorTokenSetup")) return;

  const control = {
    action: "vorfaleActorTokenSetup",
    icon: "fa-solid fa-id-card-clip",
    label: context.localize("ContextMenu"),
    visible: function visibleActorTokenSetup() {
      return context?.isEnabled?.() && actor?.canUserModify?.(game.user, "update");
    },
    onClick: () => {
      if (actor?.canUserModify?.(game.user, "update")) openSetupDialog(actor);
    }
  };

  const prototypeIndex = controls.findIndex(item => item?.action === "configurePrototypeToken");
  const insertIndex = prototypeIndex >= 0 ? prototypeIndex + 1 : controls.length;
  controls.splice(insertIndex, 0, control);
}

function openSetupDialogSoon(actor) {
  if (openedActors.has(actor.uuid)) return;
  openedActors.add(actor.uuid);
  window.setTimeout(() => openSetupDialog(actor), 350);
}

function openSetupDialog(actor) {
  if (!context?.isEnabled?.()) return;

  const tokenName = actor.prototypeToken?.name || actor.name || "";
  const displayName = Number(actor.prototypeToken?.displayName ?? CONST.TOKEN_DISPLAY_MODES.NONE);
  const actorImg = actor.img ?? "";
  const tokenImg = actor.prototypeToken?.texture?.src ?? "";
  const hoverImg = getImageHoverPath(actor);
  const title = context.localize("DialogTitle").replace("{name}", escapeHTML(actor.name ?? ""));

  new Dialog({
    title,
    content: renderForm(tokenName, displayName, actorImg, tokenImg, hoverImg),
    buttons: {
      apply: {
        icon: '<i class="fa-solid fa-check"></i>',
        label: context.localize("Apply"),
        callback: html => applySetup(actor, normalizeHtml(html))
      }
    },
    default: "apply",
    render: html => activateListeners(normalizeHtml(html))
  }, {
    classes: ["vorfale-actor-token-setup-dialog"],
    width: 560
  }).render(true);
}

function renderForm(tokenName, displayName, actorImg, tokenImg, hoverImg) {
  return `
    <form class="vorfale-actor-token-setup">
      ${renderTokenNameField(tokenName)}
      ${renderDisplayNameField(displayName)}
      ${renderImageField("actor", context.localize("ActorPortrait"), context.localize("ActorPortraitHint"), actorImg)}
      ${renderImageField("token", context.localize("TokenImage"), context.localize("TokenImageHint"), tokenImg)}
      ${renderImageField("hover", context.localize("HoverImage"), context.localize("HoverImageHint"), hoverImg, "specific-image-hover", `flags.${IMAGE_HOVER_MODULE_ID}.${IMAGE_HOVER_FLAG_KEY}`)}
    </form>
  `;
}

function renderTokenNameField(value) {
  return `
    <div class="form-group">
      <label>${escapeHTML(context.localize("TokenName"))}</label>
      <div class="form-fields">
        <input type="text" name="prototypeToken.name" data-field="tokenName" value="${escapeHTML(value)}">
      </div>
    </div>
  `;
}

function renderDisplayNameField(value) {
  return `
    <div class="form-group">
      <label>${escapeHTML(context.localize("DisplayName"))}</label>
      <div class="form-fields">
        <select name="prototypeToken.displayName" data-field="displayName">
          ${renderDisplayNameOptions(value)}
        </select>
      </div>
    </div>
  `;
}

function renderDisplayNameOptions(selectedValue) {
  return getTokenDisplayModes()
    .map(([key, value]) => `<option value="${value}" ${Number(selectedValue) === Number(value) ? "selected" : ""}>${escapeHTML(context.localize(`DisplayName${key}`))}</option>`)
    .join("");
}

function getTokenDisplayModes() {
  const modes = CONST.TOKEN_DISPLAY_MODES;
  return [
    ["NONE", modes.NONE],
    ["CONTROL", modes.CONTROL],
    ["OWNER_HOVER", modes.OWNER_HOVER],
    ["HOVER", modes.HOVER],
    ["OWNER", modes.OWNER],
    ["ALWAYS", modes.ALWAYS]
  ];
}

function renderImageField(name, label, hint, value, inputClass = "", inputName = name) {
  return `
    <div class="form-group vorfale-actor-token-setup-image-field">
      <label>${escapeHTML(label)}</label>
      <div class="form-fields">
        <div class="vorfale-actor-token-setup-field-row">
          <div class="vorfale-actor-token-setup-thumb" data-preview="${name}">${renderPreview(value)}</div>
          <input class="${escapeHTML(inputClass)}" type="text" name="${escapeHTML(inputName)}" data-field="${name}" value="${escapeHTML(value)}">
          <button type="button" class="icon fa-solid fa-file-import vorfale-actor-token-setup-browse" data-target="${name}" data-tooltip="${escapeHTML(context.localize("Browse"))}" aria-label="${escapeHTML(context.localize("Browse"))}"></button>
        </div>
      </div>
      <p class="hint">${escapeHTML(hint)}</p>
    </div>
  `;
}

function renderPreview(src) {
  const path = String(src ?? "").trim();
  if (!path) return "";
  return `<img src="${escapeHTML(path)}" alt="">`;
}

function activateListeners(element) {
  const actorInput = getFieldInput(element, "actor");
  const tokenInput = getFieldInput(element, "token");
  if (tokenInput) tokenInput.dataset.autoFromActor = isEmptyTokenImage(tokenInput.value) ? "true" : "false";

  actorInput?.addEventListener("input", () => syncTokenImageFromActor(element, actorInput, tokenInput));
  actorInput?.addEventListener("change", () => syncTokenImageFromActor(element, actorInput, tokenInput));
  tokenInput?.addEventListener("input", () => {
    tokenInput.dataset.autoFromActor = "false";
  });
  tokenInput?.addEventListener("change", () => {
    tokenInput.dataset.autoFromActor = "false";
  });

  for (const input of element.querySelectorAll("[data-field]")) {
    input.addEventListener("input", () => updatePreview(element, input.dataset.field, input.value));
    input.addEventListener("change", () => updatePreview(element, input.dataset.field, input.value));
  }

  const dialog = element.closest(".window-app, .application, .app");
  dialog?.querySelector('[data-button="apply"], .dialog-buttons button')?.classList.add("primary");

  for (const button of element.querySelectorAll(".vorfale-actor-token-setup-browse")) {
    button.addEventListener("click", () => {
      const target = button.dataset.target;
      const input = getFieldInput(element, target);
      browseImage(input, () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }
}

async function applySetup(actor, element) {
  const tokenName = getFieldValue(element, "tokenName");
  const displayName = Number(getFieldValue(element, "displayName"));
  const actorImg = getFieldValue(element, "actor");
  const tokenImg = getFieldValue(element, "token");
  const finalTokenImg = actorImg && isEmptyTokenImage(tokenImg) ? actorImg : tokenImg;
  const hoverImg = getFieldValue(element, "hover");
  const update = {};

  if (tokenName) update["prototypeToken.name"] = tokenName;
  if (Number.isFinite(displayName)) update["prototypeToken.displayName"] = displayName;
  if (actorImg) update.img = actorImg;
  if (finalTokenImg) update["prototypeToken.texture.src"] = finalTokenImg;
  if (isImageHoverActive() && (hoverImg || hasImageHoverPath(actor))) {
    update[`prototypeToken.flags.${IMAGE_HOVER_MODULE_ID}.${IMAGE_HOVER_FLAG_KEY}`] = hoverImg;
  }

  if (!Object.keys(update).length) return;

  await actor.update(update);
  ui.notifications?.info?.(context.localize("Applied"));
}

function browseImage(input, callback) {
  if (!input) return;

  const pickerClass = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
  if (!pickerClass) return;

  try {
    const picker = new pickerClass({
      type: "image",
      current: input.value || "",
      callback: path => {
        input.value = path ?? "";
        callback?.();
      }
    });
    picker.render(true);
  } catch (error) {
    console.warn("vorfale-tweaks/actor-token-setup | Could not open file picker.", error);
  }
}

function getFieldInput(element, name) {
  return element.querySelector(`[data-field="${name}"]`);
}

function getFieldValue(element, name) {
  return String(getFieldInput(element, name)?.value ?? "").trim();
}

function syncTokenImageFromActor(element, actorInput, tokenInput) {
  if (!actorInput || !tokenInput) return;

  const actorPath = actorInput.value.trim();
  if (actorPath && (isEmptyTokenImage(tokenInput.value) || tokenInput.dataset.autoFromActor === "true")) {
    tokenInput.value = actorPath;
    tokenInput.dataset.autoFromActor = "true";
    updatePreview(element, "token", tokenInput.value);
  }
  updatePreview(element, "actor", actorInput.value);
}

function updatePreview(element, name, value) {
  const preview = element.querySelector(`[data-preview="${name}"]`);
  if (preview) preview.innerHTML = renderPreview(value);
}

function isEmptyTokenImage(value) {
  const path = String(value ?? "").trim();
  return !path || path === DEFAULT_TOKEN_IMAGE;
}

function getImageHoverPath(actor) {
  return actor.prototypeToken?.flags?.[IMAGE_HOVER_MODULE_ID]?.[IMAGE_HOVER_FLAG_KEY] ?? "";
}

function hasImageHoverPath(actor) {
  return Boolean(getImageHoverPath(actor));
}

function isImageHoverActive() {
  return game.modules?.get?.(IMAGE_HOVER_MODULE_ID)?.active === true;
}

function normalizeHtml(html) {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? document;
  if (html?.jquery) return html[0] ?? document;
  return html?.[0] ?? document;
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
