import { useMemo, useSyncExternalStore } from 'react'
import { ParkRoom } from '../park/ParkRoom'
import { pets as myPets, subscribePets } from '../pets/pets'
import { gallery, subscribeGallery } from '../draw/gallery'
import { readHandle } from '../game/handle'

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
 * ⚠️ AND ITS MAP PICKER IS GONE, BECAUSE THE PARK HAS A REAL ONE NOW. This file held the
 * only control that could put a drawing in the world, as the enforcement that a map could not
 * reach a shared room — and the enforcement now lives in joinPark, which refuses the socket
 * outright while the park is a drawing. A second picker here would fight ParkRoom's own, which
 * sets the world in the same breath as it decides whether to connect.
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
  return (
    <section className="card">
      <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
        dev preview — #dev-park · room <code>park-dev</code>, never the real one
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
