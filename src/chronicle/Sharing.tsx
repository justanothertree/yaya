import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'
import { VisibilityPicker } from '../components/VisibilityPicker'
import { TIER_SHORT } from '../components/visibilityLabels'
import { timelineSays, goalsSays, type Reach } from './sharingCopy'
import type { VisibilityTier } from '../circuit/types'

/**
 * Who can see a chronicle, in the room where the chronicle is: the timeline switch and what it
 * governs, and then the goals, which answer to a different switch entirely.
 *
 * ⚠️ IT EXISTS BECAUSE THE FEATURE WAS UNREACHABLE, AND THE NUMBERS SAID SO RATHER THAN A HUNCH.
 * Measured across all 14 members: 1 had a Chronicle card on their profile, 0 had ticked "Show my
 * timeline", 0 had ticked "Friends can see this" on any activity. So the friends list returned an
 * empty array to everybody, every day, since it shipped — not because people declined, but
 * because the switches live on the profile page, in a different room from the data they are
 * about. And the one screen that was empty BECAUSE of them described all three in prose with not
 * a single link in it.
 *
 * ⚠️ THIS NOTE USED TO ADD "which has no nav entry", AND THAT HALF HAS GONE STALE. The profile
 * room is reachable now, as "My profile" in the settings menu and in the mobile nav — which is
 * why the goals copy below names it by that label rather than by a route. The rest of the
 * reasoning stands: being reachable is not the same as being where the question is asked.
 *
 * ⚠️ THE DEFAULT IS STILL OFF AND NOTHING HERE WIDENS ANYTHING. A timeline is friends-only
 * wherever it is turned on. What changed is the number of rooms you must visit to turn it on,
 * which was two, and the number of them that are in the nav, which was zero.
 *
 * ⚠️ THE PER-ACTIVITY TICKS STAY. "Gym" and "Therapy" are not one decision — Timer.tsx argues
 * this already, beside the tick it owns — so the switch does not sweep them on. It brings them
 * here, next to the thing they are about, instead of leaving them behind a row whose button
 * reads as "rename this".
 */

/**
 * What a row in either list needs, which is the same three facts twice. Activities and goals are
 * different tables with different setters and the identical question above them.
 */
type Row = {
  id: string
  /** the ladder level, which is what the picker edits. `shared` is the old boolean beside it. */
  visibility: VisibilityTier
  shared: boolean
  /**
   * Whether this one actually reaches anybody — `item_reaches_anyone` on the server.
   *
   * ⚠️ NOT THE SAME QUESTION AS `visibility !== 'private'`, and that is the whole reason it is
   * sent. An item at `certain` with nobody on its list is SET to a sharing level and reaches no
   * one, so a count built on the tier would overstate and a row built on it would read as
   * shared. It is the same predicate the readers use on the same rows, so the number here and
   * the contents there cannot disagree.
   */
  reaches: boolean
}

type Act = Row & { name: string; cat: string; colour: string | null }
type Goal = Row & { title: string; done: boolean }

/**
 * The five booleans are `Reach`, in sharingCopy.ts beside the two sentences built from them —
 * one of which was wrong for as long as this panel has existed, and is the reason they are pure
 * and tested rather than ternaries in this file.
 *
 * ⚠️ TWO SWITCHES, NOT ONE. `timeline` is `config.timeline` on the Chronicle card; goals reach a
 * profile through `config.goals`, a different key that the page editor calls "Show the goals I've
 * picked". Two independent answers, which is why the goals section is not nested inside the
 * timeline's.
 */
type Sharing = Reach & { activities: Act[]; goals: Goal[] }

const EMPTY: Sharing = {
  timeline: false,
  hasCard: false,
  wantsGoals: false,
  timelineReaches: false,
  goalsReach: false,
  activities: [],
  goals: [],
}

