import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'
import type { FeedEvent, FeedKind } from './event'

/**
 * The feed, fetched.
 *
 * ⚠️ ONE ROUND TRIP FOR FIVE KINDS, which is the point of `feed_recent` existing at all. The
 * alternative — ask each room separately and stitch the answers here — puts the visibility rules
 * in the client, where they would be a second copy of five server-side decisions. The server
 * merges; this file only translates.
 */

const KINDS: ReadonlySet<string> = new Set<FeedKind>([
  'sitting',
  'circuit_log',
  'rating',
  'snake_score',
  'snake_trophy',
])

/**
 * One row from the RPC into one event.
 *
 * ⚠️ IT RETURNS NULL FOR ANYTHING IT DOES NOT RECOGNISE, rather than coercing. A row with no
 * `at` cannot be ordered and a row with an unknown `kind` has no sentence written for it, so
 * both would render as a blank line in the middle of the feed — which reads as missing data
 * when it is really a client that is older than its server. Dropping it is the honest failure.
 */
function toEvent(r: Record<string, unknown>): FeedEvent | null {
  const kind = String(r.kind ?? '')
  if (!KINDS.has(kind)) return null
  const at = String(r.at ?? '')
  if (!at || Number.isNaN(Date.parse(at))) return null
  const id = String(r.id ?? '')
  if (!id) return null
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v))
  return {
    kind: kind as FeedKind,
    id,
    who: String(r.who ?? ''),
    name: String(r.name ?? r.who ?? ''),
    at,
    until: typeof r.until === 'string' ? r.until : null,
    detail: typeof r.detail === 'string' ? r.detail : null,
    score: num(r.score),
    colour: typeof r.colour === 'string' ? r.colour : null,
    amount: num(r.amount),
    metric: typeof r.metric === 'string' ? r.metric : null,
    items: Array.isArray(r.items) ? (r.items as FeedEvent['items']) : null,
    mine: r.mine === true,
  }
}

export async function fetchFeed(
  fromISO: string,
  toISO: string,
  perMember = 40,
): Promise<FeedEvent[]> {
  if (previewMember) return previewFeed()
  const { data, error } = await getSupabaseClient().rpc('feed_recent', {
    p_from: fromISO,
    p_to: toISO,
    p_per_member: perMember,
  })
  if (error || !Array.isArray(data)) return []
  return (data as Array<Record<string, unknown>>)
    .map(toEvent)
    .filter((e): e is FeedEvent => e !== null)
}

/**
 * The feed with something in it, for the workbenches.
 *
 * ⚠️ A FUNCTION RATHER THAN A CONSTANT, and that is not a style choice. CLAUDE.md records that
 * `previewMember.ts` shipped 2.78 kB of invented fixture to real users because a module-scope
 * call is a side effect rollup cannot prove pure — and that the second cause, a binding
 * re-exported across a chunk boundary, survives even an `import.meta.env.DEV` guard. Built
 * inside a function, the `Date` work happens only when a workbench asks, and there is no
 * populated array sitting at module scope for the bundler to carry.
 *
 * ⚠️ IT COVERS EVERY KIND AND BOTH SIDES OF `mine`, because the room has a branch for each and
 * a fixture that exercises four of five branches is how the fifth ships broken. The sitting with
 * an amount is deliberate too: `metric` is the one optional field the sentence changes shape for.
 */
export function previewFeed(): FeedEvent[] {
  const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()
  return [
    {
      kind: 'sitting',
      id: 'pv-f-1',
      who: 'preview-you',
      name: 'You',
      at: ago(90),
      until: ago(45),
      detail: 'Guitar',
      score: null,
      colour: '#7c6af7',
      mine: true,
    },
    {
      kind: 'circuit_log',
      id: 'pv-f-2',
      who: 'cam',
      name: 'Cam',
      at: ago(200),
      detail: 'The Crew',
      score: 118,
      items: [
        { name: 'Push-ups', unit: 'reps', val: 40, points: 40 },
        { name: 'Run', unit: 'km', val: 5, points: 78 },
      ],
    },
    {
      kind: 'rating',
      id: 'pv-f-3',
      who: 'josh',
      name: 'Josh',
      at: ago(420),
      detail: 'Mistfall Hunter',
      score: 94,
    },
    {
      kind: 'sitting',
      id: 'pv-f-4',
      who: 'cam',
      name: 'Cam',
      at: ago(1_500),
      until: ago(1_440),
      detail: 'Reading',
      score: null,
      colour: '#46b17b',
      amount: 38,
      metric: 'pages',
    },
    {
      kind: 'snake_trophy',
      id: 'pv-f-5',
      who: 'salty',
      name: 'Salty',
      at: ago(2_900),
      detail: 'Longest run',
      score: 2140,
    },
    {
      kind: 'snake_score',
      id: 'pv-f-6',
      who: 'preview-you',
      name: 'You',
      at: ago(4_300),
      detail: 'Classic',
      score: 870,
      mine: true,
    },
  ]
}
