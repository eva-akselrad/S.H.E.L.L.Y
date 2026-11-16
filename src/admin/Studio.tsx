import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { bandLabel, contourBands, TOTAL_SCALES, type Grid } from "../../shared/contour";
import { geomPath } from "../../shared/projection";
import {
  HAZARDS, RISK_LEVELS, STUDIO_KINDS, type CityTemps, type Hazard, type RiskArea, type RiskLevel, type RiskMap, type SevenDay,
  type SevenDayDay, type StudioBody, type StudioKind, type StudioProduct, type Timeline, type TotalsMap,
} from "../../shared/studio";
import { call, config } from "./api";
import { toast } from "./toast";
import { Card, Chip, Field, Page, Segmented, Toggle } from "./ui";
import { Basemap, layout, mapProjector, MapClip, SIZE, type Format } from "../studio/Frame";
import { download, fileName, svgToPng } from "../studio/export";
import { ProductView } from "../studio/ProductView";
import { HAZARD_LABEL, RISK } from "../studio/views/RiskMap";
import { HAZARD_COLOR } from "../studio/views/Timeline";
import type { ComponentChildren } from "preact";

const KIND_LABEL: Record<StudioKind, string> = {
  sevenDay: "7-day forecast", cityTemps: "City temperatures map", riskMap: "Risk map", totalsMap: "Snow / rain totals",
  timeline: "Storm timeline", discussion: "Forecast discussion", stormTrack: "Storm tracker",
};
const BUILT: StudioKind[] = ["sevenDay", "cityTemps", "riskMap", "totalsMap", "timeline"];

const ICONS: [number, string][] = [[0, "Sunny"], [2, "Partly cloudy"], [3, "Cloudy"], [45, "Fog"], [61, "Rain"], [80, "Showers"], [71, "Snow"], [95, "Thunderstorms"]];

const toLocal = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string, fallback: string): string => (Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : fallback);

function blank(kind: StudioKind): StudioProduct {
  const now = new Date();
  const to = new Date(now.getTime() + (kind === "sevenDay" ? 7 : 1) * 86400_000);
  const body: Record<string, StudioBody> = {
    sevenDay: { place: "", days: [] },
    cityTemps: { metric: "high", cities: [] },
    riskMap: { areas: [] },
    totalsMap: { kind: "snow", mode: "model", bands: [] },
    timeline: { rows: [] },
  };
  return {
    id: "", kind, title: { sevenDay: "SHELLY 7-Day Forecast", cityTemps: "Highs Tomorrow", riskMap: "SHELLY Risk Outlook", totalsMap: "Snow Totals", timeline: "Storm Timeline" }[kind as string] ?? KIND_LABEL[kind],
    validFrom: now.toISOString(), validTo: to.toISOString(), region: config.value.live.region.bbox, published: false, author: "forecaster",
    body: body[kind] ?? ({ text: "", draft: true } as StudioBody), updated: now.toISOString(),
  };
}

export function Studio() {
  const [list, setList] = useState<StudioProduct[]>([]);
  const [edit, setEdit] = useState<StudioProduct | null>(null);
  const load = () => void call<StudioProduct[]>("GET", "/api/admin/studio").then((r) => r.ok && setList(r.data));
  useEffect(load, []);

  if (edit) return <Editor product={edit} onClose={() => { setEdit(null); load(); }} />;
  return (
    <Page title="Forecaster Studio" lead="Your own forecast graphics. Published ones appear in the SHELLY loop, in SHELLY Live, and can be downloaded as images for social media.">
      <Card title="Create">
        <div class="adm-row">
          {BUILT.map((k) => <button key={k} type="button" class="adm-btn" onClick={() => setEdit(blank(k))}>{KIND_LABEL[k]}</button>)}
        </div>
      </Card>
      <Card title="Your graphics">
        {list.length === 0 && <p class="adm-hint">Nothing yet. Create one above.</p>}
        {list.map((p) => (
          <div key={p.id} class="adm-row" style={{ justifyContent: "space-between" }}>
            <span><b>{p.title}</b> <span class="adm-hint">{KIND_LABEL[p.kind]} · until {new Date(p.validTo).toLocaleString()}</span></span>
            <span class="adm-row">
              {p.published ? <Chip kind="ok">Published</Chip> : <Chip kind="muted">Draft</Chip>}
              {BUILT.includes(p.kind) && <button type="button" class="adm-btn small" onClick={() => setEdit(p)}>Edit</button>}
              <button type="button" class="adm-btn small danger" onClick={() => { if (confirm(`Delete "${p.title}"?`)) void call("DELETE", `/api/admin/studio?id=${encodeURIComponent(p.id)}`).then(load); }}>Delete</button>
            </span>
          </div>
        ))}
      </Card>
    </Page>
  );
}

