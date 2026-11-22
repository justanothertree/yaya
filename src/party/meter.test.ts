import { describe, expect, it } from 'vitest'
import { countMessage, newMeter, readMeter } from './meter'

describe('the Realtime meter, one call seen from one browser', () => {
  it('counts what went out and what came in, by kind and in bytes', () => {
    const m = newMeter(0)
    countMessage(m, 'sent', 'party:ptr', 60)
    countMessage(m, 'sent', 'party:ptr', 60)
    countMessage(m, 'received', 'party:where', 40)
    countMessage(m, 'received', 'voice:ice', 300)
    const r = readMeter(m, 60_000)
    expect([r.sent, r.received, r.bytes]).toEqual([2, 2, 460])
    expect(r.byKind).toEqual({ 'party:ptr': 2, 'party:where': 1, 'voice:ice': 1 })
  })
  it('turns a count into a rate from the time the call started', () => {
    const m = newMeter(1000)
    for (let i = 0; i < 90; i++) countMessage(m, i % 3 ? 'received' : 'sent', 'party:ptr', 50)
    // ninety messages in the first ninety seconds is sixty a minute
    const r = readMeter(m, 91_000)
    expect(r.perMinute).toBe(60)
    expect(r.perHour).toBe(3600)
  })
  it('says nothing about a rate before there is a whole second to measure', () => {
    const m = newMeter(5000)
    countMessage(m, 'sent', 'party:where', 30)
    expect(readMeter(m, 5400).perMinute).toBeNull()
  })
})
