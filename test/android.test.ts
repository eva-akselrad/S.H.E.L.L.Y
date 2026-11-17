import { describe, expect, test } from "vitest";
import { decideFcmSends, topicConditions, updateFcmSent, zoneTopic } from "../shared/fcm";
import { buildGlance } from "../shared/glance";
import type { Alert, Forecast } from "../shared/types";
import { b64urlDecode } from "../worker/webpush";
import { signServiceJwt } from "../worker/fcm";

const square = (w: number, s: number, e: number, n: number) => ({
  type: "Polygon" as const,
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});
const mk = (over: Partial<Alert> = {}): Alert => ({
  id: "a1", event: "Tornado Warning", severity: "Extreme", urgency: "Immediate", certainty: "Observed",
  headline: "Tornado Warning issued", description: "", instruction: "", sent: "2026-05-01T18:00:00Z", onset: null,
  expires: "2099-01-01T00:00:00Z", areaDesc: "Philadelphia, PA", zones: ["PAZ106", "PAC101"], geometry: square(-75.4, 39.9, -75.0, 40.1), params: {}, ...over,
});
const place = { lat: 39.95, lon: -75.16, name: "Philadelphia", state: "PA", tz: "America/New_York", forecastZone: "PAZ106", countyZone: "PAC101", fireZone: null };
const forecast = (): Forecast => ({
  fetchedAt: "",
  current: { temp: 61.4, feelsLike: 59, humidity: 50, dewPoint: 40, windSpeed: 5, windGust: 8, windDir: 90, pressure: 30, visibilityMi: 10, uv: 2, cloud: 50, code: 3, isDay: true, precip: 0, time: "" },
  hourly: [],
  daily: [{ date: "2026-11-17", code: 3, hi: 66.2, lo: 48.7, pop: 0, precip: 0, snow: 0, sunrise: "", sunset: "", uvMax: 2, windMax: 10, gustMax: 15 }],
  nowcast: [],
  text: [],
});
const NOW = new Date("2026-11-17T18:00:00Z");

describe("buildGlance", () => {
  const base = { now: NOW, place, forecast: forecast(), alertsUpdated: NOW.toISOString() };
  test("includes a warning whose polygon covers the point, with template steps", () => {
    const g = buildGlance({ ...base, alerts: [mk()] });
    expect(g.alerts).toHaveLength(1);
    expect(g.alerts[0]!.event).toBe("Tornado Warning");
    expect(g.alerts[0]!.action?.steps.length).toBeGreaterThan(0);
    expect(g.alerts[0]!.action?.steps.length).toBeLessThanOrEqual(4);
    expect(g.level === "WARNING" || g.level === "EMERGENCY").toBe(true);
  });
  test("leaves out a polygon that does not cover the point, even when the zone matches", () => {
    const g = buildGlance({ ...base, alerts: [mk({ geometry: square(-80, 35, -79, 36) })] });
    expect(g.alerts).toHaveLength(0);
    expect(g.level).toBe("CALM");
  });
  test("zone-only alerts match by zone", () => {
    const watch = mk({ id: "w1", event: "Flood Watch", severity: "Moderate", geometry: null, zones: ["PAC101"] });
    expect(buildGlance({ ...base, alerts: [watch] }).alerts.map((a) => a.id)).toEqual(["w1"]);
    expect(buildGlance({ ...base, alerts: [{ ...watch, zones: ["NJC005"] }] }).alerts).toHaveLength(0);
  });
  test("drops expired alerts, sorts most severe first, passes references through", () => {
    const watch = mk({ id: "w1", event: "Tornado Watch", severity: "Severe", geometry: null, zones: ["PAZ106"] });
    const old = mk({ id: "old", expires: "2026-11-17T17:00:00Z" });
    const warn = mk({ id: "new", references: ["r1", "r2"] });
    const g = buildGlance({ ...base, alerts: [watch, old, warn] });
    expect(g.alerts.map((a) => a.id)).toEqual(["new", "w1"]);
    expect(g.alerts[0]!.refs).toEqual(["r1", "r2"]);
  });
  test("conditions and zones", () => {
    const g = buildGlance({ ...base, alerts: [] });
    expect(g.now).toMatchObject({ temp: 61, feels: 59 });
    expect(g.today).toEqual({ hi: 66, lo: 49 });
    expect(g.place.zones).toEqual(["PAZ106", "PAC101"]);
    expect(buildGlance({ ...base, place: { ...place, fireZone: "PAZ106" }, alerts: [] }).place.zones).toEqual(["PAZ106", "PAC101"]);
  });
  test("works without a forecast", () => {
    const g = buildGlance({ ...base, forecast: null, alerts: [mk()] });
    expect(g.now).toBeNull();
    expect(g.alerts).toHaveLength(1);
  });
});

