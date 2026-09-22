import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { lazyRetry } from '../lazyRetry'
import { PetView } from '../pets/PetView'
import { pets as myPets, subscribePets } from '../pets/pets'
import { gallery, subscribeGallery } from '../draw/gallery'
import { readHandle } from '../game/handle'

/**
 * The room the games live in.
 *
 * ⚠️ THIS TAB USED TO BE CALLED SNAKE, and Snake is now one of the things in it rather than the
 * whole of it. That is the entire point: there was nowhere for a second game to go. A platformer
 * already existed and was reachable only by opening the Minions room and pressing a button inside
 * it, which is a fine place for it to have been BORN and a poor place for it to live.
 *
 * ⚠️ `#snake` STILL WORKS AND ALWAYS WILL — see SECTION_ALIASES in nav/places.ts. Challenge links
 * built by `challengeLink` are sitting in real chat messages in the database; nobody can go back
 * and rewrite a message somebody was sent last month. So `#snake?room=…` keeps meaning what it
 * meant, and this room reads the same query it always did.
 *
 * ⚠️ BOTH GAMES ARE LAZY, SEPARATELY. Snake's manager is 4,000 lines plus a leaderboard client
 * and a profanity list; the playground pulls in the whole pets renderer. Loading one to play the
 * other would undo the work that made Snake lazy in the first place.
 */

const SnakeGame = lazyRetry(
  () => import('./SnakeGame'),
  (m) => m.SnakeGame,
)
const PetPlay = lazyRetry(
  () => import('../pets/PetPlay'),
  (m) => m.PetPlay,
)
const PetFight = lazyRetry(
  () => import('../pets/PetFight'),
  (m) => m.PetFight,
)
const ParkRoom = lazyRetry(
  () => import('../park/ParkRoom'),
  (m) => m.ParkRoom,
)

type GameId = 'snake' | 'playground' | 'fight' | 'park'

/**
 * Which game the address bar asked for, or null for the menu.
 *
 * ⚠️ READ ONCE, AND NEVER WRITTEN BACK. A games window can be pinned to the canvas while you are
 * reading a completely different page, so a room that kept the hash in step with its own menu
 * would be a window that changes the address bar from the corner of the screen. The hash is an
 * ENTRANCE here, not a mirror — which is all a challenge link ever needed it to be.
 */
