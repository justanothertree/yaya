import { useId, type RefObject } from 'react'
import { PENDING, type BusAct, type BusButton } from './busWords'
import type { BusModel } from './busNow'
import { Token } from './Token'

/**
 * The party tour in the strip (useBus drives it, busWords.ts says every word of it): who is on the
 * bus, what is happening now and what you can do, and the three faces of a roll.
 *
 * Wide, it is a block under the strip's header: the heading, the riders in turn order, the phase
 * line with one to three buttons, and the faces. On a phone it is one row under the summary,
 * outside the fold, like the follow row: the phase line and at most two buttons — Hop off lives in
 * the open list beside Call chat, and the riders are the chips'.
 */

/**
 * ⚠️ A BUTTON KEEPS ITS ELEMENT WHEN IT TURNS INTO ITS OPPOSITE. Take me there becomes Stay here
 * where it stood, so the focus that pressed it is still on it; keyed by what it does, the press
 * would remount it and drop the focus on the page. And keyed by place it would be worse: Go now
 * arriving in front of a focused Stay here would make the focused element Go now.
 */
const SLOT: Record<BusAct, string> = {
  take: 'yes',
  stay: 'yes',
  come: 'yes',
  no: 'no',
  roll: 'roll',
  rollFor: 'roll',
  rollAnyway: 'roll',
  go: 'go',
  off: 'off',
  fin: 'fin',
  finAnyway: 'fin',
  start: 'start',
  another: 'start',
  catchUp: 'catch',
  close: 'close',
  face: 'face',
}

/**
 * ⚠️ A BUS BUTTON THAT GOES HANDS THE FOCUS TO THE BUS, NEVER TO THE CONTROL BESIDE IT. The strip's
 * focus rescue (focusRescue.ts) moves a lost focus forward by default, and forward from a bus
 * button is Hop off, a Follow or a Go: a face picked left the focus on "Go to Life, where Bo is",
 * Not this one on Hop off, Go now on the count's Stay here, and a Stay here that vanished at the
 * hop on Hop off — each a second Enter away from undoing what was just done, or from leaving the
 * bus. The phase line says what changed; after Close there is none, and Start is what is left.
 */
export const FOCUS_NEXT = '.lab-bus-say || .lab-bus-start'

/** a button's words, or "Rolling…" / "Going…" while its request is in flight (at most 3 s) */
function labelOf(b: BusButton, pending: BusModel['pending']) {
  if (pending === 'roll' && SLOT[b.act] === 'roll') return PENDING.roll
  if (pending === 'go' && b.act === 'go') return PENDING.ready
  return b.label
}

export function BusPanel({
  model,
  act,
  wide,
  sayRef,
  firstFaceRef,
}: {
  model: BusModel | null
  act: (b: BusButton) => void
  wide: boolean
  sayRef: RefObject<HTMLParagraphElement | null>
  firstFaceRef: RefObject<HTMLButtonElement | null>
}) {
  const headId = useId()
  if (!model || model.closed) return null
  const { line, faces, riders, count, pending } = model
  /* the faces are cards of their own; Come too is the line above the toy's (step 6 of the plan) */
  const own = line.buttons.filter((b) => b.act !== 'face' && b.act !== 'come')
  const buttons = wide
    ? /* the way off is always on screen for a rider, wherever the line is */
      model.riding && !own.some((b) => b.act === 'off')
      ? [...own, { act: 'off' as const, label: 'Hop off' }]
      : own
    : own.filter((b) => b.act !== 'off').slice(0, 2)
  const say = (
    <p className="lab-bus-say" tabIndex={-1} ref={sayRef}>
      {wide ? line.text : model.row}
    </p>
  )
  const now = (
    <div className="lab-bus-now">
      {count !== null && (
        /* the 3-2-1 is for the eyes: the departure is said once, in words, to the status */
        <span className="lab-bus-count" key={count} aria-hidden>
          {count}
        </span>
      )}
      {say}
      {buttons.length > 0 && (
        <span className="lab-bus-acts">
          {buttons.map((b) => (
            <button
              key={SLOT[b.act]}
              className="btn btn-ghost lab-bus-btn"
              data-focus-next={FOCUS_NEXT}
              onClick={() => act(b)}
            >
              {labelOf(b, pending)}
            </button>
          ))}
        </span>
      )}
    </div>
  )
  const cards = faces && (
    <ul className="lab-bus-faces" key={faces.map((f) => f.toy).join(',')}>
      {faces.map((f, i) => (
        <li key={f.toy}>
          {f.press ? (
            <button
              className="btn btn-ghost lab-bus-face"
              ref={i === 0 ? firstFaceRef : undefined}
              data-focus-next={FOCUS_NEXT}
              onClick={() => act(f.press!)}
            >
              <b className="lab-bus-face-name">{f.press.label}</b>
              <span className="lab-bus-face-kind">{f.kind}</span>
              {f.star && <span className="lab-bus-face-kind">{f.star}</span>}
            </button>
          ) : (
            <div className="lab-bus-face">
              <b className="lab-bus-face-name">{f.name}</b>
              <span className="lab-bus-face-kind">{f.kind}</span>
              {f.star && <span className="lab-bus-face-kind">{f.star}</span>}
            </div>
          )}
        </li>
      ))}
    </ul>
  )

  if (!wide)
    return (
      <div className="lab-bus is-phone" role="group" aria-label="Party tour">
        {now}
        {cards}
      </div>
    )
  return (
    <div className="lab-bus" role="group" aria-labelledby={headId}>
      <h4 className="fw-h lab-bus-head" id={headId}>
        {model.heading}
      </h4>
      {riders.length > 0 && (
        <ol className="lab-bus-riders" aria-label="Riders, in turn order">
          {riders.map((r) => (
            <li key={r.id} className={`lab-bus-rider${r.note ? ' is-off' : ''}`}>
              <Token id={r.id} name={r.name} place={r.place} speaking={false} me={r.me} />
              <span
                className="lab-bus-rider-name"
                style={{ ['--len' as string]: (r.me ? 'You' : r.name).length }}
              >
                {r.me ? 'You' : r.name}
              </span>
              {r.stars && (
                <span className="lab-bus-stars">
                  <span aria-hidden>{r.stars}</span>
                  <span className="sr-only">, {r.starsSr}</span>
                </span>
              )}
              {r.rolls && (
                <span className="lab-bus-rolls">
                  <span aria-hidden>{r.rolls}</span>
                  <span className="sr-only">{r.rollsSr}</span>
                </span>
              )}
              {r.note && <span className="lab-bus-note">{r.note}</span>}
              {r.lead && <span aria-hidden>👑</span>}
            </li>
          ))}
        </ol>
      )}
      {now}
      {cards}
    </div>
  )
}
