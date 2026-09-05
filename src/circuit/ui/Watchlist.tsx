// Pool — a set of options a circle is choosing between, not a list to admire.
//
// It used to be a watchlist: queued titles with a full-name vote chip per person on every row,
// which read as clutter and never actually decided anything. Same data, reframed around the
// decision — say what you're up for, then let it pick. Pools are typed (movies, food, games…)
// so one circle can run several without them mixing.
//
//
// ⚠️ THE SECOND REWRITE WAS ABOUT THE THIRTY SECONDS BEFORE A DECISION, not about the data.
//
// Four people are deciding what to watch. Getting one option in took: press ＋ Add, wait for a
// dialog, pick a category, type the whole title from memory, press Add, watch the dialog close.
// Six steps and a modal, per option, while everyone waits — and a hundred titles the room had
// already discussed sat in the database behind a separate "📚 From the list" panel with its own
// separate search box, which is a second place to look for the thing you were about to type.
//
// So the dialog is gone and the two search boxes are one box. It is always open, it is the first
// thing under the heading, and everything the room has ever suggested is already listed
// underneath it before a single key is pressed. Typing filters that list; tapping an entry adds
// it with its category and score attached; Enter adds whatever you typed if none of it matched.
// The field keeps focus, so four options is four short bursts of typing rather than four rounds
// of dialog. Nothing was removed — the full catalogue is still there, one tap away, now driven
// by the same box.
//
// ⚠️ Drag-to-add went with it. The catalogue used to be a panel some distance from the pool, so
// dragging an entry onto the pool was a way to say where it should land. Now the suggestions sit
// directly above the pool and a tap does it in one action instead of two, on every device rather
// than only the ones with a mouse.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { circuitStore, useCircuit } from '../store'
import { watchlistInGroup } from '../groupFilter'
import { ratersIn } from './movieMeta'
import { kindEmoji, kindsPresent } from '../reviewKinds'
import { buildLibrary, filterLibrary, libraryKinds, type LibraryEntry } from '../poolLibrary'
import { buildReel, reelStep, ROLL_MS, sendRoll, watchRolls, weightedPick } from '../poolRoll'
import { useScrollFade } from '../../hooks/useScrollFade'
import { peekPersistedUserId } from '../../finance/auth'
import type { CircuitGroup, WatchlistItem } from '../types'

type SortW = 'votes' | 'alpha' | 'rt'

/** the winner, held apart from the pool row so it survives the row being cleared away */
type Winner = { id: string; title: string; kind?: string }
/** a wheel currently turning on this screen */
type Spin = { reel: string[]; winner: Winner; by: string; mine: boolean }

/** how many suggestions sit under the box before you have to open the full catalogue */
const STRIP = 10

