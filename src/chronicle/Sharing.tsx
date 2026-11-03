import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'
import { VisibilityPicker } from '../components/VisibilityPicker'
import { TIER_SHORT } from '../components/visibilityLabels'
import type { VisibilityTier } from '../circuit/types'

/**
 * One switch for sharing a chronicle, in the room where the chronicle is.
 *
 * ⚠️ IT EXISTS BECAUSE THE FEATURE WAS UNREACHABLE, AND THE NUMBERS SAID SO RATHER THAN A HUNCH.
 * Measured across all 14 members: 1 had a Chronicle card on their profile, 0 had ticked "Show my
 * timeline", 0 had ticked "Friends can see this" on any activity. So the friends list returned an
 * empty array to everybody, every day, since it shipped — not because people declined, but
 * because the three switches live on `#profile`, which has no nav entry, in a different room from
 * the data they are about. And the one screen that was empty BECAUSE of them described all three
 * in prose with not a single link in it.
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

type Act = {
  id: string
  name: string
  cat: string
  colour: string | null
  shared: boolean
  /** the ladder level, which is what the picker edits. `shared` is the old boolean beside it. */
  visibility: VisibilityTier
  /**
   * Whether this one actually reaches anybody — `item_reaches_anyone` on the server.
   *
   * ⚠️ NOT THE SAME QUESTION AS `visibility !== 'private'`, and that is the whole reason it is
   * sent. An activity at `certain` with nobody on its list is SET to a sharing level and reaches
   * no one, so a count built on the tier would overstate and a row built on it would read as
   * shared. It is the same predicate the feed uses on the same rows, so the number here and the
   * contents there cannot disagree.
   */
  reaches: boolean
}
type Sharing = { timeline: boolean; hasCard: boolean; activities: Act[] }

const EMPTY: Sharing = { timeline: false, hasCard: false, activities: [] }

/** the dev harness has no session, so the switch would otherwise render its signed-out self */
function previewSharing(): Sharing {
  return {
    timeline: false,
    hasCard: false,
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
      activities: Array.isArray(d.activities) ? (d.activities as Act[]) : [],
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
   * list on the way. `chronicle_activity_set_visibility` takes the level and returns the one it
   * stored, which is doubly clamped: by the account's ceiling and by Chronicle's own cap at
   * friends.
   */
  const setTier = async (a: Act, tier: VisibilityTier) => {
    setBusy(a.id)
    setError(null)
    /* optimistic for the same reason the switch above is: a privacy control that waits a round
       trip before moving reads as not having been pressed. `reaches` is guessed here and
       corrected by the reload — a `certain` row's real answer depends on its list. */
    setState((s) =>
      s
        ? {
            ...s,
            activities: s.activities.map((x) =>
              x.id === a.id
                ? {
                    ...x,
                    visibility: tier,
                    shared: tier === 'friends',
                    reaches: tier !== 'private',
                  }
                : x,
            ),
          }
        : s,
    )
    if (previewMember) {
      setBusy(null)
      return
    }
    const { error: e } = await getSupabaseClient().rpc('chronicle_activity_set_visibility', {
      p_id: a.id,
      p_tier: tier,
    })
    if (e) {
      setError('That did not save. Try again?')
      await load()
    } else {
      /* reload rather than trust the returned tier on its own: the row's `reaches` depends on a
         list this call did not touch, and the panel's count is built from it */
      await load()
    }
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
          <span className="muted chron-sharing-says">
            {state.timeline
              ? ticked === 0
                ? 'On — but no activity is ticked yet, so nothing is shared. Tick the ones below.'
                : `On. Friends can see your sittings on ${ticked} ${ticked === 1 ? 'activity' : 'activities'} — and nothing else: no notes, no ratings, no goals.`
              : 'Off. Nobody can see your sittings. Your hours and goals follow your profile card as before.'}
          </span>
        </span>
      </label>

      {state.timeline && (
        <>
          <p className="muted chron-sharing-lede">
            Which ones, and who. Anything left at <strong>Only me</strong> stays invisible, even
            while the switch is on.
          </p>
          {/**
           * ⚠️ A FOLD PER ROW, NOT A PICKER PER ROW. Three levels, a hint and a list of friends
           * is four controls; twenty activities of that is a wall, and the one thing somebody
           * scanning this list wants is the level each activity is at. Closed, every row is one
           * line that says the level in words — which is more than the checkbox ever said.
           */}
          <ul className="chron-sharing-acts">
            {state.activities.map((a) => (
              <li key={a.id}>
                <details className="chron-sharing-fold">
                  <summary>
                    {a.colour ? (
                      <span className="chron-dot" style={{ background: a.colour }} aria-hidden />
                    ) : null}
                    <span className="chron-sharing-act">{a.name}</span>
                    {/* ⚠️ THE ROW SAYS WHEN IT REACHES NOBODY, because that is the one state a
                        level alone cannot tell you about. "Certain friends" with an empty list is
                        Only me, and an owner would otherwise find that out from a friend. */}
                    <span className="muted chron-sharing-tier">
                      {a.visibility === 'certain' && !a.reaches
                        ? 'Certain friends — nobody picked yet'
                        : TIER_SHORT[a.visibility]}
                    </span>
                  </summary>
                  <VisibilityPicker
                    kind="chronicle"
                    label={`Who can see ${a.name}?`}
                    value={a.visibility}
                    /* Chronicle is capped at friends by `chronicle_activities_tier_capped`: a
                       day-by-day record of somebody's time is not a members-tier thing. Omitted
                       rather than offered and clamped. */
                    omit={['members', 'public']}
                    disabled={busy === a.id}
                    onChange={(t) => void setTier(a, t)}
                    certainItem={{ kind: 'chronicle_activity', id: a.id }}
                  />
                </details>
              </li>
            ))}
          </ul>
          {state.activities.length === 0 && (
            <p className="muted">
              No activities yet — start something on the Day tab and it will appear here.
            </p>
          )}
        </>
      )}

      {error && <p className="chron-sharing-err">{error}</p>}
    </section>
  )
}
