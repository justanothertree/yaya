/**
 * One event in the site's feed, whatever room it happened in.
 *
 * ⚠️ THIS EXISTS BECAUSE THE SITE HAD A FEED AND IT ONLY KNEW ABOUT WORKOUTS. `#circuit?tab=feed`
 * is where the notification bell sends every kudos and every comment, and the only thing it can
 * show is a circuit day log — so somebody who rates films, plays snake and keeps a chronicle had
 * three quarters of their life on the site happening somewhere nobody looks. The fix is not a
 * second feed; it is one event shape that each room can answer in.
 *
 * ⚠️ IT IS PURE, AND THAT IS THE POINT. Merging, ordering and bucketing by day are the three
 * things a feed can get quietly wrong — a sitting filed under the wrong day is not an error, it
 * is just a lie — and all three are answerable with no browser and no session. See CLAUDE.md §2:
 * the rooms that put their logic in pure modules are the rooms that got checked.
 */
import { activityLine, type ActivityItem } from '../sections/activityLine'
import { countText, spanText } from '../chronicle/record'

/**
 * ⚠️ THE FOUR OLD KINDS KEEP THEIR OWN NAMES, exactly as `activityLine` spells them. A second
 * vocabulary for one event is how two catalogues drift apart — that warning is written on
 * `activityLine` itself, about `review` vs `rating`, and it applies with more force here because
 * this module is the thing that would create the second catalogue.
 */
export type FeedKind = ActivityItem['kind'] | 'sitting'

/**
 * Whose activity the feed is asking about.
 *
 * ⚠️ A FILTER, NOT A PERMISSION, and the distinction is worth keeping in front of whoever reads
 * this next. Every event has already been through `can_see` on the server, so `all_members` is
 * not a wider licence — it is a wider list of people to ask. Switching tabs can never reveal
 * something the other tab was hiding on purpose; it only stops leaving out the people you have
 * not befriended.
 */
export type FeedScope = 'you_and_friends' | 'all_members'

/** Narrow first, so the default is the smaller room and the wider one is a deliberate step. */
export const FEED_SCOPES: ReadonlyArray<{ id: FeedScope; label: string }> = [
  { id: 'you_and_friends', label: 'You + friends' },
  { id: 'all_members', label: 'All members' },
]

export type FeedEvent = {
  kind: FeedKind
  /**
   * The row's own id in its own table.
   *
   * ⚠️ UNIQUE ONLY WITHIN A KIND. Four tables mint their own ids and nothing stops two of them
   * colliding, so this is never a key on its own — see `eventKey`.
   */
  id: string
  /** whose event it is: the username, which is what every link on the site is keyed by */
  who: string
  /** what to call them on screen; their first name where they have one, else the username */
  name: string
  /** when it happened — for a span, when it STARTED, because that is when you did the thing */
  at: string
  /**
   * Spans only (a chronicle sitting): when it ended.
   *
   * ⚠️ A sitting is the one kind with a duration, and the duration is most of what it says. The
   * other four are instants: a rating happens, a score happens.
   */
  until?: string | null
  /** the noun — an activity name, a film title, a trophy; null where the kind has none */
  detail: string | null
  /** the number — points, a rating out of 100, a snake score; null where the kind has none */
  score: number | null
  /** sittings only: a dot colour the owner chose, so the feed reads like their chronicle does */
  colour?: string | null
  /** sittings only: `amount` and its unit, where the activity counts something */
  amount?: number | null
  metric?: string | null
  /** circuit logs only: what was actually done, resolved against their own exercise list */
  items?: ActivityItem['items']
  /**
   * Yours.
   *
   * ⚠️ THE SERVER DECIDES THIS, not a comparison in the client. Working it out here would mean
   * holding your own username to compare against — one more thing to fetch, and one more thing
   * to be wrong about while it is still loading, which is exactly when the feed first paints.
   *
   * ⚠️ AND FOR A SITTING IT MEANS MORE THAN WHOSE IT IS. Your own sittings reach the feed only
   * through the same gates a friend's do, so one of yours appearing here is the proof that your
   * sharing is actually on — see the migration `the_feed_includes_you`.
   */
  mine?: boolean
}

