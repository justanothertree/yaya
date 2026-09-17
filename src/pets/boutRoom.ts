import { NetClient } from '../game/net'
import { readDrawing, type Drawing } from '../draw/strokes'
import { packLook, PARK_LOOK_LIMIT } from '../park/room'
import { seatOf } from './bout'

/**
 * Finding somebody to fight, and swapping buttons with them.
 *
 * ⚠️ THE RELAY CARRIES INPUTS AND NOTHING ELSE. Both machines run the same fight from the same
 * inputs — see bout.ts — so there is no state to reconcile, no authority to assign, and nothing
 * the relay could be wrong about. What travels is a frame number and six bits.
 *
 * ⚠️ AND IT IS MEMBERS-ONLY, because a bout carries a DRAWING onto somebody else's screen exactly
 * as the park does. The rule is about what is being carried rather than which game is being
 * played: Snake is open to strangers and stays open, because a chat line can be filtered and a
 * picture cannot.
 */

type Out = { type: 'look'; name: string; art: unknown } | { type: 'step'; n: number; in: number }

type In =
  | { type: 'welcome'; id: string }
  | { type: 'park'; who?: unknown[] }
  | { type: 'look'; from?: string; name?: string; art?: unknown }
  | { type: 'step'; from?: string; n?: number; in?: number }
  | { type: 'over'; from?: string }
  | { type: 'error'; code?: string; message?: string }

export type Foe = { id: string; name: string; art: Drawing }

export type BoutState = {
  /** my own relay id, once the relay has said hello back */
  me: string | null
  /** who I am fighting, once they have said what they look like */
  foe: Foe | null
  /** 0 or 1, agreed by both sides without a message — see seatOf */
  seat: number
  /**
   * My own creature AS THE OTHER SIDE WILL SEE IT.
   *
   * ⚠️ NOT THE ORIGINAL, AND THIS IS THE ONE THING THAT WOULD HAVE DESYNCED EVERY BOUT. A look is
   * thinned before it is sent, and thinning moves points — so `attacksOf` and `petWide` give
   * slightly different answers for the drawing I kept and the drawing they received. Reach and
   * body width feed straight into hit detection, so the two machines would disagree about whether
   * a swipe connected, from the first exchange, with no bug anywhere in the netcode. Both sides
   * must fight the same two creatures, so both sides fight the ones that went over the wire.
   */
  mine: Drawing | null
  trouble: string | null
}

export const newBout = (): BoutState => ({
  me: null,
  foe: null,
  seat: 0,
  mine: null,
  trouble: null,
})

export type Bout = {
  /** post my buttons for a future frame */
  step: (n: number, input: number) => void
  leave: () => void
}

const str = (v: unknown, cap: number) => (typeof v === 'string' ? v.trim().slice(0, cap) : '')

/** A room code somebody can read out loud. No vowels, so it cannot spell anything. */
export function boutCode(): string {
  const abc = 'bcdfghjkmnpqrstvwxz23456789'
  let out = ''
  const r = new Uint32Array(6)
  crypto.getRandomValues(r)
  for (const n of r) out += abc[n % abc.length]
  return out
}

export const boutLink = (code: string): string =>
  `${location.origin}${location.pathname}#games?play=fight&bout=${encodeURIComponent(code)}`

/** The bout a hash is asking for, or null. */
export function boutFromHash(hash: string): string | null {
  const q = new URLSearchParams(hash.split('?')[1] ?? '')
  const code = (q.get('bout') ?? '').trim().toLowerCase()
  return /^[a-z0-9]{4,16}$/.test(code) ? code : null
}

export const boutRoom = (code: string) => `fight:${code}`

/**
 * Join a bout.
 *
 * @param onFoe called when the other side turns up, leaves, or something goes wrong — NOT when
 * their buttons arrive. Inputs go straight into the tape, which the animation loop reads; a render
 * per input is sixty renders a second for nothing.
 */
