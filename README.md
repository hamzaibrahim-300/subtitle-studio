# Subtitle Studio (V1)

Subtitle Studio is a Manifest V3 Chrome extension that injects a subtitle overlay over HTML5 videos, with upload + OpenSubtitles search, dual subtitle tracks, sync controls, and per-track styling.

## Features in V1

- Subtitle formats: **SRT, VTT, ASS, SSA**
- Dual subtitle rendering with independent style/position
- Timing sync controls
  - Keyboard: **Alt + Left / Alt + Right** (primary track ±100ms)
  - UI buttons: ±100ms, ±500ms, reset (per track)
- Dynamic `<video>` detection with fullscreen-aware overlay
- Side panel with:
  - Current video status
  - Upload (file picker + drag/drop)
  - OpenSubtitles search + match scoring
  - Sync + appearance controls
  - Basic library (recent/favorites/history)
- Background service worker for OpenSubtitles API calls, caching, storage routing
- Persistent storage for settings, site overrides, and library entries

## Setup

```bash
npm install
```

## Build

```bash
npm run build
```

Build output is generated in `./dist`.

## Run in Chrome

1. Build the extension (`npm run build`).
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `./dist` directory.
6. Open the side panel from the extension action.

## OpenSubtitles setup

- Create an OpenSubtitles API key.
- Paste it into the side panel **OpenSubtitles API key** field and click **Save key**.

## Development

Watch build:

```bash
npm run dev
```

Run parser tests:

```bash
npm test
```

## Known limitations

- Iframe support is best-effort. Cross-origin frames may block overlay/message access.
- Some DRM-restricted players may prevent usable overlay rendering.
- OpenSubtitles results depend on title metadata quality and API availability.
- ASS/SSA is parsed for dialogue timing/text, but advanced ASS effects/typesetting are not fully rendered.
