import { Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { lazyRetry } from '../lazyRetry'
import { PetView } from '../pets/PetView'
import { pets as myPets, subscribePets } from '../pets/pets'

/**
 * The room the games live in.
 *
 * ⚠️ THIS TAB USED TO BE CALLED SNAKE, and Snake is now one of the things in it rather than the
 * whole of it. That is the entire point: there was nowhere for a second game to go. A platformer
 * already existed and was reachable only by opening the Pets room and pressing a button inside
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

type GameId = 'snake' | 'playground'

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
  return play === 'snake' || play === 'playground' ? play : null
}

export function GamesRoom({
  onControlChange,
  onLiveChange,
  autoFocus,
}: {
  onControlChange?: (on: boolean) => void
  /** true while Snake is connected to a multiplayer room — see GameManager's onLiveChange */
  onLiveChange?: (live: boolean) => void
  autoFocus?: boolean
}) {
  const [game, setGame] = useState<GameId | null>(() => wantedFromHash())
  const [live, setLive] = useState(false)
  const mine = useSyncExternalStore(subscribePets, myPets, myPets)

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
   * ⚠️ ONLY ONE OF THE TWO GAMES EVER WRITES THIS. Snake raises `onControlChange` itself when its
   * canvas takes focus, so the playground is the only one this room has to speak for — it takes
   * the arrow keys the moment it is on screen, the same as it does inside the Pets room.
   */
  useEffect(() => {
    if (game !== 'playground') return
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
          <PetPlay pets={mine.map((p) => ({ name: p.name, art: p.art }))} />
        </Suspense>
      </>
    )

  return (
    <>
      <h2 style={{ marginTop: 0 }}>🎮 Games</h2>
      <p className="muted">Pick one. Both work with a keyboard, a thumb, or a friend.</p>
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
          <button className="games-tile" onClick={() => setGame('playground')}>
            <span className="games-tile-art" aria-hidden>
              {/* ⚠️ STILL, at energy 0. A row of idling creatures on a menu is movement you did
                  not ask for, and the one on the card is a picture of what you get, not a demo. */}
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
        ) : (
          <a className="games-tile is-locked" href="#pets">
            <span className="games-tile-art" aria-hidden>
              🐾
            </span>
            <span className="games-tile-body">
              <span className="games-tile-name">Playground</span>
              <span className="games-tile-line">
                A platformer for the creatures you drew — draw one first, then come back. The Pets
                room shows you how.
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
