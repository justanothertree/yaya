/**
 * The Lab's votes, notes and owner controls, as calls to the server's functions. Every rule — who
 * may vote, who reads which note, the length and rate limits, who is the admin — is decided in
 * the database (supabase/drafts/lab-catalog-and-feedback.sql). The checks the panel makes before
 * sending are a courtesy so a person is told sooner; they are not the rule, and nothing here
 * trusts its own copy of one.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClientOrNull } from '../finance/client'

export type NoteKind = 'idea' | 'more' | 'bug'
export const NOTE_KINDS: { id: NoteKind; label: string }[] = [
  { id: 'idea', label: '💡 Idea' },
  { id: 'more', label: '➕ More of this' },
  { id: 'bug', label: '🐞 Something’s wrong' },
]
export const REPORT_REASONS = [
  { id: 'spam', label: 'Spam' },
  { id: 'unkind', label: 'Unkind' },
  { id: 'unsafe', label: 'Unsafe' },
  { id: 'other', label: 'Something else' },
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]['id']

/** the same bounds the table holds, so a person hears about them before sending */
export const NOTE_MIN = 2
export const NOTE_MAX = 500
export const NOTE_MAX_BREAKS = 8

export type Note = {
  id: string
  kind: NoteKind
  body: string
  author: string
  mine: boolean
  at: string
  edited: string | null
  removed: boolean
}

export type Page = { items: Note[]; more: boolean }

const KINDS = new Set(['idea', 'more', 'bug'])

/** one note from the server, or null if it is not the shape a note has */
export function readNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.kind !== 'string' || !KINDS.has(o.kind)) return null
  if (typeof o.at !== 'string') return null
  return {
    id: o.id,
    kind: o.kind as NoteKind,
    body: typeof o.body === 'string' ? o.body.slice(0, NOTE_MAX) : '',
    author: typeof o.author === 'string' ? o.author.slice(0, 40) : 'a member',
    mine: o.mine === true,
    at: o.at,
    edited: typeof o.edited === 'string' ? o.edited : null,
    removed: o.removed === true,
  }
}

export function readPage(raw: unknown): Page {
  const o = (raw ?? {}) as { items?: unknown; more?: unknown }
  const items = Array.isArray(o.items) ? o.items.slice(0, 30) : []
  return {
    items: items.map(readNote).filter((n): n is Note => n !== null),
    more: o.more === true,
  }
}

/**
 * What a person is told when the server says no. The database speaks in a few fixed sentences;
 * anything else is reported as a failure to reach it rather than echoed, so an internal message
 * never ends up on screen.
 */
export function explain(e: unknown): string {
  const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : ''
  const known: [RegExp, string][] = [
    [/sign in first/, 'Sign in to do that.'],
    [/cannot post/, 'This account can’t post right now.'],
    [
      /five notes in ten minutes/,
      'That’s five notes in ten minutes — try again in a little while.',
    ],
    [/twenty notes a day/, 'That’s twenty notes today — the rest will have to wait for tomorrow.'],
    [/already left that note/, 'You’ve already left that note today.'],
    [/ten reports an hour/, 'That’s ten reports this hour — try again later.'],
    [/retired/, 'This experiment has been retired.'],
    [/no such (experiment|note)/, 'That isn’t there any more.'],
    [/not allowed/, 'Only the site’s owner can do that.'],
    [/is yours/, 'That note is yours — edit or delete it instead.'],
    // a value the page itself chose that the server does not know: a stale page, not the person
    [
      /^(a vote is|a note is an|a report says|remove, restore|between none)/,
      'This page is out of date — reload it and try again.',
    ],
    [
      /lab_comments_(length|trimmed|plain|lines)/,
      'A note is 2–500 characters of plain text, up to nine lines.',
    ],
  ]
  for (const [re, said] of known) if (re.test(msg)) return said
  return 'Couldn’t reach the server — nothing was changed.'
}

/**
 * Whether an error means the database has no Lab functions at all — PostgREST's answer for a
 * function it cannot find — as against a call that failed on the way. Only the first is a reason to
 * stop offering votes and notes: until the draft SQL is applied every press would fail, and say it
 * "couldn't reach the server" about a server that answered.
 */
export function noLabYet(e: unknown): boolean {
  const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : ''
  return code === 'PGRST202'
}

type Rpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T>