function Editor({ product, onClose }: { product: StudioProduct; onClose: () => void }) {
  const [p, setP] = useState<StudioProduct>(product);
  const [fmt, setFmt] = useState<Format>("wide");
  const [busy, setBusy] = useState(false);
  const forecaster = config.value.studio.forecasterName;
  const set = <K extends keyof StudioProduct>(k: K, v: StudioProduct[K]) => setP((x) => ({ ...x, [k]: v }));
  const setBody = (b: StudioBody) => setP((x) => ({ ...x, body: b }));

  const save = async (published = p.published) => {
    setBusy(true);
    const r = await call<StudioProduct>("PUT", "/api/admin/studio", { ...p, published });
    setBusy(false);
    if (r.ok) {
      setP(r.data);
      toast(published ? "Saved and published" : "Saved as draft");
    } else toast("Couldn't save. Check the graphic has content.", "error");
  };

  const exportPng = async (f: Format) => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-99999px;top:0";
    document.body.append(host);
    try {
      render(<ProductView product={p} fmt={f} forecaster={forecaster} />, host);
      const svg = host.querySelector("svg");
      if (!svg) throw new Error("no svg");
      download(await svgToPng(svg as SVGSVGElement, f), fileName(p.title, f));
    } catch {
      toast("Couldn't make the image.", "error");
    } finally {
      render(null, host);
      host.remove();
    }
  };

  return (
    <Page
      title={p.title || KIND_LABEL[p.kind]}
      lead={KIND_LABEL[p.kind]}
      actions={
        <>
          <button type="button" class="adm-btn" onClick={onClose}>Back</button>
          <button type="button" class="adm-btn" disabled={busy} onClick={() => void save(false)}>Save draft</button>
          <button type="button" class="adm-btn primary" disabled={busy} onClick={() => void save(true)}>Publish</button>
        </>
      }
    >
      <Card title="Details">
        <div class="adm-form">
          <Field label="Title"><input class="adm-input" value={p.title} onInput={(e) => set("title", (e.target as HTMLInputElement).value)} /></Field>
          <div class="adm-row">
            <Field label="Valid from"><input class="adm-input" type="datetime-local" value={toLocal(p.validFrom)} onInput={(e) => set("validFrom", fromLocal((e.target as HTMLInputElement).value, p.validFrom))} /></Field>
            <Field label="Valid until"><input class="adm-input" type="datetime-local" value={toLocal(p.validTo)} onInput={(e) => set("validTo", fromLocal((e.target as HTMLInputElement).value, p.validTo))} /></Field>
          </div>
          <Toggle checked={p.published} onChange={(v) => set("published", v)} label="Published" hint="Shown in the loop and on SHELLY Live while it is valid. Save to apply." />
          {!forecaster && <p class="adm-hint">Add your name under SHELLY Live, Forecaster name, to credit the graphics.</p>}
        </div>
      </Card>

      {p.kind === "sevenDay" && <SevenDayEditor body={p.body as SevenDay} onChange={setBody} />}
      {p.kind === "cityTemps" && <CityTempsEditor body={p.body as CityTemps} onChange={setBody} />}
      {p.kind === "totalsMap" && <TotalsEditor product={p} body={p.body as TotalsMap} onChange={setBody} />}
      {p.kind === "timeline" && <TimelineEditor body={p.body as Timeline} onChange={setBody} />}
      {p.kind === "riskMap" && <RiskEditor product={p} body={p.body as RiskMap} onChange={setBody} />}

      <Card title="Preview and download">
        <div class="adm-row">
          <Segmented label="Size" value={fmt} onChange={setFmt} options={[{ value: "wide", label: "Wide 1920×1080" }, { value: "portrait", label: "Portrait 1080×1350" }]} />
          <button type="button" class="adm-btn" onClick={() => void exportPng("wide")}>Download 1920×1080 PNG</button>
          <button type="button" class="adm-btn" onClick={() => void exportPng("portrait")}>Download 1080×1350 PNG</button>
        </div>
        <div class="studio-preview" style={{ aspectRatio: `${SIZE[fmt].w} / ${SIZE[fmt].h}` }}>
          <ProductView product={p} fmt={fmt} forecaster={forecaster} />
        </div>
      </Card>
    </Page>
  );
}

