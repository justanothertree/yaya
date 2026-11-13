import { useEffect, useRef, useState } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { here } from '../lab/links'
import { daySeed } from './bricks'
import {
  BACKS,
  FELTS,
  GOLF_KEY,
  deal,
  left,
  over,
  playable,
  readSaved,
  score,
  solver,
  take,
  turn,
  type Game,
  type Saved,
} from './golf'
import { RANK_NAMES, SUITS, rankOf, suitOf, type Card } from './poker'
import { useKept } from './kept'

type Mode = 'today' | 'practice'
const BACK_NAMES: Record<Saved['back'], string> = {
  lattice: 'Lattice backs',
  stripes: 'Striped backs',
  stars: 'Starry backs',
}
const FELT_NAMES: Record<Saved['felt'], string> = { green: 'Green', blue: 'Blue', red: 'Red' }
const LONG = [
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'jack',
  'queen',
  'king',
  'ace',
]
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs']
const longName = (c: Card) => `${LONG[rankOf(c)]} of ${SUIT_NAMES[suitOf(c)]}`
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

function Face({ c }: { c: Card }) {
  const red = suitOf(c) === 1 || suitOf(c) === 2
  return (
    <span className={`pk-card gf-card${red ? ' is-red' : ''}`}>
      {/* rank and suit together along the top, the part of a card left showing in a column */}
      <span className="gf-corner">
        {RANK_NAMES[rankOf(c)]}
        {SUITS[suitOf(c)]}
      </span>
      <span className="gf-pip">{SUITS[suitOf(c)]}</span>
    </span>
  )
}

