# SHELLY TikToks

`video/tiktok/meet-shelly` is the intro video; `video/tiktok/thanksgiving-storm` is a "we're live" video.

## What it makes

An 18-second vertical video (1080×1920) that announces a SHELLY Live stream. It has music,
sound effects, the turtle, the storm notes, your forecast graphic and the YouTube thumbnail.

## Make a new one
1. Copy the last folder in `video/tiktok/`, for example `thanksgiving-storm` → `blizzard-jan`.
2. In the new folder, replace `thumbnail.png` (the YouTube thumbnail) and, if you have one,
   the forecast graphic (any 16:9 PNG, such as a Forecaster Studio export).
3. Edit `tiktok.json`:
   - `badge`: the pulsing pill at the top (default `LIVE NOW`; `""` hides it).
   - `hook`: the two big opening words. `hook_color`: the second word's `[r, g, b]` (default red).
   - `headline`: two lines (white, then yellow). `tagline`: the short hazard line. `when`: the date, shown as
     "SHELLY LIVE • <when>". `when_line` replaces that whole line instead.
   - `bullets`: 3 or 4 short lines, about 45 characters each at most.
   - `graphic`: the graphic's file name, or `""` to skip that scene. `graphic_focus`: the
     `[x, y]` spot (0 to 1) the camera pushes in on.
   - `host_open` / `host_close`: turtle poses (folders under `%LOCALAPPDATA%\shelly-video\footage\host_*`).
   - `music` / `music_start`: a track from `public/music` and where in it to start (seconds).
   - `cta_sub`: where to watch, shown in a yellow pill (a web address or YouTube handle; TikTok
     bio links need 1,000 followers). `cta_note`: the small line beside the turtle, or `""`.
   - `caption`: the text to paste into TikTok. No emoji; TikTok viewers read them as AI-written.
4. Check the layout (takes a few seconds):
   `npm run video:tiktok -- blizzard-jan --preview`
5. Render it and copy it to Google Drive (`G:\My Drive\SHELLY TikToks`):
   `npm run video:tiktok -- blizzard-jan --drive`

The output is `video/renders/tiktok/<name>.mp4` plus `<name>_caption.txt`. Set `SHELLY_DRIVE` to
copy it to a different folder. All text stays inside TikTok's safe area, so the caption and
the side buttons don't cover it.
