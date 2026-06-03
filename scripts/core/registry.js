import { MODULE_ID } from "./constants.js";
import { TWEAK_MANIFESTS } from "../../tweaks/index.js";

export const TWEAK_IDS = TWEAK_MANIFESTS.map(path => path.split("/")[1]);

const registry = new Map();

export async function loadTweaks() {
  for (const manifestPath of TWEAK_MANIFESTS) {
    try {
      const manifest = await loadTweakManifest(manifestPath);
      registry.set(manifest.id, manifest);

      await loadTweakLocalization(manifest);
      loadTweakStyles(manifest);

      const module = await import(`../../${manifest.path}/${manifest.esmodule}`);
      module.init?.(createTweakContext(manifest));
      console.info(`vorfale-tweaks | Loaded tweak: ${manifest.id}`);
    } catch (error) {
      console.error(`vorfale-tweaks | Failed to load tweak manifest: ${manifestPath}`, error);
    }
  }

  Hooks.callAll("vorfaleTweaks.loaded", getTweaks());
}

export function getTweaks() {
  return Array.from(registry.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getTweak(id) {
  return registry.get(id) ?? null;
}

async function loadTweakManifest(path) {
  const response = await fetch(`modules/${MODULE_ID}/${path}`);
  if (!response.ok) throw new Error(`Could not load tweak manifest: ${path}`);

  const manifest = await response.json();
  manifest.path = path.split("/").slice(0, -1).join("/");
  return manifest;
}

function loadTweakStyles(manifest) {
  for (const stylesheet of manifest.styles ?? []) {
    const href = `modules/${MODULE_ID}/${manifest.path}/${stylesheet}`;
    if (document.querySelector(`link[href="${href}"]`)) continue;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }
}

async function loadTweakLocalization(manifest) {
  const language = game.i18n.lang;
  const fallback = "en";
  const languagePath = findLanguagePath(manifest, language) ?? findLanguagePath(manifest, fallback);
  if (!languagePath) return;

  const response = await fetch(`modules/${MODULE_ID}/${manifest.path}/${languagePath}`);
  if (!response.ok) return;

  const translations = await response.json();
  foundry.utils.mergeObject(game.i18n.translations, translations, { inplace: true });
}

function findLanguagePath(manifest, language) {
  return (manifest.languages ?? []).find(path => path.endsWith(`/${language}.json`));
}

function createTweakContext(manifest) {
  return {
    id: manifest.id,
    moduleId: MODULE_ID,
    manifest,
    localize: key => game.i18n.localize(`VORFALE_TWEAKS.${manifest.id}.${key}`),
    isEnabled: () => game.settings.get(MODULE_ID, manifest.id) === true,
    onChange: callback => Hooks.on("vorfaleTweaks.changed", changedId => {
      if (changedId === manifest.id) callback(game.settings.get(MODULE_ID, manifest.id) === true);
    })
  };
}
