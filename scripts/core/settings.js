import { MODULE_ID } from "./constants.js";
import { getTweaks, TWEAK_IDS } from "./registry.js";

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
}

export function isTweakEnabled(key) {
  return game.settings.get(MODULE_ID, key) === true;
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
