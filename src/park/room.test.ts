import { describe, expect, it } from 'vitest'
import {
  doorMeans,
  lookFits,
  packLook,
  PARK_LOOK_LIMIT,
  readBoss,
  readScene,
  readSomeone,
} from './room'
import type { Drawing, Stroke } from '../draw/strokes'

/**
 * The door the park's relay comes through.
 *
 * ⚠️ THIS IS THE LEAST TRUSTWORTHY INPUT ON THE SITE. The relay socket is unauthenticated —
 * CLAUDE.md says so outright, and #dev-park grants nothing because "ParkRoom's `authed` is a
 * courtesy rather than a lock". So anything on the internet can send these two functions
 * anything at all, and what comes out of them is drawn on somebody's screen, in a room their
 * family is standing in.
 *
 * ⚠️ AND THE RELAY DOES NOT LOOK INSIDE, ON PURPOSE. room.ts's own header: "a drawing goes
 * through readDrawing — the same door a backup file and a stranger's gallery file come through.
 * The relay does not look inside a drawing on purpose, so this is the only place that check
 * happens." One place, and until now no test of it.
 *
 * ⚠️ THE SHARPEST RULE IS THE LAST ONE. Every field that decides whether something HITS you —
 * the swing, the cast, whether a guard is spent — is set here from a constant and never from
 * the message. A stranger can put a creature in your park; they cannot arrive mid-swing.
 */

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  t: 'brush',
  c: '#4a7c3f',
  a: 1,
  w: 0.03,
  p: [0.3, 0.3, 0.7, 0.7],
  ...over,
})

const art = (over: Partial<Drawing> = {}): Drawing => ({
  v: 1,
  name: 'Clawbert',
  ratio: 1,
  bg: null,
  strokes: [stroke()],
  ...over,
})

/** a message as it comes off the wire */
const wire = (over: Record<string, unknown> = {}) => ({
  from: 'peer-1',
  name: 'Ada',
  art: art(),
  x: 0.5,
  y: 0.5,
  ...over,
})

