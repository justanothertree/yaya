import { archiveActivity, type MyExercise } from './cloud'
import { LIMIT } from './limits'
import { CATS, COLOURS, spanText, type Activity } from './record'
import { fit, fitText } from './units'
import type { ActivityEditor } from './useActivityEditor'

/**
 * The Activities fold at the foot of the Day half: every activity, each a door to its editor, and
 * Archive. The editor's state lives in useActivityEditor, which the Timer owns.
 */
export function ActivitiesFold({
  ed,
  acts,
  byId,
  exercises,
  mins,
  busy,
  after,
  toggleLink,
}: {
  ed: ActivityEditor
  acts: Activity[] | null
  byId: Map<string, Activity>
  exercises: MyExercise[] | null
  mins: Record<string, number>
  busy: boolean
  after: () => Promise<void>
  toggleLink: (x: MyExercise, activity: string | null) => Promise<void>
}) {
  const {
    fixAct,
    setFixAct,
    actsOpen,
    setActsOpen,
    metricBox,
    actName,
    setActName,
    actCat,
    setActCat,
    actColour,
    setActColour,
    actMetric,
    setActMetric,
    actSession,
    setActSession,
    actShared,
    setActShared,
    editActivity,
    saveAct,
  } = ed
  return (
    /* ⚠️ CONTROLLED, because something besides its own summary now opens it — the "name what
           this counts" door in a sitting's editor. `onToggle` keeps the state honest when a person
           opens or closes it by hand, so the two never disagree about whether it is open. */
    <details
      className="chron-tidy"
      open={actsOpen}
      onToggle={(ev) => setActsOpen(ev.currentTarget.open)}
    >
      <summary>Activities</summary>
      <ul className="chron-acts">
        {(acts ?? []).map((a) =>
          fixAct === a.id ? (
            <li key={a.id} className="chron-fix">
              <label>
                <span className="sr-only">Name</span>
                <input
                  value={actName}
                  maxLength={LIMIT.name}
                  onChange={(e) => setActName(e.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">Which kind</span>
                <select
                  value={actCat}
                  onChange={(e) => setActCat(e.target.value as Activity['cat'])}
                >
                  {CATS.map(([c, label]) => (
                    <option key={c} value={c}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {/**
               * ⚠️ A COLOUR IS DECORATION BESIDE A NAME, never the only thing carrying it.
               * The dot sits next to the word everywhere it is drawn, so somebody who cannot
               * tell the colours apart loses nothing — which is the only reason a row of
               * swatches is allowed to be the control.
               */}
              <span className="chron-swatches" role="group" aria-label="A colour for this">
                {COLOURS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={'chron-swatch' + (actColour === c ? ' is-on' : '')}
                    style={{ background: c }}
                    aria-pressed={actColour === c}
                    aria-label={`Colour ${COLOURS.indexOf(c) + 1} of ${COLOURS.length}`}
                    onClick={() => setActColour(c)}
                  />
                ))}
                <button
                  type="button"
                  className={'chron-swatch is-none' + (actColour == null ? ' is-on' : '')}
                  aria-pressed={actColour == null}
                  aria-label="No colour"
                  onClick={() => setActColour(null)}
                >
                  ✕
                </button>
              </span>
              <label className="chron-qty">
                <span className="sr-only">Also counts (optional)</span>
                <input
                  ref={metricBox}
                  value={actMetric}
                  maxLength={LIMIT.unit}
                  placeholder="pages?"
                  onChange={(e) => setActMetric(e.target.value)}
                />
              </label>
              <label className="chron-qty">
                <span className="sr-only">How long should one sitting be, in minutes</span>
                <input
                  value={actSession}
                  inputMode="numeric"
                  placeholder="30m a sitting?"
                  onChange={(e) => setActSession(e.target.value)}
                />
              </label>
              {/**
               * ⚠️ THE ONE CONTROL IN THIS ROOM THAT SHOWS SOMETHING TO SOMEBODY ELSE, so it
               * says who rather than just "share". "Shared" alone would be answered with
               * "with whom?" and the answer is not guessable: friends, never members, never
               * the web — see docs/2026-10-23-chronicle-friends-timeline.sql for why a
               * sitting-by-sitting record does not inherit the wider tiers the profile card
               * may be set to.
               *
               * ⚠️ AND IT IS PER ACTIVITY BECAUSE THAT IS THE DECISION PEOPLE ACTUALLY MAKE.
               * Nobody wants to rule on each sitting; everybody can say whether Gym is
               * anybody's business. The line under it is drawn from `shared` itself rather
               * than written once, so it cannot drift from what the tick does.
               */}
              {/**
               * ⚠️ AND A TICK CANNOT SAY `certain`, SO IT STANDS ASIDE RATHER THAN LYING.
               * `chronicle_activities_tier_agrees` pins `shared` to friends-or-wider, so an
               * activity shared with three chosen friends has `shared = false` — this box
               * would show empty above sittings those three can see, and ticking it would
               * widen the activity to every friend and strip the list on the way out. The
               * three-level picker lives in Sharing, which has room for the list; this is
               * the quick switch for the two states it can express, and it defers when the
               * value is the third.
               */}
              {/**
               * ⚠️ FROM THE CIRCUIT: WHICH EXERCISES COUNT TOWARD THIS, decided by units and
               * never by names (§19g). Three kinds of row — ones that fit, as toggles; ones in a
               * different unit, said plainly; and ones whose unit nobody can compare, listed as
               * needing a decision rather than linked by a guess. It reads the SAVED metric,
               * because that is what the server compares.
               */}
              {(() => {
                const act = byId.get(fixAct ?? '')
                if (!act || !exercises?.length) return null
                const rows = exercises.map((x) => ({ x, f: fit(x.unit, act.metric) }))
                const can = rows.filter((r) => r.f.ok).map((r) => r.x)
                const other = rows.filter((r) => !r.f.ok && r.f.why === 'different')
                const unsure = rows.filter((r) => !r.f.ok && r.f.why === 'unknown')
                if (!act.metric?.trim()) {
                  return (
                    <p className="muted chron-links-note">
                      Give this a count (reps, minutes, miles…) to link Circuit exercises to it.
                    </p>
                  )
                }
                return (
                  <div
                    className="chron-links"
                    role="group"
                    aria-label="Circuit exercises this counts"
                  >
                    <span className="muted">From the Circuit, in {act.metric}</span>
                    {can.map((x) => {
                      const mine = x.activity === act.id
                      const elsewhere =
                        x.activity && x.activity !== act.id ? byId.get(x.activity)?.name : null
                      return (
                        <button
                          key={`${x.person}/${x.exercise}`}
                          type="button"
                          className={'btn btn-ghost chron-link' + (mine ? ' is-on' : '')}
                          aria-pressed={mine}
                          disabled={busy}
                          onClick={() => void toggleLink(x, mine ? null : act.id)}
                        >
                          {x.name}
                          {elsewhere ? (
                            <span className="muted"> · counts as {elsewhere}</span>
                          ) : null}
                        </button>
                      )
                    })}
                    {can.length === 0 ? <span className="muted">none in {act.metric}</span> : null}
                    {other.length ? (
                      <p className="muted chron-links-note">
                        Not here: {other.map((r) => `${r.x.name} (${r.x.unit})`).join(', ')}.
                      </p>
                    ) : null}
                    {unsure.length ? (
                      <p className="muted chron-links-note">
                        Needs a decision — these units cannot be compared with anything:{' '}
                        {unsure.map((r) => `${r.x.name} (${r.x.unit || 'none'})`).join(', ')}.
                      </p>
                    ) : null}
                    {exercises.some((x) => x.activity === act.id && x.ok === false) ? (
                      <p className="muted chron-links-note">
                        A link here no longer agrees on units, so it counts nothing until it does:{' '}
                        {exercises
                          .filter((x) => x.activity === act.id && x.ok === false)
                          .map((x) => `${x.name} (${fitText(fit(x.unit, act.metric))})`)
                          .join(', ')}
                        .
                      </p>
                    ) : null}
                  </div>
                )
              })()}
              {/**
               * ⚠️ AND THE SITE'S OWN ACTIVITIES HAVE NO TICK AT ALL, because nothing reads their
               * level: the Feed, the Friends tab and the profile card all leave an `auto` activity
               * out for anybody but its owner (docs/2026-11-13-feed-hides-browsing.DRAFT.sql and
               * docs/2026-11-14-card-hides-browsing.DRAFT.sql). A tick there would be a control
               * that changes nothing. The level already stored is left alone — saving passes
               * `actShared` back as it was seeded — and Sharing no longer lists these either.
               */}
              {byId.get(fixAct ?? '')?.auto ? (
                <p className="muted chron-share-note">Only you see time on the site.</p>
              ) : byId.get(fixAct ?? '')?.visibility === 'certain' ? (
                <p className="muted chron-share-note">
                  Shared with the friends you chose. Change who in <strong>Sharing</strong>.
                </p>
              ) : (
                <label className="chron-share">
                  <input
                    type="checkbox"
                    checked={actShared}
                    onChange={(e) => setActShared(e.target.checked)}
                  />
                  <span>Friends can see this</span>
                </label>
              )}
              <button
                className="btn"
                disabled={!actName.trim() || busy}
                onClick={() => void saveAct()}
              >
                Save
              </button>
              <button className="btn btn-ghost" onClick={() => setFixAct(null)}>
                Cancel
              </button>
            </li>
          ) : (
            <li key={a.id}>
              {/**
               * ⚠️ THE NAME IS THE BUTTON, like the instrument's layer rows: the row already
               * names the thing and says what kind it is, so it may as well be the control
               * for changing both. A separate pencil would be a sixth small target in a row.
               *
               * ⚠️ AND THE SITE-WRITTEN ONES ARE EDITABLE TOO, which is the point of making
               * them ordinary activities. They arrive as Free Time because that is the only
               * honest guess, and reading a week back showed exactly why it matters: time in
               * the Instrument sitting in the same bucket as actual free time.
               */}
              <button
                className="btn btn-ghost chron-act-name"
                onClick={() => editActivity(a)}
                title={`Rename ${a.name}, or change what kind it is`}
              >
                {a.colour ? (
                  <span className="chron-dot" style={{ background: a.colour }} aria-hidden />
                ) : null}
                {a.name}
                <span className="muted">{CATS.find(([c]) => c === a.cat)?.[1]}</span>
                {/**
                 * ⚠️ THE TWO OPTIONAL FACTS ARE MARKED, so a phone can drop them. The row
                 * carries a name, a category, a metric, a sitting length, today's minutes and
                 * an Archive button; at 375 the name button gets about 178px of that and was
                 * wrapping to three ragged lines with "· 30m a sitting" spilling past its own
                 * rounded background. Same answer as `.chron-plan-note` and `.chron-ent-when`:
                 * the first things to go when a row will not fit a thumb are the ones the
                 * editor shows anyway — and this button IS the editor's door.
                 */}
                {a.metric ? <span className="muted chron-act-extra">· {a.metric}</span> : null}
                {a.session ? (
                  <span className="muted chron-act-extra">
                    · {spanText(a.session * 60_000)} a sitting
                  </span>
                ) : null}
                {a.auto ? <span className="chron-chip">on the site</span> : null}
              </button>
              {mins[a.id] ? (
                <span className="chron-ent-span">{spanText(mins[a.id] * 60_000)}</span>
              ) : null}
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  await archiveActivity(a.id, !a.archived)
                  /* ⚠️ `after` for the same reason as makeActivity: archiving the last
                         activity leaves the goals half still offering it as a source */
                  await after()
                }}
              >
                {a.archived ? 'Bring back' : 'Archive'}
              </button>
            </li>
          ),
        )}
      </ul>
    </details>
  )
}
