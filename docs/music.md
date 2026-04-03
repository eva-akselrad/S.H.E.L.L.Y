# 🎵 Music Setup

S.H.E.L.L.Y. streams background music from the `music/` folder and supports both server-hosted and local folder playback.

## Quick Start (Hosted Server / Docker)

1. Drop audio files into the `music/` folder.
2. Run from the project root:
   ```bash
   node generate-playlist.js
   ```
3. Restart the server — music streams automatically on page load ✅

## Quick Start (Local / `file://`)

When opening `index.html` directly as a local file (`file://`), use the folder picker instead:

1. Open the **Settings** panel (☰)
2. Click **📁 Load Music Folder**
3. Select the `music/` folder

> **Note:** Both modes work simultaneously — server tracks load automatically, then local picker tracks are merged in.

## Supported Formats

| Format | Extension |
|--------|-----------|
| MP3    | `.mp3` ✅ recommended |
| OGG Vorbis | `.ogg` |
| WAV    | `.wav` |
| FLAC   | `.flac` |
| AAC / M4A | `.m4a` |
| Opus   | `.opus` |

## generate-playlist.js

Auto-scans the `music/` folder and writes `playlist.json`. Run it **after adding or removing files**.

```bash
# Run from project root
node generate-playlist.js
```

## Settings

| Setting | Description |
|---------|-------------|
| **Volume** | Adjust playback volume (0–100%) |
| **Shuffle** | Randomise track order |
| **Autoplay** | Start music automatically on load |
| **Audio Ducking** | Lower music volume during TTS weather alerts |

## Files in the `music/` Folder

| File | Purpose |
|------|---------|
| `playlist.json` | Auto-generated track list (commit this) |
| `*.mp3` / etc. | Your audio files |

> Run `node generate-playlist.js` (from the project root) after adding or removing tracks to keep `playlist.json` in sync.
