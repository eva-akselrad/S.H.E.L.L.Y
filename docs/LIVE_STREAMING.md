# SHELLY Live: running it

Nothing here is deployed yet. These are the steps once you decide to go live.

## What it is
`/live?mode=broadcast&key=<token>` is a fixed 1920x1080 page. A producer on the minute cron decides
what to show (`shared/live/intensity.ts` then `rundown.ts`) and stores it in KV. The page just plays it.

## Setup checklist (yours to do)
1. **Enable it:** admin, SHELLY Live, switch on. Set your forecaster name.
2. **Viewer token:** admin, SHELLY Live, generate. Put it in the OBS URL as `?key=`.
3. **LLM (optional):** create an OpenRouter key, then `npx wrangler secret put LLM_API_KEY`.
   Free models allow about 50 requests a day; SHELLY caps itself at 45. Without a key everything
   uses templates and nothing breaks.
4. **OBS:** Browser Source, 1920x1080, URL above, "Control audio via OBS" on.
5. **YouTube:** you create the channel/stream key and press Go Live. Nothing here does that.

## Safety rules built in
- The LLM never writes alert or warning wording. Alerts, areas, expiry times and instructions come from
  NWS data through fixed templates. The LLM only writes calm-period headlines and talk breaks, and
  forecast-discussion drafts.
- Every LLM output goes through a filter that rejects safety-sounding phrases, links and markdown.
- A discussion draft is saved unpublished and the server refuses to publish it until you tick
  "I've read and edited this".
- Storm tracks (towns and ETAs on the warning radar) are pure math on the NWS storm-motion field.

## Not wired on purpose
- **Traffic cameras (PA/NJ DOT):** each feed's terms must be reviewed and approved by you first.
- **Chat replies:** dropped.
