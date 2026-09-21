import { NetClient } from '../game/net'
import { packDrawing, readDrawing, simplifyDrawing, type Drawing } from '../draw/strokes'
import type { Spot, Walker } from './walk'
import { aimFromOctant, HOP, type Aimed } from './strike'
import { traitsOf } from '../pets/play'
import { rigOf } from '../pets/rig'
import { castFromSlot, type CastKind } from './cast'

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
  | {
      type: 'walk'
      x: number
      y: number
      f: number
      m: number
      a: number
      d: number
      j: number
      k: number
    }
  /* calling a boss out, or — with a null drawing — putting it away */
  | { type: 'boss'; name: string; art: unknown | null }
  /* where it is and what is left of it, from the one machine running it */
  | { type: 'bstep'; x: number; y: number; f: number; a: number; h: number; t: boolean; d: number }

/** What arrives. */
type In =
  | { type: 'welcome'; id: string }
  | { type: 'presence'; count: number }
  | { type: 'park'; who?: unknown[]; boss?: unknown }
  | { type: 'look'; from?: string; name?: string; art?: unknown }
  | {
      type: 'walk'
      from?: string
      x?: number
      y?: number
      f?: number
      m?: number
      a?: number
      d?: number
      j?: number
      k?: number
    }
  | { type: 'boss'; from?: string; name?: string; art?: unknown }
  | {
      type: 'bstep'
      from?: string
      x?: number
      y?: number
      f?: number
      a?: number
      h?: number
      t?: boolean
      d?: number
    }
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
  /**
   * The big thing they are in the middle of, and how long it has been going.
   *
   * ⚠️ A BOSS IS HURT BY ITS HOST AND NOBODY ELSE — see the note on the swing that lands
   * below. Everybody's damage to a shared boss is worked out by the machine running it, from
   * what the rest of them broadcast, so a cast that never reached the wire was a cast that did
   * nothing at all to somebody else's boss. It rides in the same slot field a swing does,
   * above the six move slots, which is the trick bosses already use for theirs.
   */
  cast: { kind: CastKind } | null
  castFor: number
  /**
   * Which way their swing or cast points — see octantOf.
   *
   * ⚠️ A PEER'S SWING WAS ALWAYS READ AS STRAIGHT AHEAD, which was honest while nothing they
   * did could hurt anybody. It stops being honest the moment their CAST has to be aimed to work
   * out where it lands on a shared boss, so the same octant a boss already sends now rides on a
   * walk too.
   */
  aim: Aimed
  /**
   * How far off the ground they are, in pet-heights.
   *
   * ⚠️ A PICTURE AND NOT A RULE, which is why a tenth of the arc is enough precision. What can
   * hit YOU is worked out from your own height on your own machine; this exists so that a friend
   * clearing a fissure looks like a friend clearing a fissure rather than one walking through it.
   */
  hop: number
  /**
   * Whether they are on the floor.
   *
   * ⚠️ A FRIEND ON THE GROUND LOOKED EXACTLY LIKE A FRIEND STANDING THERE. Being down is
   * drawn — tipped over, drained of colour, "— down" on the tag — and all of it was gated on
   * `one.mine`, so the one moment in a shared fight where you would actually do something about
   * somebody else was the one moment nothing showed. Found by putting two clients in a park and
   * watching one of them get knocked out in front of the other, to no visible effect at all.
   *
   * ⚠️ AND IT IS A PICTURE, LIKE THEIR HEIGHT. Nothing here decides anything: a peer cannot
   * hurt you and you cannot hurt them, so a client claiming to be down all day changes nobody's
   * fight. That is what makes it safe to take their word for it.
   */
  down: boolean
  /**
   * True once this swing of theirs has already landed on something here.
   *
   * ⚠️ ONE SWING IS ONE HIT, the same rule a local striker follows. Their slot stays set for
   * the whole span of the attack, so without this the live window is a separate hit on every
   * frame of itself: measured at five frames for a quick attack and seven for a heavy, which is
   * a friend's swing landing for five to seven times what their creature's move is worth.
   */
  spent: boolean
  /**
   * The same rule for their CAST, and it has to be its own flag.
   *
   * ⚠️ IT SHARED `spent` WITH THEIR SWING AND THAT MADE A FRIEND'S CAST DO NOTHING, ever.
   * `spent` is cleared when their SWING SLOT changes — and while they are casting their swing
   * slot is 0, so a flag left true by any earlier swing of theirs was never cleared again and
   * the cast loop skipped on every frame. Found the first time two clients were actually put
   * in one park: the host drew the peer's fissure correctly, right on top of its boss, and took
   * nothing off it.
   */
  castSpent: boolean
}

