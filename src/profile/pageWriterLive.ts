import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'
import { createPageWriter, type Answer, type Deps, type PageWriter } from './pageWriter'
import { writers } from './writerRegistry'

/**
 * The page writer wired to the real server: one per member, per tab.
 *
 * - **Every request of a job carries the token the job started with** (`setHeader`), so a session
 *   that changes in the middle of a job cannot make its second request as somebody else.
 *   supabase-js only adds its own Authorization header when one is not already set.
 * - **Web Locks** keep two tabs of one member from writing the page at the same time, where the
 *   browser has them (Safari 15.4+, Firefox 96+); without them a tab only orders its own writes.
 * - **A BroadcastChannel** tells this member's other tabs the page was written, so an editor open
 *   there learns its copy is old before its next keystroke rather than at its next save. It
 *   carries who, never what.
 * - **A request gives up after 15 seconds**, and that counts as no answer: a save so treated is
 *   checked by the next read, never assumed (pageWriter, "unacknowledged").
 */

let channel: BroadcastChannel | null = null

function listen() {
  if (channel || typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel('yaya.profile-page')
  channel.onmessage = (e: MessageEvent) => {
    const uid = (e.data as { uid?: unknown } | null)?.uid
    if (typeof uid === 'string') void writers.get(uid)?.probe()
  }
}

const browserDeps = (uid: string): Omit<Deps, 'rpc' | 'session'> => ({
  uid,
  lock: <T>(name: string, fn: () => Promise<T>): Promise<T> =>
    typeof navigator !== 'undefined' && navigator.locks
      ? (navigator.locks.request(name, fn) as Promise<T>)
      : fn(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (t) => window.clearTimeout(t as number),
  post: () => channel?.postMessage({ uid, type: 'written' }),
})

/**
 * ⚠️ THE PREVIEW HARNESS HAS NO SESSION, so there the writer runs against the same faithful double
 * its tests use, seeded with the preview member's own page. DEV only, and written as
 * `import.meta.env.DEV && …` in this expression so a production build folds the branch — and the
 * dynamic imports in it — away (CLAUDE.md: a dev-only harness is a claim about the bundle).
 */
function previewDeps(uid: string): Pick<Deps, 'rpc' | 'session'> {
  const server = (async () => {
    const [{ profileServerDouble }, { previewMyBlocks }] = await Promise.all([
      import('../dev/profileServerDouble'),
      import('../dev/previewMember'),
    ])
    const srv = profileServerDouble()
    const token = srv.member(uid, 'preview')
    await srv.rpc('save_my_profile_blocks', { p_blocks: previewMyBlocks() }, token)
    return { srv, token }
  })()
  return {
    rpc: async (fn, args, token) => (await server).srv.rpc(fn, args, token),
    session: async () => ({ uid, token: (await server).token }),
  }
}

export function writerFor(uid: string): PageWriter {
  const had = writers.get(uid)
  if (had) return had
  listen()
  const sb = getSupabaseClient()
  const live: Pick<Deps, 'rpc' | 'session'> = {
    rpc: async (fn, args, token): Promise<Answer> => {
      const q = sb.rpc(fn, args).setHeader('Authorization', `Bearer ${token}`)
      /* ⚠️ AbortSignal.timeout is missing before Safari 16 and Firefox 100; without it a request
         simply waits, which is slower and never wrong */
      const r = await (typeof AbortSignal !== 'undefined' &&
      typeof AbortSignal.timeout === 'function'
        ? q.abortSignal(AbortSignal.timeout(15000))
        : q)
      return { data: r.data, error: r.error, status: r.status }
    },
    session: async () => {
      const { data } = await sb.auth.getSession()
      const s = data.session
      return s ? { uid: s.user.id, token: s.access_token } : null
    },
  }
  const w = createPageWriter({
    ...browserDeps(uid),
    ...(import.meta.env.DEV && previewMember ? previewDeps(uid) : live),
  })
  writers.set(uid, w)
  return w
}
