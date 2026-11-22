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
import { TOY_NAMES } from '../lab/names'

/**
 * ⚠️ THE FOUR OLD KINDS KEEP THEIR OWN NAMES, exactly as `activityLine` spells them. A second
 * vocabulary for one event is how two catalogues drift apart — that warning is written on
 * `activityLine` itself, about `review` vs `rating`, and it applies with more force here because
 * this module is the thing that would create the second catalogue.
 *
 * ⚠️ `comment` AND `made` ARE THE FEED'S OWN, and never `activityLine`'s, on purpose. That module
 * draws the Activity block on a profile page, which a public page shows to signed-out visitors;
 * these two come only from `feed_recent`, which refuses them. See
 * docs/applied/2026-11-14-feed-made-and-comments.DRAFT.sql.
 */
export type FeedKind = ActivityItem['kind'] | 'sitting' | 'comment' | 'made' | 'match'

/**
 * How a finished Lab match ended, from the side of the person whose row it is: they won, the two
 * of them drew, or the two of them beat the computer together. A loss is never posted, so there
 * is no word for one — see docs/applied/2026-11-16-feed-finished-matches.DRAFT.sql.
 */
export type MatchOutcome = 'won' | 'drew' | 'together'
export const MATCH_OUTCOMES: ReadonlySet<string> = new Set<MatchOutcome>([
  'won',
  'drew',
  'together',
])

/** Where a comment was left. Each is a different table read by its own room's rule. */
export type CommentPlace = 'workout' | 'lab' | 'guestbook'
export const COMMENT_PLACES: ReadonlySet<string> = new Set<CommentPlace>([
  'workout',
  'lab',
  'guestbook',
])

/** What can be made and put on a page: the block types `profile_showcase` accepts, one and many. */
const MADE: Readonly<Record<string, readonly [string, string]>> = {
  song: ['a song', 'songs'],
  art: ['a drawing', 'drawings'],
  pet: ['a pet', 'pets'],
  looks: ['a look', 'looks'],
}
export const MADE_KINDS: ReadonlySet<string> = new Set(Object.keys(MADE))

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
   * Comments only: where it was left, and on whose or what. For a comment `detail` is the
   * preview — at most 80 characters, on one line, cut by the server, so the whole of somebody's
   * words never travels to everybody's Feed.
   */
  on?: CommentPlace | null
  /** a workout's person, a guestbook's owner by first name, or a Lab toy's id */
  about?: string | null
  /** a guestbook's owner by username, so their name can be a door to their page */
  aboutWho?: string | null
  /** whether the workout or the guestbook is yours, so the line can say "your" */
  aboutMine?: boolean
  /**
   * Things made only: how many of this kind this person put up that day. The row stands for all
   * of them — see `oneMadePerDay`, which is the only thing that sets it.
   */
  count?: number
  /** Matches only: how it ended, and the toy's own words for the score ("24–12"), if it has any */
  outcome?: MatchOutcome | null
  how?: string | null
  result?: string | null
  /**
   * Matches only: the other player.
   *
   * ⚠️ NULL MEANS "NOT YOURS TO KNOW", NOT "NOBODY". The server names the other player only to one
   * of the two of them or to a friend of both, so a friend of one reads "a friend". Never fill it
   * in from anything else the client holds.
   */
  other?: string | null
  otherWho?: string | null
  /** the other player is you, so the line can say "you" */
  otherMine?: boolean
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
 * At most one "made" row per person, per kind of thing, per day: the newest, carrying how many it
 * stands for. Every other kind passes through untouched and in the order it came.
 *
 * ⚠️ HERE AND NOT IN `feed_recent`, BECAUSE THE DAY IS THE READER'S. The Feed is drawn under the
 * reader's own calendar days (`dayKeyOf`), and the server knows no timezone: a cap on the
 * server's day would leave two "Put a drawing" rows under one "Today" for anybody whose midnight
 * is not the server's. It is a cap on rows, not on what may be seen — every row it folds is one
 * the server already decided this reader may see.
 *
 * ⚠️ WHAT IT IS FOR is several blocks of one kind going up the same day. Editing ONE block is
 * already a single row: the server shows a version only while it is still on the page, so each
 * edit replaces the last (supabase/tests/feed-made-and-comments.sql, section E2).
 */