/**
 * Somebody else's boss.
 *
 * ⚠️ AN ECHO, NOT A SIMULATION. The machine that called the boss out is the only one stepping
 * it; everybody else receives where it is, which way it is looking, which move is out and how much
 * of it is left, and draws that. Two machines both running the same boss from the same drawing
 * would drift apart within seconds — the park is not lockstep and does not want to be, because
 * a place you walk into cannot make everybody wait for the slowest person in it — and the first
 * thing anybody would notice is their hits disagreeing about when it died.
 *
 * ⚠️ WHICH MOVE IS OUT IS STILL ONLY A SLOT, read against the boss's own drawing exactly as a
 * person's swing is. So a remote boss's attacks reach as far and hurt as much on your screen as on
 * the screen running it, and none of that has to cross the wire.
 */
export type BossEcho = {
  /** the peer running it; when they leave, it leaves */
  by: string
  name: string
  art: Drawing
  at: Spot
  /** where it is drawn, which lags the truth on purpose — see easeTo */
  shown: Spot
  facing: number
  /** its move table's slot plus one, 0 for none */
  swing: number
  /** how long that swing has been out, kept here so it can be animated and aimed */
  swingFor: number
  /** true once this swing of its has landed on me, so one swing is one hit */
  spent: boolean
  /** what is LEFT of it, 0..1 */
  hp: number
  /**
   * The big thing it is doing, and how long it has been doing it — see cast.ts.
   *
   * ⚠️ IT RIDES IN THE SAME SLOT FIELD A SWING DOES, above the six move slots, so it costs
   * no new message. `castFor` is counted locally the way swingFor already is, because how long
   * something has been going is a thing a viewer can measure rather than be told fifteen times
   * a second.
   */
  cast: { kind: CastKind } | null
  castFor: number
  /**
   * Which way its swing is pointed — see octantOf. Absent on the wire means straight ahead,
   * which is exactly what a client from before omnidirectional attacks was saying.
   */
  aim: Aimed
  /**
   * Mid-pivot, so everybody sees the window and not only whoever is running it.
   *
   * ⚠️ OPTIONAL ON THE WIRE, AND FALSE WHEN IT IS NOT THERE. A relay that has not been
   * redeployed strips unknown fields, so an old server simply means nobody downstream sees the
   * tell — which is exactly the behaviour before this existed. Nothing breaks either way, and it
   * starts working the moment the relay is updated.
   */
  turning: boolean
}

export type ParkState = {
  /** null until the relay says hello back */
  me: string | null
  here: Map<string, Someone>
  /** the one boss in the park, when it is somebody else's — your own lives in the room */
  boss: BossEcho | null
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
    cast: null,
    castFor: 0,
    aim: { x: 1, y: 0 },
    hop: 0,
    down: false,
    spent: false,
    castSpent: false,
  }
}

/** A boss from the wire, or null. The same door, and the same suspicion. */
function readBoss(v: unknown): BossEcho | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const by = str(o.from, 24)
  if (!by) return null
  const art = readDrawing(o.art)
  if (!art || !art.strokes.length) return null
  const at = spot(o as { x?: unknown; y?: unknown })
  return {
    by,
    name: str(o.name, 40) || 'A boss',
    art,
    at,
    shown: at,
    facing: o.f === -1 ? -1 : 1,
    swing: 0,
    swingFor: 0,
    turning: false,
    aim: { x: 1, y: 0 },
    cast: null,
    castFor: 0,
    spent: false,
    /* ⚠️ a boss with no health reported yet has not been stepped at all, which is a FULL one —
       reading a missing number as zero would draw it already beaten the moment it arrived */
    hp: typeof o.h === 'number' && Number.isFinite(o.h) ? Math.max(0, Math.min(1, o.h)) : 1,
  }
}

