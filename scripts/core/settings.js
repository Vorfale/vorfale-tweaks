import { MODULE_ID } from "./constants.js";
import { getTweakAvailability, getTweaks, TWEAK_IDS } from "./registry.js";

export { MODULE_ID };

export function registerVorfaleSettings() {
  game.settings.register(MODULE_ID, "aaAutorecBackup", {
    name: "AA Autorec Backup",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  for (const key of TWEAK_IDS) {
    game.settings.register(MODULE_ID, key, {
      name: game.i18n.localize(`VORFALE_TWEAKS.${key}.name`),
      hint: game.i18n.localize(`VORFALE_TWEAKS.${key}.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: value => {
        if (!canManageTweaks()) return;

        Hooks.callAll("vorfaleTweaks.changed", key);
        maybePromptSceneReload(key, value);
      }
    });
  }

  Hooks.on("renderSettingsConfig", (_app, html) => {
    markUnavailableTweakSettings(normalizeHtml(html));
  });
}

export function isTweakEnabled(key) {
  return game.settings.get(MODULE_ID, key) === true && getTweakAvailability(key).available;
}

function maybePromptSceneReload(key) {
  if (!canManageTweaks()) return;

  const tweak = getTweaks().find(entry => entry.id === key);
  if (!tweak?.requiresSceneReload && key !== "levels") return;

  const title = game.i18n.localize("VORFALE_TWEAKS.ReloadSceneTitle");
  const content = `<p>${game.i18n.localize("VORFALE_TWEAKS.ReloadSceneContent")}</p>`;
  Dialog.confirm({
    title,
    content,
    yes: reloadFoundryPage,
    no: () => {},
    defaultYes: false
  });
}

function reloadFoundryPage() {
  window.location.reload();
}

function canManageTweaks() {
  return game.user?.isGM === true;
}

function markUnavailableTweakSettings(element) {
  if (!element) return;

  for (const key of TWEAK_IDS) {
    const availability = getTweakAvailability(key);
    if (availability.available) continue;

    const input = element.querySelector(`[name="${MODULE_ID}.${key}"]`);
    if (!input) continue;

    input.disabled = true;
    input.checked = false;

    const group = input.closest(".form-group");
    group?.classList.add("vorfale-tweaks-setting-unavailable");
    group?.querySelector("label")?.setAttribute("data-tooltip", game.i18n.localize("VORFALE_TWEAKS.DependencyUnavailable"));

    const hint = group?.querySelector(".hint, .notes");
    if (hint && !hint.querySelector(".vorfale-tweaks-missing-dependencies")) {
      const note = document.createElement("span");
      note.className = "vorfale-tweaks-missing-dependencies";
      note.textContent = ` ${formatMissingDependencies(availability.missing)}`;
      hint.append(note);
    }
  }
}

function formatMissingDependencies(missing) {
  const items = missing.map(entry => {
    const [type, id] = entry.split(":");
    const label = game.i18n.localize(`VORFALE_TWEAKS.Dependency${capitalize(type)}`);
    return `${label}: ${id}`;
  });
  return game.i18n.format("VORFALE_TWEAKS.MissingDependencies", { dependencies: items.join(", ") });
}

function capitalize(value) {
  return String(value ?? "").charAt(0).toUpperCase() + String(value ?? "").slice(1);
}

function normalizeHtml(html) {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? document;
  if (html?.jquery) return html[0] ?? document;
  return html?.[0] ?? document;
}
