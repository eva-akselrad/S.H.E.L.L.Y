import { AnnouncementBar, Logo, MusicControl, SearchBox, StatusLine, ThemeToggle, ThreatBadge } from "../components/Chrome";
import { Freshness } from "../components/Freshness";
import { InstallApp } from "../components/InstallApp";
import { AppAlerts } from "../components/AppAlerts";
import { PushToggle } from "../components/PushToggle";
import { WatchLive } from "../components/WatchLive";
import { ActionCard, NearbyNotice, StaleBanner } from "../components/Safety";
import { SEGMENT_VIEWS } from "../segments";
import { ReportLink } from "../segments/Reports";
import { loop, threat } from "../state/store";

/** Phone: threat pinned on top, segments as scrollable cards (no slideshow). */
export function PhoneShell() {
  const seen = new Set<string>();
  const cards = loop.value.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  const t = threat.value;
  return (
    <div class="phone">
      <StaleBanner />
      <header class="phone-head">
        <Logo />
        <span class="head-right"><ThreatBadge /><MusicControl compact /><ThemeToggle /></span>
      </header>
      {t.level !== "CALM" && t.reasons.length > 0 && (
        <div class={`pin lvl-${t.level.toLowerCase()}`} role="status">{t.reasons.join(" • ")}</div>
      )}
      <ActionCard />
      <NearbyNotice />
      <InstallApp />
      <div class="phone-live"><WatchLive /></div>
      <AnnouncementBar />
      <div class="phone-tools"><SearchBox /><PushToggle /><AppAlerts /></div>
      <main class="cards">
        {cards.map((s) => {
          const View = SEGMENT_VIEWS[s.id];
          return (
            <section key={s.id} class="card" aria-label={s.title}>
              <h2>{s.title}</h2>
              <View />
              <Freshness id={s.id} />
            </section>
          );
        })}
      </main>
      <footer class="botbar"><StatusLine /><ReportLink /></footer>
    </div>
  );
}