export type Park = {
  /** `hop` is hopFrac — how far through the arc, not how high. See the note where it is sent. */
  send: (w: Walker, swing: number, aim: number, hop: number, down: boolean) => void
  /** stand one of your minions up for everybody, or pass null to put it away */
  callBoss: (name: string, art: Drawing | null) => void
  /** where your boss is and what is left of it, at the same rate as a walk */
  stepBoss: (
    at: Spot,
    facing: number,
    swing: number,
    hp: number,
    turning: boolean,
    aim: number,
  ) => void
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
          /* somebody already had a boss out when we walked in — see the relay's roster note */
          state.boss = readBoss(msg.boss)
          state.trouble = null
          net.send({ type: 'look', name: me.name, art: packed })
          onChange()
          break
        }
        case 'boss': {
          const by = str(msg.from, 24)
          if (!by) break
          /* no drawing means it has been put away */
          if (msg.art == null) {
            if (state.boss?.by === by) {
              state.boss = null
              onChange()
            }
            break
          }
          const one = readBoss(msg)
          if (!one) break
          state.boss = one
          onChange()
          break
        }
        case 'bstep': {
          const b = state.boss
          if (!b || b.by !== str(msg.from, 24)) break
          b.at = spot(msg)
          b.facing = msg.f === -1 ? -1 : 1
          const a = typeof msg.a === 'number' && Number.isFinite(msg.a) ? Math.round(msg.a) : 0
          /**
           * ⚠️ SEVEN AND ABOVE IS A CAST, NOT A SLOT. The six move slots are 1–6 and 0 is
           * "nothing" — everything past that is one of the big committed things, which is how a
           * cast reaches a viewer without a message of its own. A relay that has not been
           * redeployed clamps this to 6, so an old server turns a cast into a swing that is not
           * there rather than into anything broken.
           */
          const castKind = castFromSlot(a)
          if (!castKind) {
            b.cast = null
            b.castFor = 0
          } else if (b.cast?.kind !== castKind) {
            b.cast = { kind: castKind }
            b.castFor = 0
          }
          const slot = castKind ? 0 : Math.max(0, Math.min(6, a))
          /* a NEW swing restarts the clock; the same one carrying on does not — as for a peer */
          if (slot !== b.swing) {
            b.swingFor = 0
            b.spent = false
          }
          b.swing = slot
          if (typeof msg.h === 'number' && Number.isFinite(msg.h))
            b.hp = Math.max(0, Math.min(1, msg.h))
          b.turning = msg.t === true
          /* ⚠️ absent means straight ahead, which is what every client before this sent */
          b.aim = aimFromOctant(typeof msg.d === 'number' ? msg.d : b.facing < 0 ? 4 : 0)
          /* deliberately no onChange — the loop reads this every frame, the same as a walk */
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
          /* ⚠️ seven and above is a cast, exactly as it is for a boss — see the note there */
          const theirCast = castFromSlot(a)
          if (!theirCast) {
            who.cast = null
            who.castFor = 0
            who.castSpent = false
          } else if (who.cast?.kind !== theirCast) {
            who.cast = { kind: theirCast }
            who.castFor = 0
            /* ⚠️ a NEW cast has not landed yet, the same reset a new swing gets below */
            who.castSpent = false
          }
          who.aim = aimFromOctant(typeof msg.d === 'number' ? msg.d : who.facing < 0 ? 4 : 0)
          /* absent reads as standing on the ground, which is exactly what an older client is */
          who.down = !!msg.k
          /* ⚠️ THEIR jump, off THEIR drawing, which we already hold in order to draw them at
             all. A creature with wings goes higher on every screen, not just its own. */
          who.hop =
            (Math.max(0, Math.min(9, Math.round(num(msg.j)))) / 9) *
            HOP.up *
            traitsOf(rigOf(who.art)).jump
          const slot = theirCast ? 0 : Math.max(0, Math.min(6, a))
          if (slot !== who.swing) {
            who.swingFor = 0
            /* ⚠️ AND THE NEW SWING HAS NOT LANDED YET. Forgetting this line means one swing is one
               hit FOREVER rather than one hit per swing: the flag is set by the first blow that
               connects and never cleared, so a peer lands exactly one hit for as long as they
               stand in the park. Found by swinging twelve times at a boss and taking nothing off
               it. */
            who.spent = false
          }
          who.swing = slot
          /* deliberately no onChange — the loop reads this map every frame */
          break
        }
        case 'over': {
          const id = str(msg.from, 24)
          let changed = id ? state.here.delete(id) : false
          /* ⚠️ a boss belongs to the machine running it. Nobody else is stepping it, so when
             they go this is not an abandoned boss, it is no boss. */
          if (id && state.boss?.by === id) {
            state.boss = null
            changed = true
          }
          if (changed) onChange()
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
    send: (w, swing, aim, hop, down) => {
      net.send({
        type: 'walk',
        x: w.x,
        y: w.y,
        f: w.facing,
        m: w.moving ? 1 : 0,
        a: swing,
        d: aim,
        /* ⚠️ in tenths of the way THROUGH the arc, not tenths of a height. A height is measured
           against the sender's own jump, and a winged creature's peak would clamp against a
           constant built for a plain one — arriving as a normal hop on every other screen. The
           fraction means the same for everybody and the far end has the drawing. See hopFrac. */
        j: Math.max(0, Math.min(9, Math.round(hop * 9))),
        k: down ? 1 : 0,
      })
    },
    callBoss: (name, art) => {
      net.send({ type: 'boss', name, art: art ? packLook(art) : null })
    },
    stepBoss: (at, facing, swing, hp, turning, aim) => {
      net.send({ type: 'bstep', x: at.x, y: at.y, f: facing, a: swing, h: hp, t: turning, d: aim })
    },
    leave: () => {
      stop = true
      net.disconnect()
    },
  }
}
