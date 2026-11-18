# SHELLY v2 videos: teaser + full release

Two videos for the v2 launch. They cover everything up to **SHELLY 2.1.0**
(see [RELEASE_NOTES_v2.md](RELEASE_NOTES_v2.md) and
[RELEASE_NOTES_v2.1.0.md](RELEASE_NOTES_v2.1.0.md)):

1. **Teaser** (30–45 s): mood, motion, the turtle and the date. No feature list.
2. **Full release** (7–9 min): what v2 does, why it's safer, and the new SHELLY
   Live and Forecaster Studio from 2.1.0.

Both use the same footage library (§3), so you only record once.

---

## 1. Ground rules

- **Name is SHELLY**, on every title card and in the voiceover. The turtle is the
  mascot. The grandmother is never shown; the name is the tribute.
- **Links stay up while the videos are made, then come down until your release
  time.** So:
  - Normal shots (skies, layouts, forecast cards, `/get-android/`, the app
    install) can be recorded from the public site while it's up.
  - Record anything that **sends** something from **local dev** (`npm run dev`):
    TEST alerts, test web push and app push, announcements, bulletins, Say
    something. On the public site those would reach real subscribers and viewers.
  - The teaser goes out while the links are down, so it shows the **date and time only**. No URL, no QR code, nothing
    that would lead to a dead page. "Link at launch" in the description is fine.
  - The release video and its description can show the URL and `/get-android/`,
    but publish them (or schedule them as Premieres) for the **same moment** the
    links go back up. Check that the links work before the video goes public.
  - Don't put the links in a pinned comment, the announcements bar or anywhere
    else before release time.
- **Every demo alert is a TEST.** Use the admin simulator's custom test alerts,
  which are always labelled TEST, and keep that label in frame. Put a small
  on-screen line over every alert shot: "Demo alerts shown. Real alerts come from
  the National Weather Service." Never show a made-up warning that could pass
  for a real one.
- **SHELLY's own bulletins** (Bulletin, Advisory, Alert) are already labelled
  SHELLY and "not an official NWS alert". Keep that label in frame too.
- **Nothing private on screen:** no admin password, no real home address or GPS
  dot at your house (search a public place, such as Center City Philadelphia),
  no email addresses, no keys (Firebase, VAPID, OpenRouter, proxy password or
  tunnel URL), no bookmarks bar or other tabs. Use a clean browser profile.
- **Original look only.** No Y'allBot or RHY style, branding or music.
- **Android:** the app is at **2.0.1**. 2.1.0 has no app changes, so the app
  footage won't need re-recording for this release.

## 2. Tools (all free)

| Job | Tool |
|---|---|
| Screen capture | **OBS Studio** (already set up for SHELLY Live), 1920×1080, 60 fps, CQP ~18 |
| Phone capture | Android's built-in screen recorder, or **scrcpy** with `--record` for clean 1080p |
| Edit, colour, titles | **DaVinci Resolve** (free) |
| Voiceover | Your own voice (recommended), or SHELLY's voice for a few lines |
| Music | SHELLY's own tracks from `public/music/` (yours, so no licence trouble) |
| Thumbnails | Forecaster Studio PNG export plus the turtle SVG, finished in any image editor |

**Voice cost:** each spoken line on `/live` uses TTS credits on Deepgram Aura-2.
For the footage, run the **local Kokoro voice** (from 2.1.0) so recording is
free. Use Aura-2 only for any line where you want that exact voice.

## 3. Shot list (footage library)

These URL switches already exist in the code, so shots don't depend on the real
weather:

- `?scene=<id>` forces a sky: `clear-day`, `heat`, `partly-day`, `cloudy`, `fog`,
  `drizzle`, `rain`, `storm`, `sleet`, `snow`, `clear-night`, `partly-night`.
- `?mode=kiosk | web | phone | broadcast` forces a layout.

- `/live?host=<words>` sets the turtle's look for filming. Use any mix,
  separated by commas:
  - outfit: `shades`, `winter`, `umbrella`, `sleepy` (nightcap), `none`
  - mood: `happy`, `curious`, `focused`, `worried`
  - trick, repeated every 4 s: `look`, `lookR`, `wave`, `tilt`, `hop`, `blink2`, `sparkle`

  Example: `/live?host=winter,curious,wave`. It only changes the turtle's look.
  The threat level, the glow and what airs stay real, and a real WARNING or
  EMERGENCY switches it off. Never put it in the OBS stream URL.

### Website and app

