/**
 * The Lab's sun path: where the sun is in the sky for any place, day and time of day — and so when
 * it rises and sets, how long the day is, and how long a shadow falls.
 *
 * ⚠️ TWO CLOCKS, AND THE PAGE ALWAYS SAYS WHICH. The astronomy runs on SUN TIME — noon is when the
 * sun is highest — because that is all the sky knows. A named place also has a longitude and an
 * IANA time zone, so its times can be told on the CLOCK people there actually read: the equation of
 * time, where the place sits inside its zone, and the zone's offset on that date, daylight saving
 * included. The offset comes from the browser's own `Intl` time-zone data, so no table of rules
 * lives here to go stale, and a zone whose rules change is right as soon as the browser is. A
 * latitude picked by hand has no longitude or zone, so it is sun time only, and labelled so.
 * (Evan, 8 Nov: clock time by default, sun time kept as the teaching mode.)
 *
 * The sun's place comes from the Astronomical Almanac's low-precision formulae (good to 0.01° in
 * declination and 0.1 minute in the equation of time from 1950 to 2050), for the actual year and
 * the actual instant. ⚠️ This was Spencer's 1971 series once, quoted as "within about 0.05° of an
 * almanac" — true of the mean year it was fitted to and not of 2026, where it ran up to 0.25° late.
 * That is invisible in London and ten minutes of sunset in Longyearbyen, and the declination moves
 * 0.4° a day at an equinox, so it is asked at the moment of each event, not once a day. Sunrise and
 * sunset are when the sun's centre is 0.833° below the horizon — half its width and the light bent
 * by the air — as almanacs count them.
 *
 * Pure, so all of it can be asked a question without a browser.
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
/** the year the pure functions assume when not told; the page passes the current one */
export const YEAR = 2026

/** the sun's declination (degrees) and the equation of time (minutes: how far sun time runs ahead
 *  of a clock keeping even hours at the same longitude), at an instant — Astronomical Almanac, C5 */
function sunPlace(ms: number): { dec: number; eot: number } {
  const n = ms / 86_400_000 + 2440587.5 - 2451545.0
  const L = 280.46 + 0.9856474 * n
  const g = (357.528 + 0.9856003 * n) * RAD
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const eps = (23.439 - 0.0000004 * n) * RAD
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * DEG
  const lead = ((((L - ra) % 360) + 540) % 360) - 180
  return { dec: Math.asin(Math.sin(eps) * Math.sin(lambda)) * DEG, eot: 4 * lead }
}

/** the sun's declination in degrees, on a day of the year (1–365) at an hour of UTC */
export const declination = (day: number, year = YEAR, utcHour = 12) =>
  sunPlace(dateUtc(year, day) + utcHour * 3_600_000).dec
/** the equation of time in minutes, on a day of the year at an hour of UTC */
export const equationOfTime = (day: number, year = YEAR, utcHour = 12) =>
  sunPlace(dateUtc(year, day) + utcHour * 3_600_000).eot

/** the hour of UTC that an hour of sun time falls on, at a longitude (degrees east) */
export function utcHourOf(day: number, solar: number, year = YEAR, lon = 0): number {
  const guess = solar - lon / 15
  return guess - equationOfTime(day, year, guess) / 60
}

export type Sky = {
  /** degrees above the horizon (negative below) */
  elevation: number
  /** degrees clockwise from north: 90 east, 180 south */
  azimuth: number
}

/** where the sun is at a latitude, on a day, at an hour of sun time. The year and longitude only
 *  pick the instant the declination is read at — the hour itself is already the sun's. */
export function sunAt(lat: number, day: number, hour: number, year = YEAR, lon = 0): Sky {
  const d = declination(day, year, utcHourOf(day, hour, year, lon)) * RAD
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

/** sunrise and sunset in sun time, or the sun never setting, or never rising. Each event is found
 *  with the declination at its own moment, settled in a few rounds. */
export function dayOf(lat: number, day: number, year = YEAR, lon = 0): Day {
  const p = lat * RAD
  const half = (at: number): number | 'day' | 'night' => {
    const d = declination(day, year, utcHourOf(day, at, year, lon)) * RAD
    const c = (Math.sin(HORIZON * RAD) - Math.sin(p) * Math.sin(d)) / (Math.cos(p) * Math.cos(d))
    if (c <= -1) return 'day'
    if (c >= 1) return 'night'
    return (Math.acos(c) * DEG) / 15
  }
  let rise = 6
  let set = 18
  for (let i = 0; i < 4; i++) {
    const r = half(rise)
    const s = half(set)
    if (typeof r !== 'number' || typeof s !== 'number') {
      const at = typeof r !== 'number' ? r : s
      return at === 'day' ? { kind: 'polar-day', length: 24 } : { kind: 'polar-night', length: 0 }
    }
    rise = 12 - r
    set = 12 + s
  }
  return { kind: 'normal', rise, set, length: set - rise }
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

/** lon in degrees east; tz an IANA zone name, which is what the clock there follows */
export type Place = { name: string; lat: number; lon: number; tz: string }
/** a spread of latitudes worth comparing, north to south */
export const PLACES: Place[] = [
  { name: 'Longyearbyen', lat: 78.2, lon: 15.65, tz: 'Arctic/Longyearbyen' },
  { name: 'Tromsø', lat: 69.6, lon: 18.96, tz: 'Europe/Oslo' },
  { name: 'Reykjavík', lat: 64.1, lon: -21.94, tz: 'Atlantic/Reykjavik' },
  { name: 'Edinburgh', lat: 55.95, lon: -3.19, tz: 'Europe/London' },
  { name: 'London', lat: 51.5, lon: -0.13, tz: 'Europe/London' },
  { name: 'New York', lat: 40.7, lon: -74.01, tz: 'America/New_York' },
  { name: 'Lisbon', lat: 38.7, lon: -9.14, tz: 'Europe/Lisbon' },
  { name: 'Cairo', lat: 30.0, lon: 31.24, tz: 'Africa/Cairo' },
  { name: 'Mumbai', lat: 19.1, lon: 72.88, tz: 'Asia/Kolkata' },
  { name: 'Singapore', lat: 1.35, lon: 103.82, tz: 'Asia/Singapore' },
  { name: 'Quito', lat: -0.2, lon: -78.47, tz: 'America/Guayaquil' },
  { name: 'Lima', lat: -12.0, lon: -77.04, tz: 'America/Lima' },
  { name: 'Sydney', lat: -33.9, lon: 151.21, tz: 'Australia/Sydney' },
  { name: 'Cape Town', lat: -33.9, lon: 18.42, tz: 'Africa/Johannesburg' },
  { name: 'Ushuaia', lat: -54.8, lon: -68.3, tz: 'America/Argentina/Ushuaia' },
]

/* --------------------------------------------------------------------------- clock time */

const zones = new Map<string, Intl.DateTimeFormat | null>()
/** a zone's offset from UTC at an instant, in hours, from the browser's own time-zone data — or
 *  null when this browser cannot say (an unknown zone, or no `longOffset` support) */
export function zoneOffset(tz: string, ms: number): number | null {
  let f = zones.get(tz)
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    } catch {
      f = null
    }
    zones.set(tz, f)
  }
  if (!f) return null
  const v = f.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? ''
  // "GMT" alone for UTC itself, otherwise "GMT+05:30" / "GMT-03:00"
  const m = /^GMT(?:([+-])(\d{1,2}):?(\d{2})?)?$/.exec(v)
  if (!m) return null
  if (!m[1]) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] ?? 0) / 60)
}