function SevenDayEditor({ body, onChange }: { body: SevenDay; onChange: (b: SevenDay) => void }) {
  const cities = config.value.live.region.cities;
  const [city, setCity] = useState(cities[0]?.name ?? "");
  const [base, setBase] = useState<SevenDayDay[]>([]);

  const loadModel = async () => {
    const r = await call<{ place: string; days: SevenDayDay[] }>("GET", `/api/admin/studio/model-7day?city=${encodeURIComponent(city)}`);
    if (!r.ok) return toast("Couldn't load the model forecast.", "error");
    setBase(r.data.days);
    onChange({ place: r.data.place, days: r.data.days });
  };
  const edit = (i: number, patch: Partial<SevenDayDay>) => {
    const days = body.days.map((d, n) => {
      if (n !== i) return d;
      const next = { ...d, ...patch };
      const b = base[i];
      const changed = b ? next.hi !== b.hi || next.lo !== b.lo || next.pop !== b.pop || next.code !== b.code : true;
      return { ...next, edited: changed || !!next.note };
    });
    onChange({ ...body, days });
  };

  return (
    <Card title="Forecast" hint="Start from the model, then change anything you disagree with. Days you change get a SHELLY FORECAST marker.">
      <div class="adm-row">
        <select class="adm-input grow" value={city} onChange={(e) => setCity((e.target as HTMLSelectElement).value)} aria-label="City">
          {cities.map((c) => <option key={c.name}>{c.name}</option>)}
        </select>
        <button type="button" class="adm-btn" onClick={() => void loadModel()}>Load from model</button>
      </div>
      {body.days.map((d, i) => (
        <div class="adm-row" key={d.date}>
          <b style={{ width: "5.5rem" }}>{d.date.slice(5)}</b>
          <input class="adm-input narrow" type="number" value={d.hi} aria-label="High" onInput={(e) => edit(i, { hi: Number((e.target as HTMLInputElement).value) })} />
          <input class="adm-input narrow" type="number" value={d.lo} aria-label="Low" onInput={(e) => edit(i, { lo: Number((e.target as HTMLInputElement).value) })} />
          <input class="adm-input narrow" type="number" min={0} max={100} value={d.pop} aria-label="Chance of precipitation" onInput={(e) => edit(i, { pop: Number((e.target as HTMLInputElement).value) })} />
          <select class="adm-input" style={{ width: "10rem" }} value={ICONS.some(([c]) => c === d.code) ? d.code : 3} aria-label="Sky" onChange={(e) => edit(i, { code: Number((e.target as HTMLSelectElement).value) })}>
            {ICONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <input class="adm-input grow" maxLength={80} placeholder="Note (optional)" value={d.note ?? ""} onInput={(e) => edit(i, { note: (e.target as HTMLInputElement).value })} />
          {d.edited && <Chip kind="info">edited</Chip>}
        </div>
      ))}
      {body.days.length === 0 && <p class="adm-hint">Press "Load from model" to begin.</p>}
    </Card>
  );
}

function CityTempsEditor({ body, onChange }: { body: CityTemps; onChange: (b: CityTemps) => void }) {
  const [day, setDay] = useState<"0" | "1">("1");
  const load = async (metric = body.metric) => {
    const r = await call<CityTemps>("GET", `/api/admin/studio/city-temps?metric=${metric}&day=${day}`);
    if (r.ok) onChange(r.data);
    else toast("Couldn't load temperatures.", "error");
  };
  return (
    <Card title="Temperatures" hint="Loaded from the model for every city in your rotation; change any value before publishing.">
      <div class="adm-row">
        <Segmented label="Measure" value={body.metric} onChange={(m) => { onChange({ ...body, metric: m }); void load(m); }} options={[{ value: "high", label: "Highs" }, { value: "low", label: "Lows" }, { value: "feelsLike", label: "Feels like" }]} />
        <Segmented label="Day" value={day} onChange={setDay} options={[{ value: "1", label: "Tomorrow" }, { value: "0", label: "Today" }]} />
        <button type="button" class="adm-btn" onClick={() => void load()}>Load from model</button>
      </div>
      <div class="adm-row">
        {body.cities.map((c, i) => (
          <label key={c.name} class="adm-field" style={{ width: "9rem" }}>
            <span class="adm-label">{c.name}</span>
            <input class="adm-input" type="number" value={c.value} onInput={(e) => onChange({ ...body, cities: body.cities.map((x, n) => (n === i ? { ...x, value: Number((e.target as HTMLInputElement).value) } : x)) })} />
          </label>
        ))}
      </div>
    </Card>
  );
}

function RiskEditor({ product, body, onChange }: { product: StudioProduct; body: RiskMap; onChange: (b: RiskMap) => void }) {
  const [level, setLevel] = useState<RiskLevel>("some");
  const [hazard, setHazard] = useState<Hazard>("wind");
  const [points, setPoints] = useState<[number, number][]>([]);
  const [spcDay, setSpcDay] = useState<"1" | "2" | "3">("1");
  const proj = mapProjector("wide", product.region);
  const finish = () => {
    if (points.length < 3) return toast("Click at least three points.", "error");
    const ring = [...points, points[0]!];
    onChange({ areas: [...body.areas, { level, hazard, geometry: { type: "Polygon", coordinates: [ring] } }] });
    setPoints([]);
  };
  const fromSpc = async () => {
    const r = await call<{ areas: RiskArea[] }>("GET", `/api/admin/studio/spc?day=${spcDay}`);
    if (!r.ok) return toast("SPC isn't available right now.", "error");
    if (r.data.areas.length === 0) toast("No SPC risk areas over your region for that day.");
    else onChange({ areas: [...body.areas, ...r.data.areas] });
  };

  return (
    <Card title="Draw the risk areas" hint="Pick a level and threat, click the map to place corners, then Finish area. Higher levels draw on top.">
      <div class="adm-row">
        <select class="adm-input" style={{ width: "10rem" }} value={level} onChange={(e) => setLevel((e.target as HTMLSelectElement).value as RiskLevel)} aria-label="Risk level">
          {RISK_LEVELS.map((l) => <option key={l} value={l}>{RISK[l].label}</option>)}
        </select>
        <select class="adm-input" style={{ width: "12rem" }} value={hazard} onChange={(e) => setHazard((e.target as HTMLSelectElement).value as Hazard)} aria-label="Main threat">
          {HAZARDS.map((h) => <option key={h} value={h}>{HAZARD_LABEL[h]}</option>)}
        </select>
        <button type="button" class="adm-btn primary" onClick={finish} disabled={points.length < 3}>Finish area</button>
        <button type="button" class="adm-btn" onClick={() => setPoints((x) => x.slice(0, -1))} disabled={!points.length}>Undo point</button>
        <button type="button" class="adm-btn" onClick={() => setPoints([])} disabled={!points.length}>Cancel</button>
      </div>
      <div class="adm-row">
        <Segmented label="SPC day" value={spcDay} onChange={setSpcDay} options={[{ value: "1", label: "Day 1" }, { value: "2", label: "Day 2" }, { value: "3", label: "Day 3" }]} />
        <button type="button" class="adm-btn" onClick={() => void fromSpc()}>Start from SPC outlook</button>
      </div>
      <DrawCanvas product={product} points={points} setPoints={setPoints}>
        {body.areas.map((a, i) => <path key={i} d={geomPath(a.geometry, proj)} fill={RISK[a.level].color} fill-opacity="0.45" stroke={RISK[a.level].color} stroke-width="4" />)}
      </DrawCanvas>
      {body.areas.map((a, i) => (
        <div key={i} class="adm-row" style={{ justifyContent: "space-between" }}>
          <span><span style={{ color: RISK[a.level].color }}>●</span> {RISK[a.level].label} · {HAZARD_LABEL[a.hazard]}</span>
          <button type="button" class="adm-btn small" onClick={() => onChange({ areas: body.areas.filter((_, n) => n !== i) })}>Remove</button>
        </div>
      ))}
    </Card>
  );
}

/** Click-to-draw map shared by the risk and totals editors. Overlays go in as children. */
function DrawCanvas({ product, points, setPoints, children }: { product: StudioProduct; points: [number, number][]; setPoints: (f: (p: [number, number][]) => [number, number][]) => void; children?: ComponentChildren }) {
  const svg = useRef<SVGSVGElement>(null);
  const proj = mapProjector("wide", product.region);
  const M = layout("wide").map;
  const click = (e: MouseEvent) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(m.inverse());
    const [lon, lat] = proj.lonlat(q.x, q.y);
    setPoints((x) => [...x, [Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000]]);
  };
  return (
    <svg ref={svg} class="studio-draw" viewBox={`${M.x} ${M.y} ${M.w} ${M.h}`} onClick={click} role="img" aria-label="Click to draw an area">
      <Basemap proj={proj} bbox={product.region} />
      <MapClip proj={proj} id="draw-clip">
        {children}
        {points.length > 0 && (
          <g>
            <polyline points={points.map(([lo, la]) => proj.xy(lo, la).join(",")).join(" ")} fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="10 8" />
            {points.map(([lo, la], i) => { const [x, y] = proj.xy(lo, la); return <circle key={i} cx={x} cy={y} r="9" fill="#fff" stroke="#ff8a65" stroke-width="4" />; })}
          </g>
        )}
      </MapClip>
    </svg>
  );
}

