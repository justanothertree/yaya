// Pool — a set of options a few people are choosing between, not a list to admire.
//
// It used to be a watchlist: queued titles with a full-name vote chip per person on every row,
// which read as clutter and never actually decided anything. Same data, reframed around the
// decision — say what you're up for, then let it pick.
//
//
// ⚠️ A POOL BELONGS TO FRIENDS, NOT TO A CIRCUIT.
//
// The audience used to be circuit membership, so sharing a shortlist with two friends meant
// first creating a fitness board — people, goals, exercise grids — and getting them to join it.
// That mechanism was inherited from the feature this was built beside rather than chosen for it.
// A pool is now its own thing with its own audience: just you, all your friends, or the people
// you picked. See PoolSheet.tsx and docs/2026-09-05-pools-belong-to-friends.sql.
//
//
// ⚠️ THE COMPOSER IS ABOUT THE THIRTY SECONDS BEFORE A DECISION.
//
// Getting one option in used to take: press ＋ Add, wait for a dialog, pick a category, type the
// whole title from memory, press Add, watch it close. Six steps and a modal, per option, while
// everyone waits — and a hundred titles the room had already discussed sat behind a separate
// "From the list" panel with its own separate search box, which is a second place to look for
// the thing you were about to type.
//
// So the dialog is gone and the two search boxes are one box. It is always open, everything the
// room has ever suggested is listed underneath it before a key is pressed, and the field keeps
// focus so four options is four bursts of typing. Nothing was removed — the full catalogue is
// still one tap away, now driven by the same box.
//
//
// ⚠️ A VOTE IS YOURS AND ONLY YOURS.
//
// The old row let anybody tap anybody's initial, and stored the lot as one array rewritten
// whole — so two people voting at the same moment meant one of them silently lost. Votes are
// rows keyed by account now, the policies refuse a vote cast in somebody else's name, and the
// row shows one button for you plus whoever else has actually said yes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { circuitStore, useCircuit } from '../store'
import { kindEmoji, kindsPresent } from '../reviewKinds'
import { defaultMovieGroup } from './movieMeta'
import { buildLibrary, filterLibrary, libraryKinds, type LibraryEntry } from '../poolLibrary'
import { buildReel, reelStep, ROLL_MS, sendRoll, watchRolls, weightedPick } from '../poolRoll'
import { useScrollFade } from '../../hooks/useScrollFade'
import { getSupabaseClientOrNull } from '../../finance/client'
import { peekPersistedUserId } from '../../finance/auth'
import { PoolSheet } from './PoolSheet'
import { voteId, type Pool, type WatchlistItem } from '../types'

type SortW = 'votes' | 'alpha' | 'rt'

/** the winner, held apart from the pool row so it survives the row being cleared away */
type Winner = { id: string; title: string; kind?: string }
/** a wheel currently turning on this screen */
type Spin = { reel: string[]; winner: Winner; by: string; mine: boolean }

/** how many suggestions sit under the box before you have to open the full catalogue */
const STRIP = 10
const POOL_KEY = 'pool_current_v1'

/**
 * ⚠️ A STAND-IN, NOT A ROW. Options that predate pools — and the whole signed-out demo board,
 * which has no accounts and therefore no audience — have no pool to belong to. Rather than
 * hiding them or inventing a real pool nobody asked for, they gather under one that exists only
 * in this component. The migration gives every real option a real pool, so for a signed-in
 * member this is empty and never appears.
 */
const LOOSE_ID = '__loose__'
const LOOSE: Pool = { id: LOOSE_ID, name: 'Not in a pool', audience: 'just_me' }

