// Everybody watches the same wheel.
//
// The pool could already pick for you, but the pick happened on ONE laptop. Four people deciding
// what to watch got one person announcing a result the others had to take on trust, which is a
// worse version of that person just choosing. The randomiser only settles an argument if the
// room can see it land.
//
// So the roll is broadcast: whoever presses it sends the winner AND the exact sequence of names
// the wheel will flick through, and every screen runs the same reel and stops on the same name.
//
//
// ⚠️ THE SENDER STARTS ITS OWN REEL LOCALLY, and the channel is `self: false`.
//
// The tidier design is `self: true` — nobody animates until the server fans the message back, so
// every screen including the sender starts within a few milliseconds of each other. It is also
// the design where a missing RLS policy means pressing the button does nothing at all, silently,
// forever. Starting locally costs the peers roughly one network leg of lag (~100ms against a
// 2.1s reel — a blink, on an animation that is deliberately slow at the end) and buys a pool
// that still works when the realtime side is broken, misconfigured, or signed out.
//
//
// ⚠️ NO TIMESTAMP, AND NOTHING IS SCHEDULED AGAINST THE SENDER'S CLOCK.
//
// The obvious payload has an `at` on it so receivers can start the reel at the same instant, or
// at least discard stale ones. Both are traps. Another machine's `Date.now()` is not a time you
// can do arithmetic with — it can be minutes off, in either direction — so a staleness check
// silently drops good rolls from a slow clock and lets through everything from a fast one, and
// scheduling against it puts the animation anywhere at all. party/clock.ts exists precisely
// because this is not solvable without measuring the offset first, and there is no call here to
// measure it over. Receivers therefore start on arrival, which needs no shared clock and is
// accurate to the network leg. Broadcasts are not replayed on reconnect, so there is nothing
// stale to guard against in the first place.
//
//
// ⚠️ TWO PEOPLE PRESSING AT ONCE: last arrival wins, per screen, and screens may disagree.
//
// The alternative is electing whose roll counts, which needs a host, and a host needs electing,
// re-electing when they close the tab, and a rule for the meantime — see the same argument in
// party/transport.ts. For a handful of friends the honest failure is somebody saying "wait, I
// pressed it too", which is self-correcting, versus a wheel that stops spinning because the
// wrong person's laptop slept.
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabaseClient, subscribeLogged } from '../finance/client'
import { hasFinanceSupabaseEnv } from '../finance/env'
import { peekPersistedUserId } from '../finance/auth'

/** How long the wheel runs. Long enough to be an event, short enough not to be a wait. */
export const ROLL_MS = 2100

/** What one screen needs to run the same wheel as everybody else. */
export type Roll = {
  /** the winning item's id, so the row can be marked once it lands */
  id: string
  /** the winning title, so a peer whose board has not synced yet still shows the right answer */
  title: string
  kind?: string
  /** every label the wheel flicks through, in order; the last one is the winner */
  reel: string[]
  /** who spun it */
  by: string
}

/* Everything below is bounded before it is used: this arrives from another member's browser,
   and "it came from a friend" is not the same as "it is the shape I expected". A reel of ten
   thousand entries or a title the length of a novel is a rendering problem, not an attack, but
   it is a rendering problem that costs one line to make impossible. */
const MAX_REEL = 48
const MAX_TEXT = 160

const text = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v.slice(0, MAX_TEXT) : fallback

function parseRoll(v: unknown): Roll | null {
  const r = v as Partial<Roll> | null
  if (!r || typeof r.id !== 'string' || typeof r.title !== 'string') return null
  if (!Array.isArray(r.reel)) return null
  const reel = r.reel.filter((s): s is string => typeof s === 'string').slice(0, MAX_REEL)
  if (reel.length === 0) return null
  return {
    id: r.id.slice(0, 80),
    title: text(r.title),
    kind: typeof r.kind === 'string' ? r.kind.slice(0, 40) : undefined,
    reel: reel.map((s) => text(s)),
    by: text(r.by, 'Someone') || 'Someone',
  }
}

// ── the channels ────────────────────────────────────────────────────────────────────────────
type Entry = { ch: RealtimeChannel; listeners: Set<(r: Roll) => void> }

/** one channel per circuit, shared by however many things are listening to it */
const live = new Map<string, Entry>()
/**
 * ⚠️ Leaving is DELAYED, because realtime-js dedupes channels by topic and React mounts every
 * effect twice in development. Tearing down on the first cleanup and rejoining a millisecond
 * later hands back the dying instance, whose subscribe() silently no-ops — the exact failure
 * documented at length in voice/voiceSession.ts. A second's grace makes a remount free.
 */
const closing = new Map<string, ReturnType<typeof setTimeout>>()
const LINGER_MS = 1500

const topicFor = (groupId: string) => `pool:${groupId}`

