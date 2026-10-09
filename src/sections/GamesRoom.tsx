import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { lazyRetry } from '../lazyRetry'
import { PetView } from '../pets/PetView'
import { pets as myPets, subscribePets } from '../pets/pets'
import { gallery, subscribeGallery } from '../draw/gallery'
import { readHandle } from '../game/handle'
import { LANDED_AT } from '../nav/places'

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

const PetsRoom = lazyRetry(
  () => import('../pets/PetsRoom'),
  (m) => m.PetsRoom,
)

type GameId = 'snake' | 'playground' | 'fight' | 'park' | 'minions'

/** the bases that mean something IN HERE, so a landing hash of `#home` does not win over `#games` */
const KNOWN = /^(snake|minions|pets|games)$/

/**
 * Which game the address bar asked for, or null for the menu.
 *
 * ⚠️ READ ONCE, AND NEVER WRITTEN BACK. A games window can be pinned to the canvas while you are
 * reading a completely different page, so a room that kept the hash in step with its own menu
 * would be a window that changes the address bar from the corner of the screen. The hash is an
 * ENTRANCE here, not a mirror — which is all a challenge link ever needed it to be.
 */
function wantedFromHash(): GameId | null {
  /* ⚠️ THE ONE IT ARRIVED WITH WINS, because an alias rewrites the address bar before this room
     ever mounts: `#minions` is `#games` by the time anything here can read it, and the word that
     said which door you came through is gone. Falling back to the current hash keeps a later
     in-app jump to `#snake` or `#games?play=park` working, which is the other half of the job. */
  const landed = LANDED_AT.replace(/^#/, '')
  const now = window.location.hash.replace(/^#/, '')
  const raw = KNOWN.test(landed.split('?')[0] ?? '') ? landed : now
  const [base, query] = raw.split('?')
  const q = new URLSearchParams(query ?? '')
  // A room to join or a score to beat is a Snake link whatever the base says — and `#snake` is
  // the alias every challenge message ever posted was built from.
  if (base === 'snake' || q.has('room') || q.has('beat')) return 'snake'
  /* ⚠️ a park to walk into is a park link whatever the base says — the same rule the line above
     makes for a snake room, so an invite pasted anywhere lands in the right place */
  if (q.has('park')) return 'park'
  /* ⚠️ `#minions` and `#pets` were tabs and are links people hold — see SECTION_ALIASES. They
     land on the room the tab became, which is this one, open at the creatures. */
  if (base === 'minions' || base === 'pets') return 'minions'
  const play = q.get('play')
  return play === 'snake' ||
    play === 'playground' ||
    play === 'fight' ||
    play === 'park' ||
    play === 'minions'
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
  /* ⚠️ A RULE RATHER THAN A LIST, which is what the note above asks for: a room in here takes the
     keyboard when the whole page IS a game. Snake and the park each raise it themselves — Snake
     when its canvas takes focus, the park when you walk in — and the minions room is a menu with
     a roster on it, so it must not. */
  const takesKeys = game === 'fight' || game === 'playground'
  useEffect(() => {
    if (!takesKeys) return
    onControlChange?.(true)
    return () => onControlChange?.(false)
  }, [takesKeys, onControlChange])

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
        {/* ⚠️ back to the room it was opened from, not to the menu — see the minions room */}
        <GamesBar to="Minions" onBack={() => setGame('minions')} />
        <Suspense fallback={<div aria-busy>Loading the playground…</div>}>
          <PetPlay pets={playable} />
        </Suspense>
      </>
    )

  if (game === 'fight')
    return (
      <>
        <GamesBar to="Minions" onBack={() => setGame('minions')} />
        <Suspense fallback={<div aria-busy>Loading the ring…</div>}>
          <PetFight pets={playable} myName={readHandle()} authed={!!authed} />
        </Suspense>
      </>
    )

  if (game === 'park')
    return (
      <>
        <GamesBar to="Minions" onBack={() => setGame('minions')} />
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

  /**
   * Everything about a creature, behind one door.
   *
   * ⚠️ THE ROOM THE MINIONS TAB BECAME, and the reason it moved. Making one creature and playing
   * it used to touch three tabs — Paint to draw it and to reach the map maker, Minions to see it,
   * Games to play it — and the map you had just drawn was the hardest thing on the site to get
   * back to. Reported in those words: "having to go between all three tabs and then navigate into
   * a map that you made is not easy."
   *
   * ⚠️ THE WAYS IN COME FIRST AND THE ROSTER FOLLOWS, because the roster is what you LOOK at and
   * these are what you PRESS. The paint room learned the same thing about its part buttons: the
   * preview swallowed the visible area and put the things you act on six hundred pixels down.
   */
  if (game === 'minions')
    return (
      <>
        <GamesBar onBack={() => setGame(null)} />
        <div className="games-ways">
          {mine.length ? (
            <>
              <button className="btn" onClick={() => setGame('park')}>
                🌳 The park
              </button>
              <button className="btn" onClick={() => setGame('fight')}>
                ⚔ Scrap
              </button>
              {/* ⚠️ A DOOR, NOT THE PAGE, AND THAT IS A CORRECTION. The playground was embedded
                  here for a day: a platformer running under the roster the whole time you were
                  reading it, taking the arrow keys with it. "playground being open all the time
                  isnt the move — have it be a button like the other modes." */}
              <button className="btn" onClick={() => setGame('playground')}>
                🏃 Playground
              </button>
            </>
          ) : null}
          {/* ⚠️ A LINK, NOT A BUTTON, because it leaves the room — and it carries WHICH tool it
              wants, so it opens the thing rather than the page the thing is on. Going to Paint and
              being told to press something is the journey this room exists to shorten. */}
          <a className="btn" href="#paint?make=minion">
            🐾 Make a minion
          </a>
          <a className="btn" href="#paint?make=map">
            🗺 Make a map
          </a>
        </div>
        <Suspense fallback={<div aria-busy>Loading…</div>}>
          <PetsRoom onControlChange={onControlChange} />
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

        {/**
         * ⚠️ ONE TILE FOR ALL OF IT, WHERE THERE WERE THREE AND A LOCKED SIGN. The park, the
         * playground and the ring are all the same answer to "what can I do with the creatures I
         * drew", and listing them here put the three PLACES on the menu while the thing they have
         * in common — your creatures, and how to make another — was a different tab entirely.
         *
         * ⚠️ AND IT IS NEVER LOCKED. The old menu hid all three behind a sign saying make one
         * first, which is a door you are told about and cannot open; this one opens on the room
         * that has the Make buttons in it. Somebody with nothing drawn gets taken to where
         * drawing happens instead of being told where it is.
         */}
        <button className="games-tile" onClick={() => setGame('minions')}>
          <span className="games-tile-art" aria-hidden>
            {mine.length ? <PetView art={mine[0].art} size={56} energy={0} /> : '🐾'}
          </span>
          <span className="games-tile-body">
            <span className="games-tile-name">Minions</span>
            <span className="games-tile-line">
              {/* ⚠️ "A MAP TO WALK" STOPPED BEING THE WHOLE OF IT. A map you drew is where you
                  call waves of your own creature now, and this sentence is the site's only list
                  of what a creature is FOR — the same list that was once telling somebody with
                  nothing drawn about two games when there were three. */}
              {mine.length
                ? 'Your creatures, and everywhere they go: the park everybody shares, a scrap, a platformer. Make another, or draw a map and fight waves in it.'
                : 'Draw a creature and it can walk a park everybody shares, scrap with another, or run a platformer. Start here — draw a map and you can fight waves of it too.'}
            </span>
          </span>
        </button>
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
function GamesBar({
  live,
  onBack,
  to = 'Games',
}: {
  live?: boolean
  onBack: () => void
  to?: string
}) {
  return (
    <div className="games-bar">
      {live ? (
        <p className="muted" style={{ margin: 0 }}>
          You’re in a live round — leave the room to come back to Games.
        </p>
      ) : (
        /* ⚠️ IT SAYS WHERE IT GOES. The park, the scrap and the playground are all opened from
           the minions room now, so a button marked "← Games" would take you somewhere other than
           the place it names — which is worse than a long way round, because you stop trusting it. */
        <button className="btn" onClick={onBack}>
          ← {to}
        </button>
      )}
    </div>
  )
}
