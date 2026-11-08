import { useEffect, useRef, useState } from 'react'
import type { Flags } from './catalog'
import {
  NOTE_KINDS,
  NOTE_MAX,
  REPORT_REASONS,
  checkNote,
  explain,
  type LabApi,
  type Note,
  type NoteKind,
  type ReportReason,
} from './feedback'

export type Viewer = { authed: boolean; suspended: boolean; isAdmin: boolean }

type Props = {
  api: LabApi | null
  demo: string
  name: string
  flags: Flags | undefined
  viewer: Viewer
  /** the server's answer to a vote or an owner's change, for the catalog to show */
  onFlags: (id: string, patch: Partial<Flags>) => void
}

/**
 * Under each experiment: a thumbs up or down, and notes — ideas, requests for more, and bugs —
 * for Evan and for the members the site lets you reach. Guests can play everything; this is the
 * one part that needs an account, and it says so rather than hiding.
 */
export function LabFeedback({ api, demo, name, flags, viewer, onFlags }: Props) {
  if (!api) return null
  return (
    <section className="lab-feedback" aria-label={`Feedback on ${name}`}>
      <Votes api={api} demo={demo} flags={flags} viewer={viewer} onFlags={onFlags} />
      <Notes key={demo} api={api} demo={demo} name={name} viewer={viewer} />
      {viewer.isAdmin && <Owner api={api} demo={demo} flags={flags} onFlags={onFlags} />}
    </section>
  )
}

function Votes({
  api,
  demo,
  flags,
  viewer,
  onFlags,
}: {
  api: LabApi
  demo: string
  flags: Flags | undefined
  viewer: Viewer
  onFlags: Props['onFlags']
}) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => setSaid(null), [demo])
  const mine = flags?.mine
  const can = viewer.authed && !viewer.suspended
  const press = async (v: 1 | -1) => {
    const next = mine === v ? 0 : v
    setBusy(true)
    setSaid(null)
    try {
      const r = await api.vote(demo, next)
      // the server's own count after this vote, everybody's included, rather than ours plus one
      const counts = typeof r?.up === 'number' && typeof r?.down === 'number'
      onFlags(demo, {
        up: counts ? r.up : flags?.up,
        down: counts ? r.down : flags?.down,
        mine: next === 0 ? undefined : next,
      })
    } catch (e) {
      setSaid(explain(e))
    } finally {
      setBusy(false)
    }
  }
  const counted = flags?.up !== undefined
  return (
    <div className="lab-controls lab-votes">
      <div className="lab-group" role="group" aria-label="Your vote">
        <button
          className="btn btn-ghost"
          aria-pressed={mine === 1}
          disabled={!can || busy}
          onClick={() => press(1)}
        >
          👍 {counted ? flags?.up : ''}
          <span className="sr-only"> — I like it{counted ? ` (${flags?.up} so far)` : ''}</span>
        </button>
        <button
          className="btn btn-ghost"
          aria-pressed={mine === -1}
          disabled={!can || busy}
          onClick={() => press(-1)}
        >
          👎 {counted ? flags?.down : ''}
          <span className="sr-only"> — needs work{counted ? ` (${flags?.down} so far)` : ''}</span>
        </button>
      </div>
      {/* your own vote in words, and a plain way to take it back — a pressed button alone is a
          state some people do not read as "this is mine" */}
      {can && mine && (
        <span className="lab-mine">
          You voted {mine === 1 ? '👍 Like' : '👎 Needs work'}
          <button className="btn btn-ghost" disabled={busy} onClick={() => press(mine)}>
            Remove my vote
          </button>
        </span>
      )}
      <span className="muted lab-hint" aria-live="polite">
        {said ??
          (!viewer.authed
            ? 'Sign in to vote and leave notes — playing never needs an account.'
            : viewer.suspended
              ? 'This account can’t vote or post right now.'
              : mine
                ? 'Press the other one to change it. Members see the totals, never a list of who voted.'
                : 'Members see the totals, never a list of who voted.')}
      </span>
    </div>
  )
}