function join(groupId: string): Entry | null {
  // signed out, or a build with no Supabase at all: the pool still works, it just works alone
  if (!hasFinanceSupabaseEnv() || !peekPersistedUserId()) return null

  const pending = closing.get(groupId)
  if (pending !== undefined) {
    clearTimeout(pending)
    closing.delete(groupId)
  }
  const existing = live.get(groupId)
  if (existing) return existing

  const ch = getSupabaseClient().channel(topicFor(groupId), {
    // private routes the join through the realtime.messages policies, which gate the topic on
    // membership of this circuit — see docs/2026-09-05-the-pool-rolls-together.sql
    config: { broadcast: { self: false }, private: true },
  })
  const entry: Entry = { ch, listeners: new Set() }
  live.set(groupId, entry)

  ch.on('broadcast', { event: 'roll' }, ({ payload }) => {
    const roll = parseRoll(payload)
    if (!roll) return
    // a copy, so a listener that unsubscribes itself mid-loop cannot skip the next one
    for (const fn of [...entry.listeners]) {
      try {
        fn(roll)
      } catch {
        /* one bad listener is not the channel's problem */
      }
    }
  })
  subscribeLogged(ch, topicFor(groupId))
  return entry
}

function leave(groupId: string) {
  if (closing.has(groupId)) return
  closing.set(
    groupId,
    setTimeout(() => {
      closing.delete(groupId)
      const entry = live.get(groupId)
      if (!entry || entry.listeners.size > 0) return
      live.delete(groupId)
      void getSupabaseClient().removeChannel(entry.ch)
    }, LINGER_MS),
  )
}

/** Listen for rolls in these circuits. Returns the unsubscribe. */
export function watchRolls(groupIds: readonly string[], onRoll: (r: Roll) => void): () => void {
  const joined: string[] = []
  for (const g of groupIds) {
    const entry = join(g)
    if (!entry) continue
    entry.listeners.add(onRoll)
    joined.push(g)
  }
  return () => {
    for (const g of joined) {
      const entry = live.get(g)
      if (!entry) continue
      entry.listeners.delete(onRoll)
      if (entry.listeners.size === 0) leave(g)
    }
  }
}

/**
 * Tell the circuit what came up.
 *
 * Silent when there is nowhere to send it — no circuit, signed out, or a channel the policies
 * refused. The caller has already started its own reel by then, so the result of a failure is a
 * pool that decides for one person instead of for the room: degraded, never broken.
 */
export function sendRoll(groupId: string | null | undefined, roll: Roll): void {
  if (!groupId) return
  const entry = live.get(groupId)
  if (!entry) return
  void Promise.resolve(entry.ch.send({ type: 'broadcast', event: 'roll', payload: roll })).catch(
    () => undefined,
  )
}

// ── the roll itself ─────────────────────────────────────────────────────────────────────────

/**
 * Pick one, weighted: votes tilt the odds rather than deciding outright, so the option nobody
 * championed can still come up. That is the point of a randomiser — it settles the argument
 * without pretending the vote was unanimous.
 */
export function weightedPick<T>(items: readonly T[], weightOf: (item: T) => number): T | null {
  if (items.length === 0) return null
  const weights = items.map((i) => Math.max(0, weightOf(i)))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return items[Math.floor(Math.random() * items.length)]
  let r = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * The sequence of names the wheel shows, ending on the winner.
 *
 * ⚠️ BUILT BY THE SENDER AND SENT WHOLE, rather than each screen generating its own from a
 * shared seed. A seed means every screen has to agree on the candidate list, its order, and the
 * shuffle — three things that are only equal if everybody's board has finished syncing, which is
 * exactly what is not true in the second after somebody adds an option. Sending the list of
 * strings costs a few hundred bytes and removes the entire class of "my wheel showed different
 * names".
 */
export function buildReel(labels: readonly string[], winner: string): string[] {
  if (labels.length === 0) return [winner]
  // enough ticks to read as a spin without outrunning the ease-out at the end
  const ticks = Math.max(12, Math.min(MAX_REEL - 1, labels.length * 3))
  const start = Math.floor(Math.random() * labels.length)
  const reel: string[] = []
  for (let i = 0; i < ticks; i++) reel.push(labels[(start + i) % labels.length])
  reel.push(winner)
  return reel
}

/**
 * Which entry of the reel is showing, `elapsed` ms in.
 *
 * Cubic ease-out: quick at the start, crawling by the end, which is the whole of what makes a
 * wheel feel like it is deciding something rather than just cycling.
 */
export function reelStep(elapsed: number, length: number): number {
  const p = Math.min(1, Math.max(0, elapsed / ROLL_MS))
  const eased = 1 - Math.pow(1 - p, 3)
  return Math.min(length - 1, Math.floor(eased * length))
}
