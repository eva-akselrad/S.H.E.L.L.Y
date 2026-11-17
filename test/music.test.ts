// @vitest-environment happy-dom
// Music must respect a pause from outside the app and stop when the page is hidden (phones/desktops).
import { beforeAll, beforeEach, expect, test, vi } from "vitest";

class FakeAudio extends EventTarget {
  static last: FakeAudio | null = null;
  paused = true;
  ended = false;
  volume = 1;
  src = "";
  plays = 0;
  constructor() {
    super();
    FakeAudio.last = this;
  }
  play(): Promise<void> {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}

let hidden = false;
let music: typeof import("../src/music");

beforeAll(async () => {
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ tracks: [{ title: "Song", file: "Song.mp3" }] })));
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  localStorage.clear();
  music = await import("../src/music");
  await music.startMusic();
});

beforeEach(() => {
  hidden = false;
  vi.useRealTimers();
});

const audio = () => FakeAudio.last!;
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("plays when on", () => {
  music.refreshMusic();
  expect(audio().paused).toBe(false);
});

test("a pause from the lock screen sticks: the app does not restart it", async () => {
  music.refreshMusic();
  expect(audio().paused).toBe(false);
  await later(1100); // past the window where pauses are treated as SHELLY's own
  audio().pause(); // what the OS / headphones do
  expect(music.musicOn.value).toBe(false);
  const before = audio().plays;
  for (let i = 0; i < 5; i++) music.applyThreatToMusic("CALM"); // the once-a-second re-check
  expect(audio().paused).toBe(true);
  expect(audio().plays).toBe(before);
  expect(localStorage.getItem("shelly.v2.music")).toBe("0");
});

test("leaving the app pauses on a phone, without turning the setting off", () => {
  music.toggleMusic(); // back on
  expect(music.musicOn.value).toBe(true);
  expect(audio().paused).toBe(false);
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(audio().paused).toBe(true);
  expect(music.musicOn.value).toBe(true);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(audio().paused).toBe(false);
});

test("a TV keeps playing in the background", () => {
  music.setBackgroundPlay(true);
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(audio().paused).toBe(false);
  music.setBackgroundPlay(false);
  expect(audio().paused).toBe(true);
});
