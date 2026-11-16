import { AnnouncementBar, Logo, SearchBox, StatusLine, ThemeToggle, ThreatBadge } from "../components/Chrome";
import { SEGMENT_VIEWS } from "../segments";
import { loop, threat } from "../state/store";

/** Phone: threat pinned on top, segments as scrollable cards (no slideshow). */
export function PhoneShell() {
  const seen = new Set<string>();
  const cards = loop.value.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  const t = threat.value;
  return (
    <div class="phone">
      <header class="phone-head">
        <Logo />
        <span class="head-right"><ThreatBadge /><ThemeToggle /></span>
      </header>
      {t.level !== "CALM" && t.reasons.length > 0 && (
        <div class={`pin lvl-${t.level.toLowerCase()}`} role="status">{t.reasons.join(" • ")}</div>
      )}
      <AnnouncementBar />
      <SearchBox />
      <main class="cards">
        {cards.map((s) => {
          const View = SEGMENT_VIEWS[s.id];
          return (
            <section key={s.id} class="card" aria-label={s.title}>
              <h2>{s.title}</h2>
              <View />
            </section>
          );
        })}
      </main>
      <footer class="botbar"><StatusLine /></footer>
    </div>
  );
}
