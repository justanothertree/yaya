import { NetClient } from '../game/net'
import { packDrawing, readDrawing, simplifyDrawing, type Drawing } from '../draw/strokes'
import type { Spot, Walker } from './walk'

/**
 * The shared park, over the relay.
 *
 * ⚠️ THIS IS THE FIRST PERSISTENT ROOM ON THE SITE, and that is the whole point of it. Drawing
 * and calling together already work, over a WebRTC data channel inside a voice session — which
 * is right for "come and do this with me" and cannot be a place you walk into and find somebody.
 * A call is something you are invited to; a park is somewhere that is already there.
 *
 * ⚠️ THE RELAY, NOT A NEW SERVICE. It exists, it is deployed, it already has rooms, identity,
 * connection rate limiting and a heartbeat, and it costs nothing per message — which matters,
 * because a position channel is a firehose and every hosted realtime product bills by the
 * message. See CLAUDE.md §5: prefer an existing capability over a new service.
 *
 * ⚠️ AND EVERYTHING THAT ARRIVES IS A STRANGER'S. Names are truncated, positions are numbers
 * until proven otherwise, and a drawing goes through readDrawing — the same door a backup file
 * and a stranger's gallery file come through. The relay does not look inside a drawing on
 * purpose, so this is the only place that check happens.
 */

/** What the relay is told. The hello and the auth token are NetClient's own — see its send. */
type Out =
  | { type: 'look'; name: string; art: unknown }
  | { type: 'walk'; x: number; y: number; f: number; m: number; a: number }

/** What arrives. */
type In =
  | { type: 'welcome'; id: string }
  | { type: 'presence'; count: number }
  | { type: 'park'; who?: unknown[] }
  | { type: 'look'; from?: string; name?: string; art?: unknown }
  | { type: 'walk'; from?: string; x?: number; y?: number; f?: number; m?: number; a?: number }
  /* ⚠️ the relay already says this when anybody leaves any room, so a departure needs no new
     message on the server — `over` with a `from` is "that peer is gone", whatever ended. */
  | { type: 'over'; from?: string }
  | { type: 'error'; code?: string; message?: string }

export type Someone = {
  id: string
  name: string
  art: Drawing
  /** where they last said they were */
  at: Spot
  /** where we are drawing them, which lags the truth on purpose — see easeTo */
  shown: Spot
  facing: number
  moving: boolean
  /**
   * Which of their moves is out, 0 for none.
   *
   * ⚠️ A SLOT, NOT A MOVE. What the slot means is read from THEIR drawing, which arrived with
   * their look — so the wire carries one small number and the meaning is already on both sides.
   * Sending the attack itself would be sending a thing the other end can work out.
   */
  swing: number
  /** how long their current swing has been out, kept locally so it can be animated */
  swingFor: number
}

export type ParkState = {
  /** null until the relay says hello back */
  me: string | null
  here: Map<string, Someone>
  /** what the relay last said, so a room can explain itself rather than just sitting there */
  trouble: string | null
}

/**
 * How detailed a creature may be to walk in the park.
 *
 * ⚠️ TIGHTER THAN A PROFILE BLOCK, and for a different reason. A block is stored once and read
 * by one page; a park look is sent to everybody in the park and again to everybody who arrives
 * after you. The relay refuses anything over 12,000 characters, so this thins first and checks
 * afterwards rather than finding out from an error.
 */
export const PARK_LOOK_LIMIT = 11500
const THIN = 0.0022

export const packLook = (art: Drawing) => packDrawing(simplifyDrawing(art, THIN))

export const lookFits = (art: Drawing): boolean =>
  JSON.stringify(packLook(art)).length <= PARK_LOOK_LIMIT

/** How often a position goes out. Fifteen a second is what the cursors already use. */
export const SEND_HZ = 15

const str = (v: unknown, cap: number) => (typeof v === 'string' ? v.trim().slice(0, cap) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const spot = (v: { x?: unknown; y?: unknown }): Spot => ({
  x: Math.max(0, Math.min(1, num(v.x))),
  y: Math.max(0, Math.min(1, num(v.y))),
})

/** Somebody from the wire, or null. Never throws, never trusts. */
function readSomeone(v: unknown): Someone | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = str(o.from, 24)
  if (!id) return null
  const art = readDrawing(o.art)
  if (!art || !art.strokes.length) return null
  const at = spot(o as { x?: unknown; y?: unknown })
  return {
    id,
    name: str(o.name, 40) || 'Someone',
    art,
    at,
    shown: at,
    facing: o.f === -1 ? -1 : 1,
    moving: false,
    swing: 0,
    swingFor: 0,
  }
}