export function GolfDemo() {
  const [saved, setSaved] = useKept(GOLF_KEY, readSaved)
  const [mode, setMode] = useState<Mode>('today')
  const [seed, setSeed] = useState(() => daySeed(new Date()))
  const [game, setGame] = useState<Game>(() => deal(daySeed(new Date()), saved.wrap))
  const [par, setPar] = useState<{ best: number; exact: boolean } | null>(null)
  const [run, setRun] = useState(0)
  const [longest, setLongest] = useState(0)
  const [line, setLine] = useState(
    "Today's deal — the same for everyone today. Take a card one above or one below the card on the right.",
  )
  const [share, setShare] = useState('')
  const recorded = useRef(false)

  // par is worked out a slice at a time between frames, so the cards never wait for it
  useEffect(() => {
    setPar(null)
    const s = solver(deal(seed, game.wrap))
    let t = 0
    const slice = () => {
      const start = performance.now()
      while (performance.now() - start < 12) if (s.step(2000)) return setPar(s.result())
      t = window.setTimeout(slice, 0)
    }
    t = window.setTimeout(slice, 60)
    return () => window.clearTimeout(t)
    // a new deal is a new seed or a change of rule; the moves made do not change par
  }, [seed, game.wrap])

  const finish = (g: Game, longestRun: number) => {
    if (recorded.current) return
    recorded.current = true
    const s = score(g)
    const p = par?.best
    const day = daySeed(new Date())
    setSaved((x) => ({
      ...x,
      played: x.played + 1,
      cleared: x.cleared + (left(g) ? 0 : 1),
      best: x.best === null ? s : Math.min(x.best, s),
      onPar: x.onPar + (p !== undefined && s <= p ? 1 : 0),
      today:
        mode === 'today' && g.wrap === false
          ? { day, score: x.today && x.today.day === day ? Math.min(x.today.score, s) : s }
          : x.today,
    }))
    const parLine =
      p === undefined
        ? ''
        : s < p
          ? ` That beats par (${signed(p)}) — the solver missed something!`
          : s === p
            ? ` That is par: nobody could do better with this deal.`
            : ` Par was ${signed(p)}.`
    setLine(
      `${left(g) ? `No more moves: ${left(g)} ${left(g) === 1 ? 'card' : 'cards'} left` : `🏆 Cleared, with ${g.stock.length} still in the stock`} — you score ${signed(s)}.${parLine} Longest run ${longestRun}.`,
    )
    if (mode === 'today' && !g.wrap)
      setShare(
        `I scored ${signed(s)} on today's Golf deal${p !== undefined ? ` (par ${signed(p)})` : ''}, with a run of ${longestRun}. Beat it:\n${here()}#lab?demo=golf`,
      )
  }

  const after = (g: Game, r: number) => {
    setGame(g)
    const longestRun = Math.max(longest, r)
    setLongest(longestRun)
    if (over(g)) finish(g, longestRun)
  }
  const pick = (col: number) => {
    const g = take(game, col)
    if (g === game) {
      setLine(
        'That card is not next to the one on the right — it needs to be one above or one below.',
      )
      return
    }
    const r = run + 1
    setRun(r)
    setLine(r >= 5 ? `A run of ${r}!` : ' ')
    after(g, r)
  }
  const draw = () => {
    if (!game.stock.length) return
    setRun(0)
    setLine(' ')
    after(turn(game), 0)
  }

  const fresh = (m: Mode = mode, next?: number, wrap = saved.wrap) => {
    const sd = next ?? (m === 'today' ? daySeed(new Date()) : (Math.random() * 2 ** 31) | 0)
    recorded.current = false
    setMode(m)
    setSeed(sd)
    setGame(deal(sd, wrap))
    setRun(0)
    setLongest(0)
    setShare('')
    setLine(m === 'today' ? "Today's deal — the same for everyone today." : 'A new deal.')
  }

  const can = new Set(playable(game))
  const done = over(game)
  const wasteTop = game.waste[game.waste.length - 1]
  const day = daySeed(new Date())
  const todayScore = saved.today && saved.today.day === day ? saved.today.score : null

  return (
    <div className={`lab-keys gf-room is-${saved.felt}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Which deal">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'today'}
            onClick={() => fresh('today')}
          >
            Today's deal
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'practice'}
            onClick={() => fresh('practice')}
          >
            New deal
          </button>
        </div>
        <button className="btn btn-ghost" onClick={() => fresh(mode, seed)} disabled={!game.moves}>
          ↻ Start this deal again
        </button>
      </div>

      <div className="dice-scores gf-hud">
        <div className="dice-score">
          <span>In the columns</span>
          <strong>{left(game)}</strong>
        </div>
        <div className="dice-score">
          <span>In the stock</span>
          <strong>{game.stock.length}</strong>
        </div>
        <div className="dice-score">
          <span>Run</span>
          <strong>{run}</strong>
          <span className="muted">longest {longest}</span>
        </div>
        <div className="dice-score">
          <span>Par</span>
          <strong>{par ? signed(par.best) : '…'}</strong>
          <span className="muted">
            {par ? (par.exact ? 'the best possible' : 'the best found') : 'working it out'}
          </span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="gf-table">
        <div
          className="gf-cols"
          role="group"
          aria-label="The seven columns. Take the bottom card of a column."
        >
          {game.cols.map((col, i) => {
            const bottom = col[col.length - 1]
            const ok = can.has(i)
            return (
              <div key={i} className="gf-col">
                {col.slice(0, -1).map((c, k) => (
                  <span key={k} className="gf-under" aria-hidden>
                    <Face c={c} />
                  </span>
                ))}
                {bottom !== undefined ? (
                  <button
                    className={`gf-take${ok && saved.hints && !done ? ' is-ok' : ''}`}
                    aria-label={`Column ${i + 1}: ${longName(bottom)}${col.length > 1 ? `, ${col.length - 1} more above it` : ''}${ok ? ', can be taken' : ''}`}
                    onClick={() => pick(i)}
                    disabled={done}
                  >
                    <Face c={bottom} />
                  </button>
                ) : (
                  <span className="gf-empty" aria-hidden />
                )}
              </div>
            )
          })}
        </div>
        <div className="gf-pile">
          <button
            className={`gf-stock${!can.size && game.stock.length && saved.hints && !done ? ' is-ok' : ''}`}
            onClick={draw}
            disabled={!game.stock.length || done}
            aria-label={
              game.stock.length
                ? `Turn a card from the stock: ${game.stock.length} left`
                : 'The stock is empty'
            }
          >
            {game.stock.length ? (
              <span className={`pk-card gf-card is-back tw-back is-${saved.back}`}>
                <span className="gf-count">{game.stock.length}</span>
              </span>
            ) : (
              <span className="gf-empty" />
            )}
          </button>
          <div
            className="gf-waste"
            aria-live="off"
            aria-label={`On the waste: ${longName(wasteTop)}`}
            role="img"
          >
            {game.waste.length > 1 && (
              <span className="gf-prev" aria-hidden>
                <Face c={game.waste[game.waste.length - 2]} />
              </span>
            )}
            <span key={game.waste.length} className="gf-top" aria-hidden>
              <Face c={wasteTop} />
            </span>
          </div>
        </div>
      </div>
      {share && <CopyLink text={share} label="🔗 Copy my score" />}
      <p className="sun-reading">
        <span className="muted">
          Played {saved.played}, cleared {saved.cleared}, on par or better {saved.onPar}
          {saved.best !== null && <> · best {signed(saved.best)}</>}
          {todayScore !== null && <> · today {signed(todayScore)}</>}
        </span>
      </p>

      <div className="fw-panel">
        <section aria-label="Table and rules">
          <h3 className="fw-h">Table</h3>
          <div className="lab-controls" role="group" aria-label="Felt">
            {FELTS.map((f) => (
              <button
                key={f}
                className="btn btn-ghost"
                aria-pressed={saved.felt === f}
                onClick={() => setSaved((s) => ({ ...s, felt: f }))}
              >
                {FELT_NAMES[f]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Card backs">
            {BACKS.map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={saved.back === b}
                onClick={() => setSaved((s) => ({ ...s, back: b }))}
              >
                {BACK_NAMES[b]}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Lift the cards that can be taken
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={saved.wrap}
              onClick={() => {
                const wrap = !saved.wrap
                setSaved((s) => ({ ...s, wrap }))
                fresh(mode, seed, wrap)
              }}
            >
              King and ace are neighbours
            </button>
          </div>
          {saved.wrap && mode === 'today' && (
            <p className="muted mc-note">
              Today's score is kept for the plain rules only, so everybody plays the same game.
            </p>
          )}
        </section>
      </div>
      <p className="muted lab-hint">
        Take the bottom card of any column when it is one above or one below the card on the right —
        a seven on a six or an eight, say — and keep going as long as something fits. When nothing
        does, turn a card from the stock. An ace is low, so nothing goes on it but a two, unless
        king and ace are neighbours. Every card left in the columns at the end counts against you;
        clear them all and every card still in the stock counts for you. Lowest score wins. Par is
        the best this deal allows, found by trying every way through it. Today's deal is the same
        for everyone.
      </p>
    </div>
  )
}