export function joinBout(
  code: string,
  me: { name: string; art: Drawing },
  state: BoutState,
  onFoe: () => void,
  onStep: (seat: number, frame: number, input: number) => void,
): Bout | null {
  const raw = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WS_URL
  if (!raw) return null
  const url =
    location.protocol === 'https:' && raw.startsWith('ws://') ? 'wss://' + raw.slice(5) : raw

  const packed = packLook(me.art)
  if (JSON.stringify(packed).length > PARK_LOOK_LIMIT) {
    state.trouble = 'That creature is too detailed to take into a bout'
    onFoe()
    return null
  }
  /* the wire copy of my own creature, for the reason in BoutState.mine */
  state.mine = readDrawing(packed)
  let stop = false

  /**
   * ⚠️ ONLY WHEN WHO YOU ARE FIGHTING ACTUALLY CHANGES. Everything downstream of this rebuilds
   * the roster, and rebuilding the roster starts the fight again from three stocks each — so a
   * second `look` from the SAME person, which costs nothing and is meant to be harmless, would
   * quietly reset a round somebody was winning. Told apart by id rather than by the message
   * arriving.
   */
  let announced: string | null = null

  const settle = () => {
    if (!state.me || !state.foe) return
    state.seat = seatOf(state.me, state.foe.id)
    const was = announced
    announced = state.foe.id
    /**
     * ⚠️ SOMEBODY BEING HERE CLEARS "THEY LEFT", and without this the message outlives the
     * fact. Watched it in development: React mounts an effect, tears it down and mounts it again,
     * so the other side connects, disconnects and reconnects in a blink — the far end saw the
     * departure of a connection that had already been replaced, and sat there insisting nobody
     * was there while it fought them. The same thing happens for real whenever somebody drops and
     * comes straight back.
     */
    const hadTrouble = state.trouble !== null
    state.trouble = null
    if (was !== state.foe.id || hadTrouble) onFoe()
  }

  const net: NetClient<In, Out> = new NetClient<In, Out>(url, {
    onClose: () => {
      if (stop) return
      state.trouble = 'Lost the connection'
      onFoe()
    },
    onMessage: (msg) => {
      switch (msg.type) {
        case 'welcome': {
          state.me = str(msg.id, 24) || null
          break
        }
        case 'park': {
          /* being handed the roster is being let in — see the park's note on the same message */
          state.trouble = null
          net.send({ type: 'look', name: me.name, art: packed })
          if (Array.isArray(msg.who))
            for (const entry of msg.who.slice(0, 4)) {
              const o = entry as Record<string, unknown>
              const id = str(o.from, 24)
              const art = readDrawing(o.art)
              if (!id || !art?.strokes.length) continue
              state.foe = { id, name: str(o.name, 40) || 'Them', art }
            }
          settle()
          break
        }
        case 'look': {
          const id = str(msg.from, 24)
          const art = readDrawing(msg.art)
          if (!id || !art?.strokes.length) break
          state.foe = { id, name: str(msg.name, 40) || 'Them', art }
          settle()
          break
        }
        case 'step': {
          const id = str(msg.from, 24)
          if (!id || !state.me || id !== state.foe?.id) break
          const n = msg.n
          if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) break
          onStep(seatOf(id, state.me), n, (msg.in ?? 0) | 0)
          break
        }
        case 'over': {
          const id = str(msg.from, 24)
          if (id && id === state.foe?.id) {
            state.foe = null
            announced = null
            state.trouble = 'They left'
            onFoe()
          }
          break
        }
        case 'error': {
          state.trouble = str(msg.message, 140) || 'The bout turned us away'
          onFoe()
          break
        }
      }
    },
  })

  net.connect(boutRoom(code), { create: true })

  return {
    step: (n, input) => net.send({ type: 'step', n, in: input }),
    leave: () => {
      stop = true
      net.disconnect()
    },
  }
}
