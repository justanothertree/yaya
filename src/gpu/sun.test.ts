import { describe, expect, it } from 'vitest'
import {
  EMPTY_SAVED,
  HORIZON,
  PLACES,
  apart,
  dateOf,
  dayOf,
  dayOfDate,
  declination,
  fromView,
  points,
  question,
  readSaved,
  shadow,
  sunAt,
  toClock,
  fromClock,
  toView,
  utcHourOf,
  zoneOffset,
  zoneWords,
} from './sun'
import reference from './sun.reference.json'

const JUNE21 = dayOfDate(5, 21)
const DEC21 = dayOfDate(11, 21)
const MAR20 = dayOfDate(2, 20)

describe('where the sun is', () => {
  it('crosses the equator and turns at the moments the almanacs give for 2026', () => {
    // published instants (UTC): equinoxes 20 Mar 14:46 and 23 Sep 00:06, solstices 21 Jun 08:24
    // and 21 Dec 20:50. The formula is good to 0.01°; the 0.015° bound is that plus the minute the
    // instants are rounded to, which is up to 0.0003° of movement at an equinox
    expect(Math.abs(declination(MAR20, 2026, 14 + 46 / 60))).toBeLessThan(0.015)
    expect(Math.abs(declination(dayOfDate(8, 23), 2026, 6 / 60))).toBeLessThan(0.015)
    // at a solstice the declination IS the tilt of the earth's axis: 23.436° in 2026
    expect(declination(JUNE21, 2026, 8.4)).toBeCloseTo(23.436, 2)
    expect(declination(DEC21, 2026, 20 + 50 / 60)).toBeCloseTo(-23.436, 2)
    // and it really is a turning point: a day either side is lower
    expect(declination(JUNE21 - 1, 2026, 8.4)).toBeLessThan(declination(JUNE21, 2026, 8.4))
    expect(declination(JUNE21 + 1, 2026, 8.4)).toBeLessThan(declination(JUNE21, 2026, 8.4))
  })
  it('at noon stands 90° − |latitude − declination| high, everywhere, every day', () => {
    // geometry rather than the formula: at noon the sun is on the meridian
    for (let lat = -80; lat <= 80; lat += 7)
      for (let day = 1; day <= 365; day += 11) {
        const want = 90 - Math.abs(lat - declination(day, 2026, utcHourOf(day, 12)))
        expect(sunAt(lat, day, 12).elevation, `${lat}° on day ${day}`).toBeCloseTo(want, 6)
      }
  })
  it('at noon is due south north of the sun’s latitude, due north south of it', () => {
    expect(sunAt(51.5, JUNE21, 12).azimuth).toBeCloseTo(180, 6)
    expect(sunAt(-33.9, JUNE21, 12).azimuth).toBeCloseTo(0, 6)
    expect(sunAt(10, JUNE21, 12).azimuth).toBeCloseTo(0, 6) // the sun is north of 10°N in June
  })
  it('a morning mirrors its afternoon: east and west, nearly the same height', () => {
    // nearly, because the declination moves in the hours between: up to 0.4° a day in spring, so
    // up to 0.2° over the ten hours compared here. The bound is that movement and nothing more.
    for (const lat of [-40, 0, 25, 60])
      for (const h of [1, 3.5, 5]) {
        const am = sunAt(lat, 100, 12 - h)
        const pm = sunAt(lat, 100, 12 + h)
        const moved = Math.abs(
          declination(100, 2026, utcHourOf(100, 12 + h)) -
            declination(100, 2026, utcHourOf(100, 12 - h)),
        )
        expect(Math.abs(am.elevation - pm.elevation)).toBeLessThanOrEqual(moved + 1e-9)
        expect(Math.abs(am.azimuth + pm.azimuth - 360)).toBeLessThan(1)
        expect(am.azimuth).toBeLessThan(180)
      }
  })
})

