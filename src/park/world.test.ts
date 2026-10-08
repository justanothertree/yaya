import { describe, expect, it } from 'vitest'
import { setWorld, worldIsDrawn, worldRoom, worldMarks } from './world'
import type { Place } from './mapOf'

/**
 * Which park you are standing in, and whether anybody else can be standing in it with you.
 *
 * ⚠️ THIS IS A LOCK, NOT A PREFERENCE. `joinPark` refuses the socket while the world is drawn
 * and has no room behind it, and that one line is the whole of what stops two people standing in
 * parks that disagree. So the thing under test is not "does the flag flip" — it is "can the flag
 * ever say shared when it is not", which is a question about what gets CLEARED.
 */

const place = (name: string): Place => ({
  name,
  at: { x: 0.5, y: 0.5 },
  size: 0.1,
  kind: 'flat',
  top: 0,
  box: { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 },
})

describe('which park, and whose', () => {
  it('is not drawn and has no room when it is the park everybody shares', () => {
    setWorld(null)
    expect(worldIsDrawn()).toBe(false)
    expect(worldRoom()).toBeNull()
    /* the built-in landmarks come back, which is the other half of going home */
    expect(worldMarks().length).toBeGreaterThan(0)
  })

  it('is drawn and roomless for a map of your own — which is what keeps you alone in it', () => {
    setWorld({ places: [place('my rock')] })
    expect(worldIsDrawn()).toBe(true)
    expect(worldRoom()).toBeNull()
  })

  it('carries the room when the map came from one', () => {
    setWorld({ places: [place('their rock')], room: 'room-123' })
    expect(worldIsDrawn()).toBe(true)
    expect(worldRoom()).toBe('room-123')
  })

  it('FORGETS the room when you go back to the shared park', () => {
    setWorld({ places: [place('their rock')], room: 'room-123' })
    setWorld(null)
    expect(worldRoom()).toBeNull()
  })

  it('FORGETS the room when you open a map of your own next', () => {
    /**
     * ⚠️ THE ONE THAT MATTERS. A stale room id is a claim that this map is shared when it is the
     * NEXT one you opened — and the claim is read by joinPark, so the cost of getting it wrong is
     * a socket opened for a map nobody else has. Visiting a friend and then opening your own
     * sketch is the ordinary way to arrive here.
     */
    setWorld({ places: [place('their rock')], room: 'room-123' })
    setWorld({ places: [place('my rock')] })
    expect(worldIsDrawn()).toBe(true)
    expect(worldRoom()).toBeNull()
  })

  it('forgets it for a drawn world with nothing in it at all', () => {
    /* a map can be nothing but painted ground — still drawn, still roomless */
    setWorld({ places: [place('their rock')], room: 'room-123' })
    setWorld({ places: null })
    expect(worldIsDrawn()).toBe(true)
    expect(worldRoom()).toBeNull()
  })

  it('takes a new room when you walk from one friend’s park into another’s', () => {
    setWorld({ places: [place('a')], room: 'room-a' })
    setWorld({ places: [place('b')], room: 'room-b' })
    expect(worldRoom()).toBe('room-b')
  })
})