/**
 * The dev harness has no session, so the switch would otherwise render its signed-out self.
 *
 * ⚠️ IT HOLDS A STATE THE SERVER COULD ACTUALLY PRODUCE, which takes two implications. The server
 * computes `wantsGoals` and `goalsReach` from the same blocks as `hasCard`, so `goalsReach` ⇒
 * `wantsGoals` ⇒ `hasCard`, and a fixture breaking that chain would put the panel in a state no
 * account can reach — which is how a double invents a bug or hides one. Both switches are on and
 * the card reaches somebody, because the workbench is here to show the rows; the off branches of
 * the timeline copy are reachable by pressing the switch, which moves optimistically in preview.
 * The `wantsGoals` branches are not reachable here — that switch lives on the profile editor.
 */
function previewSharing(): Sharing {
  return {
    timeline: true,
    hasCard: true,
    wantsGoals: true,
    timelineReaches: true,
    goalsReach: true,
    goals: [
      {
        id: 'pv-g-1',
        title: 'Finish the website',
        done: false,
        shared: true,
        visibility: 'friends',
        reaches: true,
      },
      {
        id: 'pv-g-2',
        title: 'Run three times a week',
        done: false,
        shared: false,
        visibility: 'certain',
        reaches: true,
      },
      /* the state only `certain` can produce, for goals as for activities: a sharing level that
         reaches nobody, because the list behind it is empty */
      {
        id: 'pv-g-3',
        title: 'Read twelve books',
        done: false,
        shared: false,
        visibility: 'certain',
        reaches: false,
      },
      /* done, and private: the row has to be tellable from a live one of the same name */
      {
        id: 'pv-g-4',
        title: 'Learn to solder',
        done: true,
        shared: false,
        visibility: 'private',
        reaches: false,
      },
    ],
    activities: [
      {
        id: 'pv-a-1',
        name: 'Guitar',
        cat: 'free',
        colour: '#7c6af7',
        shared: false,
        visibility: 'private',
        reaches: false,
      },
      {
        id: 'pv-a-2',
        name: 'Reading',
        cat: 'free',
        colour: '#46b17b',
        shared: true,
        visibility: 'friends',
        reaches: true,
      },
      /* the state that only `certain` can produce: a sharing level that reaches nobody. The
         double must be able to show it, or the workbench cannot see the row that says so. */
      {
        id: 'pv-a-3',
        name: 'Work',
        cat: 'locked',
        colour: null,
        shared: false,
        visibility: 'certain',
        reaches: false,
      },
    ],
  }
}

/**
 * One row for both lists, because they are the same control over the same ladder.
 *
 * ⚠️ A FOLD PER ROW, NOT A PICKER PER ROW. Three levels, a hint and a list of friends is four
 * controls; twenty activities of that is a wall, and the one thing somebody scanning this list
 * wants is the level each is at. Closed, every row is one line that says the level in words —
 * which is more than the checkbox it replaced ever said.
 *
 * The two lists differ in their table, their setter and one optional word in the summary. A second
 * copy of this would be a second place for the "reaches nobody" line to go stale.
 */
function ShareRow({
  name,
  colour,
  done,
  item,
  visibility,
  reaches,
  busy,
  onChange,
}: {
  name: string
  colour?: string | null
  /** marks a finished goal, so two rows of the same name are not one row twice */
  done?: boolean
  item: { kind: 'chronicle_activity' | 'chronicle_goal'; id: string }
  visibility: VisibilityTier
  reaches: boolean
  busy: boolean
  onChange: (t: VisibilityTier) => void
}) {
  return (
    <li>
      <details className="chron-sharing-fold">
        <summary>
          {colour ? (
            <span className="chron-dot" style={{ background: colour }} aria-hidden />
          ) : null}
          <span className="chron-sharing-act">{name}</span>
          {done ? <span className="muted chron-sharing-done">done</span> : null}
          {/* ⚠️ THE ROW SAYS WHEN IT REACHES NOBODY, because that is the one state a level alone
              cannot tell you about. "Certain friends" with an empty list is Only me, and an owner
              would otherwise find that out from a friend. */}
          <span className="muted chron-sharing-tier">
            {visibility === 'certain' && !reaches
              ? 'Certain friends — nobody picked yet'
              : TIER_SHORT[visibility]}
          </span>
        </summary>
        <VisibilityPicker
          /* ⚠️ DERIVED FROM `item`, NEVER PASSED SEPARATELY, so the wording and the row it is
             about cannot disagree. A goal is not a sitting: the chronicle hints say "in the feed",
             and `get_member_chronicle` is the only reader of `chronicle_goals` that consults
             `can_see` — a goal reaches a profile card and nowhere else. */
          kind={item.kind === 'chronicle_goal' ? 'goal' : 'chronicle'}
          label={`Who can see ${name}?`}
          value={visibility}
          /* Chronicle is capped at friends by `chronicle_activities_tier_capped` and its goals
             twin: a day-by-day record of somebody's time, or what they are trying to change about
             themselves, is not a members-tier thing. Omitted rather than offered and clamped. */
          omit={['members', 'public']}
          disabled={busy}
          onChange={onChange}
          certainItem={item}
        />
      </details>
    </li>
  )
}

