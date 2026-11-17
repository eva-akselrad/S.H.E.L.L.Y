// @vitest-environment happy-dom
// "Play sound on…": audio follows the chosen speaker and falls back to the default when it disappears.
import { beforeAll, expect, test, vi } from "vitest";

let devices: { deviceId: string; kind: string; label: string }[] = [];
const sinks = new Map<HTMLMediaElement, string>();
let ao: typeof import("../src/audioOut");

beforeAll(async () => {
  Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
    configurable: true,
    value(this: HTMLMediaElement, id: string) {
      if (id && !devices.some((d) => d.deviceId === id)) return Promise.reject(new Error("NotFoundError"));
      sinks.set(this, id);
      return Promise.resolve();
    },
  });
  const listeners: (() => void)[] = [];
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: async () => devices,
      getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }),
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      fire: () => listeners.forEach((f) => f()),
    },
  });
  localStorage.clear();
  ao = await import("../src/audioOut");
});

const flush = () => new Promise((r) => setTimeout(r, 0));

test("speakers are hidden until unlocked, then listed", async () => {
  devices = [{ deviceId: "", kind: "audiooutput", label: "" }];
  ao.initAudioOut();
  await flush();
  expect(ao.outputsUnlocked.value).toBe(false);
  devices = [
    { deviceId: "default", kind: "audiooutput", label: "Default" },
    { deviceId: "hp", kind: "audiooutput", label: "Headphones" },
    { deviceId: "roku", kind: "audiooutput", label: "Streaming Stick -M91" },
    { deviceId: "mic", kind: "audioinput", label: "Mic" },
  ];
  await ao.unlockOutputs();
  expect(ao.outputs.value.map((o) => o.id)).toEqual(["hp", "roku"]);
});

test("choosing the Roku moves SHELLY's audio there and remembers it", async () => {
  const music = document.createElement("audio");
  await ao.routeAudio(music);
  expect(sinks.get(music)).toBe("");
  ao.choose("roku");
  await flush();
  expect(sinks.get(music)).toBe("roku");
  expect(localStorage.getItem("shelly.v2.sink")).toBe("roku");
  const voice = document.createElement("audio");
  await ao.routeAudio(voice);
  expect(sinks.get(voice)).toBe("roku");
});

test("Roku disconnects: falls back to the default speaker, then back when it returns", async () => {
  const music = document.createElement("audio");
  await ao.routeAudio(music);
  devices = devices.filter((d) => d.deviceId !== "roku");
  (navigator.mediaDevices as unknown as { fire: () => void }).fire();
  await flush();
  await flush();
  expect(sinks.get(music)).toBe("");
  expect(ao.sinkId.value).toBe("roku"); // the choice is kept for when it reconnects
  devices.push({ deviceId: "roku", kind: "audiooutput", label: "Streaming Stick -M91" });
  (navigator.mediaDevices as unknown as { fire: () => void }).fire();
  await flush();
  await flush();
  expect(sinks.get(music)).toBe("roku");
});
