// Daily log — pick a person + date, enter per-exercise amounts, watch points/goal live.
// The exercise grid is a "sheet" of slots: moveable (drag the ⠿ handle to reorder within or
// across columns), and edited in a focused modal (name / multiplier / unit / category / tags).
// Entries autosave through the shared store (localStorage signed out, Supabase and realtime
// signed in), so there's no Save button and every change gets undo/redo + sync for free.
// The state is useLog.ts; the sheet and its exercise editor are LogSheet.tsx.
import { useEffect, useState } from 'react'
import { logPoints } from '../scoring'
import { GoalBar } from './GoalBar'
import { todayISO } from '../dates'
import type { DayLog } from '../types'
import { AddPicture } from '../../pictures/AddPicture'
import { useSeenPicture } from '../../pictures/seen'
import { setLogPicture } from '../picture'
import { LogSheet } from './LogSheet'
import { useLog } from './useLog'

export function Log({
  defaultPersonId,
  defaultDate,
  viewGroup = '',
}: {
  defaultPersonId?: string
  defaultDate?: string
  viewGroup?: string
} = {}) {
  /** everything the log holds — see useLog */
  const log = useLog({ defaultPersonId, defaultDate, viewGroup })
  const {
    people,
    setSelPid,
    date,
    setDate,
    savedPulse,
    celebrate,
    uid,
    authReady,
    pid,
    person,
    canEdit,
    existing,
    imported,
    goal,
    total,
    hit,
    shiftDay,
    clear,
    copyLast,
  } = log

  if (!person) return <p className="muted">No participants yet.</p>

  const laps = Math.floor(total / goal)
  const extra = Math.round(total % goal)
  const goalNote = !hit
    ? `/ ${goal} pts`
    : laps > 1
      ? `/ ${goal} pts ✓ ×${laps} goal!`
      : extra > 0
        ? `/ ${goal} pts ✓ +${extra} bonus`
        : `/ ${goal} pts ✓ goal hit!`

  return (
    <div>
      {/* person chips */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
        {people.map((p) => {
          const on = p.id === pid
          return (
            <button
              key={p.id}
              className="btn"
              onClick={() => setSelPid(p.id)}
              style={{
                borderColor: p.color,
                color: on ? '#fff' : p.color,
                background: on ? p.color : 'transparent',
                fontWeight: 700,
              }}
            >
              {p.name}
            </button>
          )
        })}
      </div>

      {authReady && !canEdit && person && (
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
            marginBottom: '0.9rem',
            borderColor: '#f5c060',
            background: 'rgba(245,192,96,0.1)',
          }}
        >
          <span style={{ fontSize: '1.05rem' }}>🔒</span>
          <span style={{ fontWeight: 700 }}>Read-only</span>
          <span className="muted" style={{ fontSize: '0.86rem' }}>
            This is {person.name}&rsquo;s Circuit — you can look, but changes won&rsquo;t save. Pick
            your own name above to log yours.
          </span>
        </div>
      )}

      {/* date row — ⚠️ it wraps: a past day with a workout carries ‹ date › Today and Saved ✓, which is
          385px of row, and on a 375 phone the badge sat 34px past the edge reading "S" */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.75rem',
        }}
      >
        <button className="btn" aria-label="Previous day" onClick={() => shiftDay(-1)}>
          ‹
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ padding: '0.4rem 0.6rem' }}
        />
        <button className="btn" aria-label="Next day" onClick={() => shiftDay(1)}>
          ›
        </button>
        {date !== todayISO() && (
          <button
            className="btn btn-ghost"
            onClick={() => setDate(todayISO())}
            style={{ fontSize: '0.78rem' }}
            title="Jump to today"
          >
            ● Today
          </button>
        )}
        {existing && !imported && (
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              color: '#22cc78',
              background: 'rgba(34,204,120,0.12)',
              border: '1px solid rgba(34,204,120,0.4)',
              borderRadius: 12,
              padding: '2px 9px',
            }}
            title="A workout is saved for this day"
          >
            Saved ✓
          </span>
        )}
        {imported && (
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              color: '#f5c060',
              background: 'rgba(245,192,96,0.12)',
              border: '1px solid rgba(245,192,96,0.4)',
              borderRadius: 12,
              padding: '2px 9px',
            }}
            title="Imported historical total"
          >
            Imported
          </span>
        )}
      </div>

      {imported && (
        <p className="muted" style={{ marginTop: 0 }}>
          📊 Imported total: <strong>{Math.round(logPoints(person, existing!))} pts</strong> — no
          per-exercise breakdown. Entering values below will replace it.
        </p>
      )}

      {/* goal / live total */}
      <div style={{ margin: '0.5rem 0 1rem' }}>
        <GoalBar total={total} goal={goal} color="var(--accent, #7c6af7)" />
        <div
          className="muted"
          style={{
            marginTop: 4,
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.4rem',
            flexWrap: 'wrap',
          }}
        >
          <span
            className={`cz-num${celebrate ? ' cz-goal-pop' : ''}`}
            style={{
              fontSize: '1.4rem',
              fontWeight: 800,
              color: hit ? '#22cc78' : 'var(--accent, #7c6af7)',
            }}
          >
            {Math.round(total)}
          </span>
          <span style={{ fontSize: '0.82rem', color: hit ? '#22cc78' : undefined }}>
            {goalNote}
          </span>
          {celebrate && (
            <span
              className="cz-goal-cheer"
              role="status"
              style={{ fontSize: '0.9rem', fontWeight: 700, color: '#22cc78' }}
            >
              🎉 Goal!
            </span>
          )}
        </div>
      </div>

      <LogSheet log={log} person={person} />

      {/* actions — entries save automatically, so there's no Save button */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginTop: '1.25rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          className="btn"
          onClick={copyLast}
          title="Fill from this person's most recent workout"
        >
          ⧉ Copy last
        </button>
        <button className="btn" onClick={clear} title="Clear this day's entries (removes the log)">
          Clear
        </button>
        {/**
         * ⚠️ ONLY ONCE THE DAY EXISTS. circuit_log_picture refuses a row that is not there, and
         * this form has no Save button to hang the attachment behind — it autosaves 600ms after a
         * number is typed. So the control appears when there is a log to attach to, rather than
         * offering something that would answer "no such workout".
         *
         * ⚠️ AND `uid != null` ON TOP OF `canEdit`, WHICH IS NOT REDUNDANT. canEdit is
         * `uid == null || isAdmin || owner` — signed out counts as allowed, deliberately, because
         * the local demo board is anybody's to play with. A photograph is not like the numbers: it
         * goes to an ACCOUNT's gallery and through an RPC that refuses `auth.uid() is null`. Seen
         * in the pane on the demo board, which rendered "+ Photo" happily — a file picker and an
         * upload that could only ever answer "not authenticated".
         */}
        {existing && uid != null && canEdit && !imported ? <LogPicture log={existing} /> : null}
        <span
          key={savedPulse}
          className="muted"
          style={{ fontSize: '0.78rem', marginLeft: 'auto', animation: 'czIn 0.2s ease' }}
        >
          {existing && !imported ? '✓ Saved automatically' : 'Saves automatically as you type'}
        </span>
      </div>
    </div>
  )
}