function rpcWith(client: SupabaseClient | null): Rpc | null {
  if (!client) return null
  return async <T>(fn: string, args?: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw error
    return data as T
  }
}

/** the calls, or null when this build has no backend to call (a fork, or a local run without one) */
export function labApi(rpc: Rpc | null = rpcWith(getSupabaseClientOrNull())) {
  if (!rpc) return null
  return {
    catalog: () => rpc<unknown>('lab_catalog'),
    vote: (demo: string, value: 1 | -1 | 0) =>
      rpc<{ up?: number; down?: number; mine?: 1 | -1 | null }>('lab_vote', {
        p_demo: demo,
        p_value: value,
      }),
    page: async (demo: string, before?: Note) =>
      readPage(
        await rpc('lab_comments_page', {
          p_demo: demo,
          p_before: before?.at ?? null,
          p_before_id: before?.id ?? null,
          p_limit: 20,
        }),
      ),
    add: async (demo: string, kind: NoteKind, body: string) =>
      readNote(await rpc('lab_comment_add', { p_demo: demo, p_kind: kind, p_body: body })),
    edit: async (id: string, body: string | null, kind: NoteKind | null) =>
      readNote(await rpc('lab_comment_edit', { p_id: id, p_body: body, p_kind: kind })),
    remove: (id: string) => rpc<boolean>('lab_comment_delete', { p_id: id }),
    report: (id: string, reason: ReportReason) =>
      rpc<'reported' | 'already'>('lab_comment_report', { p_id: id, p_reason: reason }),
    // the owner's — the database refuses everybody else on the first line of each
    setDemo: (
      demo: string,
      flags: Partial<{ featured: boolean; experiment: boolean; hidden: boolean }>,
    ) =>
      rpc<unknown>('admin_lab_set_demo', {
        p_demo: demo,
        p_featured: flags.featured ?? null,
        p_experiment: flags.experiment ?? null,
        p_hidden: flags.hidden ?? null,
      }),
    register: (ids: string[]) => rpc<number>('admin_lab_register', { p_ids: ids }),
    reports: async () => {
      const raw = await rpc<unknown>('admin_lab_reports')
      return (Array.isArray(raw) ? raw.slice(0, 100) : []).flatMap((r) => {
        const n = readNote(r)
        if (!n) return []
        const o = r as { demo?: unknown; reasons?: unknown; state?: unknown }
        const reasons: Record<string, number> = {}
        if (o.reasons && typeof o.reasons === 'object')
          for (const [k, v] of Object.entries(o.reasons))
            if (typeof v === 'number' && REPORT_REASONS.some((x) => x.id === k)) reasons[k] = v
        return [
          {
            ...n,
            demo: typeof o.demo === 'string' ? o.demo : '',
            reasons,
            // 'open': somebody reported it; 'removed': the admin took it down, and can restore it
            state: o.state === 'removed' ? ('removed' as const) : ('open' as const),
          },
        ]
      })
    },
    moderate: async (id: string, action: 'remove' | 'restore' | 'keep') =>
      readNote(await rpc('admin_lab_moderate', { p_id: id, p_action: action })),
  }
}
export type LabApi = NonNullable<ReturnType<typeof labApi>>

/** a note's text the way the server will store it, and why not if it won't */
export function checkNote(body: string): string | null {
  const t = body.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim()
  if (t.length < NOTE_MIN) return 'Write a little more.'
  if (t.length > NOTE_MAX) return `${t.length - NOTE_MAX} characters over the ${NOTE_MAX}.`
  if ((t.match(/\n/g) ?? []).length > NOTE_MAX_BREAKS) return 'Nine lines at most.'
  // eslint-disable-next-line no-control-regex
  if (/[\x01-\x09\x0b-\x1f\x7f]/.test(t)) return 'Plain text only, please.'
  return null
}

/** what the closed notes fold says before anybody opens it — counted from the first page the
 *  viewer was sent, so it is a count of what THIS viewer may read, never of everybody's notes
 *  (the draft keeps that from members on purpose: it would be a picture of activity the ladder
 *  hides). A full first page means there may be more, and says so rather than guessing. */
export function notesSummary(count: number | null, more: boolean): string {
  if (count === null) return 'ideas, requests and bugs'
  if (!count) return 'none yet'
  return `${count}${more ? '+' : ''} to read`
}
