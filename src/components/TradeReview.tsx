import { useMemo, useState } from 'react'
import type { RecentReview } from '../finance/portfolio'
import {
  answerLabel,
  brokerName,
  groupForReview,
  partOf,
  partPreview,
  type ReviewTrade,
} from '../finance/reviewGroups'

/**
 * "Was any of this for the family?" — the screen that moves real money with one tap.
 *
 * ⚠️ IT IS A COMPONENT OF ITS OWN SO THAT SOMETHING CAN LOOK AT IT. It lived inside ImportPanel,
 * which reaches for `getSupabaseClient()` directly — and the only workbench that renders that
 * panel, `#dev-admin`, has no token, so every RPC answered nothing and the review list was always
 * empty. A room with nothing in it passes every check there is. Here the data arrives as props
 * and the writes leave as callbacks, so `#dev-admin` can hand it invented trades and the layout
 * can be measured at 375 like anything else.
 *
 * ⚠️ AND THE ARITHMETIC IS NOT IN HERE EITHER. Grouping, the Part… parse and the answer labels
 * are in `src/finance/reviewGroups.ts` with their own tests — including the one the old
 * `window.prompt` version got wrong, where "12 or 13" was stripped to 1213 and acted on.
 *
 * What this file owns is interaction state: which Part… box is open, which rows are in flight,
 * which group is also settling its symbol. The caller owns the RPCs.
 */

/** How many review rows are shown before "show more". */
const REVIEW_WINDOW = 12

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export type TradeReviewProps = {
  /** the backlog, newest first, already capped by the caller's RPC */
  trades: ReviewTrade[]
  /**
   * How deep the backlog really is.
   *
   * ⚠️ FROM THE SERVER, NOT FROM `trades.length`. The list is capped at 200, so a deeper backlog
   * would have described itself as exactly 200 — a number that looks precise and is a ceiling.
   */
  total: number
  /** the last answers, so one can be changed */
  recent: RecentReview[]
  /** answer one or many trades with the same fraction; resolves when the writes are done */
  onAnswer: (ids: string[], fraction: number) => Promise<void>
  /** settle the symbol itself, so the question does not come back on the next import */
  onDesignate: (symbol: string, platform: string, family: boolean) => Promise<void>
  error?: string | null
}

