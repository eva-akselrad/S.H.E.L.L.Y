# SHELLY v2 videos: two teasers + the release

Three videos for the v2 launch. They cover everything up to **SHELLY 2.1.0**
(see [RELEASE_NOTES_v2.md](RELEASE_NOTES_v2.md) and
[RELEASE_NOTES_v2.1.0.md](RELEASE_NOTES_v2.1.0.md)).

| # | Video | Length | Feel | Voice |
|---|---|---|---|---|
| 1 | **"Signal"**: teases the tease | 8 s | Cryptic. Almost nothing is shown | None. Sound effects only |
| 2 | **"Forecast"**: the teaser | 30 s | More obvious, still cryptic. No feature is explained | None. Music + sound effects |
| 3 | **"SHELLY v2"**: the release | 3–4 min | A tech keynote, over the top | **SHELLY's own voice** (local Kokoro) + music + sound effects |

## Style: a tech keynote, turned up to 11

- **Black backgrounds, huge white type.** One short phrase at a time, centred,
  bold. Font: **Inter** (free, OFL), Bold/Black for titles, tight letter spacing.
- **Every phrase lands on a hit.** Text slams in with `slam`. Big reveals get
  `boom`. The logo gets `logo_hit`. Cuts get `whoosh` / `whoosh_fast`.
- **Product-shot camera work:** slow push-ins (100% → 110% over a shot),
  screens floating in 3D at a slight tilt, a soft light sweep across the glass,
  deep shadows. In Resolve, use the Transform and 3D tools in Fusion, or just
  Zoom + Position keyframes on the Edit page.
- **Grand claims, said with a straight face** ("We tore it down to the studs").
  Over the top in tone, **never in facts**: every claim must be true of what
  ships. No "most accurate", no "never wrong".
- **The turtle is the star of the reveal moments.**
- **Colour:** SHELLY's own teal and the alert colours (amber/red) as accents on black.

## 1. Ground rules

- **Name is SHELLY**, on every title card and in the voiceover. The turtle is the
  mascot. The grandmother is never shown; the name is the tribute.
- **Links stay up while the videos are made, then come down until your release
  time.** So:
  - Normal shots (skies, layouts, forecast cards, `/get-android/`, installing
    the app) can be recorded from the public site while it's up.
  - Record anything that **sends** something from **local dev** (`npm run dev`):
    TEST alerts, test web push and app push, announcements, bulletins, Say
    something. On the public site those would reach real subscribers and viewers.
  - Both teasers go out while the links are down, so they show the **date and
    time only**. No URL, no QR code. "Link at launch" in the description is fine.
  - Upload the release video as a **scheduled video / Premiere** for the moment
    the links go back up. Check the links before it goes public.
- **Every demo alert is a TEST.** Use the admin simulator's custom test alerts
  (always labelled TEST) and keep that label in frame. Put a small on-screen line
  over every alert shot: "Demo alerts shown. Real alerts come from the National
  Weather Service." In the teasers, alert shots are blurred glimpses with TEST
  still readable.
- **SHELLY's own bulletins** carry the label "SHELLY" and "not an official NWS
  alert". Keep that label in frame too.
- **Nothing private on screen:** no admin password, no home address or GPS dot at
  your house (use a public place such as Center City Philadelphia), no email
  addresses, no keys (Firebase, VAPID, OpenRouter, proxy password, tunnel URL),
  no bookmarks bar or other tabs. Use a clean browser profile.
- **Original look and sound only.** No Y'allBot or RHY style, branding or music.
  No copied keynote footage or logos. All sound effects are synthesized (§3).
- **Android:** the app is at **2.0.1**. 2.1.0 has no app changes.

## 2. Tools (all free)

| Job | Tool |
|---|---|
| Screen capture | **OBS Studio**, 1920×1080, 60 fps, CQP ~18 |
| Phone capture | Android's built-in screen recorder, or **scrcpy** with `--record` |
| Edit, colour, titles, mix | **DaVinci Resolve** (free) |
| Voiceover | SHELLY's voice, Kokoro on this PC: `npm run video:vo` |
| Sound effects | Synthesized kit: `npm run video:sfx` |
| Music | SHELLY's own tracks in `public/music/` |
| Thumbnails | Forecaster Studio PNG export + the turtle SVG |

## 3. Audio

### Voiceover (release video only)

- Script: **[video/voiceover.txt](../video/voiceover.txt)**: 26 lines in 9
  chapters, about 2.1 minutes of speech. With music moments, hits and pauses,
  that makes a video of about 3½ minutes. Each line is its own clip, so the
  edit can breathe between them. If the cut runs past 4 minutes, trim the
  music moments first, then drop 02-02 or 05-01.
