# S.H.E.L.L.Y. – Stream Sound Alerts

This directory holds `.mp3` audio files used by the streaming overlay system for sound alerts triggered from the Stream Dashboard.

## Supported Sound Files

Place MP3 files here with the following exact filenames:

| Filename                     | Dashboard Button       | Recommended Sound                                 |
|------------------------------|------------------------|---------------------------------------------------|
| `tornado-warning.mp3`        | 🌪️ Tornado Siren       | EAS Tornado Warning tone / civil defense siren    |
| `severe-thunderstorm.mp3`    | ⛈️ Thunderstorm         | EAS Severe Thunderstorm Warning tone              |
| `flash-flood.mp3`            | 🌊 Flash Flood          | EAS Flash Flood Warning tone                      |
| `special-weather.mp3`        | 📡 Special Wx           | Short alert chime for Special Weather Statements  |
| `chime.mp3`                  | 🔔 Chime                | Gentle notification chime                         |
| `test-tone.mp3`              | 🎚️ Test Tone            | Short test tone (e.g. 440Hz or 1kHz sine wave, 1–2 seconds) |

## Notes

- If a file is missing, S.H.E.L.L.Y. will automatically generate a synthesized tone using the Web Audio API as a fallback — the sound alert will still work.
- Files are served as static assets from the `/sounds/` path.
- Use MP3 format for broadest browser compatibility.
- Keep sound files short — typically 1–10 seconds. Longer files will play in full before the display returns to normal.
- Volume can be adjusted per-alert in the dashboard (0.0 – 1.0).

## Mounting in Docker

In your `docker-compose.yml`, mount the sounds directory alongside the music directory:

```yaml
volumes:
  - ./music:/app/music:ro
  - ./sounds:/app/sounds:ro
```

## Free Sound Resources

The following are suggestions for finding compliant alert sounds. **Always verify licensing before use.**

- [Emergency Alert System (EAS) tones](https://en.wikipedia.org/wiki/Emergency_Alert_System) — these are distinctive audio signals used by NOAA/NWS
- [freesound.org](https://freesound.org) — search for "alert", "chime", "siren" (filter by CC0 license)
- [NOAA Weather Radio](https://www.weather.gov/nwr/) — NWS broadcasts can be recorded for monitoring purposes

> ⚠️ **Legal Note:** EAS attention tones (the distinctive two-tone attention signal) are legally restricted for use in official emergency broadcasts in the United States. For streaming purposes, use custom tones that are clearly differentiated from official EAS signals to avoid confusion with real emergency alerts.
