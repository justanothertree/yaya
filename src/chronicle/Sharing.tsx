import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'

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

type Act = { id: string; name: string; cat: string; colour: string | null; shared: boolean }
type Sharing = { timeline: boolean; hasCard: boolean; activities: Act[] }

const EMPTY: Sharing = { timeline: false, hasCard: false, activities: [] }

/** the dev harness has no session, so the switch would otherwise render its signed-out self */
function previewSharing(): Sharing {
  return {
    timeline: false,
    hasCard: false,
    activities: [
      { id: 'pv-a-1', name: 'Guitar', cat: 'free', colour: '#7c6af7', shared: false },
      { id: 'pv-a-2', name: 'Reading', cat: 'free', colour: '#46b17b', shared: true },
      { id: 'pv-a-3', name: 'Work', cat: 'locked', colour: null, shared: false },
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

  const setShared = async (a: Act, on: boolean) => {
    setBusy(a.id)
    setError(null)
    setState((s) =>
      s
        ? { ...s, activities: s.activities.map((x) => (x.id === a.id ? { ...x, shared: on } : x)) }
        : s,
    )
    if (previewMember) {
      setBusy(null)
      return
    }
    const { error: e } = await getSupabaseClient().rpc('chronicle_activity_share', {
      p_id: a.id,
      p_on: on,
    })
    if (e) {
      setState((s) =>
        s
          ? {
              ...s,
              activities: s.activities.map((x) => (x.id === a.id ? { ...x, shared: !on } : x)),
            }
          : s,
      )
      setError('That did not save. Try again?')
    }
    setBusy(null)
  }

  const ticked = state.activities.filter((a) => a.shared).length

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
            Which ones. Anything left unticked stays invisible, even while the switch is on.
          </p>
          <ul className="chron-sharing-acts">
            {state.activities.map((a) => (
              <li key={a.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={a.shared}
                    disabled={busy === a.id}
                    onChange={(e) => void setShared(a, e.target.checked)}
                  />
                  {a.colour ? (
                    <span className="chron-dot" style={{ background: a.colour }} aria-hidden />
                  ) : null}
                  <span className="chron-sharing-act">{a.name}</span>
                </label>
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