/**
 * Attach, show or remove the photograph on one day's workout.
 *
 * ⚠️ IT WRITES STRAIGHT AWAY RATHER THAN WAITING FOR A SAVE, which is the opposite of the rating
 * editor and right for the same reason: this form has no Save button. It autosaves 600ms after a
 * number changes, so there is no moment to defer an attachment to — the only honest thing is to
 * do it when the picture is kept and say so if it fails.
 */
function LogPicture({ log }: { log: DayLog }) {
  const [id, setId] = useState<string | null>(log.picture ?? null)
  const [say, setSay] = useState<string | null>(null)
  const shot = useSeenPicture(id)

  /* ⚠️ the row can change under this — realtime, or switching day — so follow it rather than
     keeping whatever was attached to a log that is no longer the one on screen */
  useEffect(() => setId(log.picture ?? null), [log.id, log.picture])

  const hang = async (next: string | null) => {
    const before = id
    setId(next)
    const bad = await setLogPicture(log.id, next)
    if (bad) {
      setId(before)
      setSay(bad.why)
      window.setTimeout(() => setSay(null), 6000)
    }
  }

  if (say)
    return (
      <span className="muted" role="status" style={{ fontSize: '0.78rem' }}>
        {say}
      </span>
    )

  return id ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      {shot ? (
        <img
          src={shot.thumbUrl}
          alt={shot.alt ?? ''}
          style={{ maxHeight: 32, borderRadius: 6, display: 'block' }}
        />
      ) : null}
      <button className="btn btn-ghost" onClick={() => void hang(null)} title="Take the photo off">
        Remove photo
      </button>
    </span>
  ) : (
    <AddPicture label="+ Photo" onKept={(k) => hang(k.id)} />
  )
}