function Notes({
  api,
  demo,
  name,
  viewer,
}: {
  api: LabApi
  demo: string
  name: string
  viewer: Viewer
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Note[] | null>(null)
  const [more, setMore] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const loaded = useRef(false)

  const load = async (before?: Note) => {
    setBusy(true)
    try {
      const page = await api.page(demo, before)
      setItems((was) => (before ? [...(was ?? []), ...page.items] : page.items))
      setMore(page.more)
      setSaid(null)
    } catch (e) {
      setSaid(explain(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (open && viewer.authed && !loaded.current) {
      loaded.current = true
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, the first time the fold opens
  }, [open, viewer.authed])

  const replace = (n: Note) => setItems((was) => (was ?? []).map((x) => (x.id === n.id ? n : x)))
  const drop = (id: string) => setItems((was) => (was ?? []).filter((x) => x.id !== id))

  return (
    <details className="lab-notes" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Notes on {name} — ideas, requests and bugs</summary>
      {!viewer.authed ? (
        <p className="muted">Sign in to read notes and leave one.</p>
      ) : (
        <>
          {!viewer.suspended && (
            <Compose
              api={api}
              demo={demo}
              onPosted={(n) => setItems((was) => [n, ...(was ?? [])])}
            />
          )}
          {said && <p className="lab-warn">{said}</p>}
          {items === null ? (
            <p className="muted" aria-busy={busy}>
              {busy ? 'Loading notes…' : ''}
            </p>
          ) : items.length ? (
            <ul className="lab-note-list">
              {items.map((n) => (
                <NoteRow
                  key={n.id}
                  api={api}
                  note={n}
                  viewer={viewer}
                  onChange={replace}
                  onGone={drop}
                />
              ))}
            </ul>
          ) : (
            <p className="muted">
              No notes yet{viewer.suspended ? '.' : ' — yours could be the first.'}
            </p>
          )}
          {more && items && (
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => load(items[items.length - 1])}
            >
              Older notes
            </button>
          )}
        </>
      )}
    </details>
  )
}

function Compose({
  api,
  demo,
  onPosted,
}: {
  api: LabApi
  demo: string
  onPosted: (n: Note) => void
}) {
  const [kind, setKind] = useState<NoteKind>('idea')
  const [body, setBody] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const wrong = body.trim() ? checkNote(body) : null
  const send = async () => {
    const why = checkNote(body)
    if (why) return setSaid(why)
    setBusy(true)
    try {
      const n = await api.add(demo, kind, body)
      if (n) onPosted(n)
      setBody('')
      setSaid('Posted.')
    } catch (e) {
      setSaid(explain(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="lab-compose"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <p className="muted lab-hint">
        Who reads a note follows the same rules as your profile: if your page reaches only friends,
        so does this note. The site’s owner reads it only where those same rules reach, or once
        somebody reports it. Plain text, up to {NOTE_MAX} characters.
      </p>
      <div className="lab-controls">
        <label className="studio-pick">
          <span className="muted">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
            {NOTE_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="lab-note-box">
        <span className="sr-only">Your note</span>
        <textarea
          value={body}
          rows={3}
          maxLength={NOTE_MAX + 50}
          placeholder="What would make it better, what should there be more of, or what went wrong?"
          onChange={(e) => {
            setBody(e.target.value)
            setSaid(null)
          }}
        />
      </label>
      <div className="lab-controls">
        <button className="btn" type="submit" disabled={busy || !body.trim() || !!wrong}>
          Post note
        </button>
        <span className="muted lab-hint" aria-live="polite">
          {said ?? wrong ?? `${body.trim().length}/${NOTE_MAX}`}
        </span>
      </div>
    </form>
  )
}

function NoteRow({
  api,
  note: n,
  viewer,
  onChange,
  onGone,
}: {
  api: LabApi
  note: Note
  viewer: Viewer
  onChange: (n: Note) => void
  onGone: (id: string) => void
}) {
  const [mode, setMode] = useState<'read' | 'edit' | 'delete' | 'report'>('read')
  const [draft, setDraft] = useState(n.body)
  const [reason, setReason] = useState<ReportReason>('spam')
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setSaid(null)
    try {
      await fn()
    } catch (e) {
      setSaid(explain(e))
    } finally {
      setBusy(false)
    }
  }
  const kind = NOTE_KINDS.find((k) => k.id === n.kind)?.label
  const when = new Date(n.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const can = !viewer.suspended
  return (
    <li className="lab-note" data-removed={n.removed || undefined}>
      <p className="lab-note-meta muted">
        <span className="lab-badge">{kind}</span> {n.mine ? 'You' : n.author} · {when}
        {n.edited && ' · edited'}
        {n.removed && ' · removed by the moderator'}
      </p>
      {mode === 'edit' ? (
        <>
          <label className="lab-note-box">
            <span className="sr-only">Edit your note</span>
            <textarea
              value={draft}
              rows={3}
              maxLength={NOTE_MAX + 50}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <div className="lab-controls">
            <button
              className="btn"
              disabled={busy || !!checkNote(draft)}
              onClick={() =>
                act(async () => {
                  const e = await api.edit(n.id, draft, null)
                  if (e) onChange(e)
                  setMode('read')
                })
              }
            >
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setMode('read')}>
              Cancel
            </button>
            <span className="muted lab-hint">
              {checkNote(draft) ?? `${draft.trim().length}/${NOTE_MAX}`}
            </span>
          </div>
        </>
      ) : (
        <p className="lab-note-body">{n.body}</p>
      )}
      {mode === 'read' && (
        <div className="lab-controls lab-note-actions">
          {n.mine && can && !n.removed && (
            <button className="btn btn-ghost" onClick={() => setMode('edit')}>
              Edit
            </button>
          )}
          {n.mine && (
            <button className="btn btn-ghost" onClick={() => setMode('delete')}>
              Delete
            </button>
          )}
          {!n.mine && can && !n.removed && (
            <button className="btn btn-ghost" onClick={() => setMode('report')}>
              Report
            </button>
          )}
          {viewer.isAdmin && (
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const m = await api.moderate(n.id, n.removed ? 'restore' : 'remove')
                  if (m) onChange(m)
                })
              }
            >
              {n.removed ? 'Restore' : 'Remove'}
            </button>
          )}
        </div>
      )}
      {mode === 'delete' && (
        <div className="lab-controls">
          <span>Delete this note for good?</span>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await api.remove(n.id)
                onGone(n.id)
              })
            }
          >
            Delete
          </button>
          <button className="btn btn-ghost" onClick={() => setMode('read')}>
            Keep it
          </button>
        </div>
      )}
      {mode === 'report' && (
        <div className="lab-controls">
          <label className="studio-pick">
            <span className="muted">Why</span>
            <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
              {REPORT_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await api.report(n.id, reason)
                setMode('read')
                setSaid(
                  r === 'already'
                    ? 'You’ve already reported this one.'
                    : 'Reported to Evan, privately. The writer isn’t told who.',
                )
              })
            }
          >
            Send report
          </button>
          <button className="btn btn-ghost" onClick={() => setMode('read')}>
            Cancel
          </button>
        </div>
      )}
      {said && (
        <p className="muted lab-hint" aria-live="polite">
          {said}
        </p>
      )}
    </li>
  )
}

