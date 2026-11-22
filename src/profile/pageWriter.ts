import type { Song } from '../audio/songFile'
import type { ProfileBlock } from '../sections/ProfileBlocks'
import { payloadOf, withSong, type WithSong } from './newBlock'
import { classify, duplicatePositions, expectStored, ownerOf, sameStored } from './pageStore'
import { proveEmpty } from './seedGate'

/**
 * The one way a member's own profile page is written, from this browser.
 *
 * ⚠️ WHY THERE IS ONE (22 Nov 2026). `save_my_profile_blocks` deletes the page and inserts what it
 * is sent, and takes no lock and no expected state. Three things write it from here — the editor's
 * autosave, its save on the way out, and 🎵 Put it on my profile in the Instrument room — and the
 * chronicle's sharing switch writes the same table. Each used to save whatever copy it held, so
 * the last one to save deleted what the others had added, and the editor's own overlapping saves
 * took each other for "somebody else". docs/2026-11-22-profile-page-writer.md has the review that
 * found twelve ways this lost a page, and the plan this follows.
 *
 * The rules every job keeps:
 * - **One job at a time per member**, in order, inside a Web Lock where the browser has one, so
 *   two tabs take turns too.
 * - **Every job is pinned to the session it started with**: a job that finds the session is
 *   somebody else's, or nobody's, writes nothing, and every request in it carries that one token.
 * - **`known` is only ever what the server said**: an owner-proven read, or what a save's own
 *   answer proves was stored (pageStore.expectStored). Never the copy that was sent.
 * - **A copy saves only if it descends from `known`** (its lineage's rev) AND a fresh owner-proven
 *   read still matches `known`. Otherwise it is refused, kept, and said so — never merged.
 *
 * ⚠️ WHAT THIS CANNOT CLOSE: another device saving in the moment between a job's check and its
 * save. Only a compare-and-swap in the server function closes that, and the server is not changed
 * here. Within one browser the lock closes it.
 *
 * Pure apart from what is handed in, so it is tested against a faithful server double
 * (src/dev/profileServerDouble.ts) with nothing but timers to fake.
 */

type Block = ProfileBlock

export type Answer = { data: unknown; error: unknown; status: number }
export type Deps = {
  uid: string
  rpc: (fn: string, args: Record<string, unknown>, token: string) => Promise<Answer>
  /** the session now: whose it is and its bearer token */
  session: () => Promise<{ uid: string; token: string } | null>
  /** run `fn` holding a lock other tabs respect (navigator.locks); run it straight away without */
  lock: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (t: unknown) => void
  /** tell this member's other tabs the page was written */
  post?: () => void
}

/** Why a copy did not save. */
export type Conflict = 'stale' | 'changed' | 'not-yours' | 'collided'

export type Outcome =
  | { kind: 'saved'; narrowed: number[] }
  | { kind: 'nothing' }
  | { kind: Conflict }
  | { kind: 'not-you' }
  | { kind: 'signed-out' }
  | { kind: 'unverified' }
  | { kind: 'unacknowledged' }
  | { kind: 'error'; message: string }

export type Status =
  /** `unsaved`: whether this editor holds a change that did not go — what Reload would drop */
  | { kind: 'conflict'; why: Conflict | 'not-you'; unsaved: boolean }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'unverified' }
  | { kind: 'unacknowledged' }
  | { kind: 'saved' }
  | { kind: 'idle' }

/** what an editor lets a Put reach: its copy as it stands, and a way to add a song to it */
export type Apply = {
  peek: () => Block[]
  commit: (song: Song, approved: string | null) => Promise<PutOutcome>
}

export type PutOutcome =
  | (Outcome & { song?: string; how?: 'added' | 'updated' | 'new block' })
  | { kind: 'cannot'; why: Extract<WithSong, { ok: false }>['why'] }
  | { kind: 'ask'; name: string }

export type Event =
  | { type: 'status' }
  | { type: 'written'; page: Block[]; rev: number; name: string }
  | { type: 'advanced'; page: Block[]; rev: number; name: string }
  | { type: 'orphan'; blocks: Block[]; why: string }

