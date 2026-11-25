import { useState } from "preact/hooks";
import { SearchBox } from "../components/Chrome";
import { EtaBanner } from "../components/Safety";
import { Radar } from "../segments/Radar";
import { countdown } from "../../shared/countdown";
import { actionCards, locateByCoords, mode, now, place, threat } from "../state/store";

/** Which place this warning is for, and a way to switch places (phones and desktops; TVs have no input). */
function LocationBar() {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const p = place.value;
  if (mode.value === "kiosk") return null;
  const gps = () => {
    if (!navigator.geolocation) return setMsg("Location isn't available here. Search instead.");
    setMsg("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        void locateByCoords(pos.coords.latitude, pos.coords.longitude)
          .then(() => setMsg(""))
          .catch(() => setMsg("SHELLY covers the United States only.")),
      () => setMsg("Couldn't get your location. Search instead."),
    );
  };
  return (
    <div class="tk-loc">
      <span>
        For <b>{p ? `${p.name}${p.state ? `, ${p.state}` : ""}` : "your location"}</b>
      </span>
      <button type="button" class="tk-loc-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Close" : "Change location"}
      </button>
      {open && (
        <div class="tk-loc-form">
          <SearchBox />
          <button type="button" class="tk-loc-btn" onClick={gps}>Use my location</button>
          {msg && <span class="tk-loc-msg">{msg}</span>}
        </div>
      )}
    </div>
  );
}

/** Full-screen severe-weather takeover. WARNING locks radar on the polygon; EMERGENCY suppresses everything else. */
export function Takeover() {
  const t = threat.value;
  if (t.rank < 2 || !t.primary) return null;
  const a = t.primary;
  const emergency = t.level === "EMERGENCY";
  const left = countdown(t.expiresAt, now.value, place.value?.tz);
  const instruction = (a.instruction || a.description).replace(/\s+/g, " ").trim();
  // the plain-language card for the primary alert (template text only, never LLM)
  const card = actionCards.value.find((x) => x.alert.id === a.id)?.card ?? null;

  return (
    <div class={`takeover ${emergency ? "emergency" : "warning"}`} role="alertdialog" aria-live="assertive" aria-label={a.event}>
      <header>
        <span class="tk-level">{emergency ? "EMERGENCY" : "WARNING"}</span>
        <h1>{a.event}</h1>
        {left && (
          <div class={`tk-count ${left.startsWith("Until") ? "long" : ""}`} aria-label={left.startsWith("Until") ? left : `Time remaining ${left}`}>
            {left}
          </div>
        )}
      </header>
      <LocationBar />
      <div class="tk-body">
        {!emergency && <div class="tk-map"><Radar future={false} /></div>}
        <div class="tk-info">
          <EtaBanner />
          <p class="tk-label">{emergency ? "Take action now" : "What to do"}</p>
          {card ? (
            <>
              <p class="tk-title">{card.title}</p>
              <ol class="tk-steps">
                {card.steps.slice(0, 4).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {instruction && <p class="tk-nws"><span class="tk-label">From the NWS:</span> {instruction.slice(0, emergency ? 360 : 220)}</p>}
            </>
          ) : (
            <p class="tk-text">{emergency ? instruction.slice(0, 600) : instruction.slice(0, 320)}</p>
          )}
          <p class="tk-label">Affected area</p>
          <p class="tk-area">{a.areaDesc.split(";").map((s) => s.trim()).filter(Boolean).slice(0, 6).join(" · ")}</p>
        </div>
      </div>
      <div class="crawl" aria-hidden="true">
        <span>{t.active.map((x) => `${x.event} — ${x.headline}`).join("   •   ")}</span>
      </div>
    </div>
  );
}
