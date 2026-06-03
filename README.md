# Vorfale Tweaks

One Foundry VTT module that acts as a container and settings hub for small tweaks.

Each tweak lives in its own folder under `tweaks/`:

- `tweaks/sr-portraits` - chat speaker portraits.
- `tweaks/chat-images` - chat media upload and rendering.
- `tweaks/levels` - level background token hiding.

Each tweak folder can contain:

- `tweak.json` - metadata and entrypoint.
- `scripts/main.js` - tweak behavior.
- `styles/*.css` - tweak-specific styles.
- `languages/*.json` - tweak-specific localization.

## Settings

Open **Configure Settings** and choose **Vorfale Tweaks**.

Each section can be enabled or disabled independently:

- **SR Portraits** toggles chat portraits.
- **Chat Images** toggles the chat-controls media button, drag-and-drop uploads, paste uploads, and media commands.
- **Levels** toggles the Level settings checkbox and background-token hiding logic.

## Notes

To add a new tweak, add a folder under `tweaks/`, create `tweak.json`, add the manifest path to `tweaks/index.js`, and provide an `init(context)` export from the tweak entrypoint.

The level tweak reads old flags from the previous `level-token-cull-v14` module, so existing level checkboxes should keep working after migration.
