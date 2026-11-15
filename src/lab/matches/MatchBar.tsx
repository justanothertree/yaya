import { useState } from 'react'
import { here } from '../links'
import type { LabMatch } from './useLabMatch'
import { toyName } from './names'
import { matchHash, matchLine, otherName } from './words'

/**
 * Everything around the board while a toy shows a match by turns: who is playing whom, the
 * status line, and the match's own buttons. The board itself stays the toy's.
 *
 * ⚠️ RESIGNING ASKS IN THE PAGE, NOT WITH window.confirm, which some browsers suppress and the
 * Browser pane answers "no" on its own — a confirm that cannot be seen is a button that does not
 * work. The second press is a different button, so a double tap cannot resign by accident.
 */
export function MatchBar({ lm, sides }: { lm: LabMatch; sides: [string, string] }) {
  const v = lm.view
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)

  if (!v)
    return (
      <div className="match-bar">
        <p className="mc-line" aria-live="polite">
          {lm.error ?? 'Opening the match…'}
        </p>
        <div className="lab-controls">
          <button className="btn btn-ghost" onClick={lm.leave}>
            ← Back to {lm.error ? 'the toy' : 'playing alone'}
          </button>
        </div>
      </div>
    )

  const them = otherName(v)
  const link = `${here()}${matchHash(v.demo, v.id)}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied('yes')
    } catch {
      setCopied('no')
    }
  }
  const seats =
    v.mode === 'together'
      ? `You and ${them} · ${sides[0]}, against the computer · ${sides[1]}`
      : v.you === 0
        ? `You · ${sides[0]}, ${them} · ${sides[1]}`
        : `${them} · ${sides[0]}, you · ${sides[1]}`
  const over = v.status === 'finished' || v.status === 'declined' || v.status === 'expired'

  return (
    <div className="match-bar" aria-label={`${toyName(v.demo)} with ${them}, by turns`}>
      <p className="match-who">
        <strong>
          {toyName(v.demo)} with {them}
        </strong>{' '}
        <span className="muted">· by turns · {seats}</span>
      </p>
      <p className="mc-line" aria-live="polite">
        {matchLine(v, lm.hasPending)}
      </p>
      {lm.error && (
        <p className="lab-warn" role="alert">
          {lm.error}
        </p>
      )}

      {v.status === 'invited' && v.you === 1 && (
        <div className="lab-controls">
          <button className="btn" disabled={lm.busy} onClick={() => void lm.accept()}>
            Accept
          </button>
          <button className="btn btn-ghost" disabled={lm.busy} onClick={() => void lm.decline()}>
            Decline
          </button>
        </div>
      )}

      <div className="lab-controls">
        {v.status === 'active' && v.canClaim && (
          <button className="btn" disabled={lm.busy} onClick={() => void lm.claim()}>
            Claim the win
          </button>
        )}
        {v.status === 'active' &&
          (confirming ? (
            <>
              <button
                className="btn"
                disabled={lm.busy}
                onClick={() => {
                  setConfirming(false)
                  void lm.resign()
                }}
              >
                Yes, resign
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Keep playing
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => setConfirming(true)}>
              Resign…
            </button>
          ))}
        {over && (
          <button className="btn" disabled={lm.busy} onClick={() => void lm.rematch()}>
            ↻ Rematch
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => void copy()}>
          🔗 Copy link
        </button>
        <button className="btn btn-ghost" onClick={lm.leave}>
          ← Back to playing alone
        </button>
      </div>
      {copied === 'yes' && (
        <p className="muted mc-note" aria-live="polite">
          Copied. The link opens this match for you and {them}, and nobody else.
        </p>
      )}
      {copied === 'no' && (
        <p className="muted mc-note">
          Copy this link: <code className="match-link">{link}</code>
        </p>
      )}
    </div>
  )
}

/**
 * Send and Undo for a chosen move, placed AFTER the board.
 *
 * ⚠️ AFTER, BECAUSE STICKY ONLY HOLDS WHAT WOULD FALL BELOW THE SCREEN. Above the board, a phone
 * scrolled down to play a square near the bottom had already carried Send off the top, and
 * `position: sticky; bottom` does nothing for something above you. Below the board it rides at the
 * bottom of the screen while the board is in view, which is where the thumb that just chose the
 * move already is.
 */
export function MatchSend({ lm }: { lm: LabMatch }) {
  if (!lm.hasPending) return null
  return (
    <div className="lab-controls match-send" role="group" aria-label="Your chosen move">
      <button className="btn" disabled={lm.busy} onClick={() => void lm.send()}>
        {lm.busy ? 'Sending…' : 'Send move'}
      </button>
      <button className="btn btn-ghost" disabled={lm.busy} onClick={lm.undo}>
        Undo
      </button>
    </div>
  )
}