function TotalsEditor({ product, body, onChange }: { product: StudioProduct; body: TotalsMap; onChange: (b: TotalsMap) => void }) {
  const scale = TOTAL_SCALES[body.kind];
  const [grid, setGrid] = useState<Grid | null>(null);
  const [mult, setMult] = useState(1);
  const [days, setDays] = useState(2);
  const [min, setMin] = useState<number>(scale.thresholds[1]!);
  const [points, setPoints] = useState<[number, number][]>([]);
  const proj = mapProjector("wide", product.region);

  const contour = (g: Grid, m: number, kind = body.kind) =>
    contourBands({ ...g, values: g.values.map((v) => Math.round(v * m * 10) / 10) }, [...TOTAL_SCALES[kind].thresholds]);

  const load = async (kind = body.kind) => {
    const r = await call<{ grid: Grid }>("GET", `/api/admin/studio/totals?kind=${kind}&days=${days}`);
    if (!r.ok) return toast("Couldn't load model totals.", "error");
    setGrid(r.data.grid);
    setMult(1);
    onChange({ kind, mode: "model", bands: contour(r.data.grid, 1, kind) });
  };
  const nudge = (m: number) => {
    setMult(m);
    if (grid) onChange({ ...body, mode: "model", bands: contour(grid, m) });
  };
  const finish = () => {
    if (points.length < 3) return toast("Click at least three points.", "error");
    const t: readonly number[] = scale.thresholds;
    onChange({ ...body, mode: "draw", bands: [...body.bands, { min, max: t[t.indexOf(min) + 1] ?? null, geometry: { type: "Polygon", coordinates: [[...points, points[0]!]] } }] });
    setPoints([]);
  };

  return (
    <Card title="Totals" hint="Let the model draw the bands, then scale them up or down, or draw your own areas by hand.">
      <div class="adm-row">
        <Segmented label="Type" value={body.kind} onChange={(k) => { setMin(TOTAL_SCALES[k].thresholds[1]!); onChange({ kind: k, mode: body.mode, bands: [] }); setGrid(null); }} options={[{ value: "snow", label: "Snow" }, { value: "rain", label: "Rain" }]} />
        <select class="adm-input" style={{ width: "9rem" }} value={days} onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))} aria-label="Days">
          {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>Next {d} day{d > 1 ? "s" : ""}</option>)}
        </select>
        <button type="button" class="adm-btn" onClick={() => void load()}>Load from model</button>
        <button type="button" class="adm-btn" onClick={() => onChange({ ...body, mode: "draw", bands: [] })}>Clear</button>
      </div>
      {grid && (
        <label class="adm-field">
          <span class="adm-label">Adjust the model: {Math.round(mult * 100)}%</span>
          <input class="adm-range" type="range" min={0.3} max={2} step={0.05} value={mult} onInput={(e) => nudge(Number((e.target as HTMLInputElement).value))} />
        </label>
      )}
      <div class="adm-row">
        <select class="adm-input" style={{ width: "12rem" }} value={min} onChange={(e) => setMin(Number((e.target as HTMLSelectElement).value))} aria-label="Band to draw">
          {scale.thresholds.map((t, i) => <option key={t} value={t}>{bandLabel({ min: t, max: scale.thresholds[i + 1] ?? null })}</option>)}
        </select>
        <button type="button" class="adm-btn primary" onClick={finish} disabled={points.length < 3}>Finish area</button>
        <button type="button" class="adm-btn" onClick={() => setPoints((x) => x.slice(0, -1))} disabled={!points.length}>Undo point</button>
      </div>
      <DrawCanvas product={product} points={points} setPoints={setPoints}>
        {[...body.bands].sort((a, b) => a.min - b.min).map((b, i) => <path key={i} d={geomPath(b.geometry, proj)} fill={scale.colors[Math.max(0, scale.thresholds.findIndex((t) => Math.abs(t - b.min) < 1e-6))]} fill-opacity="0.7" />)}
      </DrawCanvas>
    </Card>
  );
}