- Make it: **`npm run video:vo`** → `video/vo/<id>.wav` (24-bit), plus
  `video/vo/_all.wav` to listen to the whole thing in order.
  - It runs Kokoro **directly on this PC**. That's the same voice the tunnel
    serves to SHELLY Live, but without the tunnel or the server's 64k MP3, so the
    files are full quality. The voice server and tunnel don't need to be running.
  - Default voice is `af_heart` at 0.95 speed. To use another one, run
    `npm run video:vo -- --voice <name> --force`. To remake single lines after
    editing their text: `npm run video:vo -- 04-02 07-04`. Lines whose text
    hasn't changed are skipped.
- Pauses: Kokoro shortens dramatic pauses, so make them in the edit. "One. More.
  Thing." (07-01) wants about 0.4 s between words. Cut the clip at each word.
- `02-02` (the name's story) is optional. `07-05a` ("on the air right now") and
  `07-05b` ("coming soon") are alternatives: pick one at release time.

### Sound effects

`npm run video:sfx` → `video/sfx/`, 48 kHz / 24-bit stereo, made from scratch
(no samples, no licences, same sounds every run):

| File | What it is | Use for |
|---|---|---|
| `sub_rumble` | 5 s low rumble swelling in and out | Opening darkness, tension |
| `heartbeat` | Two deep thumps | Teaser 1 pulse |
| `boom` | Cinematic hit with a falling sub | Big reveals |
| `slam` | Tight, short hit | Every text slam |
| `braam` | Huge brassy low chord | "One more thing", the Live reveal |
| `logo_hit` | boom + braam + sparkle | Every SHELLY logo reveal |
| `riser` | 6 s rising noise and tone, hard stop | Building into a reveal |
| `reverse_suck` | Sound pulled backwards into a cut | Right before a hard cut to black |
| `whoosh`, `whoosh_fast` | Swept air, panning across | Transitions, devices flying in |
| `glitch` | Bit-crushed stutters | Glitch cuts, cryptic flashes |
| `thunder` | Crack, then a rolling rumble | Lightning shots |
| `shimmer` | High sparkle | Turtle outfit changes, light sweeps |
| `ui_tick`, `ui_pop` | Tiny UI clicks | Blinks, cards appearing, taps |

### Music

| Video | Track | How |
|---|---|---|
| 1 Signal | None | Silence makes the hits louder |
| 2 Forecast | **Strong Breeze** (or **Catch the Sun**; listen to both) | Start on its biggest build. Low-pass it for the first 8 s, then open it up on "Every sky." Cut it dead at the black before the logo |
| 3 Release | **Catch the Sun** for the cold open and outro; **Cumulus Commute (v4)** as the bed; **Midnight Reverie** for the SHELLY Live chapter | Under the voice, duck the music about 12 dB (Resolve: Fairlight sidechain, or keyframes) |

**Mix targets:** master at **-14 LUFS integrated, -1 dBTP** (YouTube's level).
Voice sits about -16 LUFS. Sound effects hit hard but never cover a word.

## 4. Shot list (footage library)

Switches already in the code, so shots don't wait for the weather:

- `?scene=<id>` forces a sky: `clear-day`, `heat`, `partly-day`, `cloudy`, `fog`,
  `drizzle`, `rain`, `storm`, `sleet`, `snow`, `clear-night`, `partly-night`.
- `?mode=kiosk | web | phone | broadcast` forces a layout.
- `/live?host=<words>` sets the turtle's look, any mix separated by commas:
  - outfit: `shades`, `winter`, `umbrella`, `sleepy` (nightcap), `none`
  - mood: `happy`, `curious`, `focused`, `worried`
  - trick, repeated every 4 s: `look`, `lookR`, `wave`, `tilt`, `hop`, `blink2`, `sparkle`

  It only changes the look. A real WARNING or EMERGENCY switches it off. Never
  put it in the OBS stream URL. Mute `/live`'s voice or use the local voice
  while filming, so you don't spend Aura-2 credits.

### Website and app

| # | Shot | How | Used in |
|---|---|---|---|
| S1 | Sky loop for every scene, 10 s each, no UI moves | `?scene=…&mode=kiosk` | 1, 2, 3 |
| S2 | Storm with lightning, 20 s | `?scene=storm` | 1, 2, 3 |
| S3 | Opening the site: straight to weather, search, "My location" | `?mode=web`, search "Philadelphia" | 3 |
| S4 | The three layouts (TV, desktop, phone) | `?mode=kiosk`, `?mode=web`, `?mode=phone` | 2, 3 |
| S5 | TEST alert takeover: map, action card, storm ETA, voice | Local dev, admin simulator → custom test alert | 2 (blurred), 3 |
| S6 | Safety cards close up: action card, ETA, freshness/latency, stale-data banner, nowcast, storm reports, confidence, local hazards, what to wear | Slow scroll in `?mode=web` | 3 |
| S7 | Self-grading forecast card | Default location set in admin | 3 |
| S8 | Web push arriving (TEST) | Local dev, admin → test web push | 3 |
| S9 | "Play sound on" a TV/Roku | Film the TV with a phone | 3 |
| S10 | Android: `/get-android/`, install, permissions, widget going amber/red, TEST notification, Check for updates | Public site for the page and install; local dev for the TEST notification | 2 (widget flash), 3 |
| S11 | Admin tour (login, simulator, display, music, announcements). Password typed off-camera | Admin | 3 |
| S12 | Old site vs new, same city | A `legacy-v1` build or `docs/screenshots/legacy.png` | 3 |

### SHELLY Live

| # | Shot | How | Used in |
|---|---|---|---|
| S13 | Turtle close up: idle tricks | `/live?host=happy,wave`, `?host=tilt`, `?host=hop`, `?host=blink2` | 1 (eye only), 2, 3 |
| S14 | Outfits and moods | `/live?host=shades,happy`, `?host=winter,curious`, `?host=umbrella,focused`, `?host=sleepy`, `?host=worried` | 2, 3 |
| S15 | Speech-bubble reactions | `/live`, let the rundown play | 3 |
| S16 | Block montage: maps, 7-day, next 12 hours, weekend, sun/moon/UV, alerts board, locator map, radar | `/live` with short block times | 2, 3 |
| S17 | Rundown builder: blocks on/off, reorder, Play next, Hold, Skip | Admin beside `/live` | 3 |
| S18 | "Say something": typed line → said on air | Local dev, local voice | 3 |
| S19 | AI line: ask, edit, press Say it now. Nothing airs before that | Local dev, local Qwen3 | 3 |
| S20 | SHELLY bulletin with its label; a TEST NWS warning breaking through a hold | Local dev + simulator | 3 |

### Forecaster Studio

| # | Shot | How | Used in |
|---|---|---|---|
| S21 | Forecast card, impact scale, day planner, today vs tomorrow, the odds | Studio | 3 |
| S22 | Quick set maps → playing on `/live` | Studio + `/live` | 3 |
| S23 | Drawing a risk map and snow/rain totals | Studio | 3 |
| S24 | PNG export, landscape and portrait | Studio | 3 + thumbnail |

### Extra shots for the teasers

| # | Shot | How |
|---|---|---|
| X1 | Macro sky: rain scene scaled to 300%, out of focus | S1 `rain`, scaled and blurred in the edit |
| X2 | Fragments: a sliver of radar, the edge of the widget turning red, half a word, the hourly graph | Crops of S4, S10, S16 |
| X3 | The turtle in silhouette | S13 with exposure crushed to black, rim light only (Resolve: Curves) |
| X4 | Turtle eye opening, extreme close up, dark | S13 `?host=blink2`, cropped to the eye |

**Tips:** hide the cursor in OBS. Hold the UI still 5 s at each end of every clip.
Phone shots with Do Not Disturb on. For admin + `/live` side by side, record one
1920×1080 canvas split in two.

## 5. Video 1, "Signal" (8 s): teasing the tease

Almost nothing is shown. No name, no features. The goal is just "huh, what was that?"

| Time | Picture | Sound |
|---|---|---|
| 0.0–1.5 | Black | `sub_rumble` swells in |
| 1.5 | A single teal point of light, dead centre | `heartbeat` |
| 2.4 | Lightning: 3 frames of the storm sky (S2) at full brightness, then black | `thunder` (crack on the flash) |
| 3.2–5.0 | Out of the dark, the turtle's eye opens and blinks (X4) | `ui_tick` on the blink |
| 5.0–5.6 | A huge "2" glitches in and out | `glitch` |
| 5.6–6.6 | Black | `reverse_suck` into a hard cut |
| 6.6–8.0 | Black, then the date in small type at the bottom | Silence, then one `ui_pop` |

Make it 16:9 and 9:16 (re-framed). Title on YouTube: just "2" or "⚡". Description:
the date, nothing else.

## 6. Video 2, "Forecast" (30 s): the teaser

More obvious, still cryptic. You see the product in flashes and three big
phrases, but nothing is explained. The name appears once, at the end.

| Time | Picture | Sound |
|---|---|---|
| 0–3 | Out-of-focus rain filling the screen (X1) | Music low-passed and quiet; `riser` begins |
| 3–8 | Fragments, 0.3 s each, hard cuts (X2) | `whoosh_fast` on each cut, `glitch` on two of them |
| 8 | **"Every sky."** slams in over the sky montage (S1) | `slam`; music opens up |
| 11 | **"Every screen."** Three device silhouettes light up one by one (S4) | `slam`, `whoosh` per device |
| 14 | **"Every warning."** Blurred TEST takeover, red glow, TEST readable, demo line on screen (S5) | `slam`, `boom` |
| 17–22 | The turtle swims across in silhouette (X3); on each beat a flash of an outfit: shades, beanie, umbrella, nightcap (S14) | `shimmer` + `ui_pop` per outfit |
| 22–23 | Everything rushes to the centre | `riser` peaks → `reverse_suck` → black |
| 23–27 | **SHELLY v2** wordmark, light sweep across it | `logo_hit` |
| 27–30 | Date and time | Music tail, then silence |

Deliverables: 16:9 plus a 9:16 cut, captions burned in on the vertical one.
Description: the date and "link at launch".

## 7. Video 3, "SHELLY v2" (3–4 min): the release

A keynote with SHELLY's own voice, cut tight: one idea per line, no lingering.
Voice clip ids are from `video/voiceover.txt`. Each chapter becomes a YouTube chapter.

| Chapter | About | VO ids | Picture | Sound and music |
|---|---|---|---|---|
| 1. Cold open | 0:20 | 01-01 → 01-04 | Sky montage (S1), slow push-ins. Black on "Until now." Then the logo | Catch the Sun builds. `boom` on "Until now", `logo_hit` on "Version two" |
| 2. Rebuilt | 0:20 | 02-01, (02-02), 02-03 | Old site shatters → new site opening on Philadelphia (S12, S3) | Cumulus Commute (v4) bed starts. `boom` on "from scratch" |
| 3. Every screen, every sky | 0:20 | 03-01, 03-02 | TV, desktop, phone flying in (S4), then a fast run of skies (S1) | `whoosh` per device, `shimmer` on the scene changes |
| 4. Built for warnings | 0:35 | 04-01 → 04-05 | TEST takeover, action card, ETA (S5, S6), polygon with the phone inside buzzing (S8). Demo line on screen throughout | Music drops out, `sub_rumble` under it. `boom` on "Not one word." |
| 5. Every day | 0:15 | 05-01 | Quick card close-ups: nowcast, reports, confidence, what to wear, grades (S6, S7) | Bed returns, `ui_pop` per card |
| 6. Android | 0:20 | 06-01, 06-02 | Phone floating in, widget turning amber then red (S10) | `whoosh` on the phone, `slam` on "never" |
| 7. SHELLY Live | 0:40 | 07-01 → 07-05 | Black. "One. More. Thing." word by word. The turtle swims in (S13), outfit flashes (S14), block montage (S16), rundown and AI review (S17, S19), a TEST warning breaking through (S20) | Silence → `braam` after "Thing." → Midnight Reverie. `shimmer` per outfit |
| 8. Forecaster Studio | 0:15 | 08-01 | Graphics building, then playing on `/live` (S21, S22) | `ui_pop` per graphic |
| 9. Outro | 0:25 | 09-01 → 09-03 | Waveform on screen for "the voice you're hearing", then logo, URL, the turtle waves (S13 `?host=wave`) | `glitch`, a beat of silence, Catch the Sun returns, `logo_hit` on the logo |

That adds up to about 3½ minutes. Shots S9, S11, S15, S18, S23 and S24 aren't
in this cut; record them only if you want extra vertical clips or a longer
director's cut later.

Deliverables: 16:9 1080p master, YouTube chapters, captions (from
`video/voiceover.txt`, which is already the exact text), a thumbnail, and 3
vertical clips from chapters 4, 6 and 7.

## 8. Still open (only you can decide)

1. **Release date and time.** Goes on both teasers. It's also when the links go
   back up and the release video goes public.
2. **Voice:** listen to `video/vo/_all.wav`. If SHELLY Live uses a different
   Kokoro voice in admin, remake with `--voice <that one> --force` so they match.
3. **Line 02-02** (the name's story): keep or cut.
4. **Line 07-05a or 07-05b:** is SHELLY Live on air at release time?

## 9. Order of work

1. ~~`?host=` filming switch.~~ Done.
2. ~~Voiceover script and audio, sound-effects kit.~~ Done (`npm run video:vo`, `npm run video:sfx`).
3. Listen to `_all.wav`, fix any word Kokoro says wrong (spell it how it sounds
   in `voiceover.txt`), and remake those lines.
4. Record the footage library (§4) while the links are up: normal shots from the
   public site, anything that sends alerts or messages from local dev. Save it
   to `video/footage/` (ignored by git).
5. Edit Signal, then Forecast, then the release. Renders go to `video/renders/`.
6. Once all three are done, take the links down.
7. Post **Signal** about 10 days before release, **Forecast** about 4 days
   before, and schedule the **release** as a Premiere for release time.
8. At release time: put the links back up, check the site, `/get-android/` and
   the stream, and confirm the video went public.
