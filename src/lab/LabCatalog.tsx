import { useEffect, useMemo, useRef } from 'react'
import {
  CATEGORIES,
  EVERYTHING,
  arrange,
  showingAll,
  surprise,
  withoutName,
  type Browse,
  type Category,
  type Entry,
  type View,
} from './catalog'

const VIEWS: { id: View; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'recent', label: '🕘 Recent' },
  { id: 'favourites', label: '★ Favourites' },
  { id: 'new', label: '🆕 New' },
  { id: 'top', label: '👍 Highly rated' },
]

type Props = {
  list: readonly Entry[]
  current: string
  favourites: readonly string[]
  /** opened lately in this browser, most recent first */
  recent: readonly string[]
  /** may this viewer see vote totals: a signed-in member, with the server reachable */
  rated: boolean
  admin: boolean
  /** the search, list and kind — held by the Lab, so they outlast a visit to a toy */
  browse: Browse
  onBrowse: (b: Browse) => void
  /** come back from a toy launched here: the card it was launched from is put back in view */
  returning: boolean
  onFavourite: (id: string) => void
  onLaunch: (id: string) => void
}

/**
 * Every experiment as a card to read and launch — and nothing running while you read. The Lab
 * unmounts its current experiment while this is open, so browsing costs no GPU at all: a card is
 * text, and an experiment starts only when one is chosen.
 */
export function LabCatalog({
  list,
  current,
  favourites,
  recent,
  rated,
  admin,
  browse,
  onBrowse,
  returning,
  onFavourite,
  onLaunch,
}: Props) {
  const { query, view, category } = browse
  const set = (patch: Partial<Browse>) => onBrowse({ ...browse, ...patch })
  const searchBox = useRef<HTMLInputElement | null>(null)
  const cards = useRef<HTMLUListElement | null>(null)
  const kind = useRef<HTMLSelectElement | null>(null)
  /* Back from a toy, the card it was launched from is where the eye left it — scrolled to and
     focused, so Tab and Enter carry on from there, as a browser's Back would. Otherwise opening
     the catalog is usually to look for something, and the cursor waits in the search box — with
     a mouse only, since on a phone focusing it would throw the keyboard over the list. */
  useEffect(() => {
    const go = returning
      ? cards.current?.querySelector<HTMLButtonElement>(
          `[data-id="${CSS.escape(current)}"] .lab-card-go`,
        )
      : null
    if (go) {
      go.scrollIntoView({ block: 'center' })
      go.focus({ preventScroll: true })
    } else if (window.matchMedia?.('(pointer: fine)').matches) searchBox.current?.focus()
    // once, as the catalog opens: a card moving under a later filter is not a reason to jump
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = useMemo(
    () => arrange(list, browse, favourites, recent),
    [list, browse, favourites, recent],
  )

  const rule =
    view === 'top'
      ? rated
        ? 'Ordered by 👍 minus 👎, then by more votes; ones nobody has voted on come last. Every member’s vote counts.'
        : 'Sign in to see how members rated them — until then this is the Lab’s own order.'
      : view === 'new'
        ? 'Newest first, by the day each was added.'
        : view === 'recent'
          ? `The last ${recent.length === 1 ? 'one' : recent.length} you opened, most recent first — remembered in this browser only.`
          : view === 'favourites'
            ? 'Your favourites are kept in this browser only, and never sent anywhere.'
            : 'Featured first, then in the order they were added.'

  const empty =
    view === 'favourites' && !favourites.length
      ? 'No favourites yet — press ☆ on any experiment to keep it here.'
      : view === 'recent' && !recent.length
        ? 'Nothing opened yet — the experiments you open will be listed here.'
        : query
          ? `Nothing matches “${query}”.`
          : 'Nothing here.'

  return (
    <div className="lab-catalog">
      <div className="lab-controls">
        <label className="lab-search">
          <span className="sr-only">Search the experiments</span>
          <input
            ref={searchBox}
            type="search"
            value={query}
            placeholder="Search — try “music” or “puzzle”"
            onChange={(e) => set({ query: e.target.value.slice(0, 60) })}
          />
        </label>
        <button
          className="btn"
          disabled={!shown.length}
          onClick={() => {
            const id = surprise(shown, recent)
            if (id) onLaunch(id)
          }}
        >
          🎲 Surprise me
        </button>
        <div className="lab-group" role="group" aria-label="Which list">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className="btn btn-ghost"
              aria-pressed={view === v.id}
              onClick={() => set({ view: v.id })}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="lab-controls">
        {/* a native dropdown rather than a row of five buttons: on a phone those were three rows
            of chips before the first card */}
        <label className="studio-pick">
          <span className="muted">Kind</span>
          <select
            ref={kind}
            value={category ?? ''}
            onChange={(e) => set({ category: (e.target.value || null) as Category | null })}
          >
            <option value="">Every kind ({list.length})</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({list.filter((e) => e.category === c.id).length})
              </option>
            ))}
          </select>
        </label>
        {/* kept between visits to toys, so a list left narrowed comes back narrowed — and the
            way back to everything has to be as plain as the narrowing was */}
        {!showingAll(browse) && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              onBrowse(EVERYTHING)
              // the button goes with the filters, and focus must not go with it to the page
              // itself: the search with a mouse, the kind under a finger (no keyboard thrown up)
              if (window.matchMedia?.('(pointer: fine)').matches) searchBox.current?.focus()
              else kind.current?.focus()
            }}
          >
            ✕ Show everything
          </button>
        )}
      </div>
      <p className="muted lab-hint" aria-live="polite">
        {shown.length} of {list.length}. {rule}
      </p>
      {shown.length ? (
        <ul className="lab-cards" ref={cards}>
          {shown.map((e) => (
            <Card
              key={e.id}
              entry={e}
              current={e.id === current}
              favourite={favourites.includes(e.id)}
              rated={rated}
              admin={admin}
              onFavourite={onFavourite}
              onLaunch={onLaunch}
            />
          ))}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </div>
  )
}

