// Normalized shapes shared by the Worker and the client.

export type LonLat = [number, number];
export type Ring = LonLat[];
export interface PolygonGeom {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Place {
  lat: number;
  lon: number;
  name: string;
  state: string | null;
  tz: string;
  office: string | null;
  gridX: number | null;
  gridY: number | null;
  forecastZone: string | null;
  countyZone: string | null;
  fireZone: string | null;
}

export interface AlertParams {
  tornadoDetection?: string;
  tornadoDamageThreat?: string;
  thunderstormDamageThreat?: string;
  flashFloodDamageThreat?: string;
  maxHailSize?: string;
  maxWindGust?: string;
  /** raw NWS storm-motion string: "2024-05-01T18:00:00-00:00...245DEG...35KT...39.9,-75.2" */
  eventMotionDescription?: string;
}

export interface Alert {
  id: string;
  event: string;
  /** issuing office, e.g. "NWS Mount Holly NJ"; used for region filtering */
  senderName?: string;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  urgency: string;
  certainty: string;
  headline: string;
  description: string;
  instruction: string;
  sent: string;
  onset: string | null;
  expires: string | null;
  areaDesc: string;
  zones: string[]; // zone ids, e.g. "TXZ123" or "TXC201"
  geometry: PolygonGeom | null;
  params: AlertParams;
  /** ids of earlier messages this one updates (NWS "references"); used to avoid duplicate pushes */
  references?: string[];
}

export interface Current {
  temp: number;
  feelsLike: number;
  humidity: number;
  dewPoint: number;
  windSpeed: number;
  windGust: number;
  windDir: number;
  pressure: number;
  visibilityMi: number | null;
  uv: number;
  cloud: number;
  code: number;
  isDay: boolean;
  precip: number;
  time: string;
}

export interface HourPoint {
  time: string;
  temp: number;
  feelsLike: number;
  code: number;
  pop: number;
  precip: number;
  wind: number;
  cape: number;
}

export interface DayPoint {
  date: string;
  code: number;
  hi: number;
  lo: number;
  pop: number;
  precip: number;
  snow: number;
  sunrise: string;
  sunset: string;
  uvMax: number;
  windMax: number;
  gustMax: number;
}

export interface Forecast {
  fetchedAt: string;
  current: Current;
  hourly: HourPoint[];
  daily: DayPoint[];
  nowcast: { time: string; precip: number }[]; // 15-minute
  text: { name: string; detailed: string }[]; // NWS forecast periods
}

export type SpcCategory = "NONE" | "TSTM" | "MRGL" | "SLGT" | "ENH" | "MDT" | "HIGH";
export interface Outlook {
  fetchedAt: string;
  days: { day: 1 | 2 | 3; category: SpcCategory; label: string }[];
}

export interface AirQuality {
  fetchedAt?: string;
  aqi: number | null;
  pm25: number | null;
  ozone: number | null;
  pollen: { type: string; value: number }[];
}

export interface RadarFrames {
  host: string;
  frames: { time: number; path: string }[];
}

export interface Announcement {
  id: string;
  text: string;
  level: "info" | "warn";
  created: string;
  /** hidden from displays until this time (scheduled announcements) */
  starts: string | null;
  expires: string | null;
}

export type ThreatLevel = "CALM" | "ELEVATED" | "WARNING" | "EMERGENCY";

export interface ThreatState {
  level: ThreatLevel;
  rank: 0 | 1 | 2 | 3;
  reasons: string[];
  primary: Alert | null;
  active: Alert[];
  expiresAt: string | null;
}
