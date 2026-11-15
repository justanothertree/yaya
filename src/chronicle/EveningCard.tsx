import { useId, type ReactNode } from 'react'
import { MOODS, spanText, type Entry } from './record'

/**
 * The evening wrap-up: after eight, the Day's headline becomes one card with three small things
 * to close the day — see evening.ts for the questions and Timer.tsx for when it is drawn.
 *
 * ⚠️ NOTHING HERE IS NEW, ONLY ASKED AT THE RIGHT TIME. A rating is what the dialog after ■ Stop
 * asks; a stretch with nothing in it is what Log a past session fills; a line about the day is a
 * day note, the Journal's own. The card writes through the same functions as those, and each of
 * them is still where it was. Skip and Not tonight are the way out of every question.
 *
 * ⚠️ AND IT TAKES THE HEADLINE INSIDE IT ON A PHONE, rather than sitting above it. The headline
 * fold is the Day's summary; a second card above it would make the evening the one time of day
 * the room grew a box. From 900px the headline is the side rail, so the card is the questions only.
 */
export function EveningCard({
  rate,
  of,
  name,
  stretch,
  line,
  lineDone,
  busy,
  onRate,
  onSkip,
  onLog,
  onLine,
  onSaveLine,
  onOff,
  children,
}: {
  /** the earliest sitting of the day with no rating, if any */
  rate: Entry | null
  /** how many are waiting, this one included */
  of: number
  /** an activity's name by id */
  name: (activity: string) => string
  /** the longest stretch between two sittings with nothing written down, if any */
  stretch: { fromMs: number; toMs: number } | null
  line: string
  /** a line about the day is already written, so that question is answered */
  lineDone: boolean
  busy: boolean
  onRate: (e: Entry, n: number) => void
  onSkip: (e: Entry) => void
  onLog: (s: { fromMs: number; toMs: number }) => void
  onLine: (s: string) => void
  onSaveLine: () => void
  onOff: () => void
  /** the headline fold, on a phone */
  children?: ReactNode
}) {
  const lineId = useId()
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return (
    <section className="chron-wrap" aria-label="Wrapping up today">
      {children}
      <div className="chron-wrap-head">
        <strong>Wrapping up today</strong>
        <button type="button" className="btn btn-ghost chron-wrap-off" onClick={onOff}>
          Not tonight
        </button>
      </div>

      {rate ? (
        <div className="chron-wrap-item">
          <p>
            How did <strong>{name(rate.activity)}</strong> go?{' '}
            <span className="muted">
              {spanText(Date.parse(rate.end!) - Date.parse(rate.start))} at{' '}
              {time(Date.parse(rate.start))}
              {of > 1 ? ` · 1 of ${of}` : ''}
            </span>
          </p>
          <div className="chron-pickmoods">
            {MOODS.map(([n, word]) => (
              <button
                key={n}
                type="button"
                className={'chron-pickmood is-' + word}
                disabled={busy}
                onClick={() => onRate(rate, n)}
              >
                {word}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-ghost chron-wrap-skip"
              disabled={busy}
              onClick={() => onSkip(rate)}
            >
              Skip
            </button>
          </div>
        </div>
      ) : null}

      {stretch ? (
        <div className="chron-wrap-item chron-wrap-row">
          <p>
            Nothing written down{' '}
            <strong>
              {time(stretch.fromMs)}–{time(stretch.toMs)}
            </strong>
            <span className="muted"> · {spanText(stretch.toMs - stretch.fromMs)}</span>
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => onLog(stretch)}
          >
            Log it
          </button>
        </div>
      ) : null}

      {!lineDone ? (
        <div className="chron-wrap-item chron-wrap-row">
          <label className="sr-only" htmlFor={lineId}>
            One line about today
          </label>
          <input
            id={lineId}
            className="chron-wrap-line"
            value={line}
            placeholder="One line about today"
            onChange={(e) => onLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              onSaveLine()
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || !line.trim()}
            onClick={onSaveLine}
          >
            Save
          </button>
        </div>
      ) : null}
    </section>
  )
}
