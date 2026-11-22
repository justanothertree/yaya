/**
 * ── DEV-ONLY: the Circuit feed's kudos and comments, signed in, with no session ─────────────────
 *
 * OPEN-DECISIONS §22c. The layout sweep of 10 Nov reached every Chronicle and Circuit screen except
 * three, because they read Supabase directly and the preview has no session: the feed's comments,
 * its reactions, and the Circuits panel's list. #128 shipped a fix to the comments on reasoning and
 * a seeded copy, because the pane could only ever show them empty.
 *
 * ⚠️ THE REAL HOOK, WITH A DOUBLE WHERE THE NETWORK WAS — the same choice as dev/circuitPreview.ts.
 * `useFeedSocial` runs unchanged, its loads, toggles, posts and deletes included, over a client that
 * answers here. Replacing the hook instead would have tested this file.
 *
 * ⚠️ THE SERVER'S RULES, IN THE SERVER'S OWN WORDS (CLAUDE.md §2: an unfaithful double hides bugs
 * as well as inventing them). From the baseline schema and its policies:
 * - `circuit_log_comments_body_check`: `char_length(body)` between 1 and 1000. CHARACTERS, not
 *   UTF-16 units, so a comment of a thousand emoji is allowed and `.length` would refuse it.
 * - `clc_insert` / `clr_insert`: `user_id = auth.uid()` and `circuit_can_see_log(log_id)`.
 * - `circuit_log_reactions_pkey`: (log_id, user_id, emoji), so a second identical kudos fails.
 * - `clc_delete` / `clr_delete`: your own rows (or an admin's — the preview is not one). Under RLS
 *   somebody else's row is not an error, it is zero rows.
 * - `clc_select` / `clr_select`: only rows on a log you can see.
 * Every log the preview board holds is one you can see, so `can_see_log` is "the log exists".
 *
 * NOT MODELLED: suspension (the preview is never suspended), admins, `author_name` being anything
 * but what the caller sends (the server stores it as given, too).
 *
 * Reached only through `circuit/social.ts`, behind `import.meta.env.DEV && previewMember` and a
 * dynamic import, so the production bundle has no path to it. Grep `dist/` for `pv-c-jordan`.
 */
import { PREVIEW_ME } from './previewMember'
import { pvCircuitLogs } from './chroniclePreview'

type Reaction = {
  log_id: string
  user_id: string
  emoji: string
  author_name: string | null
  created_at: string
}
type Comment = {
  id: string
  log_id: string
  user_id: string
  author_name: string | null
  body: string
  created_at: string
}
type Answer = { data: unknown; error: { message: string; code: string } | null }

const ok = (data: unknown = null): Answer => ({ data, error: null })
const no = (code: string, message: string): Answer => ({ data: null, error: { message, code } })
const rls = (table: string) =>
  no('42501', `new row violates row-level security policy for table "${table}"`)

const JORDAN = 'preview-jordan'
const SAM = 'preview-sam'

/** minutes before now, as the server's `timestamptz` text */
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

/**
 * Built on first use rather than at import, so the store holds the board's log ids as they are
 * when the feed first asks. ⚠️ THE COMMENTS ARE STORED OUT OF ORDER on purpose: the hook asks for
 * `order('created_at')`, and a double that already held them in order could not tell whether it
 * was asked.
 */
let S: { reactions: Reaction[]; comments: Comment[] } | null = null
function store() {
  if (S) return S
  const log = pvCircuitLogs()[0]?.id
  S = { reactions: [], comments: [] }
  if (!log) return S
  S.reactions.push(
    { log_id: log, user_id: JORDAN, emoji: '🔥', author_name: 'Jordan', created_at: ago(50) },
    {
      log_id: log,
      user_id: SAM,
      emoji: '🔥',
      author_name: 'Samantha Okonkwo-Fitzgerald',
      created_at: ago(40),
    },
    {
      log_id: log,
      user_id: PREVIEW_ME.id,
      emoji: '💪',
      author_name: 'Preview You',
      created_at: ago(30),
    },
  )
  S.comments.push(
    {
      id: 'pv-c-you',
      log_id: log,
      user_id: PREVIEW_ME.id,
      author_name: 'Preview You',
      body: 'Ninety and not a second more.',
      created_at: ago(20),
    },
    {
      id: 'pv-c-jordan',
      log_id: log,
      user_id: JORDAN,
      author_name: 'Jordan',
      body: 'A ninety-second plank? Show-off.',
      created_at: ago(45),
    },
    {
      id: 'pv-c-sam',
      log_id: log,
      user_id: SAM,
      author_name: 'Samantha Okonkwo-Fitzgerald',
      /* long, with one unbroken run in it: the line a narrow card has to wrap */
      body:
        'Twenty quad curls two days after leg day is more than I managed all month. I wrote the routine ' +
        'down here so I stop losing it: https://example.com/notes/legs/quad-curls-and-planks-the-whole-' +
        'routine-written-out-so-nobody-has-to-ask-again — tell me if the numbers look wrong.',
      created_at: ago(35),
    },
  )
  return S
}

