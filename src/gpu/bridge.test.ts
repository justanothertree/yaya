import { describe, expect, it } from 'vitest'
import {
  GRAVITY,
  LEVELS,
  MATERIALS,
  MAX_LENGTH,
  REFERENCE,
  addMember,
  canJoint,
  cost,
  flatRoad,
  jointAt,
  readDesign,
  readSaved,
  reference,
  removeMember,
  simulate,
  start,
  step,
  testDrive,
  type Level,
} from './bridge'

const tiny: Level = {
  name: 'tiny',
  hint: '',
  span: 4,
  anchors: [
    [0, 0],
    [4, 0],
  ],
  budget: 10000,
  cart: 0,
  kinds: ['road', 'wood', 'steel'],
  water: 5,
}

describe('the forces are newtons', () => {
  it('a hanging V carries what statics says it must', () => {
    // two timbers from the anchors down to one joint 2 m below the middle, a known weight hung there:
    // each carries W / (2 sin θ) in tension, θ the angle from the horizontal
    const l: Level = { ...tiny, cart: 0 }
    const d = start(l)
    const mid = jointAt(l, d, 2, -2, true)
    addMember(l, d, 0, mid, 'steel')
    addMember(l, d, 1, mid, 'steel')
    const s = simulate(l, d)
    s.cart.x = -100 // the cart stays off the bridge: only the members' own weight and the joint
    for (let i = 0; i < 240; i++) step(s)
    // what hangs at the middle: the joint, and half of each member
    const each = Math.hypot(2, 2)
    const hung = 5 + each * MATERIALS.steel.kgPerM
    const sin = 2 / each
    const want = (hung * GRAVITY) / (2 * sin)
    // the members' own weight also loads their other ends, at the anchors — which carry it
    // themselves — so the tension at the middle is the hung weight's share, within a few percent
    for (const f of s.force) expect(f / want).toBeGreaterThan(0.95)
    for (const f of s.force) expect(f / want).toBeLessThan(1.05)
  })

  it('a member asked for more than its strength breaks, and one asked for less does not', () => {
    const l: Level = { ...tiny }
    const d = start(l)
    const mid = jointAt(l, d, 2, -2, true)
    addMember(l, d, 0, mid, 'wood')
    addMember(l, d, 1, mid, 'wood')
    const s = simulate(l, d)
    s.cart.x = -100
    for (let i = 0; i < 120; i++) step(s)
    expect(s.broken).toEqual([false, false])
    // hang something heavy enough: W/(2 sin 45°) beyond 9 kN needs W > 12.7 kN, about 1.3 t
    s.w[2] = 1 / 1400
    for (let i = 0; i < 120; i++) step(s)
    expect(s.broken.some(Boolean)).toBe(true)
  })
})

describe('every level', () => {
  it('a known bridge crosses it within the budget, with nothing broken', () => {
    expect(REFERENCE.length).toBe(LEVELS.length)
    LEVELS.forEach((l, k) => {
      const d = reference(k)
      expect(cost(d), l.name).toBeLessThanOrEqual(l.budget)
      const r = testDrive(l, d)
      expect(r.outcome, l.name).toBe('across')
      expect(r.broken, l.name).toBe(0)
      expect(r.worst, l.name).toBeLessThan(1)
    })
  })

  it('a flat road alone is not a bridge on any of them: it snaps', () => {
    LEVELS.forEach((l) => {
      const r = testDrive(l, flatRoad(l))
      expect(r.outcome, l.name).toBe('fell')
      expect(r.broken, l.name).toBeGreaterThan(0)
    })
  })

  it('the same bridge drives the same way every time', () => {
    const a = testDrive(LEVELS[1], reference(1))
    const b = testDrive(LEVELS[1], reference(1))
    expect(b.worst).toBe(a.worst)
    expect(b.sim.t).toBe(a.sim.t)
  })
})

