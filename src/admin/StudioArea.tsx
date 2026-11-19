// Editor for the drawn areas map: the forecaster's own shapes, each with its own text, plus markers.
import { useMemo, useRef, useState } from "preact/hooks";
import {
  AREA_DEFAULT_STYLE, AREA_LABEL_AT, AREA_LIMITS, MARKER_ICONS, type AreaMap, type AreaMarker, type AreaShape, type StudioProduct,
} from "../../shared/studio";
import type { LonLat } from "../../shared/types";
import { Basemap, layout, mapProjector, MapClip } from "../studio/Frame";
import { AreaOverlay, ringD, ringXY } from "../studio/views/AreaMap";
import { toast } from "./toast";
import { Card, Field, Segmented } from "./ui";

type Mode = "draw" | "edit" | "marker";
type Sel = { t: "shape"; i: number; v: number | null } | { t: "marker"; i: number } | null;
type Drag =
  | { t: "vertex"; i: number; v: number }
  | { t: "shape"; i: number; from: LonLat; orig: LonLat[] }
  | { t: "marker"; i: number };

const AT_NAME: Record<AreaShape["labelAt"], string> = { inside: "On the shape", above: "Above", below: "Below", left: "Left", right: "Right" };
const ICON_NAME: Record<AreaMarker["icon"], string> = { star: "Star", dot: "Dot", none: "Text only" };
const ACCENT = "#ff8a65";
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const val = (e: Event) => (e.target as HTMLInputElement).value;