describe('somebody arriving in the park', () => {
  it('comes through when the message is a real one', () => {
    const who = readSomeone(wire())!
    expect(who.id).toBe('peer-1')
    expect(who.name).toBe('Ada')
    expect(who.art.strokes.length).toBeGreaterThan(0)
    expect(who.at).toEqual({ x: 0.5, y: 0.5 })
  })

  it('and is refused when there is nobody there', () => {
    for (const junk of [null, undefined, 7, 'peer', [], {}]) {
      expect(readSomeone(junk), `${JSON.stringify(junk)} got in`).toBeNull()
    }
    expect(readSomeone(wire({ from: '' })), 'no id').toBeNull()
    expect(readSomeone(wire({ from: '   ' })), 'an id of spaces').toBeNull()
    expect(readSomeone(wire({ from: 42 })), 'an id that is not a string').toBeNull()
  })

  /**
   * ⚠️ A CREATURE IS A DRAWING OR IT IS NOTHING. This is the only place a park drawing is
   * checked, so anything readDrawing will not take must not become somebody standing there.
   */
  it('and refused when the creature is not a drawing', () => {
    expect(readSomeone(wire({ art: undefined })), 'no art').toBeNull()
    expect(readSomeone(wire({ art: 'a picture' })), 'a string').toBeNull()
    expect(readSomeone(wire({ art: { strokes: 'lots' } })), 'nonsense').toBeNull()
    expect(readSomeone(wire({ art: art({ strokes: [] }) })), 'a drawing of nothing').toBeNull()
  })

  it('and a name is trimmed rather than allowed to be a paragraph', () => {
    expect(readSomeone(wire({ name: 'n'.repeat(500) }))!.name.length).toBeLessThanOrEqual(40)
    expect(
      readSomeone(wire({ name: '' }))!.name,
      'and there is always something to call them',
    ).toBe('Someone')
    expect(readSomeone(wire({ name: 12345 }))!.name).toBe('Someone')
  })

  it('and an id is trimmed too, because it is a key', () => {
    expect(readSomeone(wire({ from: 'x'.repeat(200) }))!.id.length).toBeLessThanOrEqual(24)
  })

  /**
   * ⚠️ A POSITION IS 0 TO 1 ACROSS THE WHOLE PARK, and anything else is somebody standing
   * outside the world — off the camera's clamp, outside every wall, unhittable and undrawable.
   */
  it('and nobody can stand outside the park', () => {
    for (const [x, y] of [
      [-5, -5],
      [99, 99],
      [Number.NaN, 0.5],
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    ] as const) {
      const at = readSomeone(wire({ x, y }))!.at
      expect(at.x, `x from ${x}`).toBeGreaterThanOrEqual(0)
      expect(at.x).toBeLessThanOrEqual(1)
      expect(at.y, `y from ${y}`).toBeGreaterThanOrEqual(0)
      expect(at.y).toBeLessThanOrEqual(1)
    }
    const odd = readSomeone(wire({ x: 'over there', y: null }))!.at
    expect(odd).toEqual({ x: 0, y: 0 })
  })

  it('and faces one of two ways, whatever the message says', () => {
    expect(readSomeone(wire({ f: -1 }))!.facing).toBe(-1)
    expect(readSomeone(wire({ f: 1 }))!.facing).toBe(1)
    for (const f of [0, 7, -3, 'left', null, Number.NaN]) {
      expect(readSomeone(wire({ f }))!.facing, `f of ${String(f)}`).toBe(1)
    }
  })

  /**
   * ⚠️ AND THIS IS THE ONE THAT MATTERS. Everything that decides whether something touches you
   * is set here from a constant, never from the message — so a stranger can put a creature in
   * your park, and cannot have it arrive already swinging, already casting, or with your guard
   * already spent. Those states come from their own messages, which are read elsewhere; this
   * door only ever produces somebody standing still.
   */
  it('and cannot arrive mid-swing however the message is dressed up', () => {
    const hostile = readSomeone(
      wire({
        swing: 6,
        swingFor: 99,
        cast: 'wave',
        castFor: 99,
        spent: true,
        castSpent: true,
        down: true,
        hop: 1,
        moving: true,
        aim: { x: -1, y: -1 },
      }),
    )!
    expect(hostile.swing).toBe(0)
    expect(hostile.swingFor).toBe(0)
    expect(hostile.cast).toBeNull()
    expect(hostile.castFor).toBe(0)
    expect(hostile.spent).toBe(false)
    expect(hostile.castSpent).toBe(false)
    expect(hostile.down).toBe(false)
    expect(hostile.hop).toBe(0)
    expect(hostile.moving).toBe(false)
    expect(hostile.aim).toEqual({ x: 1, y: 0 })
  })

  it('and is shown where it says it is, to begin with', () => {
    const who = readSomeone(wire({ x: 0.25, y: 0.75 }))!
    expect(who.shown).toEqual(who.at)
  })
})

describe('a boss arriving in the park', () => {
  it('comes through the same door with the same suspicion', () => {
    expect(readBoss(null)).toBeNull()
    expect(readBoss(wire({ from: '' }))).toBeNull()
    expect(readBoss(wire({ art: 'not a drawing' }))).toBeNull()
    const b = readBoss(wire({ name: 'Grumble' }))!
    expect(b.by).toBe('peer-1')
    expect(b.name).toBe('Grumble')
  })

  it('and has something to be called when nobody said', () => {
    expect(readBoss(wire({ name: '' }))!.name).toBe('A boss')
  })

  /**
   * ⚠️ A BOSS WITH NO HEALTH REPORTED IS A FULL ONE, NOT A BEATEN ONE. Its own note: reading a
   * missing number as zero "would draw it already beaten the moment it arrived" — and a boss
   * that arrives at zero health is one nobody gets to fight, in the room the fight is the point
   * of. An absent field is the COMMON case here: health rides along with the boss's own
   * messages and the first one may not have been sent yet.
   */
  it('and full health is what an unsaid number means', () => {
    expect(readBoss(wire())!.hp, 'nothing said').toBe(1)
    expect(readBoss(wire({ h: undefined }))!.hp).toBe(1)
    expect(readBoss(wire({ h: 'half' }))!.hp, 'not a number').toBe(1)
    expect(readBoss(wire({ h: Number.NaN }))!.hp).toBe(1)
  })

  it('and a health that is said is believed, within reason', () => {
    expect(readBoss(wire({ h: 0.5 }))!.hp).toBe(0.5)
    expect(readBoss(wire({ h: 0 }))!.hp, 'nought is a real answer').toBe(0)
    expect(readBoss(wire({ h: 99 }))!.hp).toBe(1)
    expect(readBoss(wire({ h: -99 }))!.hp).toBe(0)
  })

  it('and cannot arrive mid-swing either', () => {
    const b = readBoss(wire({ swing: 4, cast: 'bloom', castFor: 9, spent: true, turning: true }))!
    expect(b.swing).toBe(0)
    expect(b.cast).toBeNull()
    expect(b.castFor).toBe(0)
    expect(b.spent).toBe(false)
    expect(b.turning).toBe(false)
  })
})

