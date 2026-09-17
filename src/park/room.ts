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
  | { type: 'walk'; x: number; y: number; f: number; m: number }

/** What arrives. */
type In =
  | { type: 'welcome'; id: string }
  | { type: 'presence'; count: number }
  | { type: 'park'; who?: unknown[] }
  | { type: 'look'; from?: string; name?: string; art?: unknown }
  | { type: 'walk'; from?: string; x?: number; y?: number; f?: number; m?: number }
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
  }
}

export type Park = {
  send: (w: Walker) => void
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
          /**
           * ⚠️ THE LOOK GOES OUT HERE, NOT ON `onOpen`. NetClient calls its open handler
           * BEFORE it sends its own hello, so a look sent from there reaches the relay while the
           * socket has joined no room at all — and the relay drops everything that is not a
           * hello until one has arrived. Watched happen: the first person into the park was
           * visible to herself and to nobody else, because the relay had never been told what
           * she looked like, so the roster it handed the second arrival was empty.
           *
           * `welcome` is the relay confirming the join, which is the first moment a look can
           * land anywhere. It is also the right moment after a reconnect, for the same reason.
           */
          state.me = str(msg.id, 24) || null
          state.trouble = null
          net.send({ type: 'look', name: me.name, art: packed })
          onChange()
          break
        }
        case 'park': {
          /* everybody already standing here, sent only to whoever just arrived */
          if (!Array.isArray(msg.who)) break
          for (const entry of msg.who.slice(0, 32)) {
            const one = readSomeone(entry)
            if (one) state.here.set(one.id, one)
          }
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
    send: (w) => {
      net.send({ type: 'walk', x: w.x, y: w.y, f: w.facing, m: w.moving ? 1 : 0 })
    },
    leave: () => {
      stop = true
      net.disconnect()
    },
  }
}