export function TradeReview({
  trades,
  total,
  recent,
  onAnswer,
  onDesignate,
  error,
}: TradeReviewProps) {
  const [limit, setLimit] = useState(REVIEW_WINDOW)
  /** answered in THIS session: they stay on screen with a ✓ rather than vanishing as you tap */
  const [decided, setDecided] = useState<Record<string, number>>({})
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({})
  /**
   * ⚠️ PER ROW, NOT ONE BANNER AT THE TOP. A failure used to render once above the whole list, so
   * the row that actually failed looked identical to the fourteen that worked — and with the
   * answers one tap apart, the banner was usually about a row already scrolled past.
   */
  const [rowErr, setRowErr] = useState<Record<string, string>>({})
  const [partFor, setPartFor] = useState<string | null>(null)
  const [partVal, setPartVal] = useState('')
  const [alsoDesignate, setAlsoDesignate] = useState<Record<string, boolean>>({})
  const [showRecent, setShowRecent] = useState(false)

  const shown = trades.slice(0, limit)
  const remaining = trades.length - shown.length
  /**
   * ⚠️ GROUPED INSIDE THE WINDOW RATHER THAN ACROSS THE WHOLE BACKLOG, so "All 7 SOFI trades"
   * never promises more than is on screen. A bulk button that silently reached past the dozen
   * being shown would answer trades the person had not seen — the one thing this screen must not
   * do.
   */
  const groups = useMemo(() => groupForReview(shown), [shown])
  const pending = trades.filter((t) => decided[t.id] == null).length
  const backlog = Math.max(0, total - (trades.length - pending))

  async function answer(key: string, ids: string[], fraction: number) {
    setInFlight((b) => ({ ...b, [key]: true }))
    setRowErr((e) => ({ ...e, [key]: '' }))
    try {
      await onAnswer(ids, fraction)
      setDecided((d) => {
        const next = { ...d }
        for (const id of ids) next[id] = fraction
        return next
      })
    } catch (e) {
      setRowErr((er) => ({ ...er, [key]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setInFlight((b) => ({ ...b, [key]: false }))
    }
  }

  /**
   * ⚠️ THE DESIGNATION GOES LAST, AFTER the trades, and this order is the whole safety of it.
   * Flipping a symbol to family runs `admin_even_split_trades`, which sweeps up every unallocated
   * family-designated trade — so doing it first would catch these very rows and split them 33
   * ways before the answer given here was applied, turning "mine" into "theirs" silently. Done
   * last, there is nothing left for it to find.
   */
  async function answerGroup(
    key: string,
    ids: string[],
    fraction: number,
    symbol: string,
    platform: string,
  ) {
    await answer(key, ids, fraction)
    if (!alsoDesignate[key]) return
    setInFlight((b) => ({ ...b, [key]: true }))
    try {
      await onDesignate(symbol, platform, fraction > 0)
    } catch (e) {
      setRowErr((er) => ({ ...er, [key]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setInFlight((b) => ({ ...b, [key]: false }))
    }
  }

  return (
    <div className="card import-review">
      {backlog > 0 ? (
        <>
          <strong>
            {backlog} trade{backlog === 1 ? '' : 's'} — was any of this for the family?
          </strong>
          <p className="muted" style={{ margin: '0.2rem 0 0.6rem', fontSize: '0.82rem' }}>
            Everything since the fund started on a symbol you haven&apos;t already settled one way
            or the other. Anything in a symbol you&apos;ve marked family was split automatically;
            these are the ones nothing decided for you. Answering &ldquo;mine&rdquo; is a real
            answer — it won&apos;t be asked again.
          </p>
        </>
      ) : (
        /* ⚠️ THE CARD STAYS WHEN THE BACKLOG EMPTIES. It used to render only while something was
           waiting, so the ✓ for the last answer vanished as it was tapped and the card went with
           it — no confirmation, and no way back to anything. */
        <strong>All caught up ✓</strong>
      )}
      {error && <p className="import-err">{error}</p>}

      {groups.map((g) => {
        const waiting = g.trades.filter((t) => decided[t.id] == null)
        /**
         * ⚠️ A ROW IN FLIGHT LOCKS ITS GROUP'S BULK BUTTONS TOO, which is not obvious until you
         * watch a slow write: pressing "Mine" on one row and then "All 7 theirs" before it lands
         * answers that trade TWICE with different fractions. `admin_set_trade_allocation`
         * replaces rather than adds, so the end state is whichever reply arrives last — which is
         * a race deciding whose shares those are. Found by driving #dev-review with the slow-write
         * toggle on; the buttons were disabled per row and nothing joined them up.
         */
        const groupBusy = inFlight[g.key] === true || g.trades.some((t) => inFlight[t.id] === true)
        return (
          <div key={g.key} className="import-review-group">
            <div className="import-review-head">
              <span>
                <strong>{g.symbol}</strong> <span className="import-broker">{g.broker}</span>{' '}
                <span className="muted">
                  {g.trades.length} trade{g.trades.length === 1 ? '' : 's'} · {usd(g.dollars)}
                  {/* ⚠️ "they already hold some" said nothing actionable. The number is the point:
                      it is what tells you this symbol is already part family and the answer
                      probably matches what was done before. */}
                  {g.alreadyHeld > 0 && ` · family already holds ${g.alreadyHeld.toFixed(4)} sh`}
                </span>
              </span>
              {waiting.length > 1 && (
                <span className="import-review-actions">
                  <button
                    className="btn btn-ghost"
                    disabled={groupBusy}
                    onClick={() =>
                      void answerGroup(
                        g.key,
                        waiting.map((t) => t.id),
                        0,
                        g.symbol,
                        g.platform,
                      )
                    }
                  >
                    All {waiting.length} mine
                  </button>
                  <button
                    className="btn"
                    disabled={groupBusy}
                    onClick={() =>
                      void answerGroup(
                        g.key,
                        waiting.map((t) => t.id),
                        1,
                        g.symbol,
                        g.platform,
                      )
                    }
                  >
                    All {waiting.length} theirs
                  </button>
                </span>
              )}
            </div>

            {/**
             * ⚠️ IT SETTLES THE SYMBOL, NOT JUST THESE ROWS (plan P3.4). Without it the same
             * question returns on the next import, because designation is what makes future
             * trades split automatically. Off by default: turning a symbol family is the one
             * action here whose undo destroys more than it created.
             */}
            {waiting.length > 0 && (
              <label className="import-review-also">
                <input
                  type="checkbox"
                  checked={alsoDesignate[g.key] === true}
                  onChange={(e) => setAlsoDesignate((d) => ({ ...d, [g.key]: e.target.checked }))}
                />
                <span>
                  …and from now on treat {g.symbol} ({g.broker}) the same way
                </span>
              </label>
            )}

            {g.trades.map((t) => {
              const done = decided[t.id]
              const rowBusy = inFlight[t.id] === true || groupBusy
              const typed = partFor === t.id ? partOf(t.dollars, partVal) : null
              return (
                <div key={t.id} className="import-review-row">
                  <span className="muted">
                    {t.date} · {usd(t.dollars)} · {t.units.toFixed(4)} units
                  </span>
                  {done == null ? (
                    <span className="import-review-actions">
                      <button
                        className="btn btn-ghost"
                        disabled={rowBusy}
                        onClick={() => void answer(t.id, [t.id], 0)}
                      >
                        Mine
                      </button>
                      <button
                        className="btn"
                        disabled={rowBusy}
                        onClick={() => void answer(t.id, [t.id], 1)}
                      >
                        All theirs
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={rowBusy}
                        aria-expanded={partFor === t.id}
                        onClick={() => {
                          setPartVal('')
                          setPartFor((cur) => (cur === t.id ? null : t.id))
                        }}
                      >
                        {partFor === t.id ? '✕' : 'Part…'}
                      </button>
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: '0.82rem', marginLeft: 'auto' }}>
                      {done === 0
                        ? 'kept yours ✓'
                        : done === 1
                          ? 'all theirs ✓'
                          : `${(done * 100).toFixed(0)}% theirs ✓`}
                    </span>
                  )}

                  {/**
                   * ⚠️ AN INLINE FIELD RATHER THAN `window.prompt`. prompt is blocked outright in
                   * some in-app browsers, is clumsy on a phone, and showed no preview — so the
                   * 33-person result was invisible until after it had been written. It also
                   * stripped every character it disliked, which turned "12 or 13" into 1213 and
                   * acted on it; `partOf` refuses that, and the test for it is in
                   * reviewGroups.test.ts.
                   */}
                  {partFor === t.id && done == null && (
                    <div className="import-part">
                      <label>
                        <span className="muted">How much of it was theirs?</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={partVal}
                          placeholder={`up to ${usd(Math.abs(t.dollars))}`}
                          onChange={(e) => setPartVal(e.target.value)}
                        />
                      </label>
                      <p className="muted import-part-preview">
                        {typed?.ok
                          ? partPreview(t, typed.fraction)
                          : (typed?.why ?? 'Type a dollar amount.')}
                      </p>
                      <button
                        className="btn"
                        disabled={rowBusy || !typed?.ok}
                        onClick={() => {
                          if (!typed?.ok) return
                          setPartFor(null)
                          void answer(t.id, [t.id], typed.fraction)
                        }}
                      >
                        Split it that way
                      </button>
                    </div>
                  )}
                  {rowErr[t.id] && <p className="import-err">{rowErr[t.id]}</p>}
                </div>
              )
            })}
            {rowErr[g.key] && <p className="import-err">{rowErr[g.key]}</p>}
          </div>
        )
      })}

      {remaining > 0 && (
        <button
          className="btn btn-ghost"
          style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}
          onClick={() => setLimit((n) => n + REVIEW_WINDOW)}
        >
          Show {Math.min(REVIEW_WINDOW, remaining)} more · {remaining} still to sort
        </button>
      )}

      {/**
       * ⚠️ THE ONLY WAY BACK TO AN ANSWER. Every list on this screen is defined by
       * `reviewed_at is null`, so answering a trade is what removes it from view — until this,
       * no screen anywhere could show what had just been decided. Measured 29 Oct 2026: 103
       * trades were answered in about seven minutes, 109 of the 113 ever answered say "Mine".
       * A wrong "Mine" means the family quietly does not own something.
       */}
      {recent.length > 0 && (
        <div className="import-recent">
          <button
            className="btn btn-ghost"
            aria-expanded={showRecent}
            onClick={() => setShowRecent((v) => !v)}
          >
            Recently answered ({recent.length}) {showRecent ? '▾' : '▸'}
          </button>
          {showRecent &&
            recent.map((r) => (
              <div key={r.id} className="import-review-row">
                <span className="muted">
                  <strong>{r.symbol}</strong>{' '}
                  <span className="import-broker">{brokerName(r.platform)}</span> {r.date} ·{' '}
                  {usd(r.dollars)} · {decided[r.id] == null ? answerLabel(r) : 'changed ✓'}
                </span>
                <span className="import-review-actions">
                  <button
                    className="btn btn-ghost"
                    disabled={inFlight[r.id] === true}
                    onClick={() => void answer(r.id, [r.id], 0)}
                  >
                    Mine
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={inFlight[r.id] === true}
                    onClick={() => void answer(r.id, [r.id], 1)}
                  >
                    All theirs
                  </button>
                </span>
                {rowErr[r.id] && <p className="import-err">{rowErr[r.id]}</p>}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
