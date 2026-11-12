import { editNote, dropSet } from './cloud'
import { Modal } from '../circuit/ui/Modal'
import { AddPicture } from '../pictures/AddPicture'
import { HoldButton } from '../ui/HoldButton'
import { countedIn, moveNote, setName } from './sets'
import { unitOf } from './units'
import {
  clockOfLocal,
  minsBetweenLocal,
  nudgeLocal,
  MOODS,
  countText,
  spanText,
  type Activity,
  type Entry,
} from './record'
import { forInput, type SittingEditor } from './useSittingEditor'
import type { ActivityEditor } from './useActivityEditor'

/**
 * ⚠️ TWO BUTTONS AT ONE MINUTE, WHERE THERE WERE FOUR AT FIVE AND FIFTEEN.
 *
 * The four were `[-15, -5, 5, 15]`, and they failed in both directions at once: you could not
 * reach an exact minute with them, and they were four of the controls on a row that was already
 * called "very control dense". "A plus and minus button to really adjust single increments that I
 * can easily press and hold to ramp faster" solves both — one minute is exact, and a hold crosses
 * an hour in about three seconds, so the coarse jumps have nothing left to do.
 *
 * The ramp itself lives in src/ui/hold.ts, where it can be asked how far a given hold moves
 * rather than felt for in a browser that never fires a frame.
 */
const STEP_MINUTES = 1

/**
 * The sitting editor's dialog: the same Modal for a sitting just finished ("…how did it go?") and
 * one being changed. Its state lives in useSittingEditor, which the Timer owns.
 */