export function AreaMapEditor({ product, body, onChange }: { product: StudioProduct; body: AreaMap; onChange: (b: AreaMap) => void }) {
  const [mode, setMode] = useState<Mode>("draw");
  const [sel, setSel] = useState<Sel>(null);
  const [draft, setDraft] = useState<LonLat[]>([]);
  const [markerText, setMarkerText] = useState("");
  const [markerIcon, setMarkerIcon] = useState<AreaMarker["icon"]>("star");
  // while dragging, the canvas shows `live`; the product (and its preview) updates once on release
  const [live, setLive] = useState<AreaMap | null>(null);
  const drag = useRef<Drag | null>(null);
  // set when a press starts on a shape, corner or marker: with pointer capture its click lands on the map itself
  const pressed = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const region = product.region;
  const proj = useMemo(() => mapProjector("wide", region), [region.south, region.west, region.north, region.east]);
  const base = useMemo(() => <Basemap proj={proj} bbox={region} />, [proj]);
  const M = layout("wide").map;
  const view = live ?? body;

  const toLL = (e: MouseEvent): LonLat | null => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(m.inverse());
    const [lon, lat] = proj.lonlat(q.x, q.y);
    return [r3(lon), r3(lat)];
  };

  const setShape = (i: number, patch: Partial<AreaShape>, b = body) => onChange({ ...b, shapes: b.shapes.map((s, n) => (n === i ? { ...s, ...patch } : s)) });
  const setMarker = (i: number, patch: Partial<AreaMarker>) => onChange({ ...body, markers: body.markers.map((m, n) => (n === i ? { ...m, ...patch } : m)) });

  const finish = () => {
    if (draft.length < 3) return toast("Click at least three points.", "error");
    if (body.shapes.length >= AREA_LIMITS.shapes) return toast(`Up to ${AREA_LIMITS.shapes} shapes.`, "error");
    const shape: AreaShape = { ring: draft, ...AREA_DEFAULT_STYLE, label: "", labelAt: "inside", note: "" };
    onChange({ ...body, shapes: [...body.shapes, shape] });
    setDraft([]);
    setSel({ t: "shape", i: body.shapes.length, v: null });
    setMode("edit");
  };

  const deleteVertex = () => {
    if (sel?.t !== "shape" || sel.v === null) return;
    const s = body.shapes[sel.i];
    if (!s) return;
    if (s.ring.length <= 3) return toast("A shape needs at least three points. Delete the shape instead.", "error");
    setShape(sel.i, { ring: s.ring.filter((_, n) => n !== sel.v) });
    setSel({ ...sel, v: null });
  };
  const deleteShape = (i: number) => {
    onChange({ ...body, shapes: body.shapes.filter((_, n) => n !== i) });
    setSel(null);
  };
  const deleteMarker = (i: number) => {
    onChange({ ...body, markers: body.markers.filter((_, n) => n !== i) });
    setSel(null);
  };

  // ── pointer handling ──
  const startDrag = (e: PointerEvent, d: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = d;
    pressed.current = true;
    svg.current?.setPointerCapture(e.pointerId);
    svg.current?.focus({ preventScroll: true }); // preventDefault above stops the usual focus, and Delete needs it
    setLive(body);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    const at = d && toLL(e);
    if (!d || !at) return;
    setLive((cur) => {
      const b = cur ?? body;
      if (d.t === "vertex") return { ...b, shapes: b.shapes.map((s, n) => (n === d.i ? { ...s, ring: s.ring.map((p, k) => (k === d.v ? at : p)) } : s)) };
      if (d.t === "marker") return { ...b, markers: b.markers.map((m, n) => (n === d.i ? { ...m, lon: at[0], lat: at[1] } : m)) };
      const dx = at[0] - d.from[0], dy = at[1] - d.from[1];
      return { ...b, shapes: b.shapes.map((s, n) => (n === d.i ? { ...s, ring: d.orig.map(([lo, la]) => [r3(lo + dx), r3(la + dy)] as LonLat) } : s)) };
    });
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (live) onChange(live);
    setLive(null);
  };
  const onClick = (e: MouseEvent) => {
    if (pressed.current) {
      pressed.current = false;
      return;
    }
    const at = toLL(e);
    if (!at) return;
    if (mode === "draw") {
      if (draft.length >= AREA_LIMITS.points) return toast(`Up to ${AREA_LIMITS.points} points per shape.`, "error");
      setDraft((x) => [...x, at]);
    } else if (mode === "marker") {
      if (body.markers.length >= AREA_LIMITS.markers) return toast(`Up to ${AREA_LIMITS.markers} markers.`, "error");
      if (markerIcon === "none" && !markerText.trim()) return toast("Type the label text first.", "error");
      onChange({ ...body, markers: [...body.markers, { lon: at[0], lat: at[1], icon: markerIcon, text: markerText.trim().slice(0, AREA_LIMITS.marker) }] });
      setSel({ t: "marker", i: body.markers.length });
    } else setSel(null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    e.preventDefault();
    if (sel?.t === "shape" && sel.v !== null) deleteVertex();
    else if (sel?.t === "shape") deleteShape(sel.i);
    else if (sel?.t === "marker") deleteMarker(sel.i);
  };

  const editing = mode === "edit";
  const selShape = sel?.t === "shape" ? view.shapes[sel.i] : undefined;
  const selPts = selShape ? ringXY(selShape, proj) : [];

  return (
    <Card title="Draw the areas" hint="Draw: click the map to place corners, then Finish shape. Edit: drag a shape to move it, drag its corners, click a midpoint dot to add a corner, select a corner and press Delete to remove it. Marker: click to drop a star, dot or text label.">
      <div class="adm-form">
        <Field label="Caption" hint={`What the map is about, in your words. Up to ${AREA_LIMITS.caption} characters.`}>
          <textarea class="adm-input" rows={2} maxLength={AREA_LIMITS.caption} value={body.caption} placeholder="Coastal flooding is possible at high tide Thursday morning in the shaded area." onInput={(e) => onChange({ ...body, caption: (e.target as HTMLTextAreaElement).value })} />
        </Field>
      </div>
      <div class="adm-row">
        <Segmented label="Mode" value={mode} onChange={(m) => { setMode(m); if (m !== "draw") setDraft([]); }} options={[{ value: "draw", label: "Draw shape" }, { value: "edit", label: "Edit / move" }, { value: "marker", label: "Add marker" }]} />
        {mode === "draw" && (
          <>
            <button type="button" class="adm-btn primary" onClick={finish} disabled={draft.length < 3}>Finish shape</button>
            <button type="button" class="adm-btn" onClick={() => setDraft((x) => x.slice(0, -1))} disabled={!draft.length}>Undo point</button>
            <button type="button" class="adm-btn" onClick={() => setDraft([])} disabled={!draft.length}>Cancel</button>
            <span class="adm-hint">{draft.length}/{AREA_LIMITS.points} points</span>
          </>
        )}
        {mode === "marker" && (
          <>
            <select class="adm-input" style={{ width: "9rem" }} value={markerIcon} onChange={(e) => setMarkerIcon((e.target as HTMLSelectElement).value as AreaMarker["icon"])} aria-label="Marker icon">
              {MARKER_ICONS.map((i) => <option key={i} value={i}>{ICON_NAME[i]}</option>)}
            </select>
            <input class="adm-input" style={{ width: "14rem" }} maxLength={AREA_LIMITS.marker} value={markerText} placeholder="Washington" onInput={(e) => setMarkerText(val(e))} aria-label="Marker text" />
            <span class="adm-hint">then click the map</span>
          </>
        )}
        {editing && sel?.t === "shape" && sel.v !== null && <button type="button" class="adm-btn" onClick={deleteVertex}>Delete point</button>}
      </div>

      <svg ref={svg} class="studio-draw" viewBox={`${M.x} ${M.y} ${M.w} ${M.h}`} tabindex={0} onKeyDown={onKey}
        onClick={onClick} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ cursor: editing ? "default" : "crosshair", touchAction: "none" }} role="img" aria-label="Map: click to draw areas">
        {base}
        <MapClip proj={proj} id="area-draw-clip">
          <g style={{ pointerEvents: "none" }}><AreaOverlay body={view} proj={proj} /></g>
          {editing && view.shapes.map((s, i) => (
            <path key={i} d={ringD(ringXY(s, proj))} fill="#000" fill-opacity="0" stroke="#000" stroke-opacity="0" stroke-width="14" style={{ cursor: "move" }}
              onPointerDown={(e) => { setSel({ t: "shape", i, v: null }); const at = toLL(e); if (at) startDrag(e, { t: "shape", i, from: at, orig: s.ring }); }}
              onClick={(e) => e.stopPropagation()} />
          ))}
          {editing && selShape && sel?.t === "shape" && (
            <g>
              <path d={ringD(selPts)} fill="none" stroke={ACCENT} stroke-width="2" style={{ pointerEvents: "none" }} />
              {selPts.map(([x, y], k) => {
                const [x2, y2] = selPts[(k + 1) % selPts.length]!;
                return selShape.ring.length < AREA_LIMITS.points ? (
                  <circle key={`m${k}`} cx={(x + x2) / 2} cy={(y + y2) / 2} r="7" fill={ACCENT} fill-opacity="0.7" stroke="#fff" stroke-width="2" style={{ cursor: "copy" }}
                    onPointerDown={(e) => {
                      const at = toLL(e);
                      if (!at) return;
                      const ring = [...selShape.ring.slice(0, k + 1), at, ...selShape.ring.slice(k + 1)];
                      setSel({ t: "shape", i: sel.i, v: k + 1 });
                      startDrag(e, { t: "vertex", i: sel.i, v: k + 1 });
                      setLive({ ...body, shapes: body.shapes.map((s, n) => (n === sel.i ? { ...s, ring } : s)) });
                    }}
                    onClick={(e) => e.stopPropagation()} />
                ) : null;
              })}
              {selPts.map(([x, y], k) => (
                <circle key={`v${k}`} cx={x} cy={y} r="11" fill={sel.v === k ? ACCENT : "#fff"} stroke={ACCENT} stroke-width="4" style={{ cursor: "grab" }}
                  onPointerDown={(e) => { setSel({ t: "shape", i: sel.i, v: k }); startDrag(e, { t: "vertex", i: sel.i, v: k }); }}
                  onClick={(e) => e.stopPropagation()} />
              ))}
            </g>
          )}
          {editing && view.markers.map((m, i) => {
            const [x, y] = proj.xy(m.lon, m.lat);
            const on = sel?.t === "marker" && sel.i === i;
            return (
              <circle key={`k${i}`} cx={x} cy={y} r="22" fill="#fff" fill-opacity={on ? 0.25 : 0.01} stroke={on ? ACCENT : "none"} stroke-width="3" style={{ cursor: "move" }}
                onPointerDown={(e) => { setSel({ t: "marker", i }); startDrag(e, { t: "marker", i }); }}
                onClick={(e) => e.stopPropagation()} />
            );
          })}
          {draft.length > 0 && (
            <g style={{ pointerEvents: "none" }}>
              <polyline points={draft.map(([lo, la]) => proj.xy(lo, la).join(",")).join(" ")} fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="10 8" />
              {draft.map(([lo, la], i) => { const [x, y] = proj.xy(lo, la); return <circle key={i} cx={x} cy={y} r="9" fill="#fff" stroke={ACCENT} stroke-width="4" />; })}
            </g>
          )}
        </MapClip>
      </svg>

      <h3 class="adm-label" style={{ marginTop: "1rem" }}>Shapes ({body.shapes.length}/{AREA_LIMITS.shapes})</h3>
      {body.shapes.length === 0 && <p class="adm-hint">No shapes yet. Draw one on the map.</p>}
      {body.shapes.map((s, i) => {
        const on = sel?.t === "shape" && sel.i === i;
        return (
          <div key={i} class="adm-form" style={{ borderLeft: `4px solid ${on ? ACCENT : "transparent"}`, paddingLeft: ".6rem", marginBottom: ".8rem" }}>
            <div class="adm-row">
              <button type="button" class="adm-btn small" onClick={() => { setMode("edit"); setSel({ t: "shape", i, v: null }); }} aria-pressed={on}>{on ? "Selected" : "Select"}</button>
              <input class="adm-input grow" maxLength={AREA_LIMITS.label} value={s.label} placeholder="Label on the map, e.g. Coastal flooding" onInput={(e) => setShape(i, { label: val(e) })} aria-label="Shape label" />
              <select class="adm-input" style={{ width: "9rem" }} value={s.labelAt} onChange={(e) => setShape(i, { labelAt: (e.target as HTMLSelectElement).value as AreaShape["labelAt"] })} aria-label="Label position">
                {AREA_LABEL_AT.map((a) => <option key={a} value={a}>{AT_NAME[a]}</option>)}
              </select>
              <button type="button" class="adm-btn small danger" onClick={() => deleteShape(i)} aria-label="Delete shape">Delete</button>
            </div>
            <input class="adm-input" maxLength={AREA_LIMITS.note} value={s.note} placeholder="What this shape shows (legend text, optional)" onInput={(e) => setShape(i, { note: val(e) })} aria-label="Shape description" />
            <div class="adm-row">
              <label class="adm-row" style={{ gap: ".35rem" }}>Fill <input type="color" value={s.fill} onInput={(e) => setShape(i, { fill: val(e) })} aria-label="Fill colour" /></label>
              <label class="adm-row" style={{ gap: ".35rem" }}>
                Opacity <input type="range" min={0} max={1} step={0.05} value={s.fillOpacity} onInput={(e) => setShape(i, { fillOpacity: Number(val(e)) })} aria-label="Fill opacity" />
                <span class="adm-hint" style={{ width: "2.6rem" }}>{Math.round(s.fillOpacity * 100)}%</span>
              </label>
              <label class="adm-row" style={{ gap: ".35rem" }}>Outline <input type="color" value={s.stroke} onInput={(e) => setShape(i, { stroke: val(e) })} aria-label="Outline colour" /></label>
              <Segmented label="Outline style" value={s.line} onChange={(v) => setShape(i, { line: v })} options={[{ value: "dashed", label: "Dashed" }, { value: "solid", label: "Solid" }]} />
              <span class="adm-hint">{s.ring.length} points</span>
            </div>
          </div>
        );
      })}

      <h3 class="adm-label" style={{ marginTop: "1rem" }}>Markers and labels ({body.markers.length}/{AREA_LIMITS.markers})</h3>
      {body.markers.length === 0 && <p class="adm-hint">None. Use Add marker to drop a star and a city name, or a free text label.</p>}
      {body.markers.map((m, i) => (
        <div key={i} class="adm-row">
          <select class="adm-input" style={{ width: "9rem" }} value={m.icon} onChange={(e) => setMarker(i, { icon: (e.target as HTMLSelectElement).value as AreaMarker["icon"] })} aria-label="Marker icon">
            {MARKER_ICONS.map((ic) => <option key={ic} value={ic}>{ICON_NAME[ic]}</option>)}
          </select>
          <input class="adm-input grow" maxLength={AREA_LIMITS.marker} value={m.text} placeholder="Text" onInput={(e) => setMarker(i, { text: val(e) })} aria-label="Marker text" />
          <button type="button" class="adm-btn small danger" onClick={() => deleteMarker(i)} aria-label="Delete marker">Delete</button>
        </div>
      ))}
    </Card>
  );
}
