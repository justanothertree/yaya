import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * How a send went outlives whatever showed it (sendOutcome.ts). The component that started a send
 * can be gone by the time it lands — toggled shut, replaced by a new export, the room left — so
 * the question is whether the NEXT reader finds the answer, asked with nobody listening at all.
 */
let settle: (r: { msg: unknown } | { why: string }) => void = () => {}
let fail: (e: unknown) => void = () => {}
const sent: unknown[][] = []
vi.mock('../circuit/chatSongs', () => ({
  sendSong: (...a: unknown[]) => {
    sent.push(a)
    return new Promise((res, rej) => {
      settle = res
      fail = rej
    })
  },
  songTitle: (s: string) => s.trim(),
}))

let m: typeof import('./sendOutcome')
beforeEach(async () => {
  vi.resetModules()
  sent.length = 0
  m = await import('./sendOutcome')
})

const exportA = new Blob(['a'])
const exportB = new Blob(['b'])
const crew = { id: 'r1', name: 'The Crew' }
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('how a send went', () => {
  it('is there for whoever looks next, though nobody was listening when it landed', async () => {
    const seen: (string | undefined)[] = []
    const stop = m.subscribeSendOutcome(() => seen.push(m.sendOutcome()?.text))
    const going = m.sendToChat(exportA, crew, ' Sunday ', async () => 125)
    await tick()
    expect(m.sendOutcome()).toMatchObject({ of: exportA, state: 'sending' })
    stop() // the picker unmounts mid-send
    settle({ msg: { id: 'm1' } })
    expect(await going).toBe(true)
    expect(seen).toEqual(['Sending…'])
    // the next mount reads it: what went, and where
    expect(m.sendOutcome()).toEqual({
      of: exportA,
      state: 'sent',
      text: 'Sent “Sunday” to The Crew.',
      room: crew,
    })
    expect(sent).toEqual([[crew.id, exportA, ' Sunday ', 125]])
  })

  it('keeps a refusal in the server’s words, and an exception as a sentence', async () => {
    const going = m.sendToChat(exportA, crew, 'Sunday', async () => 60)
    await tick()
    settle({ why: 'your songs in chat come to 25 MB — remove one first' })
    expect(await going).toBe(false)
    expect(m.sendOutcome()).toMatchObject({
      state: 'failed',
      text: 'your songs in chat come to 25 MB — remove one first',
    })
    const again = m.sendToChat(exportA, crew, 'Sunday', async () => 60)
    await tick()
    fail(new Error('boom'))
    expect(await again).toBe(false)
    expect(m.sendOutcome()).toMatchObject({ state: 'failed', text: 'That song didn’t send.' })
  })

  it('sends one at a time: a second press while one is going starts nothing', async () => {
    const first = m.sendToChat(exportA, crew, 'Sunday', async () => 60)
    await tick()
    expect(await m.sendToChat(exportB, crew, 'Other', async () => 60)).toBe(false)
    expect(sent).toHaveLength(1)
    expect(m.sendOutcome()).toMatchObject({ of: exportA, state: 'sending' })
    settle({ msg: {} })
    await first
  })

  it('outlives a new export while it is still going, and is forgotten by one once it has landed', async () => {
    const going = m.sendToChat(exportA, crew, 'Sunday', async () => 60)
    await tick()
    m.newExport() // export B replaces A mid-send
    expect(m.sendOutcome()).toMatchObject({ of: exportA, state: 'sending' })
    settle({ why: 'not in this room' })
    await going
    // the answer about A is still news when it lands, export B or not
    expect(m.sendOutcome()).toMatchObject({ of: exportA, text: 'not in this room' })
    m.newExport()
    expect(m.sendOutcome()).toBeNull()
  })
})