function Card({
  entry: e,
  current,
  favourite,
  rated,
  admin,
  onFavourite,
  onLaunch,
}: {
  entry: Entry
  current: boolean
  favourite: boolean
  rated: boolean
  admin: boolean
  onFavourite: (id: string) => void
  onLaunch: (id: string) => void
}) {
  const up = e.flags.up ?? 0
  const down = e.flags.down ?? 0
  return (
    <li className="lab-card" data-id={e.id} data-current={current || undefined}>
      <div className="lab-card-head">
        <button className="btn lab-card-go" onClick={() => onLaunch(e.id)}>
          ▶ {e.name}
        </button>
        <button
          className="btn btn-ghost lab-card-fav"
          aria-pressed={favourite}
          aria-label={
            favourite ? `Remove ${e.name} from favourites` : `Add ${e.name} to favourites`
          }
          onClick={() => onFavourite(e.id)}
        >
          {favourite ? '★' : '☆'}
        </button>
      </div>
      <p className="lab-card-line">{withoutName(e)}</p>
      <p className="lab-card-meta muted">
        <span>{CATEGORIES.find((c) => c.id === e.category)?.label}</span>
        {e.flags.featured && <span className="lab-badge">⭐ Featured</span>}
        {e.flags.experiment && <span className="lab-badge">🧪 Rough edges</span>}
        {admin && e.flags.hidden && <span className="lab-badge lab-badge-off">🙈 Hidden</span>}
        {/* not "Playing": the catalog unmounts the toy while it is open, so nothing is */}
        {current && <span className="lab-badge">Last open</span>}
        {rated && <span>{`👍 ${up} · 👎 ${down}`}</span>}
        {e.flags.mine && <span className="lab-badge">You: {e.flags.mine === 1 ? '👍' : '👎'}</span>}
      </p>
    </li>
  )
}