function wantedFromHash(): GameId | null {
  const raw = window.location.hash.replace(/^#/, '')
  const [base, query] = raw.split('?')
  const q = new URLSearchParams(query ?? '')
  // A room to join or a score to beat is a Snake link whatever the base says — and `#snake` is
  // the alias every challenge message ever posted was built from.
  if (base === 'snake' || q.has('room') || q.has('beat')) return 'snake'
  const play = q.get('play')
  return play === 'snake' || play === 'playground' || play === 'fight' || play === 'park'
    ? play
    : null
}

export function GamesRoom({
  onControlChange,
  onLiveChange,
  autoFocus,
  authed,
}: {
  onControlChange?: (on: boolean) => void
  /** true while Snake is connected to a multiplayer room — see GameManager's onLiveChange */
  onLiveChange?: (live: boolean) => void
  autoFocus?: boolean
  /** signed in to the members' side. Only the park cares, and only so it can explain itself. */
  authed?: boolean
}) {
  const [game, setGame] = useState<GameId | null>(() => wantedFromHash())
  const [live, setLive] = useState(false)
  const mine = useSyncExternalStore(subscribePets, myPets, myPets)
  /**
   * The creatures, as the games want them, and the SAME objects every render.
   *
   * ⚠️ THIS WAS `mine.map(...)` AT EACH CALL SITE, AND IT COST THE PARK ITS CONNECTION. A new
   * array of new objects every render means the park's `mine` is a new object every render, which
   * means its join effect — which owns the socket — tears down and rebuilds on every render of
   * this component. Measured against a live relay: one leave and one rejoin every four seconds,
   * with no position sent in between. Everybody else sees you flicker in and out, and anything
   * the relay holds FOR you goes with each drop, which is how a shared boss lasted four seconds.
   *
   * ⚠️ AND IT IS THE SHAPE CLAUDE.md §7 NAMES: an effect whose dependency is rebuilt every
   * render tears down and rebuilds whatever it owns. The store's own array is stable; only this
   * mapping was not.
   */
  const playable = useMemo(() => mine.map((p) => ({ name: p.name, art: p.art })), [mine])

  /**
   * The rest of your drawings, which can be stood up as a boss even though they are not minions.
   *
   * ⚠️ MEMOISED FOR THE SAME REASON playable IS, and the note above it says why: this feeds a
   * prop that reaches the park's animation loop, and a new array every render is a loop torn
   * down and rebuilt every render.
   *
   * ⚠️ AND THE ONES ALREADY ADOPTED ARE LEFT OUT, by name, or the picker lists the same
   * creature twice and the second one does exactly what the first does.
   */
  const kept = useSyncExternalStore(subscribeGallery, gallery, gallery)
  const extras = useMemo(() => {
    const had = new Set(mine.map((p) => p.name))
    return kept.filter((a) => !had.has(a.name)).map((a) => ({ name: a.name, art: a.art }))
  }, [kept, mine])

  /** Snake's relay connection, mirrored here as well as raised — see the note on Back below. */
  const liveChange = useCallback(
    (on: boolean) => {
      setLive(on)
      onLiveChange?.(on)
    },
    [onLiveChange],
  )

  /**
   * ⚠️ A CHALLENGE LINK CLICKED FROM INSIDE THIS ROOM STILL HAS TO OPEN THE GAME. Chat can be
   * a pinned window on the canvas while the games menu is the page behind it, so “join my room”
   * is a hashchange that never changes the SECTION — nothing remounts, and the menu would just
   * sit there having visibly ignored you.
   *
   * ⚠️ AND ONLY WHEN THE HASH ASKS FOR A GAME BY NAME. Navigating to `#paint` names no game,
   * so this leaves the room on whatever it was showing: a pinned games window must not empty
   * itself out every time somebody walks to another page.
   */
  useEffect(() => {
    const onHash = () => {
      const want = wantedFromHash()
      if (want) setGame(want)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /**
   * ⚠️ EVERY GAME IN HERE TAKES THE KEYBOARD, and for a while only one of them said so. This
   * read `game !== 'playground'` when the playground was the only thing beside Snake, and neither
   * the scrap nor the park was ever added to it — so the arrow keys walked the site out from
   * under a fight somebody was in the middle of. Reported from a live test, which is exactly
   * where a guard that is a LIST rather than a rule gets found out.
   *
   * ⚠️ SNAKE IS THE EXCEPTION AND STAYS ONE. It raises this itself when its canvas takes focus,
   * so clicking away from the board gives the page its arrows back; speaking for it here as well
   * would be two writers and a flag that never comes down.
   *
   * ⚠️ AND THE PARK SPEAKS FOR ITSELF, because it is the one room where being on the page is
   * not the same as playing: until you walk in, the arrows should still move between sections.
   */
  useEffect(() => {
    if (game !== 'playground' && game !== 'fight') return
    onControlChange?.(true)
    return () => onControlChange?.(false)
  }, [game, onControlChange])

  if (game === 'snake')
    return (
      <>
        <GamesBar live={live} onBack={() => setGame(null)} />
        {/* Its own boundary: a shared fallback would blank the bar while the chunk arrives. */}
        <Suspense fallback={<div aria-busy>Loading the game…</div>}>
          <SnakeGame
            onControlChange={onControlChange}
            onLiveChange={liveChange}
            autoFocus={autoFocus}
          />
        </Suspense>
      </>
    )

  if (game === 'playground')
    return (
      <>
        <GamesBar onBack={() => setGame(null)} />
        <Suspense fallback={<div aria-busy>Loading the playground…</div>}>
          <PetPlay pets={playable} />
        </Suspense>
      </>
    )

  if (game === 'fight')
    return (
      <>
        <GamesBar onBack={() => setGame(null)} />
        <Suspense fallback={<div aria-busy>Loading the ring…</div>}>
          <PetFight pets={playable} myName={readHandle()} authed={!!authed} />
        </Suspense>
      </>
    )

  if (game === 'park')
    return (
      <>
        <GamesBar onBack={() => setGame(null)} />
        <Suspense fallback={<div aria-busy>Finding the park…</div>}>
          <ParkRoom
            pets={playable}
            extras={extras}
            myName={readHandle()}
            authed={!!authed}
            onControlChange={onControlChange}
          />
        </Suspense>
      </>
    )

  return (
    <>
      <h2 style={{ marginTop: 0 }}>🎮 Games</h2>
      <p className="muted">Pick one. They all work with a keyboard, a thumb, or a friend.</p>
      <div className="games-pick">
        <button className="games-tile" onClick={() => setGame('snake')}>
          <span className="games-tile-art" aria-hidden>
            🐍
          </span>
          <span className="games-tile-body">
            <span className="games-tile-name">Snake</span>
            <span className="games-tile-line">
              The board this site started with. Play alone, or make a room and challenge somebody
              from Chat.
            </span>
          </span>
        </button>

        {mine.length ? (
          <>
            <button className="games-tile" onClick={() => setGame('playground')}>
              <span className="games-tile-art" aria-hidden>
                {/* ⚠️ STILL, at energy 0. A row of idling creatures on a menu is movement you
                    did not ask for, and the one on the card is a picture of what you get. */}
                <PetView art={mine[0].art} size={56} energy={0} />
              </span>
              <span className="games-tile-body">
                <span className="games-tile-name">Playground</span>
                <span className="games-tile-line">
                  A platformer for the creatures you drew. Arrow keys to run and jump, 1–9 to switch
                  which one you are — the rest follow you.
                </span>
              </span>
            </button>
            <button className="games-tile" onClick={() => setGame('park')}>
              <span className="games-tile-art" aria-hidden>
                🌳
              </span>
              <span className="games-tile-body">
                <span className="games-tile-name">The park</span>
                {/* ⚠️ TWO MODES NOW, AND THIS IS WHERE YOU FIND OUT. "One field" stopped
                    being the whole truth when the park learned to walk a drawing, and this
                    tile is the way in — somebody who had drawn a map would read the room's
                    description and never learn the map was walkable. The three sentences
                    inside the room were fixed when the mode shipped; the sign on the door
                    was not, which is the same miss as the locked tile below. */}
                <span className="games-tile-line">
                  One field everybody shares — whoever else is online is who you will meet. Or a map
                  you drew, on your own.
                </span>
              </span>
            </button>
            <button className="games-tile" onClick={() => setGame('fight')}>
              <span className="games-tile-art" aria-hidden>
                <PetView art={mine[mine.length > 1 ? 1 : 0].art} size={56} energy={0} />
              </span>
              <span className="games-tile-body">
                <span className="games-tile-name">Scrap</span>
                <span className="games-tile-line">
                  Two of your creatures, three lives each, on a stage you can be knocked off. What
                  they are made of is what they hit with.
                </span>
              </span>
            </button>
          </>
        ) : (
          /**
           * ⚠️ THIS IS THE ONLY THING A VISITOR WITH NO CREATURES IS TOLD, and it had been
           * describing two games since before the park existed. Somebody arriving with nothing
           * drawn read "a platformer and a fighting ring", went away, and never learned that
           * the one place on this site where you meet other people was behind the same door.
           * The tiles above it were updated when the park was added; the sign on the locked
           * door was not, because nobody with a minion ever sees it.
           */
          <a className="games-tile is-locked" href="#minions">
            <span className="games-tile-art" aria-hidden>
              🐾
            </span>
            <span className="games-tile-body">
              <span className="games-tile-name">The park, Playground &amp; Scrap</span>
              <span className="games-tile-line">
                A park everybody shares, a platformer, and a fighting ring — all for creatures you
                drew. Make one in Minions first.
              </span>
            </span>
          </a>
        )}
      </div>
    </>
  )
}

/**
 * ⚠️ NO WAY OUT WHILE A ROUND IS LIVE, because leaving would unmount Snake and drop you from the
 * relay room mid-game. The canvas has always refused to float a second copy for this exact
 * reason; a Back button beside the board is the same hazard with a friendlier label.
 *
 * ⚠️ AND IT SAYS SO IN WORDS RATHER THAN GOING GREY. A disabled button explained by a `title` is
 * a button that is unexplained on every phone on the site.
 */
function GamesBar({ live, onBack }: { live?: boolean; onBack: () => void }) {
  return (
    <div className="games-bar">
      {live ? (
        <p className="muted" style={{ margin: 0 }}>
          You’re in a live round — leave the room to come back to Games.
        </p>
      ) : (
        <button className="btn" onClick={onBack}>
          ← Games
        </button>
      )}
    </div>
  )
}