describe('the creature you send to everybody else', () => {
  /**
   * ⚠️ A CREATURE IS SMOOTH, AND THAT IS THE WHOLE REASON THINNING WORKS. simplifyDrawing drops
   * points that sit on the line their neighbours already describe, so a stroke a hand drew —
   * many samples along a curve — loses most of itself and keeps its shape. Noise has no such
   * redundancy and barely moves.
   *
   * The first version of these tests used noise, and reported that a 60-stroke creature could
   * not get into the park. It was measuring the thinner's worst case against a feature built
   * for its ordinary one. Measured, packed, on the same stroke counts:
   *
   *   drawn   120 x 80 : 282,690 -> 11,361   (25x, and it fits)
   *   noise    30 x 60 :  26,231 -> 14,980   (43%, and it does not)
   */
  const drawn = (strokes: number, points: number): Drawing =>
    art({
      strokes: Array.from({ length: strokes }, (_, i) =>
        stroke({
          p: Array.from({ length: points * 2 }, (_, k) => {
            const t = (k >> 1) / points
            return k % 2 === 0 ? 0.2 + 0.6 * t : 0.5 + 0.25 * Math.sin(t * Math.PI + i)
          }),
        }),
      ),
    })

  const noise = (strokes: number, points: number): Drawing =>
    art({
      strokes: Array.from({ length: strokes }, (_, i) =>
        stroke({
          p: Array.from(
            { length: points * 2 },
            (_, k) => +Math.abs(Math.sin(k * 7.13 + i)).toFixed(4),
          ),
        }),
      ),
    })

  /**
   * ⚠️ IT THINNED ONCE AND GAVE UP, which turned a size limit into a refusal to play: "too many
   * strokes to send to everybody in the park. Take a simpler one", about a creature with an
   * eyepatch, a head and a hit. The ladder is what fixed that, and this is the property it
   * bought — anything that can be thinned into the limit is, rather than being turned away.
   */
  it('is thinned as hard as it has to be, rather than refused', () => {
    const elaborate = drawn(120, 80)
    expect(JSON.stringify(elaborate).length, 'the fixture is not elaborate').toBeGreaterThan(
      PARK_LOOK_LIMIT * 20,
    )
    expect(lookFits(elaborate), 'a creature like this should still get in').toBe(true)
    expect(JSON.stringify(packLook(elaborate)).length).toBeLessThanOrEqual(PARK_LOOK_LIMIT)
  })

  it('and no harder than it has to be', () => {
    /* one that already fits travels at the first rung, so nothing anybody made looks different */
    const simple = JSON.stringify(packLook(drawn(6, 20))).length
    const busier = JSON.stringify(packLook(drawn(40, 40))).length
    expect(simple).toBeLessThanOrEqual(PARK_LOOK_LIMIT)
    expect(
      busier,
      'a heavier drawing should keep more of itself, not be flattened to the same size',
    ).toBeGreaterThan(simple)
  })

  /**
   * ⚠️ THE RELAY REFUSES ANYTHING OVER 12,000 CHARACTERS, and this is 11,500 — so the thinning
   * happens here rather than being found out from an error. What must never happen is packLook
   * saying yes to something the relay will drop, because that is a creature that vanishes for
   * everybody else and looks fine to the person who drew it.
   */
  it('and never claims something fits that the relay would refuse', () => {
    for (const d of [art(), drawn(6, 20), drawn(120, 80), noise(30, 60), noise(200, 200)]) {
      if (lookFits(d)) {
        expect(
          JSON.stringify(packLook(d)).length,
          'it said this fits and it does not',
        ).toBeLessThanOrEqual(PARK_LOOK_LIMIT)
      }
    }
  })

  /* ⚠️ and there has to be a no, or the limit is not a limit — noise is what cannot be thinned */
  it('and says no rather than sending something nobody will accept', () => {
    expect(lookFits(noise(200, 200))).toBe(false)
  })

  it('and what it sends still reads back as a creature', () => {
    const packed = packLook(drawn(120, 80))
    const back = readSomeone(wire({ art: packed }))
    expect(back, 'the thinned copy did not survive its own door').not.toBeNull()
    expect(back!.art.strokes.length).toBeGreaterThan(0)
  })
})

