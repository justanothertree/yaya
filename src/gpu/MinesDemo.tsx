import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { here } from '../lab/links'
import { daySeed } from './bricks'
import {
  MARKS,
  MINES_KEY,
  SIZES,
  THEMES,
  chord,
  newGame,
  over,
  readSaved,
  reveal,
  toggleFlag,
  type Game,
  type Saved,
  type SizeName,
} from './mines'

type Mode = 'today' | 'practice'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(MINES_KEY))
  } catch {
    return readSaved(null)
  }
}
const SIZE_NAMES: Record<SizeName, string> = { small: 'Small', medium: 'Medium', large: 'Large' }
const THEME_NAMES: Record<Saved['theme'], string> = {
  meadow: 'Meadow',
  night: 'Night',
  sand: 'Sand',
}
const MARK_GLYPH: Record<Saved['mark'], string> = { flag: '🚩', flower: '🌸', star: '⭐' }
const MARK_NAMES: Record<Saved['mark'], string> = {
  flag: 'Flags',
  flower: 'Flowers',
  star: 'Stars',
}
/** today's board is a medium one, opened from its middle so everybody starts from the same place */
const TODAY_SIZE: SizeName = 'medium'
const middle = (n: SizeName) => {
  const s = SIZES[n]
  return Math.floor(s.h / 2) * s.w + Math.floor(s.w / 2)
}
const tenths = (ms: number) => Math.round(ms / 100)
const secs = (t: number) => `${(t / 10).toFixed(1)} s`

/** the running time, ticking on its own so the board is not drawn again ten times a second */
function Clock({ from, to }: { from: number | null; to: number | null }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (from === null || to !== null) return
    const t = window.setInterval(() => tick((n) => n + 1), 200)
    return () => window.clearInterval(t)
  }, [from, to])
  const ms = from === null ? 0 : (to ?? performance.now()) - from
  return <strong>{to !== null ? secs(tenths(ms)) : `${Math.floor(ms / 1000)} s`}</strong>
}

type CellProps = {
  i: number
  open: boolean
  flag: boolean
  mine: boolean
  count: number
  boom: boolean
  finished: boolean
  focus: boolean
  mark: string
  label: string
  onAct: (i: number, how: 'open' | 'flag') => void
  setRef: (i: number, el: HTMLButtonElement | null) => void
}
const Cell = memo(function Cell(p: CellProps) {
  const press = useRef<number | null>(null)
  const longDone = useRef(false)
  const showMine = p.finished && p.mine && !p.flag
  const wrongFlag = p.finished && p.flag && !p.mine
  return (
    <button
      ref={(el) => p.setRef(p.i, el)}
      className={[
        'mn-cell',
        p.open ? `is-open n${p.count}` : '',
        p.boom ? 'is-boom' : '',
        showMine ? 'is-mine' : '',
        wrongFlag ? 'is-wrong' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      tabIndex={p.focus ? 0 : -1}
      aria-label={p.label}
      onClick={() => {
        if (longDone.current) {
          longDone.current = false
          return
        }
        p.onAct(p.i, 'open')
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onAct(p.i, 'flag')
      }}
      // a long press flags, for a finger with no right button
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return
        longDone.current = false
        press.current = window.setTimeout(() => {
          longDone.current = true
          p.onAct(p.i, 'flag')
        }, 450)
      }}
      onPointerUp={() => press.current !== null && window.clearTimeout(press.current)}
      onPointerLeave={() => press.current !== null && window.clearTimeout(press.current)}
      onPointerCancel={() => press.current !== null && window.clearTimeout(press.current)}
    >
      <span aria-hidden>
        {p.open && p.count
          ? p.count
          : p.flag
            ? wrongFlag
              ? '✗'
              : p.mark
            : showMine || p.boom
              ? '✹'
              : ''}
      </span>
    </button>
  )
})