describe('day and night', () => {
  it('a London midsummer is 16h38m long and midwinter 7h50m — the almanac’s figures', () => {
    const june = dayOf(51.5, JUNE21)
    const dec = dayOf(51.5, DEC21)
    expect(june.kind === 'normal' && june.length * 60).toBeCloseTo(16 * 60 + 38, -1)
    expect(dec.kind === 'normal' && dec.length * 60).toBeCloseTo(7 * 60 + 50, -1)
  })
  it('the equator has about twelve hours all year', () => {
    for (let day = 1; day <= 365; day += 13) {
      const d = dayOf(0, day)
      expect(d.kind).toBe('normal')
      expect(d.length).toBeGreaterThan(12)
      expect(d.length).toBeLessThan(12.2)
    }
  })
  it('in Tromsø the sun never sets in June and never rises in December', () => {
    expect(dayOf(69.6, JUNE21).kind).toBe('polar-day')
    expect(dayOf(69.6, DEC21).kind).toBe('polar-night')
    expect(dayOf(-69.6, JUNE21).kind).toBe('polar-night')
  })
  it('at sunrise and sunset the sun stands where the almanac says: 0.833° below', () => {
    for (const p of PLACES) {
      const d = dayOf(p.lat, 130, 2026, p.lon)
      if (d.kind !== 'normal') continue
      expect(sunAt(p.lat, 130, d.rise, 2026, p.lon).elevation, p.name).toBeCloseTo(HORIZON, 4)
      expect(sunAt(p.lat, 130, d.set, 2026, p.lon).elevation).toBeCloseTo(HORIZON, 4)
      expect(sunAt(p.lat, 130, d.rise, 2026, p.lon).azimuth).toBeLessThan(180) // east half
    }
  })
  it('a shadow is as long as the stick at 45°, and endless with the sun down', () => {
    expect(shadow(45)).toBeCloseTo(1, 9)
    expect(shadow(30)).toBeCloseTo(Math.sqrt(3), 9)
    expect(shadow(0)).toBe(Infinity)
    expect(shadow(-5)).toBe(Infinity)
  })
})

type Row = {
  place: string
  month: number
  date: number
  rise: number | null
  set: number | null
  riseOff?: number
  setOff?: number
}

