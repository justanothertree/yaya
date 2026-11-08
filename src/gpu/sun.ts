/**
 * The Lab's sun path: where the sun is in the sky for any place, day and time of day — and so when
 * it rises and sets, how long the day is, and how long a shadow falls.
 *
 * ⚠️ TIME HERE IS SUN TIME. Noon is when the sun is highest, wherever you are. Clock time adds a
 * time zone, daylight saving and where you sit inside your zone — up to an hour or two either way,
 * and a different answer on each side of a border — none of which moves the sun. Asking only
 * latitude, day and sun time keeps the answer exact for every place on earth, and the page says so.
 *
 * Declination by Spencer's series (within about 0.05° of an almanac), then the plain spherical
 * astronomy of a sun on a circle tilted by it. Sunrise and sunset are when the sun's centre is
 * 0.833° below the horizon — half its width and the light bent by the air — as almanacs count them.
 *
 * Pure, so all of it can be asked a question without a browser.
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** the sun's declination on a day of the year (1–365), in degrees — Spencer 1971 */
export function declination(day: number): number {
  const g = (2 * Math.PI * (day - 1)) / 365
  return (
    DEG *
    (0.006918 -
      0.399912 * Math.cos(g) +
      0.070257 * Math.sin(g) -
      0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) -
      0.002697 * Math.cos(3 * g) +
      0.00148 * Math.sin(3 * g))
  )
}

export type Sky = {
  /** degrees above the horizon (negative below) */
  elevation: number
  /** degrees clockwise from north: 90 east, 180 south */
  azimuth: number
}

/** where the sun is at a latitude, on a day, at an hour of sun time */
export function sunAt(lat: number, day: number, hour: number): Sky {
  const d = declination(day) * RAD
  const p = lat * RAD
  const h = (hour - 12) * 15 * RAD
  const sinEl = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h)
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)))
  // azimuth from north, clockwise; atan2 keeps the quadrant right at every latitude
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(p) - Math.tan(d) * Math.cos(p))
  return { elevation: el * DEG, azimuth: (((az * DEG + 180) % 360) + 360) % 360 }
}

/** how far below the horizon the sun's centre is at the moment it appears or goes */
export const HORIZON = -0.833

export type Day =
  | { kind: 'normal'; rise: number; set: number; length: number }
  | { kind: 'polar-day'; length: 24 }
  | { kind: 'polar-night'; length: 0 }

/** sunrise and sunset in sun time, or the sun never setting, or never rising */
export function dayOf(lat: number, day: number): Day {
  const d = declination(day) * RAD
  const p = lat * RAD
  const c = (Math.sin(HORIZON * RAD) - Math.sin(p) * Math.sin(d)) / (Math.cos(p) * Math.cos(d))
  if (c <= -1) return { kind: 'polar-day', length: 24 }
  if (c >= 1) return { kind: 'polar-night', length: 0 }
  const h0 = (Math.acos(c) * DEG) / 15
  return { kind: 'normal', rise: 12 - h0, set: 12 + h0, length: 2 * h0 }
}

/** how long a shadow a stick of height 1 throws; Infinity when the sun is down */
export const shadow = (elevation: number) =>
  elevation <= 0 ? Infinity : 1 / Math.tan(elevation * RAD)

/** the angle between two places in the sky — what the game scores */
export function apart(a: Sky, b: Sky): number {
  const p1 = a.elevation * RAD
  const p2 = b.elevation * RAD
  const dl = (a.azimuth - b.azimuth) * RAD
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl)
  return Math.acos(Math.max(-1, Math.min(1, c))) * DEG
}

/* ------------------------------------------------------------------------------- places */

