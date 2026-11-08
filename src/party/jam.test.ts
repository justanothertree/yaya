import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layer } from '../audio/looper'
import { toSong } from '../audio/songFile'

/**
 * The jam, asked what it does with a layer louder than 1.5 and a song longer than eight bars —
 * through two REAL rooms rather than through the parser alone.
 *
 * ⚠️ WHY TWO MACHINES. The claim worth pinning is a round trip: my layer at 1.8 goes to a partner,
 * they mute it, and what comes back is what sets my own layer's level. A test that fed one jam a
 * message built by hand would be a second copy of whatever the sender is assumed to send. Here
 * each machine is its own module instance of jam.ts AND looper.ts (both hold their state at
 * module scope, so `vi.resetModules` between imports is two computers), and the only thing shared
 * is the bus below, which stands in for the party channel and nothing else.
 *
 * ⚠️ THE BUS ASKS WHO IS ACTING AT CALL TIME, because a `vi.mock` factory runs ONCE however many
 * times the modules are reset — measured: two fresh imports, one factory call, and both machines
 * answering `myPeerId() === 'a'`, which made every message look like an echo and dropped it.
 * Every path here is synchronous (a looper change fires the jam's diff inline, and a handler's
 * replies are sent before it returns), so setting `net.machine` around each act is exact.
 *
 * ⚠️ THESE PIN TODAY'S BEHAVIOUR, NOT A DECISION ABOUT IT. All three outcomes come from
 * JAM_CEILINGS in songFile.ts, which keeps the jam reading at exactly what it read before the
 * Library's ceilings were corrected. If the jam is ever raised to the room's full range, these
 * are the tests that should change — on purpose, in that change.
 */

type Envelope = { from: string; name: string; kind: string; body: unknown }

const net = vi.hoisted(() => ({
  /** whose code is running right now */
  machine: '',
  handlers: new Map<string, (m: Envelope) => void>(),
  outbox: [] as Envelope[],
}))

vi.mock('../voice/voiceSession', () => ({
  myPeerId: () => net.machine,
  onParty: (fn: (m: Envelope) => void) => {
    const me = net.machine
    net.handlers.set(me, fn)
    return () => net.handlers.delete(me)
  },
  sendParty: (kind: string, body: unknown) =>
    net.outbox.push({ from: net.machine, name: net.machine.toUpperCase(), kind, body }),
  voiceSession: { subscribe: () => () => {}, getState: () => ({ inCall: true }) },
}))
vi.mock('./clock', () => ({ clock: { start: () => () => {} }, toLocalTime: () => null }))
vi.mock('./transport', () => ({ transport: { start: () => () => {} } }))
vi.mock('../circuit/toast', () => ({ showToast: () => {} }))
vi.mock('../audio/context', () => ({ sharedCtx: () => ({ currentTime: 0 }) }))

/** do something as one machine — its sends are stamped with its name */
function as<T>(who: string, act: () => T): T {
  net.machine = who
  return act()
}

/** every message so far, handed to everybody but its sender — until the room goes quiet */
function deliver() {
  for (let guard = 0; net.outbox.length && guard < 200; guard++) {
    const m = net.outbox.shift()!
    for (const [who, fn] of net.handlers) if (who !== m.from) as(who, () => fn(m))
  }
  expect(net.outbox).toHaveLength(0)
}

async function machine(id: string) {
  vi.resetModules()
  const { jam } = await import('./jam')
  const lp = await import('../audio/looper')
  return { id, jam, lp }
}

/** a machine turning the jam on, after whoever is already in it — and the room settling */
function join(m: Awaited<ReturnType<typeof machine>>) {
  as(m.id, () => m.jam.start())
  as(m.id, () => m.jam.setOn(true))
  deliver()
}

const gainOf = (m: Awaited<ReturnType<typeof machine>>, pick: (l: Layer) => boolean) =>
  m.lp.loopState().layers.find(pick)?.gain

const loud = (id: string): Layer => ({
  id,
  instrument: 'rhodes',
  muted: false,
  len: 2,
  gain: 1.8,
  fx: { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
  events: [
    { t: 0, midi: 60, on: true },
    { t: 0.5, midi: 60, on: false },
  ],
})

beforeEach(() => {
  net.handlers.clear()
  net.outbox.length = 0
  vi.stubGlobal('window', {
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('a jam reads a partner at the ceilings it always has', () => {
  it('a layer they set to 1.8 plays at 1.5 here', async () => {
    const a = await machine('a')
    a.lp.loadSong(96, 2, [loud('mine-1')])
    join(a)
    const b = await machine('b')
    join(b)

    expect(gainOf(b, (l) => l.from === 'a')).toBe(1.5)
  })

  /**
   * ⚠️ AND IT COMES BACK TO ITS AUTHOR AT 1.5 THE MOMENT A PARTNER HAS IT — nobody editing
   * anything. Found by this file, not by reading, and true on main before any of this.
   *
   * The receiver's echo guard (`sentLayers.set(…)` after `putSharedLayer`) is written one line
   * too late: the looper notifies its listeners synchronously, so the jam's own diff runs INSIDE
   * putSharedLayer, sees a layer it has no record of sending, and sends it to the room. Its author
   * receives a message about its own layer, `localIdFor` maps it home, and it is applied — as the
   * partner read it. At equal ceilings that echo is a wasted message and a `releaseLayer` on the
   * author's take; above 1.5 it is the author's fader moving.
   */
  it('and its author hears it turned down to 1.5 as soon as a partner receives it', async () => {
    const a = await machine('a')
    a.lp.loadSong(96, 2, [loud('mine-1')])
    join(a)
    expect(gainOf(a, (l) => l.id === 'mine-1')).toBe(1.8)

    const b = await machine('b')
    join(b)
    expect(gainOf(a, (l) => l.id === 'mine-1')).toBe(1.5)
  })

  it('and a song offered to the room longer than eight bars arrives as eight', async () => {
    const a = await machine('a')
    join(a)
    const b = await machine('b')
    join(b)

    as('a', () => a.jam.offerSong(toSong('Long', 96, 16, [loud('x-0')])))
    deliver()
    expect(b.jam.getState().offer?.song.bars).toBe(8)
    expect(b.jam.getState().offer?.song.layers[0].gain).toBe(1.5)
  })
})
