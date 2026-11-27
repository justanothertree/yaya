/**
 * Work somebody has not saved yet, kept on this device so that a reload does not take it.
 *
 * ⚠️ WHY THIS EXISTS. A member built a whole minion in Paint on a phone, pulled the page down while
 * looking for Save, and the browser reloaded: everything was gone. Paint held the drawing in a
 * module variable (draw/session.ts), which survives walking to another room and nothing else —
 * and a pull-to-refresh is the easiest reload there is to do by accident.
 *
 * ⚠️ INDEXEDDB, NOT localStorage, AND draw/session.ts SAYS WHY. A picture is unbounded, and
 * writing every stroke into the 5MB that the gallery, the minions and the songs also live in is
 * how a paint app starts silently failing to save at the exact moment somebody has drawn something
 * worth keeping. IndexedDB has its own, far larger allowance, so a draft can never be the reason
 * a Keep is refused. A draft that cannot be written costs only itself: every call here resolves,
 * and the worst case is the room as it was before this file.
 *
 * ⚠️ PER PERSON. The key carries the signed-in account (or `signed-out`), so on a shared computer
 * one member is never offered somebody else's unsaved minion, and signing in does not hand the
 * last visitor's chat message to the next one.
 *
 * ⚠️ A DRAFT IS A COPY, NEVER THE THING. Nothing here may stand between somebody and what they
 * kept on purpose: a restore is OFFERED, never applied over work on the page, and a saved item
 * drops its draft rather than the other way round.
 *
 * ⚠️ VALIDATED ON THE WAY OUT. IndexedDB is writable by anything on this origin, so what comes
 * back is handed to the caller's own reader (`parse`) — for a drawing that is readDrawing, the
 * same door a stranger's gallery file comes through.
 */

/** Where drafts are kept. Every method resolves; failure is `null` / `false`, never a throw. */
export type DraftBackend = {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<boolean>
  del(key: string): Promise<boolean>
}

export type Draft<T> = {
  /** when it was last written, ms since the epoch */
  at: number
  body: T
}

/** Which editor a draft belongs to. One per editor, so one never restores as another. */
export type DraftKind = 'paint'

/** The account a draft belongs to when nobody is signed in. */
export const SIGNED_OUT = 'signed-out'

/**
 * A draft's key: the editor, the person, and — for an editor with many of something, like one
 * compose box per conversation — which one.
 *
 * ⚠️ AN EMPTY OR MISSING ACCOUNT IS `signed-out`, NEVER THE EMPTY STRING, so a key can never be
 * mistaken for a prefix of another and a signed-out draft is one row, not one per spelling.
 */
export function draftKey(kind: DraftKind, who: string | null | undefined, scope?: string): string {
  const person = who && who.trim() ? who.trim() : SIGNED_OUT
  return scope ? `${kind}|${person}|${scope}` : `${kind}|${person}`
}

const isStored = (v: unknown): v is { v: 1; at: number; body: unknown } =>
  !!v &&
  typeof v === 'object' &&
  (v as { v?: unknown }).v === 1 &&
  typeof (v as { at?: unknown }).at === 'number' &&
  Number.isFinite((v as { at: number }).at) &&
  'body' in (v as object)

export type Drafts = ReturnType<typeof makeDrafts>

/**
 * The draft store over a backend, for whoever `who()` says is signed in at the moment of each
 * call. Pure apart from the backend, which is what lets a test reload it.
 */
export function makeDrafts(
  backend: DraftBackend,
  who: () => string | null,
  now: () => number = Date.now,
) {
  return {
    /**
     * The draft, through `parse`, or null if there is none, it is unreadable, or `parse` refuses
     * it. An unreadable row is left where it is: deleting what we cannot read would be deciding
     * that somebody's work is worthless because this build cannot parse it.
     */
    async read<T>(
      kind: DraftKind,
      parse: (body: unknown) => T | null,
      scope?: string,
    ): Promise<Draft<T> | null> {
      const raw = await backend.get(draftKey(kind, who(), scope)).catch(() => null)
      if (!isStored(raw)) return null
      const body = parse(raw.body)
      return body === null || body === undefined ? null : { at: raw.at, body }
    },
    /** Keep `body` as the draft. False when the device would not take it. */
    write(kind: DraftKind, body: unknown, scope?: string): Promise<boolean> {
      return backend.put(draftKey(kind, who(), scope), { v: 1, at: now(), body }).catch(() => false)
    },
    /** Forget the draft — after it was saved for real, or thrown away on purpose. */
    drop(kind: DraftKind, scope?: string): Promise<boolean> {
      return backend.del(draftKey(kind, who(), scope)).catch(() => false)
    },
  }
}