export type Place = { name: string; lat: number }
/** a spread of latitudes worth comparing, north to south */
export const PLACES: Place[] = [
  { name: 'Longyearbyen', lat: 78.2 },
  { name: 'Tromsø', lat: 69.6 },
  { name: 'Reykjavík', lat: 64.1 },
  { name: 'Edinburgh', lat: 55.95 },
  { name: 'London', lat: 51.5 },
  { name: 'New York', lat: 40.7 },
  { name: 'Lisbon', lat: 38.7 },
  { name: 'Cairo', lat: 30.0 },
  { name: 'Mumbai', lat: 19.1 },
  { name: 'Singapore', lat: 1.35 },
  { name: 'Quito', lat: -0.2 },
  { name: 'Lima', lat: -12.0 },
  { name: 'Sydney', lat: -33.9 },
  { name: 'Cape Town', lat: -33.9 },
  { name: 'Ushuaia', lat: -54.8 },
]

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
/** day of the year (1–365) as "21 Jun" */
export function dateOf(day: number): string {
  let d = Math.max(1, Math.min(365, Math.round(day)))
  for (let m = 0; m < 12; m++) {
    if (d <= MONTH_DAYS[m]) return `${d} ${MONTHS[m]}`
    d -= MONTH_DAYS[m]
  }
  return '31 Dec'
}
export const dayOfDate = (month: number, date: number) =>
  MONTH_DAYS.slice(0, month).reduce((a, b) => a + b, 0) + date

/** an hour as "06:42" */
export function clock(hour: number): string {
  const m = Math.round((((hour % 24) + 24) % 24) * 60) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** a compass word for an azimuth */
export function compass(az: number): string {
  const names = [
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
  ]
  return names[Math.round(az / 45) % 8]
}

/* --------------------------------------------------------------------------- the game */

export type Question = { place: Place; day: number; hour: number }

/** a round: a place, a day and a daylight hour — the sun up, so there is something to find */
export function question(rand: () => number): Question {
  for (;;) {
    const place = PLACES[Math.floor(rand() * PLACES.length)]
    const day = 1 + Math.floor(rand() * 365)
    const hour = 5 + Math.round(rand() * 28) / 2 // 05:00 to 19:00, on the half hour
    if (sunAt(place.lat, day, hour).elevation > 3) return { place, day, hour }
  }
}

/** points for a guess: 100 when exact, nothing beyond 45° off */
export const points = (degrees: number) => Math.max(0, Math.round(100 * (1 - degrees / 45)))
export const ROUNDS = 5

/* ---------------------------------------------------------------------------- the view */

/** the panorama: azimuth across (north at both edges, south in the middle), elevation up from a
 *  horizon two-thirds of the way down, below it the ground */
export const VIEW = { up: 90, down: -25 }
export function toView(sky: Sky, w: number, h: number): [number, number] {
  const x = (sky.azimuth / 360) * w
  const horizon = h * (VIEW.up / (VIEW.up - VIEW.down))
  const y = horizon - (sky.elevation / (VIEW.up - VIEW.down)) * h
  return [x, y]
}
export function fromView(x: number, y: number, w: number, h: number): Sky {
  const horizon = h * (VIEW.up / (VIEW.up - VIEW.down))
  return {
    azimuth: ((((x / w) * 360) % 360) + 360) % 360,
    elevation: Math.max(VIEW.down, Math.min(VIEW.up, ((horizon - y) / h) * (VIEW.up - VIEW.down))),
  }
}

/** the day's path, as points every ten minutes — what the panorama draws as an arc */
export function path(lat: number, day: number, steps = 144): Sky[] {
  return Array.from({ length: steps + 1 }, (_, i) => sunAt(lat, day, (24 * i) / steps))
}

/* ---------------------------------------------------------------------------- what is kept */

export const SUN_KEY = 'lab_sun_v1'
export type Saved = { place: string; lat: number; day: number; best: number }
export const EMPTY_SAVED: Saved = { place: 'London', lat: 51.5, day: 172, best: 0 }
export function readSaved(text: string | null): Saved {
  const out = { ...EMPTY_SAVED }
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  if (typeof o.place === 'string' && o.place.length <= 40) out.place = o.place
  if (Number.isFinite(o.lat) && Math.abs(o.lat as number) <= 90) out.lat = o.lat as number
  if (Number.isInteger(o.day) && (o.day as number) >= 1 && (o.day as number) <= 365)
    out.day = o.day as number
  if (Number.isInteger(o.best) && (o.best as number) >= 0 && (o.best as number) <= 100 * ROUNDS) out.best = o.best as number // prettier-ignore
  return out
}
