import { afterEach, describe, expect, test, vi } from "vitest";
import { MIN, type Flash } from "../shared/lightning";
import {
  decideLightningPush,
  distanceToGeometryMi,
  lightningData,
  markPushed,
  PUSH_COOLDOWN_MS,
  type ZoneOutline,
} from "../shared/lightningPush";
import type { PolygonGeom } from "../shared/types";
import { fanOutLightningFcm } from "../worker/fcm";

const NOW = Date.parse("2026-07-10T23:00:00Z");
/** a 0.2 x 0.2 degree square zone with its south-west corner at (40, -75.4) */
const square = (s: number, w: number, d = 0.2): PolygonGeom => ({
  type: "Polygon",
  coordinates: [[[w, s], [w + d, s], [w + d, s + d], [w, s + d], [w, s]]],
});
const ZONE_A: ZoneOutline = { zone: "PAC091", geometry: square(40, -75.4) };
const ZONE_B: ZoneOutline = { zone: "PAC045", geometry: square(39.3, -75.4) }; // well south of A
const flash = (lat: number, lon: number, agoMin: number): Flash => [lat, lon, NOW - agoMin * MIN];

describe("distance to a zone outline", () => {
  test("inside is 0; outside is the distance to the nearest edge", () => {
    expect(distanceToGeometryMi(40.1, -75.3, ZONE_A.geometry)).toBe(0);
    // 0.1 degrees of latitude south of the south edge is about 6.9 mi
    expect(distanceToGeometryMi(39.9, -75.3, ZONE_A.geometry)).toBeCloseTo(6.9, 0);
    // diagonal off a corner is farther than straight off the edge
    expect(distanceToGeometryMi(39.9, -75.5, ZONE_A.geometry)).toBeGreaterThan(8);
  });
  test("a hole is not inside", () => {
    const donut: PolygonGeom = {
      type: "Polygon",
      coordinates: [
        [[-75.4, 40], [-75.0, 40], [-75.0, 40.4], [-75.4, 40.4], [-75.4, 40]],
        [[-75.3, 40.1], [-75.1, 40.1], [-75.1, 40.3], [-75.3, 40.3], [-75.3, 40.1]],
      ],
    };
    expect(distanceToGeometryMi(40.2, -75.2, donut)).toBeGreaterThan(0);
  });
  test("MultiPolygon: nearest part wins", () => {
    const multi: PolygonGeom = { type: "MultiPolygon", coordinates: [square(40, -75.4).coordinates, square(41, -75.4).coordinates] } as PolygonGeom;
    expect(distanceToGeometryMi(40.9, -75.3, multi)).toBeCloseTo(6.9, 0);
  });
});

describe("decideLightningPush", () => {
  test("a flash within 10 mi of the outline messages that zone only", () => {
    const { pushes } = decideLightningPush([flash(39.92, -75.3, 1)], [ZONE_A, ZONE_B], {}, NOW);
    expect(pushes.map((p) => p.zone)).toEqual(["PAC091"]); // about 5.5 mi south of A, about 29 mi from B
  });
  test("a flash 20 mi from every zone sends nothing", () => {
    expect(decideLightningPush([flash(38.9, -75.3, 1)], [ZONE_A, ZONE_B], {}, NOW).pushes).toEqual([]);
  });
  test("at most one message per zone per 30 minutes", () => {
    const first = decideLightningPush([flash(40.1, -75.3, 1)], [ZONE_A], {}, NOW);
    expect(first.pushes).toHaveLength(1);
    const sent = markPushed(first.next, first.pushes, NOW);
    expect(decideLightningPush([flash(40.1, -75.3, 0)], [ZONE_A], sent, NOW + 10 * MIN).pushes).toEqual([]);
    expect(decideLightningPush([flash(40.1, -75.3, 0)], [ZONE_A], sent, NOW + PUSH_COOLDOWN_MS - 1).pushes).toEqual([]);
    expect(decideLightningPush([[40.1, -75.3, NOW + PUSH_COOLDOWN_MS]], [ZONE_A], sent, NOW + PUSH_COOLDOWN_MS + 1).pushes).toHaveLength(1);
  });
  test("a zone's cooldown does not hold back another zone", () => {
    const sent = { PAC091: NOW - 5 * MIN };
    const both = [flash(40.1, -75.3, 1), flash(39.4, -75.3, 1)];
    expect(decideLightningPush(both, [ZONE_A, ZONE_B], sent, NOW).pushes.map((p) => p.zone)).toEqual(["PAC045"]);
  });
  test("old flashes are not pushed; the newest qualifying flash is the one sent", () => {
    expect(decideLightningPush([flash(40.1, -75.3, 11)], [ZONE_A], {}, NOW).pushes).toEqual([]);
    const { pushes } = decideLightningPush([flash(40.1, -75.3, 6), flash(40.15, -75.31, 2), flash(30, -75, 0)], [ZONE_A], {}, NOW);
    expect(pushes[0]!.flash[2]).toBe(NOW - 2 * MIN);
  });
  test("expired cooldowns are dropped from the memory", () => {
    const { next } = decideLightningPush([], [ZONE_A], { OLD: NOW - 2 * PUSH_COOLDOWN_MS, KEEP: NOW - MIN }, NOW);
    expect(next).toEqual({ KEEP: NOW - MIN });
  });
  test("the message carries only the flash point and time, as strings", () => {
    const d = lightningData({ zone: "PAC091", flash: [40.1234, -75.3456, NOW] });
    expect(d).toEqual({ type: "lightning", zone: "PAC091", lat: "40.12", lon: "-75.35", t: String(NOW) });
  });
});

