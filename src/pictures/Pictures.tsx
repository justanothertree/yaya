import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PICTURES_EACH,
  PICTURE_BYTES_ALL,
  dropPicture,
  keepPicture,
  myPictures,
  prepare,
  type Kept,
  type Squeezed,
} from './cloud'
import { sayBytes, savedBy } from './shrink'

/**
 * Pictures: choose one, decide how hard to squeeze it, keep it.
 *
 * ⚠️ THE DIAL IS THE ROOM. Everything else here is a list and a button; the thing worth building
 * is the moment where a picture gets smaller in front of you and says by how much. Compression on
 * a free tier is usually a tax charged out of sight — this makes it a control, which is the same
 * argument the paint room and the instrument are built on.
 *
 * ⚠️ AND IT RE-ENCODES ON A DEBOUNCE, because each notch of that slider is a real `toBlob` on a
 * full-size canvas. Dragging it is forty encodes if nothing waits; a quarter of a second after the
 * thumb stops is one, and the number lands about as fast as a person can read it.
 */
export function Pictures({ authed = false }: { authed?: boolean } = {}) {
  const [kept, setKept] = useState<Kept[] | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [quality, setQuality] = useState(0.8)
  const [ready, setReady] = useState<{ full: Squeezed; thumb: Squeezed } | null>(null)
  const [alt, setAlt] = useState('')
  const [busy, setBusy] = useState(false)
  const [working, setWorking] = useState(false)
  const [say, setSay] = useState<string | null>(null)

  const moan = (why: string) => {
    setSay(why)
    window.setTimeout(() => setSay(null), 6000)
  }

  const load = useCallback(async () => {
    if (!authed) return
    setKept(await myPictures())
  }, [authed])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * ⚠️ THE PREVIEW IS A BLOB URL AND IT IS REVOKED. Every re-encode makes a new one, and a slider
   * dragged across its range makes dozens — each holding a full-size image alive until the tab
   * closes. Revoking the previous one is the whole of the fix and it is easy to forget, because
   * nothing goes visibly wrong until a phone runs out of memory.
   */
  const shown = useRef<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const show = (blob: Blob | null) => {
    if (shown.current) URL.revokeObjectURL(shown.current)
    shown.current = blob ? URL.createObjectURL(blob) : null
    setPreview(shown.current)
  }
  useEffect(() => () => void (shown.current && URL.revokeObjectURL(shown.current)), [])

  /* re-squeeze whenever the file or the dial changes, a beat after the dial stops */
  useEffect(() => {
    if (!file) return
    let dead = false
    setWorking(true)
    const t = window.setTimeout(() => {
      void (async () => {
        /* and here too: a squeeze that throws would leave the dial reading "squeezing…" for ever */
        const out = await prepare(file, quality).catch((e) => ({
          why: e instanceof Error ? e.message : 'that file did not look like a picture',
        }))
        if (dead) return
        setWorking(false)
        if ('why' in out) {
          setReady(null)
          show(null)
          return moan(out.why)
        }
        setReady(out)
        show(out.full.blob)
      })()
    }, 250)
    return () => {
      dead = true
      window.clearTimeout(t)
    }
  }, [file, quality])

  /**
   * ⚠️ `finally`, BECAUSE A THROW SKIPS THE LINE THAT UNGREYS THE BUTTON. This was a bare
   * `setBusy(true)` … `await` … `setBusy(false)`, and the await could reject — a cross-origin
   * `fetch` does exactly that. One rejection left the room with Keep it disabled permanently and
   * no message, which is worse than an error: an error says something went wrong, and a greyed
   * button says nothing at all while looking like a considered state.
   */
  const keep = async () => {
    if (!ready || busy) return
    setBusy(true)
    let out: { id: string } | { why: string }
    try {
      out = await keepPicture(ready.full, ready.thumb, alt)
    } catch (e) {
      out = { why: e instanceof Error ? e.message : 'that did not go up' }
    } finally {
      setBusy(false)
    }
    if ('why' in out) return moan(out.why)
    setFile(null)
    setReady(null)
    setAlt('')
    show(null)
    await load()
  }

  const drop = async (p: Kept) => {
    if (busy) return
    /* ⚠️ `confirm` is auto-dismissed in the Browser pane — see CLAUDE.md — so this is deliberately
       not behind one. Deleting a picture you can see the thumbnail of is a small, obvious act; the
       dangerous version would be deleting several at once, which this cannot do. */
    /* the same guard as `keep` above, for the same reason */
    setBusy(true)
    let bad: { why: string } | null
    try {
      bad = await dropPicture(p.id)
    } catch (e) {
      bad = { why: e instanceof Error ? e.message : 'that did not go' }
    } finally {
      setBusy(false)
    }
    if (bad) return moan(bad.why)
    await load()
  }

  if (!authed) {
    return (
      <div className="pics">
        <h2 className="section-title">Pictures</h2>
        <p className="muted">
          Pictures you keep, squeezed small before they leave the browser. Sign in to use it.
        </p>
      </div>
    )
  }

  const used = (kept ?? []).reduce((n, p) => n + p.bytes, 0)

  return (
    <div className="pics">
      <h2 className="section-title">Pictures</h2>

      <label className="btn pics-pick">
        + Choose a picture
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setFile(f)
            setReady(null)
            show(null)
            /* ⚠️ the input is cleared so choosing the SAME file again still fires a change —
               otherwise a person who picked the wrong one, then picked it again on purpose, gets
               nothing and no explanation */
            e.target.value = ''
          }}
        />
      </label>

      {say ? (
        <p className="pics-say" role="status">
          {say}
        </p>
      ) : null}

      {file ? (
        <div className="pics-try">
          {preview ? (
            <img className="pics-preview" src={preview} alt="" />
          ) : (
            <div className="pics-preview is-empty" aria-hidden />
          )}

          <div className="pics-dial">
            <label>
              <span>How hard to squeeze</span>
              <input
                type="range"
                min={30}
                max={100}
                step={5}
                value={Math.round(quality * 100)}
                onChange={(e) => setQuality(Number(e.target.value) / 100)}
              />
            </label>

            {/**
             * ⚠️ THE NUMBER IS THE POINT, so it keeps its place while a new one is worked out:
             * `aria-busy` rather than swapping the text for "…", which would make the line jump
             * and the figure unreadable exactly while somebody is trying to read it.
             */}
            <p className="pics-size" aria-busy={working}>
              {ready ? (
                <>
                  <strong>{sayBytes(ready.full.blob.size)}</strong>
                  <span className="muted">
                    {' '}
                    {ready.full.w}×{ready.full.h}
                    {savedBy(file.size, ready.full.blob.size)
                      ? ` · ${savedBy(file.size, ready.full.blob.size)}`
                      : ''}
                  </span>
                </>
              ) : (
                <span className="muted">squeezing…</span>
              )}
            </p>

            <label className="pics-alt">
              <span className="sr-only">What is in this picture?</span>
              <input
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                placeholder="what is in it?"
                maxLength={300}
              />
            </label>

            <div className="pics-do">
              <button className="btn" onClick={() => void keep()} disabled={!ready || busy}>
                Keep it
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setFile(null)
                  setReady(null)
                  setAlt('')
                  show(null)
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {kept === null ? (
        <p className="muted" aria-busy>
          Loading…
        </p>
      ) : kept.length === 0 ? (
        <p className="muted">Nothing kept yet. Choose a picture and it appears here.</p>
      ) : (
        <>
          <ul className="pics-grid">
            {kept.map((p) => (
              <li key={p.id} className="pics-one">
                {/* ⚠️ the THUMBNAIL, never the full picture. A grid of twenty full-size images is
                    the single biggest thing anybody gets wrong here — roughly ten times the
                    bytes, for pictures drawn two inches wide. */}
                <img
                  className="pics-thumb"
                  src={p.thumbUrl}
                  alt={p.alt ?? ''}
                  width={p.w}
                  height={p.h}
                  loading="lazy"
                />
                <span className="pics-facts">
                  <span className="muted">{sayBytes(p.bytes)}</span>
                  <button
                    className="btn btn-ghost chron-x"
                    onClick={() => void drop(p)}
                    disabled={busy}
                    aria-label={p.alt ? `Delete ${p.alt}` : 'Delete this picture'}
                    title="Delete"
                  >
                    ✕
                  </button>
                </span>
                {/* ⚠️ the description is drawn, not only an alt attribute — a picture nobody can
                    describe to themselves is one they will not find again, and a tooltip does not
                    exist on a phone */}
                {p.alt ? <span className="pics-said">{p.alt}</span> : null}
              </li>
            ))}
          </ul>
          <p className="muted pics-used">
            {kept.length} of {PICTURES_EACH} · {sayBytes(used)} of {sayBytes(PICTURE_BYTES_ALL)}
          </p>
        </>
      )}
    </div>
  )
}
