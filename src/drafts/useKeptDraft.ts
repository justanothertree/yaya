import { useEffect, useRef, useState } from 'react'
import { drafts } from './device'
import { makeAutosave, type Draft, type DraftKind } from './drafts'

/**
 * Unsaved work in one editor, kept on this device across a reload — the protection Paint got after
 * a whole minion was lost to a pull-to-refresh (27 Nov 2026), for any editor whose work is one value.
 *
 * - The value is kept per person as it changes, and dropped once nothing is unsaved: an emptied
 *   box, or `markSaved()` after a Keep or a Send that left the work on screen.
 * - On arrival a kept value comes back one of two ways, chosen by `offer`:
 *   - PUT BACK (the default) into an empty editor only, for a box of words. A sentence coming back
 *     into an empty box replaces nothing and is seen whole where it lands, so asking first would be
 *     a dialog standing between somebody and a box that already says it.
 *   - OFFERED (`offer: true`), for a builder. Bringing one back replaces what is on screen, so it
 *     waits for an answer — `offered`, `bringBack()`, `startFresh()` — and nothing is written while
 *     it waits, or the empty builder would overwrite the very thing being offered.
 * - Leaving with unsaved work asks first.
 *
 * ⚠️ "UNSAVED" IS AGAINST THE LAST SAVE, NOT AGAINST EMPTY. A builder still shows its hole after
 * Keep, and a hole on screen is not unsaved work. `markSaved()` makes what is on screen the
 * baseline; `sig` is how two values are compared (JSON by default — give one when key order can
 * differ between the doors a value comes in by, as Paint's contentSig does).
 *
 * ⚠️ `kind` AND `scope` ARE READ ONCE. Key the component by its scope, the way Chat keys its
 * Composer by room, so a different conversation is a different editor rather than a moved one.
 */
export type KeptDraft<T> = {
  /** a draft waiting for an answer (offer mode only) */
  offered: Draft<T> | null
  bringBack(): void
  startFresh(): void
  /** what is on screen is now kept for real: it is the baseline, and its draft goes now */
  markSaved(): void
  /** something is on screen that the last save did not keep */
  unsaved: boolean
}

export function useKeptDraft<T>({
  kind,
  scope,
  value,
  isEmpty,
  parse,
  restore,
  offer = false,
  sig = (v: T) => JSON.stringify(v),
  on = true,
}: {
  kind: DraftKind
  /** which one, when an editor has many — one compose box per conversation */
  scope?: string
  value: T
  isEmpty: (v: T) => boolean
  /** the stored body back, validated, or null — it comes out of storage anything can write to */
  parse: (raw: unknown) => T | null
  /** put a kept value back into the editor */
  restore: (v: T) => void
  offer?: boolean
  sig?: (v: T) => string
  /** false keeps no draft at all — a preview harness, or an editor not yet ready */
  on?: boolean
}): KeptDraft<T> {
  const [autosave] = useState(() =>
    makeAutosave<T>({
      write: (b) => drafts.write(kind, b, scope),
      drop: () => drafts.drop(kind, scope),
    }),
  )
  const empty = isEmpty(value)
  const now = sig(value)
  /* the editor as it stands when something async answers, not as it stood when it was asked */
  const live = useRef({ empty, now })
  live.current = { empty, now }

  /* null until something is saved: then only an empty editor is "nothing unsaved" */
  const [baseline, setBaseline] = useState<string | null>(null)
  const unsaved = !empty && now !== baseline
  const [cleanAsk, setCleanAsk] = useState(0)
  useEffect(() => {
    if (cleanAsk) setBaseline(live.current.now)
  }, [cleanAsk])

  const [offered, setOffered] = useState<Draft<T> | null>(null)
  /* on arrival: paused until the device has said whether anything was kept */
  useEffect(() => {
    if (!on) return
    let alive = true
    autosave.pause()
    void drafts.read(kind, parse, scope).then((d) => {
      if (!alive) return
      if (d && offer && sig(d.body) !== live.current.now) return setOffered(d)
      if (d && !offer && live.current.empty) restore(d.body)
      autosave.resume()
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per editor; see `live`
  }, [autosave, on])

  useEffect(() => {
    if (on) autosave.change(unsaved ? value : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` stands for `value`
  }, [autosave, on, unsaved, now])

  useEffect(() => {
    if (!on) return
    const out = () => void autosave.flush()
    const whenHidden = () => {
      if (document.visibilityState === 'hidden') out()
    }
    window.addEventListener('pagehide', out)
    document.addEventListener('visibilitychange', whenHidden)
    return () => {
      window.removeEventListener('pagehide', out)
      document.removeEventListener('visibilitychange', whenHidden)
      out()
    }
  }, [autosave, on])

  useEffect(() => {
    if (!on || !unsaved) return
    const ask = (e: BeforeUnloadEvent) => {
      void autosave.flush()
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [autosave, on, unsaved])

  return {
    offered,
    unsaved,
    bringBack() {
      if (!offered) return
      restore(offered.body)
      setOffered(null)
      autosave.resume()
    },
    startFresh() {
      if (!offered) return
      setOffered(null)
      void drafts.drop(kind, scope).then(() => autosave.resume())
    },
    markSaved() {
      setCleanAsk((n) => n + 1)
      autosave.change(null)
      void autosave.flush()
    },
  }
}
