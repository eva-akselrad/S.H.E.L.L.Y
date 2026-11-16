import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Logo, ThemeToggle } from "./components/Chrome";
import { Activity } from "./admin/Activity";
import { Announcements } from "./admin/Announcements";
import { authed, call, loadConfig } from "./admin/api";
import { Display } from "./admin/Display";
import { Login } from "./admin/Login";
import { Music } from "./admin/Music";
import { Note } from "./admin/Note";
import { Overview } from "./admin/Overview";
import { Simulator } from "./admin/Simulator";
import { Toasts } from "./admin/ui";
import "./styles/main.css";
import "./styles/admin.css";

const PAGES = [
  { id: "overview", label: "Overview", view: Overview },
  { id: "announcements", label: "Announcements", view: Announcements },
  { id: "note", label: "Forecaster note", view: Note },
  { id: "simulate", label: "Alert simulator", view: Simulator },
  { id: "display", label: "Display", view: Display },
  { id: "music", label: "Music", view: Music },
  { id: "activity", label: "Activity", view: Activity },
] as const;
type PageId = (typeof PAGES)[number]["id"];

const fromHash = (): PageId => PAGES.find((p) => `#${p.id}` === location.hash)?.id ?? "overview";

function Shell() {
  const [page, setPage] = useState<PageId>(fromHash());
  useEffect(() => {
    const on = () => setPage(fromHash());
    addEventListener("hashchange", on);
    void loadConfig();
    return () => removeEventListener("hashchange", on);
  }, []);

  const View = PAGES.find((p) => p.id === page)!.view;
  const out = async () => {
    await call("POST", "/api/admin/logout");
    authed.value = false;
  };

  return (
    <div class="adm-shell">
      <aside class="adm-side">
        <a class="adm-brand" href="#overview"><Logo /><span>admin</span></a>
        <nav aria-label="Admin sections">
          {PAGES.map((p) => (
            <a key={p.id} href={`#${p.id}`} aria-current={p.id === page ? "page" : undefined}>{p.label}</a>
          ))}
        </nav>
        <div class="adm-side-foot">
          <a href="/" target="_blank" rel="noopener">View site</a>
          <ThemeToggle />
          <button type="button" class="adm-btn small" onClick={() => void out()}>Log out</button>
        </div>
      </aside>
      <main class="adm-main"><View /></main>
    </div>
  );
}

function Admin() {
  useEffect(() => {
    void call<{ authed: boolean }>("GET", "/api/admin/session").then((r) => {
      authed.value = r.ok ? r.data.authed : false;
    });
  }, []);
  if (authed.value === null) return null;
  return (
    <>
      {authed.value ? <Shell /> : <Login />}
      <Toasts />
    </>
  );
}

render(<Admin />, document.getElementById("app")!);