export type Park = {
  send: (w: Walker, swing: number) => void
  leave: () => void
}

/**
 * Walk into the park.
 *
 * @param onChange called whenever the roster changes — NOT when somebody moves. Positions live
 * in the returned map and are read by the animation loop directly, because a React render per
 * peer per packet is fifteen renders a second per person in the room, which is the cost of
 * asking the wrong question. Same bargain PartyCursors already makes.
 */
export function joinPark(
  room: string,
  me: { name: string; art: Drawing },
  state: ParkState,
  onChange: () => void,
): Park | null {
  const raw = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WS_URL
  if (!raw) return null
  /* ⚠️ a page served over https cannot open a ws:// socket — the same upgrade the game does */
  const url =
    location.protocol === 'https:' && raw.startsWith('ws://') ? 'wss://' + raw.slice(5) : raw

  const packed = packLook(me.art)
  let stop = false

  const net: NetClient<In, Out> = new NetClient<In, Out>(url, {
    onClose: () => {
      if (stop) return
      state.trouble = 'Lost the connection to the park'
      onChange()
    },
    onMessage: (msg) => {
      switch (msg.type) {
        case 'welcome': {
          /* joined the room — which is not the same as being let into the park, see below */
          state.me = str(msg.id, 24) || null
          state.trouble = null
          onChange()
          break
        }
        case 'park': {
          /**
           * ⚠️ THE ROSTER IS THE DOOR OPENING, and the look goes out in answer to it.
           *
           * Two things had to be waited for and they are not the same thing. `welcome` says the
           * socket joined a room; the park additionally wants proof of an account, which arrives
           * a round trip later because the relay has to ask Supabase. Sending the look any
           * earlier means sending it to a relay that will drop it — which is exactly what
           * happened when it went out on the socket's open handler, before even the hello: the
           * first person into the park was visible to herself and to nobody else, and the roster
           * handed to the second arrival was empty.
           *
           * A signed-out visitor never receives this, so they never announce themselves either.
           */
          if (Array.isArray(msg.who))
            for (const entry of msg.who.slice(0, 32)) {
              const one = readSomeone(entry)
              if (one) state.here.set(one.id, one)
            }
          state.trouble = null
          net.send({ type: 'look', name: me.name, art: packed })
          onChange()
          break
        }
        case 'look': {
          const one = readSomeone(msg)
          if (!one) break
          /* ⚠️ keep where they are if we already know: a look can arrive after a walk, and
             taking the look's position would teleport them back to the middle of the park */
          const had = state.here.get(one.id)
          if (had) {
            one.at = had.at
            one.shown = had.shown
            one.facing = had.facing
          }
          state.here.set(one.id, one)
          onChange()
          break
        }
        case 'walk': {
          const id = str(msg.from, 24)
          const who = id && state.here.get(id)
          if (!who) break
          who.at = spot(msg)
          who.facing = msg.f === -1 ? -1 : 1
          who.moving = !!msg.m
          /* ⚠️ a NEW swing restarts the clock; the same one carrying on does not, or a peer's
             attack would appear to start again on every packet that arrived during it */
          const a = typeof msg.a === 'number' && Number.isFinite(msg.a) ? Math.round(msg.a) : 0
          const slot = Math.max(0, Math.min(6, a))
          if (slot !== who.swing) who.swingFor = 0
          who.swing = slot
          /* deliberately no onChange — the loop reads this map every frame */
          break
        }
        case 'over': {
          const id = str(msg.from, 24)
          if (id && state.here.delete(id)) onChange()
          break
        }
        case 'error': {
          state.trouble = str(msg.message, 120) || 'The park turned us away'
          onChange()
          break
        }
      }
    },
  })

  net.connect(room, { create: true })

  return {
    send: (w, swing) => {
      net.send({ type: 'walk', x: w.x, y: w.y, f: w.facing, m: w.moving ? 1 : 0, a: swing })
    },
    leave: () => {
      stop = true
      net.disconnect()
    },
  }
}
