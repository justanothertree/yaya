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
  toView,
} from './sun'

const JUNE21 = dayOfDate(5, 21)
const DEC21 = dayOfDate(11, 21)
const MAR20 = dayOfDate(2, 20)
const SEP22 = dayOfDate(8, 22)

describe('where the sun is', () => {
  it('reaches the tropics at the solstices and the equator at the equinoxes', () => {
    expect(declination(JUNE21)).toBeCloseTo(23.44, 0)
    expect(declination(DEC21)).toBeCloseTo(-23.44, 0)
    // near the equinoxes the declination moves 0.4° a day, and the equinox falls on the 20th or
    // 21st of March and the 22nd or 23rd of September: within a day's movement of zero
    expect(Math.abs(declination(MAR20))).toBeLessThan(0.8)
    expect(Math.abs(declination(SEP22))).toBeLessThan(0.8)
  })
  it('at noon stands 90° − |latitude − declination| high, everywhere, every day', () => {
    // geometry rather than the formula: at noon the sun is on the meridian
    for (let lat = -80; lat <= 80; lat += 7)
      for (let day = 1; day <= 365; day += 11) {
        const want = 90 - Math.abs(lat - declination(day))
        expect(sunAt(lat, day, 12).elevation, `${lat}° on day ${day}`).toBeCloseTo(want, 6)
      }
  })
  it('at noon is due south north of the sun’s latitude, due north south of it', () => {
    expect(sunAt(51.5, JUNE21, 12).azimuth).toBeCloseTo(180, 6)
    expect(sunAt(-33.9, JUNE21, 12).azimuth).toBeCloseTo(0, 6)
    expect(sunAt(10, JUNE21, 12).azimuth).toBeCloseTo(0, 6) // the sun is north of 10°N in June
  })
  it('a morning mirrors its afternoon: east and west, the same height', () => {
    for (const lat of [-40, 0, 25, 60])
      for (const h of [1, 3.5, 5]) {
        const am = sunAt(lat, 100, 12 - h)
        const pm = sunAt(lat, 100, 12 + h)
        expect(am.elevation).toBeCloseTo(pm.elevation, 9)
        expect(am.azimuth + pm.azimuth).toBeCloseTo(360, 6)
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
      const d = dayOf(p.lat, 130)
      if (d.kind !== 'normal') continue
      expect(sunAt(p.lat, 130, d.rise).elevation, p.name).toBeCloseTo(HORIZON, 6)
      expect(sunAt(p.lat, 130, d.set).elevation).toBeCloseTo(HORIZON, 6)
      expect(sunAt(p.lat, 130, d.rise).azimuth).toBeLessThan(180) // rising in the east half
    }
  })
  it('a shadow is as long as the stick at 45°, and endless with the sun down', () => {
    expect(shadow(45)).toBeCloseTo(1, 9)
    expect(shadow(30)).toBeCloseTo(Math.sqrt(3), 9)
    expect(shadow(0)).toBe(Infinity)
    expect(shadow(-5)).toBe(Infinity)
  })
})

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
    for (let n = 0; n < 500; n++) {
      const q = question(rand)
      expect(sunAt(q.place.lat, q.day, q.hour).elevation).toBeGreaterThan(3)
      expect(PLACES).toContain(q.place)
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
    const s = { place: 'Quito', lat: -0.2, day: 300, best: 412 }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved(JSON.stringify({ place: 7, lat: 120, day: 400, best: 9999 }))).toEqual(
      EMPTY_SAVED,
    )
    expect(readSaved('{')).toEqual(EMPTY_SAVED)
  })
})