describe('building', () => {
  it('puts joints only on the grid, over the gap or on the cliff tops, never in the rock', () => {
    const l = LEVELS[1]
    expect(canJoint(l, 3, -2)).toBe(true)
    expect(canJoint(l, 3.5, 0)).toBe(false)
    expect(canJoint(l, -1, -1)).toBe(false) // inside the left cliff
    expect(canJoint(l, -1, 0)).toBe(true) // on top of it
    expect(canJoint(l, 0, -3)).toBe(true) // an anchor on the cliff face
    expect(canJoint(l, 0, -2)).toBe(false) // the cliff face where there is none
    expect(canJoint(l, 5, -l.water)).toBe(false) // in the water
    const d = start(l)
    const j = jointAt(l, d, -1, 0, true)
    expect(d.joints[j].fixed).toBe(true) // on the ground: fixed
    expect(d.joints[jointAt(l, d, 4, 1, true)].fixed).toBe(false)
  })

  it('refuses a member too long, doubled, of a kind the level lacks, or to itself', () => {
    const l = LEVELS[0] // road and timber only
    const d = start(l)
    const a = jointAt(l, d, 1, 0, true)
    const b = jointAt(l, d, 6, 0, true) // the far cliff's anchor, 5 m away
    const c = jointAt(l, d, 4, 0, true)
    expect(addMember(l, d, a, b, 'road')).toBe('long')
    expect(Math.hypot(4, 0)).toBeLessThanOrEqual(MAX_LENGTH)
    expect(addMember(l, d, a, a, 'road')).toBe('same')
    expect(addMember(l, d, a, c, 'steel')).toBe('kind')
    expect(addMember(l, d, a, c, 'road')).toBe(null)
    expect(addMember(l, d, c, a, 'wood')).toBe('exists')
  })

  it('taking a member away takes the joints it leaves loose, and keeps the anchors', () => {
    const l = LEVELS[0]
    const d = start(l)
    const a = jointAt(l, d, 2, -1, true)
    const b = jointAt(l, d, 3, -1, true)
    addMember(l, d, 0, a, 'wood')
    addMember(l, d, a, b, 'wood')
    removeMember(d, 1)
    expect(d.joints.length).toBe(l.anchors.length + 1) // b went, a stays: still attached
    removeMember(d, 0)
    expect(d.joints.length).toBe(l.anchors.length)
    expect(d.members.length).toBe(0)
  })

  it('costs each member by its length and material', () => {
    const l = LEVELS[4]
    const d = start(l)
    const j = jointAt(l, d, 3, 4, false) // nowhere yet
    expect(j).toBe(-1)
    const a = jointAt(l, d, 3, 0, true)
    const b = jointAt(l, d, 3, 4, true)
    addMember(l, d, a, b, 'steel')
    expect(cost(d)).toBe(4 * MATERIALS.steel.costPerM)
  })
})

describe('kept in this browser', () => {
  it('round-trips every level’s design and best, with every field set', () => {
    const designs = Object.fromEntries(LEVELS.map((l, k) => [l.name, reference(k)]))
    const best = Object.fromEntries(LEVELS.map((l, k) => [l.name, cost(reference(k))]))
    const back = readSaved(JSON.stringify({ level: 5, designs, best }))
    expect(back.level).toBe(5)
    expect(back.best).toEqual(best)
    LEVELS.forEach((l) => expect(back.designs[l.name]).toEqual(designs[l.name]))
  })

  it('refuses a design that moves an anchor, puts a joint in rock, or breaks a rule', () => {
    const l = LEVELS[1]
    const good = reference(1)
    expect(readDesign(l, good)).toEqual(good)
    const moved = structuredClone(good)
    moved.joints[0].x = 1
    expect(readDesign(l, moved)).toBeNull()
    const rock = structuredClone(good)
    rock.joints.push({ x: -1, y: -2, fixed: false })
    expect(readDesign(l, rock)).toBeNull()
    const long = structuredClone(good)
    long.members.push({ a: 0, b: 1, kind: 'road' }) // ten metres in one
    expect(readDesign(l, long)).toBeNull()
    const steel = structuredClone(good)
    steel.members[0].kind = 'steel' // this level has none
    expect(readDesign(l, steel)).toBeNull()
    const outside = structuredClone(good)
    outside.members.push({ a: 0, b: 999, kind: 'wood' })
    expect(readDesign(l, outside)).toBeNull()
    expect(readSaved('junk')).toEqual({ level: 0, designs: {}, best: {} })
    // a best over the budget is not one this game could have given
    expect(readSaved(JSON.stringify({ best: { [l.name]: l.budget + 1 } })).best).toEqual({})
  })
})