const CELL_NEXT = [0, 1, 2, 3] as const;

function TimelineEditor({ body, onChange }: { body: Timeline; onChange: (b: Timeline) => void }) {
  const [hazard, setHazard] = useState<Hazard>("flood");
  const load = async () => {
    const r = await call<Timeline>("GET", "/api/admin/studio/timeline");
    if (r.ok) onChange(r.data);
    else toast("Couldn't load the hourly model.", "error");
  };
  const cycle = (ri: number, bi: number) =>
    onChange({
      rows: body.rows.map((row, r) =>
        r !== ri ? row : { ...row, blocks: row.blocks.map((b, i) => (i !== bi ? b : { ...b, hazard, intensity: CELL_NEXT[(b.intensity + 1) % 4]! })) },
      ),
    });
  return (
    <Card title="Timeline" hint="Loaded from the hourly model in 3-hour blocks. Click a block to raise its strength (it cycles back to none); it takes the threat chosen here.">
      <div class="adm-row">
        <button type="button" class="adm-btn" onClick={() => void load()}>Load from model</button>
        <select class="adm-input" style={{ width: "12rem" }} value={hazard} onChange={(e) => setHazard((e.target as HTMLSelectElement).value as Hazard)} aria-label="Threat for clicked blocks">
          {HAZARDS.map((h) => <option key={h} value={h}>{HAZARD_LABEL[h]}</option>)}
        </select>
      </div>
      {body.rows.map((r, ri) => (
        <div key={r.city} class="adm-row">
          <b style={{ width: "8rem" }}>{r.city}</b>
          {r.blocks.map((b, bi) => (
            <button key={bi} type="button" class="adm-btn small" aria-label={`${r.city} ${b.hour} ${b.hazard} ${b.intensity}`} onClick={() => cycle(ri, bi)} style={{ background: HAZARD_COLOR[b.hazard], opacity: b.intensity === 0 ? 0.55 : 0.35 + b.intensity * 0.22, minWidth: "2.4rem" }}>{b.intensity || ""}</button>
          ))}
        </div>
      ))}
    </Card>
  );
}