describe('on the clock people there read', () => {
  const rows = (reference as { rows: Row[] }).rows
  it('agrees with an independent almanac at every place, through every clock change', () => {
    // ⚠️ THE TOLERANCE IS A BUDGET IN DEGREES, NOT A NUMBER OF MINUTES. The reference puts the
    // horizon about 0.04° higher than the almanac convention used here (its own refraction model:
    // measured, its sun stands at −0.79° at its own sunrise), and each side's declination is good
    // to about 0.01°. How many minutes 0.06° is depends on how fast the sun is climbing: half a
    // minute in Mumbai, five near the end of polar night in Tromsø, where it grazes the horizon.
    // So each event's bound is that budget divided by the sun's rate of climb at that moment, plus
    // a quarter-minute for the equation of time. Under 60° that comes to about a minute; the worst
    // measured there is under half of one.
    let checked = 0
    for (const r of rows) {
      const place = PLACES.find((p) => p.name === r.place)!
      expect(place, r.place).toBeDefined()
      const day = dayOfDate(r.month - 1, r.date)
      const d = dayOf(place.lat, day, 2026, place.lon)
      const tag = `${r.place} ${r.date}/${r.month}`
      if (r.rise === null || r.set === null) {
        expect(d.kind, tag).not.toBe('normal')
        continue
      }
      expect(d.kind, tag).toBe('normal')
      if (d.kind !== 'normal') continue
      for (const k of ['rise', 'set'] as const) {
        const got = toClock(place, 2026, day, d[k])!
        expect(got.offset, `${tag} ${k}: offset`).toBe(r[k === 'rise' ? 'riseOff' : 'setOff'])
        // the sun's rate of climb, degrees a minute: measured from the module's own sky, a minute apart
        const climb = Math.abs(
          sunAt(place.lat, day, d[k] + 1 / 120, 2026, place.lon).elevation -
            sunAt(place.lat, day, d[k] - 1 / 120, 2026, place.lon).elevation,
        )
        const bound = 0.25 + 0.06 / climb
        expect(Math.abs(got.hour - r[k]!) * 60, `${tag} ${k}`).toBeLessThan(bound)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(250)
  })
  it('London at midsummer is 04:43 to 21:21, summer time — the Met Office’s published figures', () => {
    const london = PLACES.find((p) => p.name === 'London')!
    const d = dayOf(london.lat, JUNE21, 2026, london.lon)
    if (d.kind !== 'normal') throw new Error('London has a sunset')
    const rise = toClock(london, 2026, JUNE21, d.rise)!
    const set = toClock(london, 2026, JUNE21, d.set)!
    expect(clockOf(rise.hour)).toBe('04:43')
    // the Met Office's "21:21" is for London unspecified and rounded to the minute; the same evening's
    // published sunsets at the Tower and at Trafalgar Square are 21:21:55 and 21:22:07. This place
    // sits at Trafalgar Square's longitude, so the bound is that published minute and that spread
    const set21 = (21 * 60 + 21.5) / 60
    expect(Math.abs(set.hour - set21) * 60).toBeLessThan(1.2)
    expect(zoneWords(london, 2026, rise.offset)).toBe('UTC+01:00, summer time')
    expect(zoneWords(london, 2026, zoneOffset('Europe/London', Date.UTC(2026, 0, 9))!)).toBe(
      'UTC+00:00',
    )
  })
  it('reads offsets on both sides of zero, half-hours, and none of summer time where there is none', () => {
    const at = Date.UTC(2026, 6, 1)
    expect(zoneOffset('Asia/Kolkata', at)).toBe(5.5)
    expect(zoneOffset('America/New_York', at)).toBe(-4)
    expect(zoneOffset('America/New_York', Date.UTC(2026, 0, 1))).toBe(-5)
    expect(zoneOffset('Atlantic/Reykjavik', at)).toBe(0)
    expect(zoneOffset('Not/AZone', at)).toBeNull()
    const sydney = PLACES.find((p) => p.name === 'Sydney')!
    expect(zoneWords(sydney, 2026, 11)).toBe('UTC+11:00, summer time') // January, down there
    expect(zoneWords(sydney, 2026, 10)).toBe('UTC+10:00')
    const mumbai = PLACES.find((p) => p.name === 'Mumbai')!
    expect(zoneWords(mumbai, 2026, 5.5)).toBe('UTC+05:30')
  })
  it('a clock hour goes to sun time and back, on ordinary days and the days the clocks change', () => {
    for (const p of PLACES)
      for (const day of [15, 88, 89, 172, 298, 299, 305, 355])
        for (const hour of [6, 9.25, 12, 15.5, 20]) {
          const solar = fromClock(p, 2026, day, hour)!
          expect(toClock(p, 2026, day, solar)!.hour, `${p.name} day ${day} ${hour}h`).toBeCloseTo(
            hour,
            6,
          )
        }
  })
})

const clockOf = (h: number) => {
  const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

describe('the game and the page', () => {
  it('measures the angle between two places in the sky', () => {
    expect(apart({ elevation: 30, azimuth: 100 }, { elevation: 30, azimuth: 100 })).toBeCloseTo(
      0,
      6,
    )
    expect(apart({ elevation: 0, azimuth: 0 }, { elevation: 0, azimuth: 180 })).toBeCloseTo(180, 6)
    expect(apart({ elevation: 90, azimuth: 10 }, { elevation: 0, azimuth: 250 })).toBeCloseTo(90, 6)
    expect([0, 22.5, 45, 90].map(points)).toEqual([100, 50, 0, 0])
  })
  it('asks only about a sun that is up, at a place it knows', () => {
    let s = 3
    const rand = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 2 ** 32)
    for (const scale of ['sun', 'clock'] as const)
      for (let n = 0; n < 300; n++) {
        const q = question(rand, scale, 2026)
        expect(sunAt(q.place.lat, q.day, q.solar, 2026, q.place.lon).elevation).toBeGreaterThan(3)
        expect(PLACES).toContain(q.place)
        if (scale === 'sun') expect(q.solar).toBe(q.hour)
        else expect(toClock(q.place, 2026, q.day, q.solar)!.hour).toBeCloseTo(q.hour, 6)
      }
  })
  it('dates and the panorama go there and back', () => {
    for (let d = 1; d <= 365; d++) {
      const [day, mon] = dateOf(d).split(' ')
      expect(
        dayOfDate(
          [
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
          ].indexOf(mon),
          Number(day),
        ),
      ).toBe(d)
    }
    for (const sky of [
      { elevation: 12, azimuth: 95 },
      { elevation: -10, azimuth: 300 },
      { elevation: 80, azimuth: 1 },
    ]) {
      const [x, y] = toView(sky, 800, 400)
      const back = fromView(x, y, 800, 400)
      expect(back.elevation).toBeCloseTo(sky.elevation, 6)
      expect(back.azimuth).toBeCloseTo(sky.azimuth, 6)
    }
  })
  it('keeps where you were, and drops what makes no sense', () => {
    // every field away from its default, so dropping any one of them turns this red
    const s = { place: 'Quito', lat: -0.2, day: 300, best: 412, scale: 'sun' }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(
      readSaved(JSON.stringify({ place: 7, lat: 120, day: 400, best: 9999, scale: 'moon' })),
    ).toEqual(EMPTY_SAVED)
    // a save from before clock time existed opens on the clock
    expect(readSaved(JSON.stringify({ place: 'Lima', lat: -12, day: 9, best: 3 })).scale).toBe(
      'clock',
    )
    expect(readSaved('{')).toEqual(EMPTY_SAVED)
  })
})
