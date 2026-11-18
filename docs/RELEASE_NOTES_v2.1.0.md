# SHELLY 2.1.0

A big update to **SHELLY Live**, the 24/7 broadcast, and to **Forecaster Studio**. SHELLY can now run its AI host and voice on your own computer.

> **No Android app changes in this release.** The app stays at **2.0.1**, there is no new APK, and you don't need to update or reinstall anything on your phone. Everything here is on the website and the server.

## SHELLY Live

### A host with personality
- **Moods** follow the weather threat: happy on calm days, curious during watches, focused during warnings, worried in an emergency.
- **Dresses for the weather:** sunglasses when it's warm and sunny, a beanie and scarf when it's cold or snowy, an umbrella in the rain, and a nightcap late at night.
- **Idle tricks** on calm days: looks around, waves, tilts its head, hops and blinks naturally.
- **Reacts to the screen** with a short speech bubble ("Brrrr!", "Radar check!", "The week ahead!"). It never does this during warnings.
- **Sits in its own spot** in the right column instead of hanging over the bottom bar.

### 21 blocks to build the show from
- **Maps:** temperatures now, feels like, today's highs, tonight's lows, tomorrow's highs, rain chances, wind and gusts, and dew points.
- **One city:** 7-day forecast, next 12 hours, weekend outlook, and sun, moon and UV.
- **Everything else:** warmest and coolest, alerts board, station ID, your own message slides, radar, city cards, the severe weather outlook, Forecaster Studio graphics and host talk breaks.
- All of it comes from one weather request every 10 minutes.

### You run the show
- **Rundown builder:** turn blocks on and off, put them in any order, and set the time, city and count for each.
- **Say something:** type a line and SHELLY says it next, on screen and out loud.
- **AI-written lines:** ask the AI for a line, then read and edit it before it airs. Nothing airs until you press Say it now.
- **Play next or hold:** put any block on screen right away, or keep only that block on for a set number of minutes.
- **Skip** the current item, or go **back to the top**.
- **Your own bulletins (Bulletin, Advisory or Alert):** they show full screen, on the alerts board and in the crawl, and SHELLY can read them out. They are labelled SHELLY and say they aren't official NWS alerts.
- Controls reach the broadcast within about 5 seconds.

### Better screen
- **Locator map** now draws the real county and state map, every alert area, the radar's view, and a pin on the city being shown.

### Safety
- National Weather Service warnings always break through a hold.
- An emergency drops blocks and bulletins from the rotation, so only the warning is shown.
- Alert wording still never comes from the AI.
- Your bulletins don't change the SHELLY index.

### Fixed
- A message you sent no longer replays every time you save settings.
- The voice can no longer play an old recording when the words on screen have changed.

## Forecaster Studio

### New graphics
- **Forecast card:** your headline and up to five points, with an icon and a colour from Calm to Serious.
- **Impact scale:** rate an event from None to Extreme, overall and for travel, power, flooding and more.
- **Day planner:** morning, afternoon, evening and overnight for one city, loaded from the model and fully editable.
- **Today vs tomorrow:** each city's high, with up and down arrows. It loads from the model.
- **The odds:** probability bars for each outcome (like "1 inch or more, 45%"), with your confidence and a short reason.
- **Rain chance and wind gust maps** join highs, lows and feels like.

### Publishing
- **Publish as many as you like.** Every published graphic plays on SHELLY Live. Before, only the first 4 did.
- **Quick set:** make and publish any mix of highs, lows, feels like, rain chance and gust maps in one press.
- **Publish, unpublish and duplicate** right from the list.
- Temperature maps **name themselves**, like "Lows Tomorrow".

### Fixed
- City maps zoom in on your cities, so labels around Philadelphia no longer pile up and none are cut off at the edge.
- Portrait downloads no longer draw the title on top of the date line.

## Run the AI on your own computer
- **Local AI host:** SHELLY can use a Qwen3 model on your own PC through a password-protected proxy, with start and stop scripts.
- **Local voice:** a Kokoro voice server on your PC, reached through a locked tunnel, with Deepgram Aura-2 as the backup.
- The voice preview in the admin always makes a fresh sample.

## Admin
- Settings pages no longer open or save before your saved settings have loaded. Before, a slow connection could show and save the defaults.
