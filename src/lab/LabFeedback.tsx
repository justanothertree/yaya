import { useEffect, useRef, useState } from 'react'
import type { Flags } from './catalog'
import { resultCard, fromStorage } from './bests'
import { attach, scrub, split, type Card } from './recorded'
import {
  COMMENT_KIND,
  NOTE_MAX,
  checkNote,
  explain,
  type LabApi,
  type Note,
  notesSummary,
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
  /** whether the database's catalog lists this experiment; undefined while that is not known */
  listed?: boolean
}

/**
 * Under each experiment: a thumbs up or down, and notes — ideas, requests for more, and bugs —
 * for Evan and for the members the site lets you reach. Guests can play everything; this is the
 * one part that needs an account, and it says so rather than hiding.
 */
export function LabFeedback({ api, demo, name, flags, viewer, onFlags, listed }: Props) {
  if (!api) return null
  /* ⚠️ A TOY NEWER THAN THE CATALOG IS NOT "GONE". The draft seeds the experiments the Lab had when
     it was written and the owner's visit registers any added since — until then the server
     answers every vote and note on it "no such experiment", which explain() reads, rightly for a
     removed note, as "That isn't there any more". Said plainly instead, with nothing to press. */
  if (listed === false)
    return (
      <section className="lab-feedback" aria-label={`Feedback on ${name}`}>
        <p className="muted lab-hint">
          {name} is new here: votes and comments open once it has been added to the catalog.
        </p>
      </section>
    )
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
  const [heard, setHeard] = useState('')
  useEffect(() => {
    setSaid(null)
    setHeard('')
  }, [demo])
  const mine = flags?.mine
  const can = viewer.authed && !viewer.suspended
  const press = async (v: 1 | -1) => {
    if (busy) return
    const next = mine === v ? 0 : v
    setBusy(true)
    setSaid(null)
    setHeard('')
    try {
      const r = await api.vote(demo, next)
      // the server's own count after this vote, everybody's included, rather than ours plus one
      const counts = typeof r?.up === 'number' && typeof r?.down === 'number'
      onFlags(demo, {
        up: counts ? r.up : flags?.up,
        down: counts ? r.down : flags?.down,
        mine: next === 0 ? undefined : next,
      })
      setHeard(
        next === 0 ? 'Vote removed' : next === 1 ? 'Your vote: like' : 'Your vote: needs work',
      )
    } catch (e) {
      setSaid(explain(e))
    } finally {
      setBusy(false)
    }
  }
  const counted = flags?.up !== undefined
  /* ⚠️ TWO BUTTONS AND NOTHING ELSE, by Evan's call (8 Nov). The selected one is highlighted and
     pressing it again takes the vote back; pressing the other moves it. What a sighted member reads
     from the highlight, a screen reader hears from aria-pressed and from the quiet announcement
     below — no "You voted…" line, no Remove button, no paragraph. A guest gets two words, because
     two disabled buttons with no reason are a puzzle. */
  const name = (v: 1 | -1) => {
    const word = v === 1 ? 'Like' : 'Needs work'
    const n = v === 1 ? flags?.up : flags?.down
    return counted ? `${word}, ${n} ${n === 1 ? 'vote' : 'votes'}` : word
  }
  return (
    <div className="lab-controls lab-votes">
      <div className="lab-group" role="group" aria-label="Your vote">
        {([1, -1] as const).map((v) => (
          <button
            key={v}
            className="btn btn-ghost lab-vote"
            aria-pressed={mine === v}
            aria-label={name(v)}
            /* not disabled while the vote is in flight: a button that disables under the
               finger drops keyboard focus to the page — a second press is ignored instead */
            disabled={!can}
            aria-busy={busy || undefined}
            onClick={() => press(v)}
          >
            {v === 1 ? '👍' : '👎'}
            {counted && <span className="lab-vote-n">{v === 1 ? flags?.up : flags?.down}</span>}
          </button>
        ))}
      </div>
      {!viewer.authed && <span className="muted">Sign in to vote</span>}
      {viewer.authed && viewer.suspended && (
        <span className="muted">Voting is paused for this account</span>
      )}
      {said && (
        <span className="lab-warn" role="alert">
          {said}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {heard}
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
  /* ⚠️ THE FIRST PAGE LOADS WITH THE TOY, NOT WITH THE FOLD. It used to wait for the fold to be
     opened, so a closed fold said nothing about whether anybody had written anything — and nobody
     opens a fold to find it empty. Now the summary can say how many there are to read: one call
     per toy, for a signed-in member only, the same call the fold made anyway. */
  useEffect(() => {
    if (viewer.authed && !loaded.current) {
      loaded.current = true
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as soon as there is somebody to ask for
  }, [viewer.authed])

  const replace = (n: Note) => setItems((was) => (was ?? []).map((x) => (x.id === n.id ? n : x)))
  const drop = (id: string) => setItems((was) => (was ?? []).filter((x) => x.id !== id))

  return (
    <details className="lab-notes">
      <summary>
        Comments on {name}
        {viewer.authed ? ` — ${notesSummary(items?.length ?? null, more)}` : ''}
      </summary>
      {!viewer.authed ? (
        <p className="muted">Sign in to read comments and leave one.</p>
      ) : (
        <>
          {!viewer.suspended && (
            <Compose
              api={api}
              demo={demo}
              name={name}
              onPosted={(n) => setItems((was) => [n, ...(was ?? [])])}
            />
          )}
          {said && <p className="lab-warn">{said}</p>}
          {items === null ? (
            <p className="muted" aria-busy={busy}>
              {busy ? 'Loading comments…' : ''}
            </p>
          ) : items.length ? (
            <ul className="lab-note-list">
              {items.map((n) => (
                <NoteRow
                  key={n.id}
                  api={api}
                  demo={demo}
                  note={n}
                  viewer={viewer}
                  onChange={replace}
                  onGone={drop}
                />
              ))}
            </ul>
          ) : (
            <p className="muted">
              No comments yet{viewer.suspended ? '.' : ' — yours could be the first.'}
            </p>
          )}
          {more && items && (
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => load(items[items.length - 1])}
            >
              Older comments
            </button>
          )}
        </>
      )}
    </details>
  )
}

/* ⚠️ A COMMENT, AND NOTHING TO CHOOSE (Evan, 9 Nov). A note was an idea, a request for more or a
   bug, picked from a list first; that was one decision too many before saying something. The
   server still files each under a kind, so every comment goes as COMMENT_KIND and nothing on
   screen asks or shows it. What is left is the box, and — once a toy has a result kept — a button
   that attaches it as a Recorded card (recorded.ts): the words stay the person's own, and the
   result is the game's, not typed. */
function Compose({
  api,
  demo,
  name,
  onPosted,
}: {
  api: LabApi
  demo: string
  name: string
  onPosted: (n: Note) => void
}) {
  const [body, setBody] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [card, setCard] = useState<Card | null>(null)
  const { kept, fresh } = useKeptResult(demo, name)
  /* what will be sent: the words, with any card typed by hand defused, and the real card last */
  const out = attach(scrub(body), card)
  const wrong = body.trim() || card ? checkNote(out) : null
  const send = async () => {
    const why = checkNote(body)
    if (why) return setSaid(why)
    setBusy(true)
    try {
      const n = await api.add(demo, COMMENT_KIND, out)
      if (n) onPosted(n)
      setBody('')
      setCard(null)
      setSaid('Posted.')
    } catch (e) {
      setSaid(explain(e))
    } finally {
      setBusy(false)
    }
  }
  const share = () => {
    if (!kept) return setSaid('No result kept in this browser yet — finish a game first.')
    setCard(kept)
    setSaid(null)
  }
  const attached = !!card && !!kept && card.line === kept.line
  return (
    <form
      className="lab-compose"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <label className="lab-note-box">
        <span className="sr-only">Your comment</span>
        <textarea
          value={body}
          rows={3}
          maxLength={NOTE_MAX + 50}
          placeholder={card ? 'Say something about it (optional)…' : `Say something about ${name}…`}
          onChange={(e) => {
            setBody(e.target.value)
            setSaid(null)
          }}
        />
      </label>
      {card && <ResultCard card={card} onRemove={() => setCard(null)} />}
      <div className="lab-controls">
        <button className="btn" type="submit" disabled={busy || (!body.trim() && !card) || !!wrong}>
          Post
        </button>
        {kept && !attached && (
          <button className="btn btn-ghost" type="button" onClick={share}>
            🏆 Share your score
          </button>
        )}
        <span className="muted lab-hint" aria-live="polite">
          {said ??
            wrong ??
            (fresh && kept && !attached
              ? 'A new result is ready to share.'
              : `${out.length}/${NOTE_MAX}`)}
        </span>
      </div>
    </form>
  )
}

function NoteRow({
  api,
  demo,
  note: n,
  viewer,
  onChange,
  onGone,
}: {
  api: LabApi
  /** the toy the note is about — a card is a card only on its own toy */
  demo: string
  note: Note
  viewer: Viewer
  onChange: (n: Note) => void
  onGone: (id: string) => void
}) {
  const [mode, setMode] = useState<'read' | 'edit' | 'delete' | 'report'>('read')
  /* the words and the card apart: editing changes the words, and the card goes back as it was */
  const parts = split(n.body, demo)
  const [draft, setDraft] = useState(parts.text)
  const edited = attach(scrub(draft), parts.card)
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
  const when = new Date(n.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const can = !viewer.suspended
  return (
    <li className="lab-note" data-removed={n.removed || undefined}>
      <p className="lab-note-meta muted">
        {n.mine ? 'You' : n.author} · {when}
        {n.edited && ' · edited'}
        {n.removed && ' · removed by the moderator'}
      </p>
      {mode === 'edit' ? (
        <>
          <label className="lab-note-box">
            <span className="sr-only">Edit your comment</span>
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
              disabled={busy || !!checkNote(edited)}
              onClick={() =>
                act(async () => {
                  const e = await api.edit(n.id, edited, null)
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
              {checkNote(edited) ?? `${edited.length}/${NOTE_MAX}`}
            </span>
          </div>
        </>
      ) : (
        <>
          {parts.text && <p className="lab-note-body">{parts.text}</p>}
          {parts.card && <ResultCard card={parts.card} />}
        </>
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
          <span>Delete this comment for good?</span>
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
          <span>Report this comment to Evan?</span>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await api.report(n.id, 'other')
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
        Hiding keeps its id, everybody’s saved work and every vote and comment; restore it any time.
        {flags?.notes
          ? ` Comments you can read here: ${flags.notes.idea + flags.notes.more + flags.notes.bug}. A comment shared only with friends you are not among reaches you only if somebody reports it.`
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
                <ReportBody body={r.body} demo={r.demo} />
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

/** a reported note, as its author posted it: words, and the card if there was one */
function ReportBody({ body, demo }: { body: string; demo: string }) {
  const { text, card } = split(body, demo)
  return (
    <>
      {text && <p className="lab-note-body">{text}</p>}
      {card && <ResultCard card={card} />}
    </>
  )
}

/**
 * A result riding with a comment. "Recorded" in words on the card, because that is all it is: the
 * game kept it in that person's browser. A checked result — the server replaying the run — is a
 * later step and will say so differently.
 */
function ResultCard({ card, onRemove }: { card: Card; onRemove?: () => void }) {
  return (
    <div className="lab-card" role="group" aria-label="Recorded result">
      <span className="lab-card-line">🏆 {card.line}</span>
      <span className="lab-card-tag">Recorded by the game, not checked</span>
      {onRemove && (
        <button
          type="button"
          className="btn btn-ghost lab-card-x"
          onClick={onRemove}
          aria-label="Remove the result from this comment"
        >
          ✕
        </button>
      )}
    </div>
  )
}

/**
 * The result this toy keeps in this browser, as a card, kept current while the page is open.
 *
 * ⚠️ READ AGAIN EVERY SECOND AND A HALF, not on an event. Toys keep their results three ways —
 * useKept, a hand-written localStorage call, a bests module — and none of them announces a
 * write in the same tab (the storage event is for OTHER tabs). One read of one key, parsed by the
 * toy's own reader, is cheap enough to do on a timer; and it is what lets the button appear at the
 * moment a game finishes, which is the moment somebody wants to share it.
 *
 * `fresh` is true once the result has changed during this visit — a game just finished.
 */
function useKeptResult(demo: string, name: string): { kept: Card | null; fresh: boolean } {
  const read = () => resultCard(demo, name, fromStorage)
  const [kept, setKept] = useState<Card | null>(read)
  const [fresh, setFresh] = useState(false)
  const first = useRef(kept?.line ?? null)
  useEffect(() => {
    first.current = resultCard(demo, name, fromStorage)?.line ?? null
    setKept(resultCard(demo, name, fromStorage))
    setFresh(false)
    const t = window.setInterval(() => {
      const now = resultCard(demo, name, fromStorage)
      setKept((was) => (was?.line === now?.line ? was : now))
      if (now && now.line !== first.current) setFresh(true)
    }, 1500)
    return () => window.clearInterval(t)
  }, [demo, name])
  return { kept, fresh }
}
