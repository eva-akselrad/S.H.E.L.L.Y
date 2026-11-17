import { AnnouncementBar, Logo, MusicControl, SearchBox, StatusLine, ThemeToggle, ThreatBadge } from "../components/Chrome";
import { Freshness } from "../components/Freshness";
import { InstallApp } from "../components/InstallApp";
import { AppAlerts } from "../components/AppAlerts";
import { PushToggle } from "../components/PushToggle";
import { SoundOutput } from "../components/SoundOutput";
import { ActionCard, NearbyNotice, StaleBanner } from "../components/Safety";
import { SEGMENT_VIEWS } from "../segments";
import { currentSegment, goTo, loop, paused, segIndex } from "../state/store";

/** Desktop browser: same segments, but you can drive them. */
export function WebShell() {
  const seg = currentSegment.value;
  const View = SEGMENT_VIEWS[seg.id];
  return (
    <div class="web">
      <StaleBanner />
      <header class="web-head">
        <Logo />
        <SearchBox />
        <ThreatBadge />
        <PushToggle />
        <MusicControl />
        <SoundOutput />
        <ThemeToggle />
      </header>
      <ActionCard />
      <NearbyNotice />
      <InstallApp />
      <AppAlerts />
      <AnnouncementBar />
      <nav class="web-nav" aria-label="Segments">
        {loop.value.map((s, i) => (
          <button key={`${s.id}-${i}`} type="button" aria-current={i === segIndex.value % loop.value.length} onClick={() => (segIndex.value = i)}>
            {s.title}
          </button>
        ))}
        <span class="spacer" />
        <button type="button" onClick={() => goTo(-1)} aria-label="Previous">‹</button>
        <button type="button" onClick={() => (paused.value = !paused.value)}>{paused.value ? "Play" : "Pause"}</button>
        <button type="button" onClick={() => goTo(1)} aria-label="Next">›</button>
      </nav>
      <main class="web-main">
        <h2>{seg.title}</h2>
        <div key={seg.id} class="web-card"><View /></div>
        <Freshness id={seg.id} />
      </main>
      <footer class="botbar"><StatusLine /></footer>
    </div>
  );
}