| # | Shot | How | Used in |
|---|---|---|---|
| S1 | Sky loop for every scene, 10 s each, no UI moves | `?scene=…&mode=kiosk`, one per scene | Teaser + release |
| S2 | Storm with lightning, held for 20 s | `?scene=storm` | Teaser hook |
| S3 | Opening the site: straight to weather, search, "My location" | `?mode=web`, search "Philadelphia" | Release |
| S4 | The three layouts side by side (TV, desktop, phone) | `?mode=kiosk`, `?mode=web`, `?mode=phone` | Teaser + release |
| S5 | TEST alert takeover: map, action card, storm ETA, voice | Admin simulator → custom test alert | Release (teaser: 1 s flash at most) |
| S6 | Safety cards close up: action card, ETA, freshness/latency, stale-data banner, nowcast, storm reports, confidence, local hazards, what to wear | Slow scroll in `?mode=web` | Release |
| S7 | Self-grading forecast card | Needs the default location set in admin | Release |
| S8 | Web push arriving (TEST) | Admin → test web push | Release |
| S9 | "Play sound on" a TV/Roku | Film the TV with a phone camera | Release |
| S10 | Android: `/get-android/` page, install, permission walkthrough, widget going amber/red, TEST alert notification, Check for updates | Phone recording + one handheld home-screen shot. Record the page and install from the public site while it's up; the TEST alert notification comes from local dev | Release |
| S11 | Admin tour (login page, simulator, display settings, music, announcements). Password typed off-camera | Admin in `?mode=web` | Release (short) |
| S12 | Old site vs new, same city, same moment | A `legacy-v1` build or `docs/screenshots/legacy.png` | Release ("before and after") |

### SHELLY Live (2.1.0)

| # | Shot | How | Used in |
|---|---|---|---|
| S13 | Turtle host close up: idle tricks (look, wave, tilt, hop, blink) | `/live`, calm weather | Teaser end card + release |
| S14 | Outfits and moods: sunglasses, beanie and scarf, umbrella, nightcap; happy, curious, focused, worried | `/live?host=shades,happy`, `?host=winter,curious`, `?host=umbrella,focused`, `?host=sleepy`, `?host=worried` | Teaser + release |
| S15 | Speech-bubble reactions ("Brrrr!", "Radar check!") | `/live`, let the rundown play | Release |
| S16 | Block montage: temperature and rain maps, 7-day, next 12 hours, weekend, sun/moon/UV, alerts board, locator map with county lines and pin, radar | `/live` with the rundown builder set to short times | Teaser (2–3 cuts) + release |
| S17 | Rundown builder: switching blocks on and off, reordering, Play next, Hold, Skip | Admin, side by side with `/live` (the broadcast updates within ~5 s) | Release |
| S18 | "Say something": type a line, then SHELLY says it on air | Admin + `/live`, local voice | Release |
| S19 | AI line: ask for one, edit it, press Say it now. Show that nothing airs before that press | Admin + `/live`, local Qwen3 | Release |
| S20 | SHELLY bulletin with its "not an official NWS alert" label, then a TEST NWS warning breaking through a hold | Admin + simulator | Release (safety chapter) |

### Forecaster Studio (2.1.0)

| # | Shot | How | Used in |
|---|---|---|---|
| S21 | Building graphics: forecast card, impact scale, day planner, today vs tomorrow, the odds | Studio in admin | Release |
| S22 | Quick set: making highs, lows, feels like, rain chance and gust maps in one press, then them playing on `/live` | Studio + `/live` | Release |
| S23 | Hand-drawn risk map and snow/rain totals being drawn | Studio | Release |
| S24 | PNG export, landscape and portrait | Studio | Release + thumbnail |

**Tips:** hide the mouse cursor in OBS for the motion shots. Hold the UI still
for 5 s at the start and end of each clip so the editor has room to cut. Record
phone shots with Do Not Disturb on. For admin + `/live` side-by-side shots,
record two OBS scenes at once, or one 1920×1080 canvas split in two.

## 4. Teaser (30–45 s)

Goal: "something new is coming" plus the date. Driven by music, few words, no link.

| Time | Picture | Sound / text |
|---|---|---|
| 0:00–0:04 | Black, then a lightning flash shows the storm sky (S2) | Thunder, music starts low |
| 0:04–0:13 | Quick cuts through the skies: sun, fog, rain, snow, clear night (S1), 1–2 s each, on the beat | No words |
| 0:13–0:19 | Same forecast on TV, desktop and phone (S4), sliding in | Text: "Every screen." |
| 0:19–0:22 | One-second flash of the TEST takeover (S5), with the demo line | Text: "When it matters most." |
| 0:22–0:30 | The turtle in quick outfit changes: sunglasses → beanie → umbrella → nightcap (S14), then 2–3 Live map cuts (S16) | Text: "And a new host." |
| 0:30–0:36 | Turtle waves (S13), then the SHELLY v2 wordmark | Music builds |
| 0:36–0:40 | Date and time card only | Music hits and ends |

