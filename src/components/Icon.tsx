import type { IconKey } from "../../shared/wx";

/** Small original weather glyphs (stroke-based, inherit currentColor). */
export function WxIcon({ icon, size = 64 }: { icon: IconKey; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 64 64", fill: "none", "stroke-width": 3, "stroke-linecap": "round" as const, "stroke-linejoin": "round" as const, "aria-hidden": true };
  const cloud = <path d="M20 44h26a9 9 0 0 0 1-17.9A12 12 0 0 0 24 24a10 10 0 0 0-4 20z" stroke="currentColor" />;
  const sun = (cx: number, cy: number, r: number) => (
    <g stroke="var(--accent)">
      <circle cx={cx} cy={cy} r={r} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const rad = (a * Math.PI) / 180;
        return <line x1={cx + Math.cos(rad) * (r + 5)} y1={cy + Math.sin(rad) * (r + 5)} x2={cx + Math.cos(rad) * (r + 10)} y2={cy + Math.sin(rad) * (r + 10)} />;
      })}
    </g>
  );
  switch (icon) {
    case "sun":
      return <svg {...common}>{sun(32, 32, 10)}</svg>;
    case "moon":
      return <svg {...common}><path d="M42 40A16 16 0 0 1 24 18a16 16 0 1 0 18 22z" stroke="currentColor" /></svg>;
    case "partly":
      return <svg {...common}>{sun(24, 22, 7)}<g transform="translate(4 6)">{cloud}</g></svg>;
    case "cloud":
      return <svg {...common}>{cloud}</svg>;
    case "fog":
      return <svg {...common}><path d="M12 24h40M8 34h40M16 44h40" stroke="currentColor" /></svg>;
    case "drizzle":
      return <svg {...common}><g transform="translate(0 -6)">{cloud}</g><path d="M26 50l-2 4M38 50l-2 4" stroke="var(--info)" /></svg>;
    case "rain":
      return <svg {...common}><g transform="translate(0 -6)">{cloud}</g><path d="M22 50l-3 7M34 50l-3 7M46 50l-3 7" stroke="var(--info)" /></svg>;
    case "snow":
      return <svg {...common}><g transform="translate(0 -6)">{cloud}</g><path d="M24 52h.1M34 56h.1M44 52h.1" stroke="currentColor" stroke-width="5" /></svg>;
    case "sleet":
      return <svg {...common}><g transform="translate(0 -6)">{cloud}</g><path d="M22 50l-3 7M44 52h.1" stroke="var(--info)" /></svg>;
    case "storm":
      return <svg {...common}><g transform="translate(0 -8)">{cloud}</g><path d="M34 40l-8 11h8l-4 9" stroke="var(--warn)" /></svg>;
    default:
      return <svg {...common}><circle cx="32" cy="32" r="14" stroke="currentColor" /><path d="M32 38v.1M28 28a4 4 0 1 1 6 3c-1.5 1-2 2-2 4" stroke="currentColor" /></svg>;
  }
}
