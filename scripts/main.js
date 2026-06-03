import { loadTweaks } from "./core/registry.js";
import { registerVorfaleSettings } from "./core/settings.js";

Hooks.once("init", () => {
  registerVorfaleSettings();
  loadTweaks().catch(error => {
    console.error("vorfale-tweaks | Failed to load tweaks.", error);
    ui?.notifications?.error?.("Vorfale Tweaks failed to load. Check the console for details.");
  });
});