export function Sharing({ authed }: { authed: boolean }) {
  const [state, setState] = useState<Sharing | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!authed) return
    if (previewMember) {
      setState(previewSharing())
      return
    }
    const { data, error: e } = await getSupabaseClient().rpc('chronicle_sharing_mine')
    if (e || !data) {
      setState(EMPTY)
      return
    }
    const d = data as Record<string, unknown>
    setState({
      timeline: d.timeline === true,
      hasCard: d.hasCard === true,
      wantsGoals: d.wantsGoals === true,
      timelineReaches: d.timelineReaches === true,
      goalsReach: d.goalsReach === true,
      activities: Array.isArray(d.activities) ? (d.activities as Act[]) : [],
      goals: Array.isArray(d.goals) ? (d.goals as Goal[]) : [],
    })
  }, [authed])

  useEffect(() => {
    void load()
  }, [load])

  if (!authed || state === null) return null

  const setTimeline = async (on: boolean) => {
    setBusy('timeline')
    setError(null)
    /* optimistic, and put back on failure -- a switch that waits a round trip before moving
       reads as not having been pressed, which is how you get pressed twice */
    setState((s) => (s ? { ...s, timeline: on } : s))
    if (previewMember) {
      setBusy(null)
      return
    }
    const { error: e } = await getSupabaseClient().rpc('chronicle_share_timeline', { p_on: on })
    if (e) {
      setState((s) => (s ? { ...s, timeline: !on } : s))
      setError('That did not save. Try again?')
    } else {
      await load()
    }
    setBusy(null)
  }

  /**
   * ⚠️ A TIER, NOT A TICK, AND THE OLD BOOLEAN COULD NOT HAVE EXPRESSED THIS ONE. `shared` is
   * pinned by a CHECK to `visibility in ('friends','members','public')`, so an activity set to
   * `certain` has `shared = false` — a checkbox built on it would show an unticked box above a
   * row three friends can see, and ticking it would widen the thing to all friends and drop the
   * list on the way. `chronicle_activity_set_visibility` and `chronicle_goal_set_visibility` take
   * the level and return the one they stored, which is doubly clamped: by the account's ceiling
   * and by Chronicle's own cap at friends.
   *
   * ⚠️ ONE FUNCTION FOR BOTH TABLES, because they differ in a name and nothing else. The two
   * setters take the same arguments, clamp the same way and answer the same question, so a second
   * copy of this would be a second place for the optimistic guess and the reload to drift apart.
   */
  const setTier = async (which: 'activity' | 'goal', id: string, tier: VisibilityTier) => {
    setBusy(id)
    setError(null)
    /* optimistic for the same reason the switch above is: a privacy control that waits a round
       trip before moving reads as not having been pressed. `reaches` is guessed here and
       corrected by the reload — a `certain` row's real answer depends on its list. */
    const moved = <T extends Row>(xs: T[]): T[] =>
      xs.map((x) =>
        x.id === id
          ? { ...x, visibility: tier, shared: tier === 'friends', reaches: tier !== 'private' }
          : x,
      )
    setState((s) =>
      s === null
        ? s
        : which === 'activity'
          ? { ...s, activities: moved(s.activities) }
          : { ...s, goals: moved(s.goals) },
    )
    if (previewMember) {
      setBusy(null)
      return
    }
    const { error: e } = await getSupabaseClient().rpc(
      which === 'activity' ? 'chronicle_activity_set_visibility' : 'chronicle_goal_set_visibility',
      { p_id: id, p_tier: tier },
    )
    if (e) setError('That did not save. Try again?')
    /* reload either way, rather than trust the returned tier on its own: the row's `reaches`
       depends on a list this call did not touch, and the panel's count is built from it */
    await load()
    setBusy(null)
  }

  /**
   * ⚠️ COUNTED FROM `reaches`, NOT FROM THE TIER. This number goes into a sentence that tells
   * somebody who can see their days, and an activity at `certain` with an empty list is set to a
   * sharing level and reaches nobody. Counting the tier would say "friends can see 3" where the
   * truth is 2 — a wrong number in the one place that must not have one.
   */
  const ticked = state.activities.filter((a) => a.reaches).length

  return (
    <section className="chron-sharing">
      <label className="chron-sharing-switch">
        <input
          type="checkbox"
          checked={state.timeline}
          disabled={busy === 'timeline'}
          onChange={(e) => void setTimeline(e.target.checked)}
        />
        <span>
          <strong>Share my Chronicle with friends</strong>
          {/**
           * ⚠️ THE LINE UNDER IT IS DRAWN FROM THE STATE, never written once. The profile
           * editor's own promise went stale the day a second switch was added to it, and the
           * note there says so — a privacy promise that has to be remembered separately from the
           * feature it describes is a promise that will be wrong.
           */}
          <span className="muted chron-sharing-says">{timelineSays(state, ticked)}</span>
        </span>
      </label>

      {state.timeline && (
        <>
          <p className="muted chron-sharing-lede">
            Which ones, and who. Anything left at <strong>Only me</strong> stays invisible, even
            while the switch is on.
          </p>
          <ul className="chron-sharing-acts">
            {state.activities.map((a) => (
              <ShareRow
                key={a.id}
                name={a.name}
                colour={a.colour}
                item={{ kind: 'chronicle_activity', id: a.id }}
                visibility={a.visibility}
                reaches={a.reaches}
                busy={busy === a.id}
                onChange={(t) => void setTier('activity', a.id, t)}
              />
            ))}
          </ul>
          {state.activities.length === 0 && (
            <p className="muted">
              No activities yet — start something on the Day tab and it will appear here.
            </p>
          )}
        </>
      )}

      {/**
       * ⚠️ OUTSIDE THE TIMELINE'S GATE, AND THAT IS THE WHOLE REASON THIS IS A SECTION RATHER
       * THAN A SECOND LIST. The switch above is `config.timeline`; a goal reaches a profile
       * through `config.goals`, a different key on the same card. Nesting this inside
       * `state.timeline` would hide the goals control from somebody whose card shows goals and no
       * timeline — the exact person it is for.
       *
       * ⚠️ AND IT IS THE ONLY PLACE A GOAL CAN BE SET TO CERTAIN FRIENDS. The ◍/◉/○ button in the
       * Aims list narrows and widens between private and friends, which is all three glyphs can
       * say; the level worked in the database, the export carried its list, and nothing on screen
       * could choose it.
       */}
      <div className="chron-sharing-goals">
        <h3 className="chron-sharing-head">Goals on your profile</h3>
        <p className="muted chron-sharing-lede">{goalsSays(state)}</p>
        <ul className="chron-sharing-acts">
          {state.goals.map((g) => (
            <ShareRow
              key={g.id}
              name={g.title}
              done={g.done}
              item={{ kind: 'chronicle_goal', id: g.id }}
              visibility={g.visibility}
              reaches={g.reaches}
              busy={busy === g.id}
              onChange={(t) => void setTier('goal', g.id, t)}
            />
          ))}
        </ul>
        {state.goals.length === 0 && (
          <p className="muted">No goals yet — add one on the Aims tab and it will appear here.</p>
        )}
      </div>

      {error && <p className="chron-sharing-err">{error}</p>}
    </section>
  )
}