/**
 * The host's word on what the room is doing.
 *
 * ⚠️ THE SAME UNTRUSTED DOOR AS THE TWO ABOVE, and with more at stake: a scene decides which
 * WORLD everybody is standing in. The relay socket is unauthenticated, so until the relay drops
 * a scene from a non-owner this is also the shape a guest could send — see the note on
 * ParkState.scene, which says so rather than pretending otherwise.
 */
describe('a scene arriving from the host', () => {
  it('needs an order, or it is not a scene', () => {
    /* ⚠️ `at` is how two scenes are compared. One without it cannot be, so it is refused
       outright rather than accepted as "the newest so far". */
    expect(readScene({ map: 'm1' })).toBeNull()
    expect(readScene({ map: 'm1', at: 'soon' })).toBeNull()
    expect(readScene({ map: 'm1', at: Number.NaN })).toBeNull()
    expect(readScene({ map: 'm1', at: Number.POSITIVE_INFINITY })).toBeNull()
    expect(readScene(null)).toBeNull()
    expect(readScene('scene')).toBeNull()
    expect(readScene({ map: 'm1', at: 3 })).toEqual({ map: 'm1', at: 3 })
  })

  it('treats a missing or junk map as "no map", never as a map', () => {
    /* the shared park is a real answer — it is what null means — so this must not invent one */
    expect(readScene({ at: 1 })?.map).toBeNull()
    expect(readScene({ map: 42, at: 1 })?.map).toBeNull()
    expect(readScene({ map: { id: 'x' }, at: 1 })?.map).toBeNull()
  })

  it('will not carry an unbounded id', () => {
    const long = 'x'.repeat(5000)
    expect(readScene({ map: long, at: 1 })?.map?.length).toBeLessThanOrEqual(64)
  })

  it('keeps a map id intact when it is a real one', () => {
    const id = '8f14e45f-ceea-467a-9575-9a0b53ba3f4e'
    expect(readScene({ map: id, at: 9 })?.map).toBe(id)
  })
})

/**
 * What a door means.
 *
 * ⚠️ THE CLAIM BEING PINNED IS "NOBODY LEAVES THE PARTY BY WALKING", not any particular
 * branch. A door swaps your world, which is the right answer alone and a silent desertion in
 * company — and silent is the whole problem: the guest stands in their own map, everybody else
 * carries on in the room, and no screen anywhere says they have parted. There is no error to
 * notice, so a test is the only thing that can notice.
 *
 * ⚠️ AND IT IS ASKED THROUGH THE ROOM IDS, WHICH SHARE NO ARITHMETIC WITH THE ANSWER. The
 * question "whose room am I in" is two string identities; the answer is one of three words. A
 * test that rebuilt the comparison would be a second copy of it — see CLAUDE.md on measuring
 * through a path that shares nothing with the thing being measured.
 */
describe('walking into a door', () => {
  const ROOM = '7f3a9c1e-0000-4000-8000-0123456789ab'
  const THEIRS = 'b2c4d6e8-0000-4000-8000-ba9876543210'

  it('changes my own world when there is nobody to disagree with', () => {
    expect(doorMeans({ room: null, mine: null })).toBe('swap')
  })

  it('and still does when I host a park I am not standing in', () => {
    /* the normal case for whoever set the park up: my room is open, I am walking a sketch */
    expect(doorMeans({ room: null, mine: ROOM })).toBe('swap')
  })

  it('moves the room when the room is mine', () => {
    expect(doorMeans({ room: ROOM, mine: ROOM })).toBe('host')
  })

  it("asks when the room is somebody else's", () => {
    expect(doorMeans({ room: THEIRS, mine: null })).toBe('ask')
  })

  it('and asks even while my own park is open, because hosting something is not hosting this', () => {
    expect(doorMeans({ room: THEIRS, mine: ROOM })).toBe('ask')
  })

  /**
   * ⚠️ THE ONE THAT MATTERS, SWEPT RATHER THAN SAMPLED. Every other case above names its
   * answer; this names the answer that must never appear, for every shape of being in a room
   * at all. A new branch that reached for 'swap' with a room on it would be a new way to
   * desert the party, and the three examples above would all still pass.
   */
  it('never changes my world alone while I am in a room with anybody', () => {
    for (const mine of [null, ROOM, THEIRS])
      expect(doorMeans({ room: THEIRS, mine })).not.toBe('swap')
    expect(doorMeans({ room: ROOM, mine: ROOM })).not.toBe('swap')
  })
})