describe("fanOutLightningFcm", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
    const m = new Map<string, string>();
    const kv = {
      get: async (k: string, opt?: string | { type?: string }) => {
        const v = m.get(k);
        if (v === undefined) return null;
        return (typeof opt === "string" ? opt : opt?.type) === "json" ? JSON.parse(v) : v;
      },
      put: async (k: string, v: string) => void m.set(k, v),
    } as unknown as KVNamespace;
    const env = { STATE: kv, FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: "p", client_email: "svc@p.iam.gserviceaccount.com", private_key: pem }) } as unknown as Env;
    const sends: { target: Record<string, unknown>; data: Record<string, string>; android: Record<string, unknown> }[] = [];
    let fail = false;
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      if (String(url).includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
      const msg = JSON.parse(init.body).message;
      sends.push({ target: { topic: msg.topic }, data: msg.data, android: msg.android });
      return new Response("{}", { status: fail ? 500 : 200 });
    });
    return { env, sends, m, setFail: (v: boolean) => (fail = v) };
  }
  const zones = async () => [ZONE_A, ZONE_B];

  test("sends one normal-priority data message to the zone topic, then holds for 30 minutes", async () => {
    const { env, sends, m } = await setup();
    const r = await fanOutLightningFcm(env, [flash(40.1, -75.3, 1)], zones, NOW);
    expect(r).toEqual({ sent: 1, failed: 0 });
    expect(sends).toHaveLength(1);
    expect(sends[0]!.target).toEqual({ topic: "z_PAC091" });
    expect(sends[0]!.data.type).toBe("lightning");
    expect(sends[0]!.android.priority).toBe("NORMAL");
    expect(sends[0]!.android.ttl).toBe("600s");
    expect(sends[0]!.android).not.toHaveProperty("notification"); // data only: the phone writes the words
    expect(JSON.parse(m.get("fcm:lightning")!)).toEqual({ PAC091: NOW });
    // the same zone, ten minutes later: nothing goes out
    const again = await fanOutLightningFcm(env, [flash(40.1, -75.3, 0)], zones, NOW + 10 * MIN);
    expect(again.sent).toBe(0);
    expect(sends).toHaveLength(1);
  });

  test("a failed send does not start a cooldown, so the next pass retries", async () => {
    const { env, sends, setFail } = await setup();
    setFail(true);
    expect((await fanOutLightningFcm(env, [flash(40.1, -75.3, 1)], zones, NOW)).failed).toBe(1);
    setFail(false);
    expect((await fanOutLightningFcm(env, [flash(40.1, -75.3, 0)], zones, NOW + 30_000)).sent).toBe(1);
    expect(sends).toHaveLength(2);
  });

  test("no flashes means no work: the zone list is not even loaded", async () => {
    const { env, sends } = await setup();
    const load = vi.fn(zones);
    expect(await fanOutLightningFcm(env, [], load, NOW)).toEqual({ sent: 0, failed: 0 });
    expect(load).not.toHaveBeenCalled();
    expect(sends).toHaveLength(0);
  });

  test("a no-op without the FCM secret", async () => {
    const { env } = await setup();
    const bare = { STATE: env.STATE } as unknown as Env;
    expect(await fanOutLightningFcm(bare, [flash(40.1, -75.3, 1)], zones, NOW)).toEqual({ sent: 0, failed: 0 });
  });
});