/** `circuit_can_see_log`: every log on the preview board is one you can see */
const canSee = (logId: string) => pvCircuitLogs().some((g) => g.id === logId)

/** what `char_length` counts: characters, so an emoji is one and not two */
const chars = (s: string) => [...s].length

let next = 1

/** per channel, so removing one subscription leaves the others listening — as realtime does */
const channels = new Map<object, Set<() => void>>()
const echo = () => setTimeout(() => channels.forEach((hs) => hs.forEach((h) => h())), 30)

function insert(table: string, row: Record<string, unknown>): Answer {
  const s = store()
  const logId = String(row.log_id ?? '')
  if (row.user_id !== PREVIEW_ME.id || !canSee(logId)) return rls(table)
  if (table === 'circuit_log_comments') {
    const body = String(row.body ?? '')
    const n = chars(body)
    if (n < 1 || n > 1000) {
      return no(
        '23514',
        'new row for relation "circuit_log_comments" violates check constraint "circuit_log_comments_body_check"',
      )
    }
    s.comments.push({
      id: `pv-c-new-${next++}`,
      log_id: logId,
      user_id: PREVIEW_ME.id,
      author_name: (row.author_name as string | null) ?? null,
      body,
      created_at: new Date().toISOString(),
    })
  } else if (table === 'circuit_log_reactions') {
    const emoji = String(row.emoji ?? '')
    if (
      s.reactions.some(
        (r) => r.log_id === logId && r.user_id === PREVIEW_ME.id && r.emoji === emoji,
      )
    ) {
      return no(
        '23505',
        'duplicate key value violates unique constraint "circuit_log_reactions_pkey"',
      )
    }
    s.reactions.push({
      log_id: logId,
      user_id: PREVIEW_ME.id,
      emoji,
      author_name: (row.author_name as string | null) ?? null,
      created_at: new Date().toISOString(),
    })
  } else {
    return no('42P01', `relation "public.${table}" does not exist`)
  }
  echo()
  return ok()
}

/** a thenable that runs once awaited, and can be narrowed by `.eq()` first — PostgREST's shape */
function deleting(table: string) {
  const where: Record<string, string> = {}
  const matches = (r: Record<string, unknown>) =>
    /* RLS first: only your own rows are there to be deleted */
    r.user_id === PREVIEW_ME.id && Object.entries(where).every(([k, v]) => r[k] === v)
  const run = (): Answer => {
    const s = store()
    if (table === 'circuit_log_comments') s.comments = s.comments.filter((c) => !matches(c))
    else if (table === 'circuit_log_reactions') s.reactions = s.reactions.filter((r) => !matches(r))
    echo()
    return ok()
  }
  const q = {
    eq(col: string, v: string) {
      where[col] = v
      return q
    },
    then<T>(res: (a: Answer) => T, rej?: (e: unknown) => T) {
      return Promise.resolve(run()).then(res, rej)
    },
  }
  return q
}

/** `select('*')`, awaitable as it is or after `.order(column, { ascending })` */
function selecting(table: string) {
  const rows = (): Record<string, unknown>[] => {
    const s = store()
    const all =
      table === 'circuit_log_comments'
        ? s.comments
        : table === 'circuit_log_reactions'
          ? s.reactions
          : []
    return all.filter((r) => canSee(r.log_id)).map((r) => ({ ...r }))
  }
  const answer = (rs: Record<string, unknown>[]) => Promise.resolve(ok(rs))
  return {
    order(col: string, opts: { ascending?: boolean } = {}) {
      const dir = opts.ascending === false ? -1 : 1
      return answer(rows().sort((a, b) => dir * String(a[col]).localeCompare(String(b[col]))))
    },
    then<T>(res: (a: Answer) => T, rej?: (e: unknown) => T) {
      return answer(rows()).then(res, rej)
    },
  }
}

const client = {
  auth: {
    getUser: () => Promise.resolve({ data: { user: { id: PREVIEW_ME.id } }, error: null }),
  },
  from(table: string) {
    return {
      select: () => selecting(table),
      insert: (row: Record<string, unknown>) => Promise.resolve(insert(table, row)),
      delete: () => deleting(table),
    }
  },
  channel() {
    const hs = new Set<() => void>()
    const ch = {
      on(_kind: string, _filter: unknown, cb: () => void) {
        hs.add(cb)
        return ch
      },
      subscribe(cb?: (status: string) => void) {
        channels.set(ch, hs)
        cb?.('SUBSCRIBED')
        return ch
      },
    }
    return ch
  },
  removeChannel(ch: object) {
    channels.delete(ch)
    return Promise.resolve('ok')
  },
}

/** the client `useFeedSocial` gets in the preview; see `circuit/social.ts` */
export function previewSocialClient(): typeof client {
  return client
}

/** for the test: forget everything, so each case starts from the seed */
export function resetPreviewSocial(): void {
  S = null
  channels.clear()
}
