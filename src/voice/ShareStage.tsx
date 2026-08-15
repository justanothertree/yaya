import { useEffect, useRef } from 'react'
import { useVoiceSession } from './useVoiceSession'

/**
 * Whoever is sharing a screen, shown big.
 *
 * A separate surface from the call dock because a shared screen is the thing you LOOK at,
 * while the dock is a control strip — putting a game feed inside a toolbar would make both
 * worse. It floats above the page and can be dismissed without leaving the call.
 */
function Screen({ stream, label, muted }: { stream: MediaStream; label: string; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    // Autoplay with sound is blocked until the page has been interacted with; being in a call
    // means it has been, but the catch keeps a refusal from throwing into the render path.
    void el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [stream])
  return (
    <figure className="sharestage-item">
      {/* muted for your OWN screen: playing your own captured audio back is a feedback loop */}
      <video ref={ref} autoPlay playsInline muted={muted} />
      <figcaption className="muted">{label}</figcaption>
    </figure>
  )
}

export function ShareStage() {
  const { inCall, peers, sharing, getLocalShare, stopShare } = useVoiceSession()
  const mine = sharing ? getLocalShare() : null
  const theirs = peers.filter((p) => p.share)
  if (!inCall || (!mine && !theirs.length)) return null
  return (
    <div className="sharestage">
      {theirs.map((p) => (
        <Screen key={p.id} stream={p.share!} label={`${p.name}'s screen`} muted={false} />
      ))}
      {mine && (
        <div className="sharestage-mine">
          <Screen stream={mine} label="Your screen" muted />
          <button className="btn" onClick={stopShare}>
            Stop sharing
          </button>
        </div>
      )}
    </div>
  )
}
