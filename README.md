# Vorfale Tweaks

Vorfale Tweaks is a modular Foundry VTT v14 add-on that collects small quality-of-life fixes, compatibility bridges, and table-specific workflow improvements in one settings hub.

Each feature is built as an independent tweak under `tweaks/`. You can enable or disable every tweak from **Configure Settings > Vorfale Tweaks**, and dependency-specific tweaks are disabled automatically when their required system or module is not active.

## Installation

Use this manifest URL in Foundry's module installer:

```text
https://raw.githubusercontent.com/Vorfale/vorfale-tweaks/main/module.json
```

The module is intended for Foundry VTT v14.

## Tweaks

### Chat

- **SR Portraits**  
  Shows the speaking token portrait next to chat speaker names and opens the actor sheet when the portrait is clicked. Requires the Shadowrun 5 system.

- **Chat Images**  
  Adds chat media posting for images, video, and audio, including chat controls, uploads, paste support, drag-and-drop support, media previews, and in-Foundry image viewing.

- **Chat Auto Scroll Fix**  
  Keeps chat pinned to the newest message when appropriate, especially after character speech or fast chat activity.

- **Plain Chat Input**  
  Keeps Foundry v14's chat editor but disables automatic markdown-style shortcuts such as dash-to-list, numbered lists, headings, blockquotes, code blocks, horizontal rules, and double-dash replacement.

- **Narrator**  
  Adds `/narrate` and `/describe` chat commands. `/narrate` posts a narration message and displays it as a temporary fullscreen overlay, while `/describe` posts a centered descriptive chat message.

### Compatibility

- **SR5 Automated Animations Bridge**  
  Connects Shadowrun 5 attack roll messages to Automated Animations and protects AA automatic recognition settings from being lost after reloads. Requires Shadowrun 5 and Automated Animations.

- **Linklame MacOS Keybind**  
  Applies macOS-only keybinding fixes for Quick Insert and Shadowrun Prompt Success Test, while leaving Windows, Linux, and existing custom user bindings untouched. Requires Quick Insert.

### Trinkets

- **Round Token Borders**  
  Replaces square hover and control frames with round token rings.

### Sound

- **Random Ambient Sounds**  
  Extends Ambient Sound configuration with random folder or wildcard playback. Random sounds use Foundry's ambient sound positioning, volume, radius, walls, and audio effects as closely as possible while rotating through matching files.

### UX/UI

- **Actor Token Setup**  
  Opens a focused setup dialog after actor creation and from actor sheet actions. It edits actor portrait, prototype token image, token name, token display mode, and optional Image Hover specific art.

### Tools

- **Load Diagnostics**  
  Adds a lightweight client load audit for slow-loading players. It records Foundry loading milestones, canvas readiness, resource timing, slow assets, module resource downloads, chat history weight, rendered chat size, scene weight, captured client errors, and safe optimization recommendations. GMs can see summaries from players whose clients reached the ready/canvas-ready stage. It cannot measure work that happens before this module itself is loaded.

### Foundry V14 Fixes

- **Levels**  
  Adds a "Hide tokens under floor" control to Level settings. Lower tokens can be hidden under opaque background pixels while still remaining visible through transparent areas using Foundry's normal visibility rules.

- **Roof Occlusion Fix**  
  Fixes overhead Fade roof behavior where visible tokens under a roof could incorrectly reveal the entire roof. It also hides token names, elevation labels, hover cues, and targeting through closed roofs until the roof is actually revealed.

## Settings And Storage

The main Vorfale Tweaks switches are stored as Foundry world settings. Tweak-specific document data is stored on the affected Foundry documents, such as actors, tiles, levels, or ambient sounds.

Removing the module does not delete actor images, token prototype settings, ambient sound documents, or other Foundry documents. Features that rely on Vorfale-specific flags simply stop using those flags while the module is disabled or removed.

Some tweaks may ask for a scene or Foundry reload after being enabled or disabled because they patch canvas rendering or document sheet behavior.

## Dependencies

Most tweaks are system-agnostic. A few are intentionally conditional:

- **SR Portraits** requires the `shadowrun5e` system.
- **SR5 Automated Animations Bridge** requires the `shadowrun5e` system and the `autoanimations` module.
- **Linklame MacOS Keybind** requires the `quick-insert` module, only applies changes on macOS clients, and only changes relevant default keybindings.

When a dependency is missing, the tweak appears disabled in the settings menu instead of trying to run.

## Development

Each tweak is self-contained:

```text
tweaks/
  tweak-id/
    tweak.json
    scripts/main.js
    styles/*.css
    languages/*.json
```

To add a new tweak:

1. Create a new folder under `tweaks/`.
2. Add `tweak.json` with an `id`, `title`, `category`, and optional scripts, styles, languages, dependencies, or reload behavior.
3. Add the manifest path to `tweaks/index.js`.
4. Export `init(context)` from the tweak entrypoint.

The settings hub discovers listed tweak manifests and renders them by category. This keeps individual tweaks easy to edit, test, remove, or extend without mixing their logic into the module shell.