type Known = { rev: number; name: string; page: Block[]; lists: 'exact' | 'sent' }
type Draft = { blocks: Block[]; json: string }
type Lineage = {
  id: number
  rev: number
  sentJson: string
  draft: Draft | null
  timer: unknown
  waiting: boolean
  running: Draft | null
  detached: boolean
  conflict: Conflict | 'not-you' | null
  last: Outcome | null
  apply: Apply | null
  /** resolved by the next job of this lineage that sends its newest copy */
  waiters: Array<(o: Outcome) => void>
  tries: number
}

/** a save whose answer never came: the page it would have made, and whose it was */
type Alt = { page: Block[]; json: string; by: number | null }

type Read = { kind: 'owner'; page: Block[] } | { kind: 'not-yours' } | { kind: 'unverified' }

const json = (blocks: readonly Block[]) => JSON.stringify(payloadOf(blocks))
const DEBOUNCE = 700

export function createPageWriter(deps: Deps) {
  let known: Known | null = null
  let alt: Alt | null = null
  let chain: Promise<unknown> = Promise.resolve()
  let ids = 0
  const lineages = new Map<number, Lineage>()
  const listeners = new Set<(e: Event) => void>()
  let orphan: { blocks: Block[]; why: string } | null = null

  const emit = (e: Event) => {
    for (const fn of [...listeners]) fn(e)
  }
  const status = () => emit({ type: 'status' })

  /** queue a job: one at a time, in order, and across tabs where the browser can */
  function run<T>(job: () => Promise<T>): Promise<T> {
    const next = chain.then(() => deps.lock(`yaya.profile-page:${deps.uid}`, job))
    chain = next.catch(() => undefined)
    return next
  }

  /** the session this job is pinned to, or why it may write nothing */
  async function pin(): Promise<{ token: string } | { refuse: 'not-you' | 'signed-out' }> {
    const s = await deps.session()
    if (!s) return { refuse: 'signed-out' }
    if (s.uid !== deps.uid) return { refuse: 'not-you' }
    return { token: s.token }
  }

  /**
   * The page as the owner reads it, or proof that it is not ours to write.
   *
   * ⚠️ AN EMPTY READ IS ASKED ABOUT AFTERWARDS. The server answers `[]` for a page with no blocks
   * and for a name nobody has; `get_member_profile` asked after it says which, from the session
   * making the call.
   */
  async function readMine(name: string, token: string): Promise<Read> {
    const b = await deps.rpc('get_profile_blocks', { p_username: name }, token)
    if (classify(b) !== 'ok') return { kind: 'unverified' }
    const whose = ownerOf(b.data)
    if (whose === 'invalid') return { kind: 'unverified' }
    if (whose === 'not-yours') return { kind: 'not-yours' }
    if (whose === 'owner') return { kind: 'owner', page: b.data as Block[] }
    const m = await deps.rpc('get_member_profile', { p_username: name }, token)
    const proof = proveEmpty({ data: m.data, error: classify(m) === 'ok' ? null : m.error })
    if (proof === 'failed') return { kind: 'unverified' }
    return proof === 'yours' ? { kind: 'owner', page: [] } : { kind: 'not-yours' }
  }

  /** a read that differs from `known` is a new version: every copy descended from the old one is stale */
  function advance(name: string, page: Block[]) {
    known = { rev: (known?.rev ?? 0) + 1, name, page, lists: 'exact' }
    emit({ type: 'advanced', page, rev: known.rev, name })
  }

  /** does a fresh read show the page as we last knew it; adopt its exact lists and ids if so */
  function matchesKnown(page: Block[]): boolean {
    if (!known) return false
    if (!sameStored(page, known.page, known.lists === 'exact' ? 'exact' : 'sent')) return false
    known = { ...known, page, lists: 'exact' }
    return true
  }

  /** an unanswered save turned out to have landed: it becomes the new version, as its own */
  function altLanded(page: Block[]): number | null {
    if (!alt || !known || !sameStored(page, alt.page, 'at-most')) return null
    const by = alt.by
    known = { rev: known.rev + 1, name: known.name, page, lists: 'exact' }
    const owner = by !== null ? lineages.get(by) : undefined
    if (owner) {
      owner.rev = known.rev
      owner.sentJson = alt.json
    }
    alt = null
    emit({ type: 'written', page, rev: known.rev, name: known.name })
    return by
  }

  /** every draft waiting on a timer goes into the queue now, ahead of whatever is queued next */
  function flushAll() {
    for (const L of lineages.values()) if (L.draft && L.timer !== null) enqueue(L)
  }

  function enqueue(L: Lineage) {
    if (L.timer !== null) {
      deps.clearTimeout(L.timer)
      L.timer = null
    }
    if (L.waiting) return
    L.waiting = true
    status()
    void run(() => saveJob(L))
  }

  /**
   * A job of this lineage finished. Anybody waiting on it hears how; and a lineage whose editor has
   * gone, with nothing more to try, is closed — reporting what it could not save as an orphan
   * rather than letting it disappear with the editor.
   */
  function settle(L: Lineage, o: Outcome) {
    L.last = o
    const waiters = L.waiters
    L.waiters = []
    for (const w of waiters) w(o)
    if (L.detached && L.timer === null && !L.waiting && !L.running) {
      if (L.draft && o.kind !== 'saved' && o.kind !== 'nothing') {
        orphan = { blocks: L.draft.blocks, why: o.kind }
        emit({ type: 'orphan', blocks: L.draft.blocks, why: o.kind })
      }
      lineages.delete(L.id)
    }
    status()
  }

  /** put a copy back to wait, unless a newer one has been staged since */
  function putBack(L: Lineage, d: Draft) {
    if (!L.draft) L.draft = d
  }

  /** try again later, with a growing wait, for a check that could not reach the server */
  function retry(L: Lineage) {
    L.tries++
    if (L.detached && L.tries > 3) return
    const wait = Math.min(30000, 2000 * 2 ** (L.tries - 1))
    if (L.timer !== null) deps.clearTimeout(L.timer)
    L.timer = deps.setTimeout(() => {
      L.timer = null
      enqueue(L)
    }, wait)
  }

  async function saveJob(L: Lineage): Promise<void> {
    L.waiting = false
    const d = L.draft
    if (!d) return settle(L, { kind: 'nothing' })
    L.draft = null
    L.running = d
    status()
    const done = (o: Outcome, keep: boolean) => {
      L.running = null
      if (keep) putBack(L, d)
      settle(L, o)
    }

    const p = await pin()
    if ('refuse' in p) {
      if (p.refuse === 'not-you') L.conflict = 'not-you'
      return done({ kind: p.refuse }, true)
    }
    /* ⚠️ THE LINEAGE IS CHECKED HERE, WHEN THE JOB STARTS — not when the copy was staged — so a
       save of ours still ahead of it in the queue is part of the history it is checked against,
       never "somebody else" */
    if (!known || L.rev !== known.rev || L.conflict) {
      if (!L.conflict) L.conflict = 'stale'
      return done({ kind: 'stale' }, true)
    }
    const r = await readMine(known.name, p.token)
    if (r.kind === 'unverified') {
      L.running = null
      putBack(L, d)
      retry(L)
      return settle(L, { kind: 'unverified' })
    }
    if (r.kind === 'not-yours') {
      L.conflict = 'not-yours'
      return done({ kind: 'not-yours' }, true)
    }
    if (!matchesKnown(r.page)) {
      const landed = altLanded(r.page)
      if (landed === null) {
        L.conflict = 'changed'
        return done({ kind: 'changed' }, true)
      }
      if (landed !== L.id) {
        L.conflict = 'stale'
        return done({ kind: 'stale' }, true)
      }
    } else alt = null
    L.tries = 0
    if (d.json === L.sentJson) return done({ kind: 'saved', narrowed: [] }, false)
    return done(await send(L, d.blocks, d.json, p.token), false)
  }

  /** the save itself, and what its answer proves */
  async function send(
    L: Lineage | null,
    blocks: Block[],
    sentJson: string,
    token: string,
  ): Promise<Outcome> {
    const res = await deps.rpc('save_my_profile_blocks', { p_blocks: payloadOf(blocks) }, token)
    const c = classify(res)
    if (c === 'refused')
      return {
        kind: 'error',
        message: String((res.error as { message?: unknown } | null)?.message ?? 'refused'),
      }
    if (c === 'auth') return { kind: 'signed-out' }
    const exp = c === 'ok' ? expectStored(blocks, res.data) : ({ kind: 'unacknowledged' } as const)
    if (exp.kind === 'unacknowledged') {
      /* ⚠️ it may or may not have happened; the next owner-proven read decides (altLanded) */
      alt = {
        page: blocks.map((b) => ({ ...b, certain: b.visibility === 'certain' ? b.certain : [] })),
        json: sentJson,
        by: L?.id ?? null,
      }
      if (L) {
        L.draft ??= { blocks, json: sentJson }
        retry(L)
      }
      return { kind: 'unacknowledged' }
    }
    if (exp.kind === 'collided') {
      for (const x of lineages.values()) x.conflict = 'collided'
      known = null
      return { kind: 'collided' }
    }
    const name = known!.name
    known = { rev: known!.rev + 1, name, page: exp.page, lists: exp.lists }
    alt = null
    if (L) {
      L.rev = known.rev
      L.sentJson = sentJson
      L.conflict = null
    }
    if (exp.lists === 'sent') {
      /* which names were friends the server decided; one read learns it */
      const v = await readMine(name, token)
      if (v.kind === 'owner') {
        if (sameStored(v.page, exp.page, 'sent')) known = { ...known, page: v.page, lists: 'exact' }
        else if (L) L.conflict = 'changed'
      }
    }
    emit({ type: 'written', page: known.page, rev: known.rev, name })
    deps.post?.()
    return { kind: 'saved', narrowed: exp.narrowed }
  }

  return {
    /**
     * The page an editor may start from: read and proved, queued behind every save already
     * waiting — so pressing Edit while a save is in flight starts from what that save wrote.
     */
    load(name: string) {
      flushAll()
      return run(async () => {
        const p = await pin()
        if ('refuse' in p) return { failed: p.refuse } as const
        const r = await readMine(name, p.token)
        if (r.kind !== 'owner') return { failed: r.kind } as const
        if (!altLanded(r.page) && !matchesKnown(r.page)) {
          alt = null
          advance(name, r.page)
        }
        return { page: known!.page, rev: known!.rev, doubled: duplicatePositions(r.page) } as const
      })
    },

    /** an editor starting from a loaded page: its copies descend from `rev` */
    attach(o: { seedRev: number; seedBlocks: Block[]; apply?: Apply }): number {
      const id = ++ids
      lineages.set(id, {
        id,
        rev: o.seedRev,
        sentJson: json(o.seedBlocks),
        draft: null,
        timer: null,
        waiting: false,
        running: null,
        detached: false,
        conflict: null,
        last: null,
        apply: o.apply ?? null,
        waiters: [],
        tries: 0,
      })
      status()
      return id
    },

    /** the editor's copy changed: saved a moment after the changes stop */
    stage(id: number, blocks: Block[]) {
      const L = lineages.get(id)
      if (!L || L.detached) return
      const j = json(blocks)
      if (j === L.sentJson || j === L.running?.json) {
        L.draft = null
        if (L.timer !== null) deps.clearTimeout(L.timer)
        L.timer = null
        if (L.last?.kind === 'error') L.last = null
        return status()
      }
      L.draft = { blocks, json: j }
      if (L.timer !== null) deps.clearTimeout(L.timer)
      L.timer = deps.setTimeout(() => {
        L.timer = null
        enqueue(L)
      }, DEBOUNCE)
      status()
    },

    /** a copy that cannot be sent (too big): nothing waits to save it */
    unstage(id: number) {
      const L = lineages.get(id)
      if (!L) return
      L.draft = null
      if (L.timer !== null) deps.clearTimeout(L.timer)
      L.timer = null
      status()
    },

    /** save this copy now, and say what happened to it */
    flushNow(id: number, blocks: Block[]): Promise<Outcome> {
      const L = lineages.get(id)
      if (!L) return Promise.resolve({ kind: 'stale' })
      L.draft = { blocks, json: json(blocks) }
      const p = new Promise<Outcome>((res) => L.waiters.push(res))
      enqueue(L)
      return p
    },

    /**
     * The editor is going: anything unsaved is sent now, and if it cannot be, the page is told
     * (an orphan) rather than the change disappearing with the editor.
     */
    release(id: number) {
      const L = lineages.get(id)
      if (!L) return
      L.detached = true
      L.apply = null
      if (L.draft) enqueue(L)
      else if (!L.waiting && !L.running) lineages.delete(id)
      status()
    },

    /** Reload it: what this editor had not saved is let go, deliberately */
    discard(id: number) {
      const L = lineages.get(id)
      if (!L) return
      if (L.timer !== null) deps.clearTimeout(L.timer)
      L.draft = null
      L.detached = true
      L.apply = null
      if (!L.waiting && !L.running) lineages.delete(id)
      status()
    },

    /**
     * 🎵 Put it on my profile, with no editor open to hand it to: read the page, add the song to
     * what is there NOW, save that — one job, so nothing writes the page in between from here.
     */
    put(o: {
      song: Song
      name: string
      approved: string | null
      uid0: string
    }): Promise<PutOutcome> {
      flushAll()
      return run(async (): Promise<PutOutcome> => {
        const p = await pin()
        if ('refuse' in p) return { kind: p.refuse }
        if (o.uid0 !== deps.uid) return { kind: 'not-you' }
        const name = known?.name ?? o.name
        const r = await readMine(name, p.token)
        if (r.kind !== 'owner') return { kind: r.kind }
        if (!known) {
          known = { rev: 1, name, page: r.page, lists: 'exact' }
        } else if (!altLanded(r.page) && !matchesKnown(r.page)) advance(name, r.page)
        const ws = withSong(r.page, o.song)
        if (!ws.ok) return { kind: 'cannot', why: ws.why }
        if (ws.how === 'updated' && ws.name !== o.approved) return { kind: 'ask', name: ws.name }
        const out = await send(null, ws.blocks, json(ws.blocks), p.token)
        /* a save from outside every editor: their copies descend from the page before it */
        if (out.kind === 'saved')
          for (const L of lineages.values())
            if (L.rev !== known?.rev && !L.conflict) L.conflict = 'stale'
        status()
        return { ...out, song: ws.name, how: ws.how }
      })
    },

    /** another tab said it wrote the page: read it, and mark open copies old if it moved */
    probe() {
      if (!known) return Promise.resolve()
      return run(async () => {
        const p = await pin()
        if ('refuse' in p || !known) return
        const r = await readMine(known.name, p.token)
        if (r.kind === 'owner' && !altLanded(r.page) && !matchesKnown(r.page)) {
          advance(known.name, r.page)
          for (const L of lineages.values()) if (!L.conflict) L.conflict = 'stale'
          status()
        }
      })
    },

    /** derived, never set: what an editor's status line says */
    statusOf(id: number): Status {
      const L = lineages.get(id)
      if (!L) return { kind: 'idle' }
      if (L.conflict)
        return { kind: 'conflict', why: L.conflict, unsaved: !!(L.draft || L.running) }
      if (L.running) return { kind: 'saving' }
      const last = L.last
      /* a check or a save that could not reach the server is being tried again: say that, not "Saving" */
      if (L.timer !== null && !L.waiting && last?.kind === 'unverified')
        return { kind: 'unverified' }
      if (L.timer !== null && !L.waiting && last?.kind === 'unacknowledged')
        return { kind: 'unacknowledged' }
      if (L.draft || L.waiting) return { kind: 'saving' }
      if (last?.kind === 'error') return { kind: 'error', message: last.message }
      if (last?.kind === 'unverified') return { kind: 'unverified' }
      if (last?.kind === 'unacknowledged') return { kind: 'unacknowledged' }
      if (last?.kind === 'saved') return { kind: 'saved' }
      return { kind: 'idle' }
    },

    /** an editor a Put may hand its song to: attached, current, and able to take it */
    liveLineage(): { id: number; apply: Apply } | null {
      let best: Lineage | null = null
      for (const L of lineages.values()) {
        if (L.detached || !L.apply || L.conflict || L.last?.kind === 'error') continue
        if (!known || L.rev !== known.rev) continue
        if (!best || L.id > best.id) best = L
      }
      return best ? { id: best.id, apply: best.apply! } : null
    },

    /** what was lost on the way out, once, for the page to offer back */
    takeOrphan() {
      const o = orphan
      orphan = null
      return o
    },

    known: () => known,
    subscribe(fn: (e: Event) => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    /** resolves when every queued job has finished */
    idle: () => chain.then(() => undefined),
  }
}

export type PageWriter = ReturnType<typeof createPageWriter>