export function MinesDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('today')
  const startToday = () =>
    reveal(newGame(SIZES[TODAY_SIZE], daySeed(new Date())), middle(TODAY_SIZE))
  const [game, setGame] = useState<Game>(startToday)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [flagging, setFlagging] = useState(false)
  const [cursor, setCursor] = useState(() => middle(TODAY_SIZE))
  const [line, setLine] = useState(
    "Today's board — the same for everyone today, opened from the middle. The clock starts with your first square.",
  )
  const [share, setShare] = useState('')
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const scroller = useRef<HTMLDivElement | null>(null)
  // a board wider than the phone opens scrolled to its middle, where today's board starts
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }, [game.seed, game.size])
  useEffect(() => {
    try {
      localStorage.setItem(MINES_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const sizeName: SizeName = mode === 'today' ? TODAY_SIZE : saved.size
  const s = game.size
  const fresh = (m: Mode = mode, size: SizeName = saved.size) => {
    setMode(m)
    setFrom(null)
    setTo(null)
    setShare('')
    if (m === 'today') {
      setGame(startToday())
      setCursor(middle(TODAY_SIZE))
      setLine(
        "Today's board — the same for everyone today. The clock starts with your first square.",
      )
    } else {
      setGame(newGame(SIZES[size], (Math.random() * 2 ** 31) | 0))
      setCursor(middle(size))
      setLine('Open any square: the first is always safe, and opens an area.')
    }
  }

  const finish = (g: Game, t0: number) => {
    const end = performance.now()
    setTo(end)
    const t = tenths(end - t0)
    if (g.won) {
      const prev = saved.best[sizeName]
      const day = daySeed(new Date())
      setSaved((x) => ({
        ...x,
        played: x.played + 1,
        won: x.won + 1,
        best: { ...x.best, [sizeName]: Math.min(x.best[sizeName] ?? Infinity, t) },
        today:
          mode === 'today'
            ? { day, tenths: x.today && x.today.day === day ? Math.min(x.today.tenths, t) : t }
            : x.today,
      }))
      setLine(
        `🏆 Cleared in ${secs(t)}${prev === undefined || t < prev ? ' — your best on this size!' : `. Your best is ${secs(prev)}.`}`,
      )
      if (mode === 'today')
        setShare(`I cleared today's Mines board in ${secs(t)}. Your go:\n${here()}#lab?demo=mines`)
    } else {
      setSaved((x) => ({ ...x, played: x.played + 1 }))
      setLine(
        `Boom — a mine, ${secs(t)} in. Every board here can be cleared without a guess, so the clue was there.`,
      )
    }
  }

  // read inside the cells' one stable handler, so a cell is drawn again only when it changes
  const live = useRef({ game, flagging, from })
  live.current = { game, flagging, from }
  const act = useRef((i: number, how: 'open' | 'flag') => {
    const { game: g, flagging: fl, from: f } = live.current
    if (over(g)) return
    const t0 = f ?? performance.now()
    if (f === null) setFrom(t0)
    let next: Game
    if (how === 'flag' || (fl && !g.open[i])) next = toggleFlag(g, i)
    else if (g.open[i]) next = chord(g, i)
    else next = reveal(g, i)
    if (next === g) return
    setGame(next)
    setCursor(i)
    if (over(next)) finishRef.current(next, t0)
  }).current
  // the handler above was made once, so what it calls at the end is kept current here
  const finishRef = useRef(finish)
  finishRef.current = finish
  const setRef = useRef((i: number, el: HTMLButtonElement | null) => {
    refs.current[i] = el
  }).current

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key.toLowerCase()
    const d: Record<string, [number, number]> = {
      arrowup: [0, -1],
      arrowdown: [0, 1],
      arrowleft: [-1, 0],
      arrowright: [1, 0],
    }
    if (d[k]) {
      e.preventDefault()
      e.stopPropagation()
      const x = Math.max(0, Math.min(s.w - 1, (cursor % s.w) + d[k][0]))
      const y = Math.max(0, Math.min(s.h - 1, Math.floor(cursor / s.w) + d[k][1]))
      const next = y * s.w + x
      setCursor(next)
      refs.current[next]?.focus()
    } else if (k === 'f') {
      e.preventDefault()
      act(cursor, 'flag')
    }
  }

  const finished = over(game)
  const flags = game.flag.filter(Boolean).length
  const day = daySeed(new Date())
  const todayBest = saved.today && saved.today.day === day ? saved.today.tenths : null
  const best = saved.best[sizeName]
  const labelOf = (i: number) => {
    const where = `Row ${Math.floor(i / s.w) + 1}, column ${(i % s.w) + 1}`
    if (game.open[i])
      return `${where}: ${game.count[i] ? `${game.count[i]} ${game.count[i] === 1 ? 'mine' : 'mines'} next to it` : 'clear'}`
    if (game.flag[i])
      return `${where}: marked${finished && game.mine && !game.mine[i] ? ', wrongly' : ''}`
    if (finished && game.mine?.[i]) return `${where}: a mine`
    return `${where}: hidden`
  }

  return (
    <div className={`lab-keys mn-room is-${saved.theme}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Which board">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'today'}
            onClick={() => fresh('today')}
          >
            Today's board
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'practice'}
            onClick={() => fresh('practice')}
          >
            Practice
          </button>
        </div>
        {mode === 'practice' && (
          <div className="lab-group" role="group" aria-label="Size">
            {(Object.keys(SIZES) as SizeName[]).map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={saved.size === n}
                aria-label={`${SIZE_NAMES[n]}: ${SIZES[n].w} by ${SIZES[n].h}, ${SIZES[n].mines} mines`}
                onClick={() => {
                  setSaved((x) => ({ ...x, size: n }))
                  fresh('practice', n)
                }}
              >
                {SIZE_NAMES[n]}
              </button>
            ))}
          </div>
        )}
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ {mode === 'today' ? 'Start again' : 'New board'}
        </button>
        <button className="btn" aria-pressed={flagging} onClick={() => setFlagging((f) => !f)}>
          {flagging ? `${MARK_GLYPH[saved.mark]} Marking` : '⛏ Opening'}
        </button>
      </div>

      <div className="dice-scores mn-hud">
        <div className="dice-score">
          <span>Time</span>
          <Clock from={from} to={to} />
        </div>
        <div className="dice-score">
          <span>Mines left</span>
          <strong>{s.mines - flags}</strong>
        </div>
        <div className="dice-score">
          <span>
            {mode === 'today' ? 'Best today' : `Best on ${SIZE_NAMES[sizeName].toLowerCase()}`}
          </span>
          <strong>
            {mode === 'today'
              ? todayBest !== null
                ? secs(todayBest)
                : '—'
              : best !== undefined
                ? secs(best)
                : '—'}
          </strong>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="mn-scroll" ref={scroller}>
        <div
          className="mn-board"
          style={{ gridTemplateColumns: `repeat(${s.w}, var(--mn-cell))` }}
          role="group"
          aria-label={`The board, ${s.w} across and ${s.h} down. Arrow keys move, Enter opens, F marks a mine.`}
          onKeyDown={onKey}
        >
          {game.open.map((o, i) => (
            <Cell
              key={i}
              i={i}
              open={o}
              flag={game.flag[i]}
              mine={!!game.mine?.[i]}
              count={game.count[i]}
              boom={game.boom === i}
              finished={finished}
              focus={i === cursor}
              mark={MARK_GLYPH[saved.mark]}
              label={labelOf(i)}
              onAct={act}
              setRef={setRef}
            />
          ))}
        </div>
      </div>
      {share && <CopyLink text={share} label="🔗 Copy my time" />}
      <p className="sun-reading">
        <span className="muted">
          Cleared {saved.won} of {saved.played}
          {(Object.keys(SIZES) as SizeName[])
            .filter((n) => saved.best[n] !== undefined)
            .map((n) => ` · ${SIZE_NAMES[n].toLowerCase()} ${secs(saved.best[n]!)}`)
            .join('')}
        </span>
      </p>

      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Ground and marks</h3>
          <div className="lab-controls" role="group" aria-label="Ground">
            {THEMES.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={saved.theme === t}
                onClick={() => setSaved((x) => ({ ...x, theme: t }))}
              >
                {THEME_NAMES[t]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Marks">
            {MARKS.map((m) => (
              <button
                key={m}
                className="btn btn-ghost"
                aria-pressed={saved.mark === m}
                onClick={() => setSaved((x) => ({ ...x, mark: m }))}
              >
                {MARK_GLYPH[m]} {MARK_NAMES[m]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Open a square to see how many of the eight around it hold a mine; open a mine and it is
        over. Mark the squares you know are mines — right-click, a long press, F on the keyboard, or
        switch to marking — and open a number whose mines are all marked to open everything else
        around it. Every board here can be cleared by reasoning alone, never a guess: each one is
        checked by playing it through before you see it. Today's board is the same for everyone,
        opened from the middle; the clock starts with your first move.
      </p>
    </div>
  )
}