/** the owner's switches for this experiment, and the report queue. The database is the lock. */
function Owner({
  api,
  demo,
  flags,
  onFlags,
}: {
  api: LabApi
  demo: string
  flags: Flags | undefined
  onFlags: Props['onFlags']
}) {
  const [said, setSaid] = useState<string | null>(null)
  const [reports, setReports] = useState<Awaited<ReturnType<LabApi['reports']>> | null>(null)
  const set = async (patch: Partial<Pick<Flags, 'featured' | 'experiment' | 'hidden'>>) => {
    setSaid(null)
    try {
      await api.setDemo(demo, patch)
      onFlags(demo, patch)
    } catch (e) {
      setSaid(explain(e))
    }
  }
  const toggles: [keyof Pick<Flags, 'featured' | 'experiment' | 'hidden'>, string][] = [
    ['featured', '⭐ Featured'],
    ['experiment', '🧪 Rough edges'],
    ['hidden', '🙈 Hidden from everyone else'],
  ]
  return (
    <details className="lab-owner">
      <summary>Owner controls</summary>
      <div className="lab-controls">
        {toggles.map(([k, label]) => (
          <button
            key={k}
            className="btn btn-ghost"
            aria-pressed={!!flags?.[k]}
            onClick={() => set({ [k]: !flags?.[k] })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted lab-hint">
        Hiding keeps its id, everybody’s saved work and every vote and note; restore it any time.
        {flags?.notes
          ? ` Notes you can read here: ${flags.notes.idea} ideas, ${flags.notes.more} asking for more, ${flags.notes.bug} bugs. A note shared only with friends you are not among reaches you only if somebody reports it.`
          : ''}
      </p>
      <div className="lab-controls">
        <button
          className="btn btn-ghost"
          onClick={async () => {
            try {
              setReports(await api.reports())
            } catch (e) {
              setSaid(explain(e))
            }
          }}
        >
          Reports and removed notes{flags?.reports ? ` (${flags.reports} reported here)` : ''}
        </button>
      </div>
      {said && <p className="lab-warn">{said}</p>}
      {reports &&
        (reports.length ? (
          <ul className="lab-note-list">
            {reports.map((r) => (
              <li key={r.id} className="lab-note">
                <p className="lab-note-meta muted">
                  {r.demo} · {r.author} ·{' '}
                  {r.state === 'removed'
                    ? 'removed'
                    : Object.entries(r.reasons)
                        .map(([k, v]) => `${v} ${k}`)
                        .join(', ')}
                </p>
                <p className="lab-note-body">{r.body}</p>
                <div className="lab-controls">
                  {(r.state === 'removed'
                    ? (['restore'] as const)
                    : (['remove', 'keep'] as const)
                  ).map((a) => (
                    <button
                      key={a}
                      className="btn btn-ghost"
                      onClick={async () => {
                        try {
                          await api.moderate(r.id, a)
                          setReports((was) => (was ?? []).filter((x) => x.id !== r.id))
                        } catch (e) {
                          setSaid(explain(e))
                        }
                      }}
                    >
                      {a === 'remove' ? 'Remove it' : a === 'keep' ? 'Keep it up' : 'Restore it'}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No open reports and nothing removed.</p>
        ))}
    </details>
  )
}