/**
 * Writes that wait for a burst of changes to settle, so a drawing costs one write a stroke rather
 * than one a pointer move, and a chat box one a pause rather than one a keypress.
 *
 * `change(body)` schedules a write of `body`; `change(null)` schedules a DROP — "there is nothing
 * unsaved any more", which is what a save or an emptied box means. The latest call wins.
 * `flush()` does whatever is pending now: called on pagehide and when the tab is hidden, which is
 * how a phone leaves a page, so the last few hundred milliseconds are not the ones lost.
 *
 * ⚠️ `pause()` STOPS IT TOUCHING THE STORE AT ALL, and the restore offer is why. While somebody is
 * being asked whether to bring back yesterday's minion, a write of the empty page would replace
 * the very thing being offered.
 */
export function makeAutosave<T>(
  store: { write(body: T): Promise<boolean>; drop(): Promise<boolean> },
  settleMs = 600,
  /** told after every write whether the device took it — how a refused draft gets said */
  onWritten: (ok: boolean) => void = () => {},
  timers: { set: typeof setTimeout; clear: typeof clearTimeout } = {
    set: (...a: Parameters<typeof setTimeout>) => setTimeout(...a),
    clear: (t) => clearTimeout(t),
  },
) {
  let pending: { body: T | null } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let paused = false
  let failed = false
  const run = () => {
    timer = null
    if (!pending || paused) return Promise.resolve()
    const { body } = pending
    pending = null
    return (body === null ? store.drop() : store.write(body)).then((ok) => {
      if (body === null) return
      failed = !ok
      onWritten(ok)
    })
  }
  return {
    change(body: T | null) {
      pending = { body }
      if (timer) timers.clear(timer)
      timer = timers.set(run, settleMs)
    },
    flush(): Promise<void> {
      if (timer) timers.clear(timer)
      return run()
    },
    pause() {
      paused = true
    },
    /** ⚠️ and picks up whatever changed while it was paused, or that change waits for the next */
    resume() {
      paused = false
      if (pending && !timer) timer = timers.set(run, settleMs)
    },
    /** Whether the last write the device was asked for was refused — the one thing worth saying. */
    failed: () => failed,
    cancel() {
      if (timer) timers.clear(timer)
      timer = null
      pending = null
    },
  }
}

/** A backend in memory: for tests, and for a browser with no IndexedDB at all. */
export function memoryBackend(
  rows = new Map<string, unknown>(),
): DraftBackend & { rows: Map<string, unknown> } {
  /* structuredClone, so what comes back is a copy the way IndexedDB's is — a test that mutated a
     live reference would otherwise pass for reasons a real reload does not have */
  const copy = (v: unknown) => (v === undefined ? undefined : structuredClone(v))
  return {
    rows,
    get: async (k) => copy(rows.get(k)),
    put: async (k, v) => {
      rows.set(k, copy(v))
      return true
    },
    del: async (k) => rows.delete(k) || true,
  }
}

const DB = 'yaya_drafts'
const STORE = 'drafts'

/**
 * IndexedDB, opened once and lazily.
 *
 * ⚠️ NEVER THROWS, for the reason takes.ts gives: a private window, a blocked origin or a full
 * disk are all normal states for a phone, and the right behaviour in each is that the editor still
 * works and simply keeps no draft.
 */
export function idbBackend(): DraftBackend {
  let open: Promise<IDBDatabase | null> | null = null
  const db = () =>
    (open ??= new Promise((done) => {
      try {
        if (typeof indexedDB === 'undefined') return done(null)
        const req = indexedDB.open(DB, 1)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
        }
        req.onsuccess = () => done(req.result)
        req.onerror = () => done(null)
        req.onblocked = () => done(null)
      } catch {
        done(null)
      }
    }))
  const run = <T>(
    mode: IDBTransactionMode,
    go: (s: IDBObjectStore) => IDBRequest<T>,
    ok: (r: T) => unknown,
  ) =>
    db().then(
      (d) =>
        new Promise<unknown>((done) => {
          if (!d) return done(null)
          try {
            const tx = d.transaction(STORE, mode)
            const req = go(tx.objectStore(STORE))
            /* a write is only done when its transaction is, not when its request is */
            if (mode === 'readwrite') tx.oncomplete = () => done(ok(req.result))
            else req.onsuccess = () => done(ok(req.result))
            req.onerror = () => done(null)
            tx.onabort = () => done(null)
            tx.onerror = () => done(null)
          } catch {
            done(null)
          }
        }),
    )
  return {
    get: (k) =>
      run(
        'readonly',
        (s) => s.get(k),
        (r) => r ?? null,
      ),
    put: (k, v) =>
      run(
        'readwrite',
        (s) => s.put(v, k),
        () => true,
      ).then((r) => r === true),
    del: (k) =>
      run(
        'readwrite',
        (s) => s.delete(k),
        () => true,
      ).then((r) => r === true),
  }
}