describe("fcm topics", () => {
  test("topic name", () => expect(zoneTopic("PAZ106")).toBe("z_PAZ106"));
  test("12 zones make 3 conditions of at most 5 topics", () => {
    const zones = Array.from({ length: 12 }, (_, i) => `PAZ${String(100 + i)}`);
    const c = topicConditions(zones);
    expect(c).toHaveLength(3);
    expect(c[0]!.split("||")).toHaveLength(5);
    expect(c[2]!.split("||")).toHaveLength(2);
    expect(c[0]).toBe("'z_PAZ100' in topics || 'z_PAZ101' in topics || 'z_PAZ102' in topics || 'z_PAZ103' in topics || 'z_PAZ104' in topics");
  });
  test("dedupes and ignores malformed zones", () => {
    expect(topicConditions(["PAZ106", "PAZ106", "bad zone", "x'y"])).toEqual(["'z_PAZ106' in topics"]);
  });
});

describe("decideFcmSends", () => {
  const now = Date.parse("2026-11-17T18:00:00Z");
  test("new alert is sent, duplicate is not", () => {
    const a = mk();
    const first = decideFcmSends([a], {}, now);
    expect(first.map((d) => d.kind)).toEqual(["new"]);
    const sent = updateFcmSent({}, first, [a], now);
    expect(decideFcmSends([a], sent, now)).toHaveLength(0);
  });
  test("an update at the same level stays quiet, an upgrade is sent", () => {
    const a = mk();
    const sent = updateFcmSent({}, decideFcmSends([a], {}, now), [a], now);
    const same = mk({ id: "a2", references: ["a1"] });
    expect(decideFcmSends([same], sent, now)).toHaveLength(0);
    const up = mk({ id: "a3", references: ["a1"], params: { tornadoDamageThreat: "CATASTROPHIC" } });
    const d = decideFcmSends([up], sent, now);
    expect(d).toHaveLength(1);
    expect(d[0]!.kind).toBe("upgrade");
  });
  test("expired, calm and zoneless alerts are skipped; watches are sent", () => {
    expect(decideFcmSends([mk({ expires: "2026-11-17T17:59:00Z" })], {}, now)).toHaveLength(0);
    expect(decideFcmSends([mk({ event: "Air Quality Alert", severity: "Minor" })], {}, now)).toHaveLength(0);
    expect(decideFcmSends([mk({ zones: [] })], {}, now)).toHaveLength(0);
    expect(decideFcmSends([mk({ event: "Flood Watch", severity: "Moderate" })], {}, now)).toHaveLength(1);
  });
  test("prunes entries an hour after expiry", () => {
    const sent = { old: { rank: 2, exp: now - 2 * 3600_000 }, live: { rank: 2, exp: now + 3600_000 } };
    expect(Object.keys(updateFcmSent(sent, [], [], now))).toEqual(["live"]);
  });
});

describe("service-account JWT", () => {
  test("RS256 signature verifies and claims are right", async () => {
    const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
    const now = Date.parse("2026-11-17T18:00:00Z");
    const jwt = await signServiceJwt({ project_id: "p", client_email: "svc@p.iam.gserviceaccount.com", private_key: pem }, now);
    const [h, c, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
    expect(claims).toEqual({
      iss: "svc@p.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now / 1000,
      exp: now / 1000 + 3600,
    });
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", kp.publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});