/** midnight UTC at the start of a day of the year (the 365-day calendar this page uses) */
export function dateUtc(year: number, day: number): number {
  const [d, mon] = dateOf(day).split(' ')
  return Date.UTC(year, MONTHS.indexOf(mon), Number(d))
}

export type ClockTime = { hour: number; offset: number }
/** a sun-time hour told on the place's clock. The offset is taken AT that instant, so a sunrise on
 *  the day the clocks change reads by the rule in force when it happens. `hour` is not wrapped: 24.1
 *  is six minutes past midnight the next day, which a sunset in Reykjavík in June needs. Null when
 *  the zone cannot be read here. */
export function toClock(place: Place, year: number, day: number, solar: number): ClockTime | null {
  const utc = utcHourOf(day, solar, year, place.lon)
  const offset = zoneOffset(place.tz, dateUtc(year, day) + utc * 3_600_000)
  if (offset === null) return null
  return { hour: utc + offset, offset }
}

/** a clock hour at a place, back to sun time — the inverse of `toClock`, found by asking `toClock`
 *  itself and correcting by the difference until it agrees (the offset and the equation of time both
 *  depend on the instant being solved for, so there is no closed form that is also exact) */
export function fromClock(place: Place, year: number, day: number, hour: number): number | null {
  let solar =
    hour + place.lon / 15 - (zoneOffset(place.tz, dateUtc(year, day) + 12 * 3_600_000) ?? 0)
  for (let i = 0; i < 6; i++) {
    const back = toClock(place, year, day, solar)
    if (!back) return null
    const miss = hour - back.hour
    solar += miss
    if (Math.abs(miss) < 1e-9) break
  }
  return solar
}

/** "UTC+01:00", and whether that is the zone's summer time (more than its smaller offset that year) */
export function zoneWords(place: Place, year: number, offset: number): string {
  const h = Math.abs(offset)
  const text = `UTC${offset < 0 ? '−' : '+'}${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`
  const jan = zoneOffset(place.tz, Date.UTC(year, 0, 1))
  const jul = zoneOffset(place.tz, Date.UTC(year, 6, 1))
  const summer = jan !== null && jul !== null && jan !== jul && offset > Math.min(jan, jul)
  return summer ? `${text}, summer time` : text
}

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

export type Scale = 'clock' | 'sun'
/** `hour` is in the scale the round is asked in; `solar` is the same moment in sun time */
export type Question = { place: Place; day: number; hour: number; solar: number; scale: Scale }

/** a round: a place, a day and a daylight hour — the sun up, so there is something to find. Asked
 *  on the local clock, or in sun time; a place whose zone this browser cannot read is skipped. */
export function question(rand: () => number, scale: Scale = 'sun', year = YEAR): Question {
  for (;;) {
    const place = PLACES[Math.floor(rand() * PLACES.length)]
    const day = 1 + Math.floor(rand() * 365)
    const hour = 5 + Math.round(rand() * 28) / 2 // 05:00 to 19:00, on the half hour
    const solar = scale === 'clock' ? fromClock(place, year, day, hour) : hour
    if (solar !== null && sunAt(place.lat, day, solar, year, place.lon).elevation > 3)
      return { place, day, hour, solar, scale }
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
export function path(lat: number, day: number, year = YEAR, lon = 0, steps = 144): Sky[] {
  return Array.from({ length: steps + 1 }, (_, i) => sunAt(lat, day, (24 * i) / steps, year, lon))
}

/* ---------------------------------------------------------------------------- what is kept */

export const SUN_KEY = 'lab_sun_v1'
export type Saved = { place: string; lat: number; day: number; best: number; scale: Scale }
export const EMPTY_SAVED: Saved = { place: 'London', lat: 51.5, day: 172, best: 0, scale: 'clock' }
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
  if (o.scale === 'clock' || o.scale === 'sun') out.scale = o.scale
  return out
}
