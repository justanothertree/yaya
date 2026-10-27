import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { keepPicture, prepare, type Squeezed } from './cloud'
import { FLOOR_QUALITY, MAX_QUALITY, sayBytes, savedBy } from './shrink'

/**
 * Add a picture: choose one, decide how hard to squeeze it, keep it. Anywhere.
 *
 * ⚠️ IT IS A CONTROL, NOT A ROOM, and that is the whole reason this file exists. Pictures shipped
 * as a page of its own as a proof that the pipe worked — browser encode, presigned PUT, R2 — and
 * the reading of it afterwards was the right one: not its own module, but a function other things
 * reach for, like a rating, a workout, and eventually a profile picture. So the pipe moves here,
 * where anything can use it, and the room goes back to being one caller among several.
 *
 * ⚠️ THE DIAL IS THE PART WORTH KEEPING. Everything else is a button and a list; the thing worth
 * building is the moment a picture gets smaller in front of you and says by how much. Compression
 * on a free tier is usually a tax charged out of sight — this makes it a control, the same
 * argument the paint room and the instrument are built on.
 *
 * ⚠️ AND IT RE-ENCODES ON A DEBOUNCE, because each notch of that slider is a real `toBlob` on a
 * full-size canvas. Dragging it is forty encodes if nothing waits; a quarter of a second after
 * the thumb stops is one, and the number lands about as fast as a person can read it.
 */
export function AddPicture({
  onKept,
  label = '+ Choose a picture',
}: {
  /** handed the id of the picture now on the account — attach it to whatever asked for it */
  onKept: (kept: { id: string }) => void | Promise<void>
  label?: string
}) {
  const [file, setFile] = useState<File | null>(null)
  /**
   * ⚠️ 0.8 AND NOT THE TOP OF THE DIAL. See MAX_QUALITY: WebP treats 1.0 as a different encoder
   * mode, and starting anywhere near it spends bytes nobody asked for on a first upload.
   */
  const [quality, setQuality] = useState(0.8)
  const [ready, setReady] = useState<{ full: Squeezed; thumb: Squeezed } | null>(null)
  const [alt, setAlt] = useState('')
  const [busy, setBusy] = useState(false)
  const [working, setWorking] = useState(false)
  const [say, setSay] = useState<string | null>(null)
  const [coarse] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true,
  )

  const moan = (why: string) => {
    setSay(why)
    window.setTimeout(() => setSay(null), 6000)
  }

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

  const clear = () => {
    setFile(null)
    setReady(null)
    setAlt('')
    show(null)
  }

  /**
   * ⚠️ `finally`, BECAUSE A THROW SKIPS THE LINE THAT UNGREYS THE BUTTON. This was a bare
   * `setBusy(true)` … `await` … `setBusy(false)`, and the await can reject — a cross-origin
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
    clear()
    await onKept(out)
  }

  /* ⚠️ the input is cleared so choosing the SAME file again still fires a change — otherwise a
     person who picked the wrong one, then picked it again on purpose, gets nothing and no
     explanation. Both doors below share this, so the camera inherits it rather than forgetting it. */
  const took = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setReady(null)
    show(null)
    e.target.value = ''
  }

  return (
    <div className="pics-add">
      <span className="pics-doors">
        <label className="btn pics-pick">
          {label}
          <input type="file" accept="image/*" className="sr-only" onChange={took} />
        </label>

        {/**
         * ⚠️ `capture` IS A HINT TO THE DEVICE, NOT A CAMERA API, and that is why this is five
         * lines rather than a hundred. On a phone `capture="environment"` opens the rear camera
         * straight away and hands back a file; everything after that — the squeeze, the dial, the
         * presigned PUT — is the path a chosen file already takes, so there is nothing new to get
         * wrong in the part that matters.
         *
         * ⚠️ AND IT IS HIDDEN ON A MOUSE, because there it is not a camera button: a desktop
         * browser ignores `capture` and opens the ordinary file picker, so the two controls would
         * do exactly the same thing under different names. `(pointer: coarse)` is the question
         * §6 of CLAUDE.md already asks everywhere else.
         *
         * Read once rather than watched: a device does not stop being a phone mid-session. A
         * convertible switching from touch to trackpad keeps whichever it booted with until a
         * reload, which is a worse trade than a listener on every mount.
         *
         * A webcam on a desktop would need getUserMedia, a video element and a canvas grab —
         * worth doing if a profile picture ever wants it, and not worth it for this.
         */}
        {coarse ? (
          <label className="btn btn-ghost pics-pick">
            📷 Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={took}
            />
          </label>
        ) : null}
      </span>

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
                min={FLOOR_QUALITY * 100}
                max={MAX_QUALITY * 100}
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
              <button className="btn btn-ghost" onClick={clear} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
