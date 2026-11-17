/**
 * Time left, in the most readable form: "12:05" under an hour, "5h 02m" under a day,
 * "Until Thu 4 AM" for multi-day warnings (winter storms, floods).
 */
export function countdown(expires: string | null, nowMs: number, tz?: string): string {
  if (!expires) return "";
  const s = Math.max(0, Math.floor((new Date(expires).getTime() - nowMs) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  const d = new Date(expires);
  const day = d.toLocaleDateString("en-US", { weekday: "short", ...(tz ? { timeZone: tz } : {}) });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) }).replace(":00", "");
  return `Until ${day} ${time}`;
}
