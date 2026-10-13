/**
 * The record — what you actually did, as opposed to what you meant to.
 *
 * Step 2 of docs/2026-10-12-chronicle-design.md. An entry is a span of time against an activity,
 * and the running timer IS an entry with no end — which is what lets it survive a closed tab and
 * turn up on a phone. The database enforces one open entry per person with a partial unique index,
 * so "what am I doing right now" has exactly one answer rather than a most-likely one.
 *
 * ⚠️ EVERYTHING HERE IS PURE, AND THAT IS THE POINT. The hard part of a time tracker is not the
 * timer, it is the arithmetic of attributing a span to a day — and a span can begin yesterday,
 * cross midnight, and still be running. That question has an exact answer, so it is asked here
 * where it can be tested, rather than in a component where it can only be eyeballed.
 */

/** A span against an activity. `end` null is the timer that is still going. */
export type Entry = {
  id: string
  activity: string
  /** ISO instants, as the server sends them */
  start: string
  end: string | null
  note: string | null
}

export type Activity = {
  id: string
  name: string
  cat: 'locked' | 'free' | 'life'
  colour: string | null
  archived: boolean
}

/**
 * The three categories, in the order the room shows them.
 *
 * ⚠️ THESE ARE THE WORDS THE HTML APP USED, which is the only reason they are the right words.
 * The first version of this list said "Committed / Yours / Upkeep" — my invention, and reported
 * exactly as you would expect: "i dont understand the choices". The app being rebuilt has said
 * `Locked In`, `Free Time` and `Life` on screen for its whole life, in a picker, in a filter row
 * and in the day's totals. Somebody who has used it knows what they mean, and no amount of my
 * being pleased with a synonym is worth making them learn it twice.
 *
 * The stored values are unchanged — `locked`, `free`, `life` — so this was only ever a label.
 */
export const CATS = [
  ['locked', 'Locked In'],
  ['free', 'Free Time'],
  ['life', 'Life'],
] as const

/**
 * How much of an entry falls inside a window, in milliseconds.
 *
 * ⚠️ THE OVERLAP, NOT THE WHOLE SPAN, and this is the one piece of arithmetic the rest of the
 * module is built on. A session from 23:00 to 01:00 is two hours long and belongs to two days —
 * one hour each. Attributing it to the day it STARTED would make a night's work vanish from
 * tomorrow; attributing it to both in full would count it twice and make eight hours of logging
 * report sixteen. The sum of its overlaps with any set of windows that tile a range is exactly
 * its length inside that range, and the test asserts that rather than any particular hour.
 *
 * ⚠️ AN OPEN ENTRY IS MEASURED TO `nowMs` AND NO FURTHER. A running timer has no end, so its
 * length is "so far" — and the caller passes the clock rather than this reading it, so a test can
 * ask about a running timer without waiting.
 */
export function overlapMs(e: Entry, fromMs: number, toMs: number, nowMs: number): number {
  const a = Date.parse(e.start)
  if (!Number.isFinite(a)) return 0
  const raw = e.end == null ? nowMs : Date.parse(e.end)
  const b = Number.isFinite(raw) ? raw : nowMs
  /* ⚠️ a backwards span contributes nothing rather than a negative: the table refuses one, so
     this is about a row that arrived from somewhere else being unable to make a total smaller */
  if (b <= a) return 0
  const lo = Math.max(a, fromMs)
  const hi = Math.min(b, toMs)
  return hi > lo ? hi - lo : 0
}

/** Minutes per activity id inside a window — what a day's totals are made of. */
export function minutesByActivity(
  entries: Entry[],
  fromMs: number,
  toMs: number,
  nowMs: number,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of entries) {
    const ms = overlapMs(e, fromMs, toMs, nowMs)
    if (ms <= 0) continue
    out[e.activity] = (out[e.activity] ?? 0) + ms / 60_000
  }
  return out
}

/** Minutes per category, which is the reading the three categories exist for. */
export function minutesByCat(
  entries: Entry[],
  acts: Activity[],
  fromMs: number,
  toMs: number,
  nowMs: number,
): Record<string, number> {
  const catOf = new Map(acts.map((a) => [a.id, a.cat]))
  const out: Record<string, number> = {}
  for (const e of entries) {
    const ms = overlapMs(e, fromMs, toMs, nowMs)
    if (ms <= 0) continue
    const c = catOf.get(e.activity) ?? 'free'
    out[c] = (out[c] ?? 0) + ms / 60_000
  }
  return out
}

/**
 * A length of time, as a person would say it.
 *
 * ⚠️ NO LEADING ZERO HOUR AND NO BARE MINUTES OVER AN HOUR. "0h 7m" and "83m" are both things a
 * clock says and neither is what anybody reads out loud. Under a minute says seconds, because a
 * timer that has just started must visibly be running.
 */
export function spanText(ms: number): string {
  if (!(ms > 0)) return '0m'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h}h ${rest}m` : `${h}h`
}

/** The clock face for a running timer: h:mm:ss, which is the one place seconds belong. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/** The local day a window covers, as millisecond bounds — half-open, like every other window. */
export function dayBounds(iso: string): { fromMs: number; toMs: number } {
  const [y, m, d] = iso.split('-').map(Number)
  /* ⚠️ built from local parts rather than parsed from the string, because `new Date('2026-10-12')`
     is parsed as UTC midnight and lands on the 11th for anybody behind it — the same trap
     circuit/dates.ts opens with a warning about */
  const from = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
  const to = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1, 0, 0, 0, 0)
  return { fromMs: from.getTime(), toMs: to.getTime() }
}