export function Watchlist({
  onWatched,
  viewGroup = '',
  groups = [],
}: {
  onWatched?: (title: string, rt?: string) => void
  /** the circuit filter you're currently looking at — '' means "all circuits" */
  viewGroup?: string
  groups?: CircuitGroup[]
} = {}) {
  const { watchlist: allWatchlist, people, groups: storeGroups } = useCircuit()
  const inGroup = useMemo(
    () => watchlistInGroup(allWatchlist, viewGroup),
    [allWatchlist, viewGroup],
  )
  /* the Circuit passes its own list; Ratings does not, and used to lose the circuit picker
     entirely because of it — so fall back to the store, which has them either way */
  const allGroups = groups.length ? groups : (storeGroups ?? [])

  const [sort, setSort] = useState<SortW>('votes')
  const [kindFilter, setKindFilter] = useState<string>('')
  const [query, setQuery] = useState('')
  const [pickedKind, setPickedKind] = useState('')
  const [newRt, setNewRt] = useState('')
  const [libOpen, setLibOpen] = useState(false)
  const [libKind, setLibKind] = useState('')
  const boxRef = useRef<HTMLInputElement | null>(null)
  /* the strip is one swipeable row on a phone — this fades its right edge only while swiping
     still gets you somewhere, so a half-cut chip reads as an invitation, not as clipping */
  const suggRef = useScrollFade<HTMLDivElement>()

  // See AddMovie.tsx for the full reasoning -- same fix, same shape: default to whatever
  // circuit you're actually looking at, only ask when there's more than one to choose from.
  const [newGroup, setNewGroup] = useState<string | undefined>(() => viewGroup || defaultGroup())

  const [spin, setSpin] = useState<Spin | null>(null)
  const [step, setStep] = useState(0)
  const [landed, setLanded] = useState<Winner | null>(null)

  const uid = useMemo(() => peekPersistedUserId(), [])
  const me = useMemo(
    () => (uid ? (people.find((p) => p.ownerUserId === uid) ?? null) : null),
    [people, uid],
  )

  /**
   * Who's up for it. Your own circle sits first and wears a ring, because on a phone in a group
   * chat you are tapping your own initial and nobody else's — the row was a fine control for
   * four people round one laptop and an unlabelled guessing game for four people in four rooms.
   */
  const voters = useMemo(() => {
    const list = ratersIn(people, viewGroup)
    const mine = me && list.some((p) => p.id === me.id) ? me : null
    return mine ? [mine, ...list.filter((p) => p.id !== mine.id)] : list
  }, [people, viewGroup, me])

  // which kinds are actually present — the filter only earns its space when there's a choice
  const kindCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of inGroup) m.set(w.kind ?? 'movie', (m.get(w.kind ?? 'movie') ?? 0) + 1)
    return m
  }, [inGroup])
  const multiKind = kindCounts.size > 1

  /**
   * What a typed option will be filed as, if you don't say.
   *
   * ⚠️ Follows the pool rather than defaulting to 'movie' forever. A pool of eleven restaurants
   * asked you to press 🍽️ on the twelfth, every time, and filed it under Movie when you forgot.
   * Whatever you are filtered to wins, then whatever the pool is mostly made of.
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
    () => (kindFilter ? inGroup.filter((w) => (w.kind ?? 'movie') === kindFilter) : inGroup),
    [inGroup, kindFilter],
  )

  const sorted = useMemo(() => {
    const list = [...watchlist]
    if (sort === 'votes') list.sort((a, b) => (b.votes?.length ?? 0) - (a.votes?.length ?? 0))
    else if (sort === 'alpha') list.sort((a, b) => a.title.localeCompare(b.title))
    else list.sort((a, b) => (parseInt(b.rt ?? '0') || 0) - (parseInt(a.rt ?? '0') || 0))
    return list
  }, [watchlist, sort])

  // default a new option to the circuit the pool already lives in, so friends can see + vote
  function defaultGroup(): string | undefined {
    const st = circuitStore.getState()
    const counts = new Map<string, number>()
    for (const w of st.watchlist)
      if (w.groupId) counts.set(w.groupId, (counts.get(w.groupId) ?? 0) + 1)
    for (const m of st.movies)
      if (m.groupId) counts.set(m.groupId, (counts.get(m.groupId) ?? 0) + 1)
    let best: string | undefined
    let bestN = 0
    for (const [g, n] of counts)
      if (n > bestN) {
        bestN = n
        best = g
      }
    return best ?? st.groups?.[0]?.id ?? undefined
  }
  /**
   * Where a new option lands.
   *
   * ⚠️ Re-derived rather than trusted from mount. `newGroup` is seeded in a useState initialiser,
   * which runs before the board has loaded — so on a cold open it was undefined, the picker
   * showed a circuit it was not actually set to, and anything added went in with no circuit at
   * all, visible to nobody but its author.
   */
  const targetGroup = viewGroup || newGroup || defaultGroup()

  /**
   * ⚠️ BUILT FROM THE WHOLE BOARD, filtered for display only. Rebuilding on every keystroke
   * would walk 250-odd rows per character; the catalogue changes when the data does, and the
   * search is a view of it.
   */
  const library = useMemo(
    () => buildLibrary(circuitStore.getState(), inGroup),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allWatchlist, inGroup],
  )
  /* the strip under the box: never offers what is already in the pool, because "add the thing
     that is already there" is the one suggestion that can only waste a tap */
  const matches = useMemo(() => filterLibrary(library, '', query), [library, query])
  const suggestions = useMemo(() => matches.filter((e) => !e.inPool), [matches])
  const libShown = useMemo(
    () => filterLibrary(library, libKind, query).slice(0, 200),
    [library, libKind, query],
  )
  const libCats = useMemo(() => libraryKinds(library), [library])

  /** the typed text, if it is genuinely new rather than something already in the catalogue */
  const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const typed = query.trim()
  const exact = useMemo(
    () => suggestions.find((e) => fold(e.title) === fold(typed)),
    [suggestions, typed],
  )

  function add(title: string, ofKind: string, rt?: string) {
    const t = title.trim()
    if (!t) return
    void circuitStore.saveWatchlist({
      id: 'wl' + (crypto.randomUUID?.() ?? String(Date.now())),
      title: t,
      rt,
      votes: [],
      kind: ofKind,
      groupId: targetGroup,
    })
    setQuery('')
    setNewRt('')
    /* ⚠️ stay in the box. The whole point of losing the dialog is that the second option costs
       one burst of typing, not another round trip to a button. */
    boxRef.current?.focus()
  }

  /** Put one of the room's old suggestions back on the table, with what we know about it. */
  const addFromLibrary = (e: LibraryEntry) => add(e.title, e.kind, e.rt)

  /** The box's own action: whatever matched exactly, else what you actually typed. */
  function addTyped() {
    if (exact) addFromLibrary(exact)
    else add(typed, kind, newRt.trim() ? newRt.trim() + '%' : undefined)
  }

  function toggleVote(item: WatchlistItem, pid: string) {
    const votes = item.votes ?? []
    const next = votes.includes(pid) ? votes.filter((v) => v !== pid) : [...votes, pid]
    void circuitStore.saveWatchlist({ ...item, votes: next })
  }

  function markDone(w: Winner) {
    void circuitStore.deleteWatchlist(w.id)
    setLanded(null)
    const item = allWatchlist.find((x) => x.id === w.id)
    onWatched?.(w.title, item?.rt)
  }

  // ── the wheel ─────────────────────────────────────────────────────────────────────────────
  /** somebody else's roll, arriving over the circuit's channel */
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
  /* watching every circuit you're in, not just the one in view: on "All circuits" a roll can
     come from any of them, and the item that came up says which one it belonged to */
  const watched = useMemo(
    () => (viewGroup ? [viewGroup] : allGroups.map((g) => g.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewGroup, allGroups.map((g) => g.id).join(',')],
  )
  useEffect(() => {
    if (watched.length === 0) return
    return watchRolls(watched, onRoll)
  }, [watched, onRoll])

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
    if (watchlist.length === 0 || spin) return
    const winner = weightedPick(watchlist, (w) => 1 + (w.votes?.length ?? 0) * 2)
    if (!winner) return
    const label = (w: WatchlistItem) => `${kindEmoji(w.kind)} ${w.title}`
    const reel = buildReel(watchlist.map(label), label(winner))
    const by = me?.name ?? 'Someone'
    sendRoll(winner.groupId ?? viewGroup, {
      id: winner.id,
      title: winner.title,
      kind: winner.kind,
      reel,
      by,
    })
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

  // RT% only means anything for films
  const moviesOnly = !multiKind && (kindCounts.has('movie') || kindCounts.size === 0)
  const face = spin ? spin.reel[Math.min(step, spin.reel.length - 1)] : null

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          flexWrap: 'wrap',
          marginBottom: '0.8rem',
        }}
      >
        <h3 style={{ margin: 0 }}>The pool</h3>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {watchlist.length} option{watchlist.length === 1 ? '' : 's'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
          {sortBtn('votes', 'Top')}
          {sortBtn('alpha', 'A–Z')}
          {moviesOnly && sortBtn('rt', 'RT%')}
        </span>
      </div>

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

        {/* the catalogue, in reach rather than behind a panel */}
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
              {/* ⚠️ "nothing matches" and "it is already down there" are different answers, and
                  telling somebody to add a thing they can see in the pool is the worse one */}
              {matches.length > 0
                ? 'Already in the pool.'
                : typed
                  ? 'Nothing like that yet — ＋ Add puts it in.'
                  : 'Everything you have suggested or rated before shows up here.'}
            </span>
          )}
        </div>

        {allGroups.length > 1 && !viewGroup && (
          <label className="cz-add-where muted">
            Goes to
            <select
              value={targetGroup ?? ''}
              onChange={(e) => setNewGroup(e.target.value || undefined)}
            >
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            — only people in that circuit can see and vote on it.
          </label>
        )}
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
        {spin && !spin.mine && <span className="cz-stage-who muted">{spin.by} is rolling…</span>}
        {landed && (
          <button className="btn cz-tap" onClick={() => markDone(landed)} title="We did this one">
            ✓ Did it
          </button>
        )}
        {/* announced once, at the end — a live region on the reel itself would read out
            twenty names nobody asked for */}
        <span className="sr-only" role="status">
          {landed ? `Picked ${landed.title}` : ''}
        </span>
      </div>

      {/* kind filter, only when there's more than one kind of thing in here */}
      {multiKind && (
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
          <button
            className={'cz-chip' + (kindFilter === '' ? ' cz-on' : '')}
            style={
              kindFilter === ''
                ? { background: 'var(--accent,#7c6af7)', color: 'var(--btn-text)' }
                : {}
            }
            onClick={() => setKindFilter('')}
          >
            All {inGroup.length}
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
          const voteCount = item.votes?.length ?? 0
          const isPick = landed?.id === item.id
          return (
            <div key={item.id} className={'cz-pool-row' + (isPick ? ' is-pick' : '')}>
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

              {/* who's up for it — initials, so a row stays one row */}
              <span className="cz-pool-votes">
                {voters.map((p) => {
                  const voted = (item.votes ?? []).includes(p.id)
                  const isMe = me?.id === p.id
                  return (
                    <button
                      key={p.id}
                      className={'cz-vote' + (isMe ? ' is-me' : '')}
                      onClick={() => toggleVote(item, p.id)}
                      title={`${isMe ? 'You' : p.name} ${voted ? '— remove vote' : '— up for it'}`}
                      aria-pressed={voted}
                      aria-label={`${p.name} up for ${item.title}`}
                      style={
                        {
                          background: voted ? p.color : 'transparent',
                          borderColor: p.color,
                          color: voted ? '#fff' : p.color,
                          opacity: voted ? 1 : 0.5,
                          /* the ring on your own circle, which must stay YOUR colour even
                             once the text has gone white on a filled chip */
                          '--vc': p.color,
                        } as CSSProperties
                      }
                    >
                      {p.name[0]?.toUpperCase()}
                    </button>
                  )
                })}
              </span>

              {voteCount > 0 && <span className="cz-pool-count">{voteCount}</span>}
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
            Everything you have all suggested or rated before — nothing fetched, nothing suggested
            by a machine.
          </p>
        </div>
      )}
    </div>
  )
}
