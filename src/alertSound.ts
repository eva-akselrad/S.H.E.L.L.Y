// The notification sound that plays before a spoken warning. Synthesized here (no audio files, no licences).
// Deliberately NOT the Emergency Alert System attention tone: that sound is reserved for the real EAS.
import { routeAudio, unrouteAudio } from "./audioOut";

export type ChimeKind = "warning" | "emergency";

const SR = 44100;
const urls: Partial<Record<ChimeKind, string>> = {};

/** a soft bell: a sine with a quiet octave overtone, a quick attack and an exponential decay */
function bell(out: Float32Array, at: number, freq: number, secs: number, gain: number): void {
  const start = Math.floor(at * SR);
  const n = Math.floor(secs * SR);
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.006) * Math.exp(-t / (secs / 4.5));
    out[start + i] += gain * env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2 * t));
  }
}

function build(kind: ChimeKind): Float32Array {
  const warn = kind === "warning";
  const out = new Float32Array(Math.floor((warn ? 1.7 : 2.4) * SR));
  // warning: a rising three-note chime, twice. emergency: a lower, faster four-note figure, three times.
  const notes = warn ? [659.25, 783.99, 987.77] : [523.25, 698.46, 523.25, 698.46];
  const reps = warn ? 2 : 3;
  const step = warn ? 0.17 : 0.13;
  const cycle = warn ? 0.85 : 0.78;
  for (let r = 0; r < reps; r++) notes.forEach((f, k) => bell(out, r * cycle + k * step, f, warn ? 0.7 : 0.55, warn ? 0.28 : 0.3));
  return out;
}

function wav(samples: Float32Array): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
  return new Blob([buf], { type: "audio/wav" });
}

/** Play the chime on the chosen speaker. Resolves when it ends; never throws (a blocked or failed chime just returns). */
export async function playAlertChime(kind: ChimeKind): Promise<void> {
  if (typeof Audio === "undefined") return;
  try {
    urls[kind] ??= URL.createObjectURL(wav(build(kind)));
    const audio = new Audio(urls[kind]);
    await routeAudio(audio); // same speaker as the music and voice
    await new Promise<void>((resolve) => {
      const done = (): void => {
        unrouteAudio(audio);
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      setTimeout(done, 4000); // never hold up the spoken warning
      audio.play().catch(done);
    });
  } catch {
    /* sound is a bonus; the warning itself is on screen */
  }
}