Deliverables: 16:9 for YouTube, plus a 9:16 cut (re-framed, 20–30 s) for
Shorts / Reels / TikTok, with captions burned in. The description says the date
and "link at launch", nothing more.

## 5. Full release video (7–9 min)

Goal: show what v2 does, show it's safer, and get people to the site, the app
and the stream. It's led by the voiceover, with YouTube chapters.

| Chapter | Length | Content | Shots |
|---|---|---|---|
| 1. Cold open | 0:20 | A shorter version of the teaser's sky montage. "This is SHELLY v2." | S1, S13 |
| 2. What SHELLY is | 0:30 | Who it's for, the Philly area, based on NWS data. One line on the name if you want it (decision 3) | S3 |
| 3. Rebuilt from scratch | 0:30 | Old vs new side by side. Opens straight to your weather | S12, S3 |
| 4. Every screen | 0:40 | TV/kiosk, desktop and phone, each a real layout. "Play sound on" a TV | S4, S9 |
| 5. Skies that match the weather | 0:30 | Scenes, text that stays readable on every sky | S1 |
| 6. Built for warnings | 1:20 | The main part. TEST takeover → action card → storm ETA → voice → freshness/latency → stale-data banner. Say clearly: alert text comes from the NWS, never from AI | S5, S6 |
| 7. Everyday forecast tools | 0:45 | Nowcast, storm reports, confidence, local hazards, what to wear, self-grading forecasts | S6, S7 |
| 8. Alerts that find you | 0:30 | Web push matched to the warning area, not the whole county | S8 |
| 9. The Android app | 0:50 | Install, permissions, widget turning amber/red, alerts that follow your location (kept private), self-update that won't install during a warning | S10 |
| 10. SHELLY Live | 1:30 | The 24/7 stream: the host's moods, outfits and reactions, the 21 blocks, the locator map. Then the controls: rundown builder, Say something, AI lines you review before they air | S13–S19 |
| 11. Safety on the stream | 0:30 | NWS warnings always break through a hold, an emergency shows only the warning, SHELLY bulletins are clearly labelled, and the AI never writes alert text | S20 |
| 12. Forecaster Studio | 1:00 | Forecast card, impact scale, day planner, today vs tomorrow, the odds, Quick set maps, drawn risk and totals maps, PNG export | S21–S24 |
| 13. Behind the curtain | 0:20 | Admin in brief. One Worker, 260+ tests, and the AI and voice can run on your own PC (one line for the nerds) | S11 |
| 14. Outro | 0:20 | URL, `/get-android/`, the stream link, subscribe, the turtle waves goodbye | S13 |

**Script approach:** write the voiceover as plain text first. At about 130 words
a minute, that's roughly 1,000 words. Read it aloud, then cut the footage to
the recording. Keep sentences short and let the pictures carry the feature names.

**Deliverables:** 16:9 1080p master, chapters, captions (.srt from Resolve's
auto-subtitles, then corrected), a thumbnail, and 3–4 vertical clips cut from
chapters 6, 9, 10 and 12.

## 6. Decisions for you

1. **Voice:** your own voice, SHELLY's voice, or text and music only?
2. **Is SHELLY Live on air at release time?** If it is, chapter 10 ends with
   "watch it now" and the stream link. If not, it ends with "coming soon".
3. **The name:** say on camera that SHELLY is named for your grandmother, or keep
   that private?
4. **Release date and time:** this goes on the teaser's card. It's also when the
   links go back up and the release video goes public.
5. **Where it goes besides YouTube** (Shorts, Reels, TikTok, the announcements
   bar after launch)?

## 7. Order of work

1. Answer §6.
2. ~~Add the `?host=` filming switch on `/live`.~~ Done (2026-11-17).
3. Set up a clean browser profile, a TEST alert in the simulator, and the local
   Kokoro voice and Qwen3 host.
4. Record the footage library (§3) while the links are up: normal shots from the
   public site, anything that sends alerts or messages from local dev. About two evenings.
5. Edit the teaser.
6. Write and record the release voiceover, then edit the release video. Re-record
   any shot you missed before the links come down.
7. Once both videos are done, take the links down.
8. Post the teaser 5–7 days before release, showing the date only, and upload
   the release video as **scheduled / Premiere** for your release time.
9. At release time: put the links back up, check they work (site,
   `/get-android/`, stream), and confirm the video went public.