export function oneMadePerDay(events: readonly FeedEvent[]): FeedEvent[] {
  const slot = (e: FeedEvent) => `${e.who}\u0000${e.detail ?? ''}\u0000${dayKeyOf(e.at)}`
  const newest = new Map<string, FeedEvent>()
  const many = new Map<string, number>()
  for (const e of events) {
    if (e.kind !== 'made') continue
    const k = slot(e)
    many.set(k, (many.get(k) ?? 0) + 1)
    const was = newest.get(k)
    if (!was) {
      newest.set(k, e)
      continue
    }
    /* ties go to the smaller key, as mergeEvents orders them, so the row kept is the row that
       would have been drawn first */
    const d = Date.parse(e.at) - Date.parse(was.at)
    if (d > 0 || (d === 0 && eventKey(e) < eventKey(was))) newest.set(k, e)
  }
  return events.flatMap((e) => {
    if (e.kind !== 'made') return [e]
    const k = slot(e)
    if (newest.get(k) !== e) return []
    const n = many.get(k) ?? 1
    return [n > 1 ? { ...e, count: n } : e]
  })
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
 * The two halves of a comment's line: what was done, and to what.
 *
 * ⚠️ SHARED BY THE SENTENCE AND THE ROOM, so the words in the feed and the words a test reads are
 * the same words. A Lab toy is named from the Lab's own list; one it does not know (a toy newer
 * than this bundle) is named by its id rather than dropped.
 */
export function commentParts(e: FeedEvent): { verb: string; noun: string } {
  const whose = e.aboutMine ? 'your' : `${e.about ?? 'somebody'}'s`
  if (e.on === 'workout') return { verb: 'Commented on', noun: `${whose} workout` }
  if (e.on === 'guestbook') return { verb: 'Signed', noun: `${whose} guestbook` }
  if (e.on === 'lab')
    return { verb: 'Left a note on', noun: TOY_NAMES[e.about ?? ''] ?? e.about ?? 'a Lab toy' }
  return { verb: 'Wrote', noun: 'something' }
}

/**
 * The three parts of a finished match's line: what happened, to whom, and at what.
 *
 * ⚠️ SHARED BY THE SENTENCE AND THE ROOM, as `commentParts` is. `whom` is null when the other
 * player is not this reader's to know, and the line reads "a friend" rather than leaving a gap.
 */
export function matchParts(e: FeedEvent): {
  verb: string
  whom: string
  toy: string
  tail: string | null
} {
  const whom = e.otherMine ? 'you' : (e.other ?? 'a friend')
  const toy = TOY_NAMES[e.detail ?? ''] ?? e.detail ?? 'a Lab game'
  const how = e.how === 'resigned' ? 'by resignation' : e.how === 'timeout' ? 'on time' : null
  const tail = [e.result, how].filter(Boolean).join(', ') || null
  if (e.outcome === 'drew') return { verb: 'Drew with', whom, toy, tail }
  if (e.outcome === 'together') return { verb: 'Beat the computer with', whom, toy, tail }
  return { verb: 'Beat', whom, toy, tail }
}

/** "a song", "3 drawings" — what a made thing is called in a sentence */
export function madeNoun(detail: string | null, count = 1): string {
  const names = MADE[detail ?? '']
  if (!names) return 'something'
  return count > 1 ? `${count} ${names[1]}` : names[0]
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
  if (e.kind === 'comment') {
    const { verb, noun } = commentParts(e)
    return e.detail ? `${verb} ${noun}: “${e.detail}”` : `${verb} ${noun}`
  }
  if (e.kind === 'made')
    return `Put ${madeNoun(e.detail, e.count)} on ${e.mine ? 'your' : 'their'} page`
  if (e.kind === 'match') {
    const { verb, whom, toy, tail } = matchParts(e)
    return `${verb} ${whom} at ${toy}${tail ? ` · ${tail}` : ''}`
  }
  return activityLine({
    kind: e.kind,
    at: e.at,
    detail: e.detail,
    score: e.score,
    items: e.items,
  })
}