/**
 * The key a kudos or a comment hangs off.
 *
 * ⚠️ THE KIND IS PART OF IT, AND LEAVING IT OUT WOULD BE A PRIVACY BUG RATHER THAN A DISPLAY ONE.
 * `circuit_log_reactions` keys on a bare `log_id` because there was only ever one kind of thing
 * to react to. Give four tables one namespace and a rating that happens to share a uuid with a
 * day log wears that log's comments — somebody's words about a workout appearing under somebody
 * else's film. Unlikely per pair and certain eventually, which is the shape of every id collision.
 */
export const eventKey = (e: Pick<FeedEvent, 'kind' | 'id'>): string => `${e.kind}:${e.id}`

/**
 * Every event from every room, newest first.
 *
 * ⚠️ DEDUPED BY KEY, because the same row can arrive twice honestly: the server sends a window
 * and the client holds the previous one, and a refresh that overlaps is the normal case rather
 * than a fault. First writer wins, so a fresher copy passed first is the one kept.
 */
export function mergeEvents(...lists: ReadonlyArray<readonly FeedEvent[]>): FeedEvent[] {
  const seen = new Set<string>()
  const all: FeedEvent[] = []
  for (const list of lists)
    for (const e of list) {
      const k = eventKey(e)
      if (seen.has(k)) continue
      seen.add(k)
      all.push(e)
    }
  /**
   * ⚠️ TIES BROKEN BY KEY, not left to the sort's own stability. Two events can share an instant
   * — a circuit log and a rating are both stamped at a date with no clock — and an order that
   * depends on which room answered first makes the feed reshuffle under the reader on every
   * refresh. The key is arbitrary and it is the same every time, which is the whole requirement.
   */
  return all.sort((a, b) => {
    const d = Date.parse(b.at) - Date.parse(a.at)
    return d !== 0 ? d : eventKey(a).localeCompare(eventKey(b))
  })
}

/**
 * The local calendar day an instant falls in.
 *
 * ⚠️ NEVER A UTC SLICE, which is the bug this is written to not have. `iso.slice(0, 10)` is
 * right for most of the day and wrong for the hours either side of midnight — and "wrong" means
 * a sitting you did last night filed under tomorrow, which reads as the feed being broken rather
 * than as a timezone. Same reasoning, same implementation, as the chronicle's own day keys.
 */
export function dayKeyOf(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * The feed in day buckets, newest day first, each day's events still newest first.
 *
 * Returns pairs rather than an object: insertion order on an object with date-like string keys
 * is not something to rely on, and the caller wants them in order rather than wanting to look
 * one up.
 */
export function groupByDay(events: readonly FeedEvent[]): Array<[string, FeedEvent[]]> {
  const days: Array<[string, FeedEvent[]]> = []
  for (const e of events) {
    const k = dayKeyOf(e.at)
    const last = days[days.length - 1]
    if (last && last[0] === k) last[1].push(e)
    else days.push([k, [e]])
  }
  return days
}

/**
 * What a sitting says, in words.
 *
 * ⚠️ THE OTHER FOUR ARE NOT WRITTEN HERE — `activityLine` owns them and keeps owning them. This
 * function exists because a sitting is the one kind that module has never seen, and adding a
 * fifth branch there would mean a sentence about a duration in a module whose every other
 * sentence is about an instant.
 */
function sittingSentence(e: FeedEvent): string {
  const when = new Date(e.at).toLocaleDateString()
  const len = e.until ? spanText(Date.parse(e.until) - Date.parse(e.at)) : null
  const much = e.amount != null && e.metric ? `${countText(e.amount)} ${e.metric}` : null
  return [e.detail ?? 'Something', len, much, when].filter(Boolean).join(' · ')
}

/**
 * One line for any event in the feed.
 *
 * ⚠️ EVERY KIND GETS A SENTENCE, and the test that says so is the reason this is a function
 * rather than four branches at the call site. A kind added to `FeedKind` with no sentence
 * written for it is the failure mode — the feed does not crash, it renders a row with nothing
 * in it, which looks like missing data rather than missing code.
 */
export function feedSentence(e: FeedEvent): string {
  if (e.kind === 'sitting') return sittingSentence(e)
  return activityLine({
    kind: e.kind,
    at: e.at,
    detail: e.detail,
    score: e.score,
    items: e.items,
  })
}