/** Stable colour per person, so the same initial is the same colour on everybody's screen. */
function tint(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 62% 52%)`
}

export function Watchlist() {
  const state = useCircuit()
  const allWatchlist = state.watchlist
  const allPools = useMemo(() => state.pools ?? [], [state.pools])
  const allVotes = useMemo(() => state.votes ?? [], [state.votes])

  const meId = useMemo(() => peekPersistedUserId(), [])
  /* the sandbox has no accounts, but it should still be usable — one stand-in voter so the
     signed-out demo can be played with without pretending to be somebody */
  const voter = meId ?? 'demo'

  const [sort, setSort] = useState<SortW>('votes')
  const [kindFilter, setKindFilter] = useState<string>('')
  const [query, setQuery] = useState('')
  const [pickedKind, setPickedKind] = useState('')
  const [newRt, setNewRt] = useState('')
  const [libOpen, setLibOpen] = useState(false)
  const [libKind, setLibKind] = useState('')
  const [sheet, setSheet] = useState<'new' | 'edit' | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const boxRef = useRef<HTMLInputElement | null>(null)
  /* the strip is one swipeable row on a phone — this fades its right edge only while swiping
     still gets you somewhere, so a half-cut chip reads as an invitation, not as clipping */
  const suggRef = useScrollFade<HTMLDivElement>()

  const [spin, setSpin] = useState<Spin | null>(null)
  const [step, setStep] = useState(0)
  const [landed, setLanded] = useState<Winner | null>(null)

  // ── which pool ────────────────────────────────────────────────────────────────────────────
  const loose = useMemo(() => allWatchlist.some((w) => !w.poolId), [allWatchlist])
  const pools = useMemo(() => (loose ? [...allPools, LOOSE] : allPools), [allPools, loose])
  const [poolId, setPoolId] = useState<string>(() => {
    try {
      return localStorage.getItem(POOL_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const pool = useMemo(
    () => pools.find((p) => p.id === poolId) ?? pools[0] ?? null,
    [pools, poolId],
  )
  const choosePool = useCallback((id: string) => {
    setPoolId(id)
    setLanded(null)
    try {
      localStorage.setItem(POOL_KEY, id)
    } catch {
      /* private mode: it holds for this visit */
    }
  }, [])

  /**
   * `#ratings?tab=watchlist&pool=<id>` — where the bell's "shared a pool with you" lands.
   *
   * ⚠️ A notice that opens the Pool tab but not the POOL is barely a notice: you would arrive
   * at whichever pool you last had open and have to guess which of them is the new one. Listens
   * for hashchange as well as reading on mount, because tapping a notice while already on this
   * page changes only the hash.
   */
  useEffect(() => {
    const open = () => {
      const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
      const want = q.get('pool')
      if (want) choosePool(want)
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [choosePool])
  /* ⚠️ "no account, no owner" counts as yours. The signed-out sandbox has no accounts, so a
     pool made there is stamped with a null owner — comparing that to a null meId with `===` on
     ids alone left you unable to rename or re-aim a pool you had just made yourself. The server
     never stores a null owner, so this can never hand a member somebody else's pool. */
  const isOwner = !!pool && (meId ? pool.ownerUserId === meId : !pool.ownerUserId)
  const shareable = !!pool && pool.id !== LOOSE_ID

  const inPool = useMemo(
    () =>
      pool
        ? allWatchlist.filter((w) => (pool.id === LOOSE_ID ? !w.poolId : w.poolId === pool.id))
        : [],
    [allWatchlist, pool],
  )

  // ── votes ─────────────────────────────────────────────────────────────────────────────────
  const votesByItem = useMemo(() => {
    const here = new Set(inPool.map((w) => w.id))
    const m = new Map<string, string[]>()
    for (const v of allVotes) {
      if (!here.has(v.itemId)) continue
      const list = m.get(v.itemId)
      if (list) list.push(v.userId)
      else m.set(v.itemId, [v.userId])
    }
    return m
  }, [allVotes, inPool])
  const votersOf = useCallback((id: string) => votesByItem.get(id) ?? [], [votesByItem])

  function toggleVote(item: WatchlistItem) {
    const id = voteId(item.id, voter)
    if (votersOf(item.id).includes(voter)) void circuitStore.deleteVote(id)
    else void circuitStore.saveVote({ id, itemId: item.id, userId: voter })
  }

  /**
   * Names for the people on this screen.
   *
   * ⚠️ Resolved server-side and ONLY for the owner, the invited, and whoever actually voted —
   * never the whole audience. Listing every friend of a friends-audience pool's owner would tell
   * each of them who else that person is friends with, which is not theirs to learn from a
   * takeaway poll.
   */
  const voteCount = allVotes.length
  const namesFor = shareable ? pool.id : null
  useEffect(() => {
    const sb = getSupabaseClientOrNull()
    if (!sb || !namesFor) return
    let live = true
    void sb.rpc('pool_names', { p_pool: namesFor }).then(({ data }) => {
      if (!live) return
      const map: Record<string, string> = {}
      for (const r of (data as { user_id: string; name: string }[] | null) ?? [])
        map[r.user_id] = r.name
      setNames(map)
    })
    return () => {
      live = false
    }
    // a new voter needs a name, so the vote count is a dependency on purpose
  }, [namesFor, voteCount])

  const nameOf = useCallback(
    (id: string) => (id === voter ? 'You' : (names[id] ?? 'Someone')),
    [names, voter],
  )

  // ── the options ───────────────────────────────────────────────────────────────────────────
  const kindCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of inPool) m.set(w.kind ?? 'movie', (m.get(w.kind ?? 'movie') ?? 0) + 1)
    return m
  }, [inPool])
  const multiKind = kindCounts.size > 1

  /**
   * What a typed option will be filed as, if you don't say.
   *
   * ⚠️ Follows the pool rather than defaulting to 'movie' forever. A pool of eleven restaurants
   * asked you to press 🍽️ on the twelfth, every time, and filed it under Movie when you forgot.
   */
  const dominantKind = useMemo(() => {
    let best = 'movie'
    let bestN = 0
    for (const [k, n] of kindCounts)
      if (n > bestN) {
        bestN = n
        best = k
      }
    return best
  }, [kindCounts])
  const kind = pickedKind || kindFilter || dominantKind

  const watchlist = useMemo(
    () => (kindFilter ? inPool.filter((w) => (w.kind ?? 'movie') === kindFilter) : inPool),
    [inPool, kindFilter],
  )

  const sorted = useMemo(() => {
    const list = [...watchlist]
    if (sort === 'votes') list.sort((a, b) => votersOf(b.id).length - votersOf(a.id).length)
    else if (sort === 'alpha') list.sort((a, b) => a.title.localeCompare(b.title))
    else list.sort((a, b) => (parseInt(b.rt ?? '0') || 0) - (parseInt(a.rt ?? '0') || 0))
    return list
  }, [watchlist, sort, votersOf])

  /**
   * ⚠️ BUILT FROM THE WHOLE BOARD, filtered for display only. Rebuilding on every keystroke
   * would walk 250-odd rows per character; the catalogue changes when the data does, and the
   * search is a view of it.
   */
  const library = useMemo(
    () => buildLibrary(circuitStore.getState(), inPool),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allWatchlist, inPool],
  )
  const matches = useMemo(() => filterLibrary(library, '', query), [library, query])
  /* never offers what is already in this pool: "add the thing that is already there" is the one
     suggestion that can only waste a tap */
  const suggestions = useMemo(() => matches.filter((e) => !e.inPool), [matches])
  const libShown = useMemo(
    () => filterLibrary(library, libKind, query).slice(0, 200),
    [library, libKind, query],
  )
  const libCats = useMemo(() => libraryKinds(library), [library])

  const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const typed = query.trim()
  const exact = useMemo(
    () => suggestions.find((e) => fold(e.title) === fold(typed)),
    [suggestions, typed],
  )

  function add(title: string, ofKind: string, rt?: string) {
    const t = title.trim()
    if (!t || !pool) return
    void circuitStore.saveWatchlist({
      id: 'wl' + (crypto.randomUUID?.() ?? String(Date.now())),
      title: t,
      rt,
      kind: ofKind,
      poolId: pool.id === LOOSE_ID ? null : pool.id,
    })
    setQuery('')
    setNewRt('')
    /* ⚠️ stay in the box. The whole point of losing the dialog is that the second option costs
       one burst of typing, not another round trip to a button. */
    boxRef.current?.focus()
  }

  const addFromLibrary = (e: LibraryEntry) => add(e.title, e.kind, e.rt)

  /** The box's own action: whatever matched exactly, else what you actually typed. */
  function addTyped() {
    if (exact) addFromLibrary(exact)
    else add(typed, kind, newRt.trim() ? newRt.trim() + '%' : undefined)
  }

  /**
   * What happens to the thing the wheel landed on.
   *
   * ⚠️ THIS WAS ONE BUTTON CALLED "✓ Did it" AND IT QUIETLY DID NOTHING BUT DELETE. It took an
   * `onWatched` callback meant to carry the title over to the review board — and in the whole
   * app nothing ever passed one, from either screen, ever. So the wheel picked a film, you
   * pressed the button that said you did it, and the option vanished without trace, next to a
   * Reviews board built for exactly that.
   *
   * Two buttons, because there are two endings and the old one guessed wrong at both: you
   * watched it and want to rate it, or you didn't and want it gone.
   */
  function rateIt(w: Winner) {
    void circuitStore.saveMovie({
      id: 'm' + (crypto.randomUUID?.() ?? String(Date.now())),
      title: w.title,
      kind: w.kind ?? 'movie',
      date: new Date().toISOString().slice(0, 10),
      rt: allWatchlist.find((x) => x.id === w.id)?.rt,
      /* nobody has rated it yet — this is the row to hang a rating on, not a rating */
      ratings: {},
      groupId: defaultMovieGroup(),
    })
    void circuitStore.deleteWatchlist(w.id)
    setLanded(null)
    /* straight to where the rating happens; landing back on the pool it just left would leave
       you to find it yourself on a board of a hundred and fifty */
    window.location.hash = '#ratings?tab=reviews'
  }

  function dropIt(w: Winner) {
    void circuitStore.deleteWatchlist(w.id)
    setLanded(null)
  }

  // ── the wheel ─────────────────────────────────────────────────────────────────────────────
  const onRoll = useCallback(
    (r: { id: string; title: string; kind?: string; reel: string[]; by: string }) =>
      setSpin({
        reel: r.reel,
        winner: { id: r.id, title: r.title, kind: r.kind },
        by: r.by,
        mine: false,
      }),
    [],
  )
  /* ⚠️ keyed on the ID, not the pool object. `pool` is derived from store state, so it is a
     new object on every board update — depending on it would tear the channel down and build
     it back up each time anybody added an option. */
  const livePoolId = shareable ? pool.id : null
  useEffect(() => {
    if (!livePoolId) return
    return watchRolls([livePoolId], onRoll)
  }, [livePoolId, onRoll])

  useEffect(() => {
    if (!spin) return
    setLanded(null)
    setStep(0)
    /* ⚠️ Somebody who has asked for less motion gets the answer, not two seconds of flashing
       names. They still see it the moment everybody else's wheel starts, which is the part that
       matters — the reel is the flourish, the result is the point. */
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setLanded(spin.winner)
      setSpin(null)
      return
    }
    let raf = 0
    let shown = -1
    const t0 = performance.now()
    const land = () => {
      setLanded(spin.winner)
      setSpin(null)
    }
    /**
     * ⚠️ THE RESULT DOES NOT DEPEND ON THE ANIMATION RUNNING. requestAnimationFrame is suspended
     * in a background tab, so a roll arriving while you are reading something else would sit on
     * the first name of the reel — a name that is not the answer — until you happened to look.
     * The wheel is decoration; what it stopped on is not, so it lands on a timer regardless.
     */
    const guard = window.setTimeout(land, ROLL_MS + 400)
    const tick = () => {
      const elapsed = performance.now() - t0
      const i = reelStep(elapsed, spin.reel.length)
      /* ⚠️ only on a CHANGE of face. Setting state every frame would re-render the whole pool
         sixty times a second for two seconds; the ease-out only produces about twenty faces. */
      if (i !== shown) {
        shown = i
        setStep(i)
      }
      if (elapsed < ROLL_MS) raf = requestAnimationFrame(tick)
      else land()
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(guard)
    }
  }, [spin])

  function roll() {
    if (watchlist.length === 0 || spin || !pool) return
    const winner = weightedPick(watchlist, (w) => 1 + votersOf(w.id).length * 2)
    if (!winner) return
    const label = (w: WatchlistItem) => `${kindEmoji(w.kind)} ${w.title}`
    const reel = buildReel(watchlist.map(label), label(winner))
    const by = names[voter] ?? 'Someone'
    if (shareable) {
      sendRoll(pool.id, { id: winner.id, title: winner.title, kind: winner.kind, reel, by })
    }
    setSpin({
      reel,
      winner: { id: winner.id, title: winner.title, kind: winner.kind },
      by,
      mine: true,
    })
  }

  const sortBtn = (k: SortW, label: string) => (
    <button
      key={k}
      className="btn cz-tap"
      onClick={() => setSort(k)}
      style={
        sort === k
          ? {
              background: 'var(--accent,#7c6af7)',
              color: 'var(--btn-text)',
              borderColor: 'transparent',
            }
          : {}
      }
    >
      {label}
    </button>
  )

  const moviesOnly = !multiKind && (kindCounts.has('movie') || kindCounts.size === 0)
  const face = spin ? spin.reel[Math.min(step, spin.reel.length - 1)] : null

  /**
   * One line saying who else is here.
   *
   * ⚠️ A pool somebody ELSE shared says whose it is. Without that, a name in the picker is just
   * a name — you cannot tell "Friday film" is Josh's list you were added to from "Friday film"
   * you made yourself, and the difference decides whether the settings button will let you
   * change anything.
   */
  const ownerName = pool?.ownerUserId ? (names[pool.ownerUserId] ?? 'Someone') : null
  const audienceLine = !pool
    ? ''
    : pool.id === LOOSE_ID
      ? 'Not shared with anyone.'
      : !isOwner
        ? `${ownerName ?? 'Someone'} shared this with you — you can add options and vote.`
        : pool.audience === 'just_me'
          ? 'Just you.'
          : pool.audience === 'friends'
            ? 'Your friends can see it, add to it and vote — and they can see each other doing it.'
            : 'Shared with the people you picked.'

  return (
    <div>
      {/* ── which pool, and who it is for ── */}
      <div className="cz-pool-head">
        <h3 style={{ margin: 0 }}>
          {pools.length > 1 ? (
            <>
              <label className="sr-only" htmlFor="cz-pool-pick">
                Which pool
              </label>
              <select
                id="cz-pool-pick"
                className="cz-pool-pick"
                value={pool?.id ?? ''}
                onChange={(e) => choosePool(e.target.value)}
              >
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            (pool?.name ?? 'The pool')
          )}
        </h3>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {watchlist.length} option{watchlist.length === 1 ? '' : 's'}
        </span>
        {shareable && (
          <button
            className="btn cz-tap"
            onClick={() => setSheet('edit')}
            title={audienceLine}
            aria-label={isOwner ? 'Pool settings' : 'Who is in this pool'}
          >
            👥 {isOwner ? 'Who' : 'Who’s in'}
          </button>
        )}
        <button className="btn cz-tap" onClick={() => setSheet('new')}>
          ＋ New pool
        </button>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
          {sortBtn('votes', 'Top')}
          {sortBtn('alpha', 'A–Z')}
          {moviesOnly && sortBtn('rt', 'RT%')}
        </span>
      </div>
      {pool && <p className="muted cz-pool-aud">{audienceLine}</p>}

      {!pool ? (
        <p className="muted">
          No pools yet. Make one and aim it at your friends — no circuit required.
        </p>
      ) : (
        <>
          {/* ── the composer: one box, always open, catalogue underneath ── */}
          <div className="cz-add">
            <div className="cz-add-row">
              <input
                ref={boxRef}
                className="cz-add-box"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') addTyped()
                  else if (e.key === 'Escape') setQuery('')
                }}
                placeholder="Type something, or pick one below"
                aria-label="Add an option to the pool"
              />
              {kind === 'movie' && typed && !exact && (
                <input
                  className="cz-add-rt"
                  value={newRt}
                  onChange={(e) => setNewRt(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') addTyped()
                  }}
                  placeholder="RT%"
                  type="number"
                  min={0}
                  max={100}
                  aria-label="Rotten Tomatoes score, optional"
                />
              )}
              <button
                className="btn cz-tap"
                onClick={addTyped}
                disabled={!typed}
                style={
                  typed
                    ? {
                        background: 'var(--accent,#7c6af7)',
                        color: 'var(--btn-text)',
                        borderColor: 'transparent',
                      }
                    : {}
                }
              >
                ＋ Add
              </button>
            </div>

            {/* category, only asked about for something genuinely new */}
            {typed && !exact && (
              <div className="cz-add-kinds">
                {kindsPresent(kindCounts.keys()).map((k) => (
                  <button
                    key={k.id}
                    className={'cz-chip' + (kind === k.id ? ' cz-on' : '')}
                    style={
                      kind === k.id
                        ? { background: 'var(--accent,#7c6af7)', color: 'var(--btn-text)' }
                        : {}
                    }
                    onClick={() => setPickedKind(k.id)}
                    title={k.label}
                  >
                    {k.emoji} {k.label}
                  </button>
                ))}
              </div>
            )}

            <div className="cz-sugg" ref={suggRef}>
              {/* ⚠️ FIRST, not last. On a phone the strip is a scroller, and the way to see
                  everything cannot be the one chip you have to swipe past ten others to find. */}
              {suggestions.length > STRIP && (
                <button
                  className={'cz-sugg-more' + (libOpen ? ' is-on' : '')}
                  onClick={() => setLibOpen((v) => !v)}
                  aria-expanded={libOpen}
                >
                  {libOpen ? 'Fewer' : `All ${suggestions.length}`}
                </button>
              )}
              {suggestions.slice(0, STRIP).map((e) => (
                <button
                  key={e.key}
                  className="cz-sugg-item"
                  onClick={() => addFromLibrary(e)}
                  title={
                    [
                      e.score != null ? `rated ${Math.round(e.score)}` : null,
                      e.suggested > 1 ? `suggested ${e.suggested}×` : null,
                      e.rt || null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'never picked'
                  }
                >
                  <span aria-hidden>{kindEmoji(e.kind)} </span>
                  {e.title}
                </button>
              ))}
              {suggestions.length === 0 && (
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  {/* ⚠️ "nothing matches" and "it is already down there" are different answers,
                      and telling somebody to add a thing they can see in the pool is the worse
                      one */}
                  {matches.length > 0
                    ? 'Already in the pool.'
                    : typed
                      ? 'Nothing like that yet — ＋ Add puts it in.'
                      : 'Everything you have suggested or rated before shows up here.'}
                </span>
              )}
            </div>
          </div>

          {/* ── the decision — the reason this screen exists ── */}
          <div className={'cz-stage' + (spin ? ' is-spinning' : '') + (landed ? ' is-landed' : '')}>
            <button
              className="cz-stage-go"
              onClick={roll}
              disabled={watchlist.length === 0 || !!spin}
              title="Votes tilt the odds — anything in the pool can still come up"
            >
              🎲 {landed ? 'Again' : 'Pick for us'}
            </button>
            <span className="cz-stage-face" aria-hidden={!!spin}>
              {face ??
                (landed ? (
                  <strong>
                    {kindEmoji(landed.kind)} {landed.title}
                  </strong>
                ) : watchlist.length ? (
                  <span className="muted">Votes tilt the odds — anything can still come up.</span>
                ) : (
                  <span className="muted">Add a few options and let it choose.</span>
                ))}
            </span>
            {spin && !spin.mine && (
              <span className="cz-stage-who muted">{spin.by} is rolling…</span>
            )}
            {landed && (
              <>
                <button
                  className="btn cz-tap"
                  onClick={() => rateIt(landed)}
                  title="We did this one — put it on the review board"
                >
                  ★ Rate it
                </button>
                <button
                  className="btn cz-tap"
                  onClick={() => dropIt(landed)}
                  title="Take it out of the pool without reviewing it"
                  style={{ opacity: 0.6 }}
                >
                  ✕ Drop it
                </button>
              </>
            )}
            {/* announced once, at the end — a live region on the reel itself would read out
                twenty names nobody asked for */}
            <span className="sr-only" role="status">
              {landed ? `Picked ${landed.title}` : ''}
            </span>
          </div>

          {multiKind && (
            <div
              style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}
            >
              <button
                className={'cz-chip' + (kindFilter === '' ? ' cz-on' : '')}
                style={
                  kindFilter === ''
                    ? { background: 'var(--accent,#7c6af7)', color: 'var(--btn-text)' }
                    : {}
                }
                onClick={() => setKindFilter('')}
              >
                All {inPool.length}
              </button>
              {kindsPresent(kindCounts.keys())
                .filter((k) => kindCounts.has(k.id))
                .map((k) => (
                  <button
                    key={k.id}
                    className={'cz-chip' + (kindFilter === k.id ? ' cz-on' : '')}
                    style={
                      kindFilter === k.id
                        ? { background: 'var(--accent,#7c6af7)', color: 'var(--btn-text)' }
                        : {}
                    }
                    onClick={() => setKindFilter(k.id)}
                  >
                    {k.emoji} {kindCounts.get(k.id)}
                  </button>
                ))}
            </div>
          )}

          <div className="cz-pool-list">
            {sorted.map((item) => {
              const voters = votersOf(item.id)
              const mine = voters.includes(voter)
              const others = voters.filter((v) => v !== voter)
              return (
                <div
                  key={item.id}
                  className={'cz-pool-row' + (landed?.id === item.id ? ' is-pick' : '')}
                >
                  <span className="cz-pool-title">
                    {multiKind && <span aria-hidden>{kindEmoji(item.kind)} </span>}
                    {item.title}
                    {item.rt && (
                      <span style={{ color: '#fa4242', fontWeight: 700, fontSize: '0.74rem' }}>
                        {' '}
                        {item.rt}
                      </span>
                    )}
                  </span>

                  {/* ⚠️ ONE button, and it is yours. Tapping somebody else's initial to vote for
                      them was possible before and is now refused by the policies as well as
                      absent from the markup. */}
                  <button
                    className={'cz-up' + (mine ? ' is-on' : '')}
                    onClick={() => toggleVote(item)}
                    aria-pressed={mine}
                    aria-label={mine ? `Not up for ${item.title}` : `Up for ${item.title}`}
                    title={mine ? 'You are up for it — tap to take it back' : "I'm up for it"}
                  >
                    👍{voters.length > 0 && <b>{voters.length}</b>}
                  </button>

                  <span className="cz-pool-votes">
                    {others.slice(0, 5).map((id) => (
                      <span
                        key={id}
                        className="cz-voter"
                        style={{ background: tint(id) }}
                        title={`${nameOf(id)} is up for it`}
                      >
                        {(nameOf(id)[0] ?? '?').toUpperCase()}
                      </span>
                    ))}
                    {others.length > 5 && (
                      <span className="cz-pool-count">+{others.length - 5}</span>
                    )}
                  </span>

                  <button
                    className="btn cz-tap"
                    onClick={() => void circuitStore.deleteWatchlist(item.id)}
                    title="Take it out of the pool"
                    style={{ opacity: 0.45, flexShrink: 0 }}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
            {watchlist.length === 0 && (
              <p className="muted" style={{ marginTop: '0.5rem' }}>
                Nothing in the pool yet. Add a few options and let it choose.
              </p>
            )}
          </div>

          {/* the whole catalogue, driven by the same box — no second search field */}
          {libOpen && (
            <div className="cz-lib">
              {libCats.length > 1 && (
                <div className="cz-lib-head">
                  <button
                    className={'btn cz-tap' + (libKind === '' ? ' is-on' : '')}
                    onClick={() => setLibKind('')}
                  >
                    All
                  </button>
                  {libCats.map((k) => (
                    <button
                      key={k}
                      className={'btn cz-tap' + (libKind === k ? ' is-on' : '')}
                      onClick={() => setLibKind(k)}
                      title={k}
                    >
                      {kindEmoji(k)}
                    </button>
                  ))}
                </div>
              )}
              <div className="cz-lib-grid">
                {libShown.map((e) => (
                  <button
                    key={e.key}
                    className={'cz-lib-item' + (e.inPool ? ' is-in' : '')}
                    disabled={e.inPool}
                    onClick={() => addFromLibrary(e)}
                    title={e.inPool ? 'Already in the pool' : 'Add to the pool'}
                  >
                    <span className="cz-lib-title">
                      <span aria-hidden>{kindEmoji(e.kind)} </span>
                      {e.title}
                    </span>
                    <span className="cz-lib-meta muted">
                      {e.inPool
                        ? 'in the pool'
                        : [
                            e.score != null ? `rated ${Math.round(e.score)}` : null,
                            e.suggested > 1 ? `suggested ${e.suggested}×` : null,
                            e.rt || null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'never picked'}
                    </span>
                  </button>
                ))}
                {libShown.length === 0 && (
                  <p className="muted" style={{ margin: 0 }}>
                    Nothing matches. Anything genuinely new goes in with ＋ Add.
                  </p>
                )}
              </div>
              <p className="muted cz-lib-note">
                Everything you have all suggested or rated before — nothing fetched, nothing
                suggested by a machine.
              </p>
            </div>
          )}
        </>
      )}

      {sheet && (
        <PoolSheet
          pool={sheet === 'new' ? null : pool}
          meId={meId}
          onClose={() => setSheet(null)}
          onCreated={choosePool}
        />
      )}
    </div>
  )
}
