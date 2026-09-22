import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ParkRoom } from '../park/ParkRoom'
import { pets as myPets, subscribePets } from '../pets/pets'
import { gallery, subscribeGallery } from '../draw/gallery'
import { readHandle } from '../game/handle'
import { mapOf } from '../park/mapOf'
import { setWorld } from '../park/world'

/**
 * The park, for somebody who is not signed in — #dev-park.
 *
 * ⚠️ WHY THIS IS NOT A BACK DOOR. Three separate reasons, and it needs all three:
 *
 * 1. `import.meta.env.DEV` wraps the dynamic import of this file in App, not just its render, so
 *    the branch and this chunk are both eliminated from a production build — the same bargain
 *    #dev-profile and #dev-admin already make.
 * 2. `authed` grants nothing. ParkRoom's own note says it is "A COURTESY, NOT THE RULE": the
 *    relay socket is unauthenticated and accepts any origin, so the flag only decides whether a
 *    visitor is told why they are being turned away. Passing it here skips a sign, not a lock.
 * 3. Nothing members-only is reachable from in here. The park draws creatures out of the local
 *    pets store and talks to the relay; it reads no profile, no library and no member data, so
 *    there is nothing for a bypass to expose even in principle.
 *
 * ⚠️ AND IT IS ITS OWN ROOM. `park-dev`, never `park` — the workbench exists so the boss fight
 * can be walked through without an account, and doing that in the room the family is actually
 * using would put a stranger with a test creature on their screen. If VITE_WS_URL is unset, which
 * is the normal state of a dev checkout, joinPark returns null and the park is single-player —
 * which is all the boss needs.
 *
 * Asked for directly: the park could not be verified at all without one.
 */
export function ParkPreview() {
  const mine = useSyncExternalStore(subscribePets, myPets, myPets)
  const playable = useMemo(() => mine.map((p) => ({ name: p.name, art: p.art })), [mine])
  /* the workbench gets the same boss list the real park does, or it cannot test it */
  const kept = useSyncExternalStore(subscribeGallery, gallery, gallery)
  const extras = useMemo(() => {
    const had = new Set(mine.map((p) => p.name))
    return kept.filter((a) => !had.has(a.name)).map((a) => ({ name: a.name, art: a.art }))
  }, [kept, mine])
  /**
   * ⚠️ THE ONLY PLACE A DRAWN MAP CAN BE CHOSEN, and that is the safety rather than a
   * rule somebody has to remember. A drawn map is not on the wire, so two people with
   * different ones would be standing on rocks the other cannot see — see setWorld. There is
   * no control for this anywhere else, so the shared park cannot get one.
   *
   * ⚠️ AND IT IS PUT BACK ON THE WAY OUT. The world is a module-level thing; leaving it
   * pointed at a drawing would mean the next room somebody opened was somebody's sketch.
   */
  useEffect(() => () => setWorld(null), [])
  const maps = useMemo(() => kept.filter((a) => mapOf(a.art).length > 0), [kept])

  return (
    <section className="card">
      <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
        dev preview — #dev-park · room <code>park-dev</code>, never the real one
      </p>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
        <label>
          Walk a drawn map:{' '}
          <select
            defaultValue=""
            onChange={(e) => {
              const found = kept.find((a) => a.name === e.target.value)
              setWorld(found ? mapOf(found.art) : null)
            }}
          >
            <option value="">the built-in park</option>
            {maps.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} — {mapOf(a.art).length} places
              </option>
            ))}
          </select>
        </label>
        {!maps.length && ' — none of your drawings name any places yet. See “As a map” in Paint.'}
      </p>
      {playable.length ? (
        <ParkRoom pets={playable} extras={extras} myName={readHandle()} authed room="park-dev" />
      ) : (
        <p className="muted">
          No minions in this browser yet — make one in Paint first, or the field has nobody to put
          on it.
        </p>
      )}
    </section>
  )
}
