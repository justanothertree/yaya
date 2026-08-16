import { useEffect, useRef, useState } from 'react'
import { useVoiceSession } from './useVoiceSession'

/**
 * Whoever is sharing a screen, shown with controls that belong to us.
 *
 * The first version was a bare <video> in a fixed box, which left the browser's pop-out button
 * as the only thing you could press — so the only way to move it, resize it or mute it was to
 * eject it out of the page entirely. Watching someone play should not require leaving the site.
 *
 * Docked bottom-right rather than centred: a shared screen is something you keep an eye on
 * while doing something else, and the middle of the page is where the something else is.
 */
function Screen({
  stream,
  label,
  selfMuted,
  onClose,
}: {
  stream: MediaStream
  label: string
  /** our own capture: never play it back, that's a feedback loop */
  selfMuted: boolean
  onClose?: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [muted, setMuted] = useState(selfMuted)
  const [big, setBig] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [stream])

  // kept off the element's own `muted` attribute so toggling never re-attaches the stream
  useEffect(() => {
    if (ref.current) ref.current.muted = muted
  }, [muted])

  const fullscreen = () => {
    const box = boxRef.current
    if (!box) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void box.requestFullscreen().catch(() => {})
  }

  /** Picture-in-picture keeps it visible when you scroll away or switch tabs entirely. */
  const popOut = () => {
    const el = ref.current as
      | (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> })
      | null
    if (!el?.requestPictureInPicture) return
    if (document.pictureInPictureElement) void document.exitPictureInPicture()
    else void el.requestPictureInPicture().catch(() => {})
  }

  return (
    <figure className={'sharestage-item' + (big ? ' is-big' : '')} ref={boxRef}>
      <video ref={ref} autoPlay playsInline muted={selfMuted} />
      <figcaption>
        <span className="muted sharestage-label">{label}</span>
        <span className="sharestage-controls">
          {/* no volume control for your own capture — there is nothing to listen to */}
          {!selfMuted && (
            <button
              className="btn"
              onClick={() => setMuted((m) => !m)}
              title={muted ? 'Unmute their screen audio' : 'Mute their screen audio'}
            >
              {muted ? '🔇' : '🔊'}
            </button>
          )}
          <button
            className="btn"
            onClick={() => setBig((b) => !b)}
            title={big ? 'Shrink' : 'Enlarge'}
          >
            {big ? '⤡' : '⤢'}
          </button>
          <button className="btn" onClick={fullscreen} title="Fullscreen">
            ⛶
          </button>
          <button className="btn" onClick={popOut} title="Pop out of the page">
            ⧉
          </button>
          {onClose && (
            <button className="btn" onClick={onClose} title="Stop sharing">
              ✕
            </button>
          )}
        </span>
      </figcaption>
    </figure>
  )
}

export function ShareStage() {
  const { inCall, peers, sharing, getLocalShare, stopShare } = useVoiceSession()
  const [hidden, setHidden] = useState(false)
  const mine = sharing ? getLocalShare() : null
  const theirs = peers.filter((p) => p.share)
  const anything = !!mine || theirs.length > 0

  // a share that ends should bring the stage back for the next one
  useEffect(() => {
    if (!anything) setHidden(false)
  }, [anything])

  if (!inCall || !anything) return null
  if (hidden) {
    return (
      <button
        className="btn sharestage-restore"
        onClick={() => setHidden(false)}
        title="Show the shared screen again"
      >
        🖥 {theirs.length + (mine ? 1 : 0)} sharing
      </button>
    )
  }
  return (
    <div className="sharestage">
      <div className="sharestage-bar">
        <button className="btn" onClick={() => setHidden(true)} title="Hide — the call keeps going">
          ▾ Hide
        </button>
      </div>
      {theirs.map((p) => (
        <Screen key={p.id} stream={p.share!} label={`${p.name}'s screen`} selfMuted={false} />
      ))}
      {mine && <Screen stream={mine} label="Your screen" selfMuted onClose={stopShare} />}
    </div>
  )
}