export function SittingDialog({
  ed,
  log,
  byId,
  busy,
  setBusy,
  moan,
  actEd,
  open,
  after,
  onIdea,
  onShow,
}: {
  ed: SittingEditor
  log: Entry[]
  byId: Map<string, Activity>
  busy: boolean
  setBusy: (busy: boolean) => void
  moan: (why: string) => void
  actEd: ActivityEditor
  /** the activities not archived, for the picker */
  open: Activity[]
  after: () => Promise<void>
  onIdea?: (text: string) => void
  onShow?: (half: 'day' | 'journal') => void
}) {
  const {
    justDid,
    setJustDid,
    fixEnt,
    setFixEnt,
    entAct,
    setEntAct,
    entFrom,
    setEntFrom,
    entTo,
    setEntTo,
    entAmount,
    setEntAmount,
    entMood,
    setEntMood,
    entNote,
    setEntNote,
    entWas,
    entSets,
    setEntSets,
    shot,
    bigPicture,
    hangPicture,
    addJournal,
    saveEnt,
    forget,
  } = ed
  const showing = fixEnt ?? justDid
  const e = log.find((x) => x.id === showing)
  if (!e) return null
  /* ⚠️ what it SAYS differs though what it shows does not: one is an offer, one is a repair */
  const finishing = fixEnt == null
  const a = byId.get(e.activity)
  const metric = byId.get(entAct)?.metric
  /**
   * What the sitting's counted sets hold, which its count may not go below — unless this
   * save moves it to an activity in another unit, which takes them back out on the server.
   */
  const unitMoves = unitOf(a?.metric) !== unitOf(metric)
  const floor = unitMoves ? 0 : countedIn(entSets, e.id)
  const asked = entAmount.trim() === '' ? 0 : Number(entAmount)
  const below = !!e.end && floor > 0 && Number.isFinite(asked) && asked < floor
  const len = minsBetweenLocal(entFrom, entTo)
  const was = entWas.current
  const untouched = was?.to != null && forInput(was.from) === entFrom && forInput(was.to) === entTo
  const ms = untouched ? Date.parse(was.to!) - Date.parse(was.from) : (len ?? 0) * 60_000
  const when = (
    label: string,
    value: string,
    set: React.Dispatch<React.SetStateAction<string>>,
  ) => (
    <div className="chron-field">
      <label>{label}</label>
      <div className="chron-when-row">
        <strong className="chron-when-at">{clockOfLocal(value)}</strong>
        <span className="chron-nudges">
          {/**
           * ⚠️ THE UPDATER FORM, NOT `set(nudgeLocal(value, …))`, AND AT 40ms IT MATTERS.
           * `value` is read from the render that drew the button. A repeat that fires
           * before React has committed the previous one would compute from the OLD time
           * and write the same minute again — a hold that visibly stalls and then jumps,
           * from steps that were counted and thrown away. Asking the setter for its own
           * current value has no such window.
           */}
          <HoldButton
            className="btn btn-ghost chron-nudge"
            label={`${label} one minute earlier (hold to go faster)`}
            onStep={() => set((cur) => nudgeLocal(cur, -STEP_MINUTES))}
          >
            −
          </HoldButton>
          <HoldButton
            className="btn btn-ghost chron-nudge"
            label={`${label} one minute later (hold to go faster)`}
            onStep={() => set((cur) => nudgeLocal(cur, STEP_MINUTES))}
          >
            +
          </HoldButton>
        </span>
      </div>
    </div>
  )
  /**
   * ⚠️ A JOURNAL, NOT A FIELD. This was one `note` column, so a sitting you wanted to
   * say three things about got one, and saying the third meant rewriting the first two.
   * Each entry keeps the moment it was written, which is the half that makes it a
   * journal rather than a longer box — "instead of just a single note id want to be
   * able to journal multiple things into an activity".
   *
   * ⚠️ AND CLEARING ONE DELETES IT, which is `chronicle_note_edit`'s own rule and the
   * one place in this room where empty means remove: a journal entry you have cleared
   * is one you did not mean to write, and a blank row is a thing to tidy up later.
   */
  /**
   * ⚠️ LIFTED OUT SO IT CAN BE DRAWN IN TWO PLACES, AND IT LEADS WHILE THE SITTING IS OPEN.
   * The dialog is ordered for a session you have finished — what it was, when it ran, how
   * long, how much, how it went — and the journal is last because it is the longest thing
   * on it. Opened on the sitting you are IN, that order is wrong: there is no end, no
   * length and nothing yet to rate, and the one reason to open it mid-session is to say
   * what you are doing. So ✎ Note on the running header lands on the box instead of above
   * four fields it has to be scrolled past, and nothing has to steal focus from the Modal
   * to manage it — see the note above about what getting that right cost once already.
   */
  const journal = (
    <div className="chron-field">
      <label>Journal</label>
      {e.notes.length > 0 && (
        <ul className="chron-journal">
          {e.notes.map((n) => (
            <li key={n.id}>
              <time dateTime={n.at}>
                {new Date(n.at).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
              <textarea
                rows={1}
                defaultValue={n.body}
                aria-label={`Written at ${new Date(n.at).toLocaleTimeString()}`}
                onBlur={(ev) => {
                  if (ev.target.value.trim() === n.body) return
                  void (async () => {
                    const bad = await editNote(n.id, ev.target.value)
                    if (bad) moan(bad.why)
                    await after()
                  })()
                }}
              />
              {onIdea && (
                <button
                  type="button"
                  className="btn btn-ghost chron-idea"
                  aria-label="Make this a goal for today"
                  onClick={(ev) => {
                    /* ⚠️ THE BOX'S TEXT, NOT `n.body`. The box is edited in place and saves
                       on blur, so a line changed and then sent straight here would
                       otherwise arrive as the version from before the change. */
                    const box = ev.currentTarget.parentElement?.querySelector('textarea')
                    const text = box?.value ?? n.body
                    setFixEnt(null)
                    setJustDid(null)
                    onIdea(text)
                  }}
                >
                  ＋ Goal
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="chron-journal-add">
        <textarea
          rows={1}
          value={entNote}
          placeholder={e.notes.length ? 'and another thing…' : 'write something down'}
          onChange={(ev) => setEntNote(ev.target.value)}
        />
        <button
          className="btn btn-ghost"
          disabled={busy || !entNote.trim()}
          onClick={() => void addJournal(e.id)}
        >
          Add
        </button>
      </div>
    </div>
  )
  return (
    <Modal
      title={
        finishing
          ? `${spanText(ms)} of ${a?.name ?? 'that'} — how did it go?`
          : `Edit ${a?.name ?? 'this session'}`
      }
      onClose={() => {
        setFixEnt(null)
        setJustDid(null)
      }}
      footer={
        <div className="chron-modal-do">
          {/* ⚠️ DELETE LIVES HERE, AWAY FROM SAVE — the arrangement the HTML version uses,
              and the reason a log row no longer needs a ✕ of its own beside its ✎ */}
          <button className="btn btn-ghost chron-danger" onClick={() => void forget(e)}>
            🗑 Delete
          </button>
          <span className="chron-modal-right">
            <button
              className="btn btn-ghost"
              onClick={() => {
                setFixEnt(null)
                setJustDid(null)
              }}
            >
              {/* ⚠️ "Done" when finishing, because there is nothing to cancel — the
                  sitting is already recorded and this dialog only ever adds to it */}
              {finishing ? 'Done' : 'Cancel'}
            </button>
            <button
              className="btn"
              disabled={busy || (len ?? 0) < 0 || below}
              onClick={() => void saveEnt(metric)}
            >
              Save
            </button>
          </span>
        </div>
      }
    >
      {e.end == null ? journal : null}

      <div className="chron-field">
        <label htmlFor="ent-act">What it was</label>
        <select
          id="ent-act"
          value={entAct}
          onChange={(ev) => {
            /* ⚠️ a quantity belongs to a metric, and moving a session changes the metric
               under it — sixty reps is not sixty pages, so the number goes when the unit
               does, visibly, while somebody is looking at it */
            const before = byId.get(entAct)?.metric ?? null
            const after = byId.get(ev.target.value)?.metric ?? null
            if (before !== after) setEntAmount('')
            setEntAct(ev.target.value)
          }}
        >
          {[...open, ...(a && a.archived ? [a] : [])].map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        {/* ⚠️ SAID AT THE MOMENT IT HAPPENS (§15c): a move takes the time to the new
            activity and leaves every set the exercise it was. Correct, and it looks like a
            bug — a goal's number moves and the Circuit's does not. */}
        {entAct !== e.activity && moveNote(entSets, e.id) ? (
          <p className="muted chron-move-note">{moveNote(entSets, e.id)}</p>
        ) : null}
      </div>

      <div className="chron-frow">
        {when('From', entFrom, setEntFrom)}
        {e.end ? when('To', entTo, setEntTo) : null}
      </div>

      {e.end && len !== null ? (
        len < 0 ? (
          <p className="chron-when-len is-wrong">That ends before it starts.</p>
        ) : (
          <p className="chron-when-len">{spanText(ms)}</p>
        )
      ) : null}

      {e.end && (
        <details className="chron-exact">
          <summary>exact times</summary>
          <div className="chron-frow">
            <div className="chron-field">
              <label htmlFor="ent-xf">Start</label>
              <input
                id="ent-xf"
                type="datetime-local"
                value={entFrom}
                onChange={(ev) => setEntFrom(ev.target.value)}
              />
            </div>
            <div className="chron-field">
              <label htmlFor="ent-xt">End</label>
              <input
                id="ent-xt"
                type="datetime-local"
                value={entTo}
                onChange={(ev) => setEntTo(ev.target.value)}
              />
            </div>
          </div>
        </details>
      )}

      {e.end && metric && (
        <div className="chron-field">
          <label htmlFor="ent-amt">How many {metric}</label>
          <input
            id="ent-amt"
            value={entAmount}
            inputMode="decimal"
            placeholder={metric}
            onChange={(ev) => setEntAmount(ev.target.value)}
          />
        </div>
      )}

      {/**
       * ⚠️ THE SETS THIS SITTING COUNTED, AND THE WAY TO TAKE ONE BACK. Its count holds the
       * counted ones, so it cannot be lowered below them here — the server refuses that too —
       * and the line under the field says so and says where the fix is: ✕ on a set takes back
       * exactly what it added. A set that is not counted is shown as such, so the two numbers
       * on this dialog never look like they disagree for no reason.
       */}
      {entSets.some((x) => x.entry === e.id) ? (
        <div className="chron-sets">
          <span className="muted">Sets</span>
          <ul>
            {entSets
              .filter((x) => x.entry === e.id)
              .map((x) => (
                <li key={x.id}>
                  {countText(x.value)} {setName(x)}
                  {x.counted ? null : <span className="muted"> · not in the count</span>}
                  <button
                    type="button"
                    className="btn btn-ghost chron-set-x"
                    disabled={busy}
                    aria-label={`Take back ${countText(x.value)} ${setName(x)}`}
                    onClick={async () => {
                      setBusy(true)
                      const bad = await dropSet(x.id)
                      setBusy(false)
                      if (bad) return moan(bad.why)
                      setEntSets((all) => all.filter((y) => y.id !== x.id))
                      if (x.counted && entAmount.trim() !== '') {
                        const n = Number(entAmount)
                        if (Number.isFinite(n)) setEntAmount(String(Math.max(0, n - x.value)))
                      }
                      await after()
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
          </ul>
          {below ? (
            <p className="chron-sets-floor" role="alert">
              Its sets count {countText(floor)} {metric}. Take one back above to go lower.
            </p>
          ) : null}
        </div>
      ) : null}

      {/**
       * ⚠️ THE DOOR TO THE COUNTER, FOR AN ACTIVITY THAT HAS NONE. The `+1 / +5 / +10` row on
       * the clock appears only once an activity has been told what it counts — and that is
       * said in the Activities fold at the foot of the Day half, closed, under a box whose
       * only label is a placeholder reading "pages?". So somebody timing Gym had a rep
       * counter one setting away and nothing on any screen saying so. This is where they
       * already are when the question occurs to them: looking at the session they just did.
       *
       * ⚠️ IT OPENS THE ACTIVITY EDITOR, NOT A SECOND ONE. The metric is a property of the
       * activity, saved through `chronicle_activity_save` with every other field it has; a
       * box here that saved just the metric would be the second write path to a row whose
       * every OTHER column it would then have to pass through untouched.
       */}
      {(() => {
        const act = byId.get(entAct)
        if (metric || !act || act.auto || act.archived) return null
        return (
          <p className="muted chron-count-door">
            Counted reps, laps or pages?{' '}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setFixEnt(null)
                setJustDid(null)
                actEd.setActsOpen(true)
                actEd.editActivity(act)
                actEd.setToMetric((n) => n + 1)
                onShow?.('day')
              }}
            >
              Name what {act.name} counts
            </button>
          </p>
        )
      })()}

      {/**
       * ⚠️ BUTTONS RATHER THAN A SELECT, which is the other thing the HTML version has
       * always done — 👍 Great / 😐 OK / 👎 Rough, one tap rather than opening a list. The
       * scale here is five and stays five, because that is what every rating already
       * stored means; what changes is only how you choose one.
       *
       * ⚠️ AND TAPPING THE CHOSEN ONE CLEARS IT, so "not rated" needs no sixth button. The
       * state it returns to is the one it started in, which is the only thing an undo here
       * could sensibly mean.
       */}
      {/**
       * ⚠️ THE PICKER IS THE ONE FROM THE PICTURES ROOM, which is the whole reason it was
       * lifted out of it. Choose, squeeze, keep — and what comes back is an id, which is
       * all this sitting stores. A signed link is fetched when something is about to be
       * drawn, because every link into a private bucket expires.
       */}
      <div className="chron-field">
        <label>Photograph</label>
        {shot ? (
          <div className="chron-shot">
            {/* same as the rating editor: a thumbnail that enlarges is a control */}
            <button
              type="button"
              className="btn btn-ghost pics-zoom"
              aria-label="See this photo full size"
              onClick={() => bigPicture.open(shot.url, shot.alt)}
            >
              <img src={shot.thumbUrl} alt={shot.alt ?? ''} />
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void hangPicture(e.id, null)}
            >
              Take it off
            </button>
            {/* portaled, so where it sits in the tree does not matter */}
            {bigPicture.viewer}
          </div>
        ) : (
          <AddPicture label="+ Add a photo" onKept={(k) => hangPicture(e.id, k.id)} />
        )}
      </div>

      {e.end && (
        <div className="chron-field">
          <label>How did it go? (optional)</label>
          <div className="chron-pickmoods">
            {MOODS.map(([n, word]) => (
              <button
                key={n}
                className={'chron-pickmood is-' + word + (entMood === String(n) ? ' is-on' : '')}
                aria-pressed={entMood === String(n)}
                onClick={() => setEntMood(entMood === String(n) ? '' : String(n))}
              >
                {word}
              </button>
            ))}
          </div>
        </div>
      )}

      {e.end == null ? null : journal}
    </Modal>
  )
}
