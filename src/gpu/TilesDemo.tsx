import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { here } from '../lab/links'
import { daySeed } from './bricks'
import {
  LAYOUTS,
  PENALTY,
  STYLES,
  TILES_KEY,
  cleared,
  colourOf,
  deal,
  free,
  pairs,
  readSaved,
  shapeOf,
  shuffle,
  take,
  type Board,
  type Saved,
} from './tiles'

type Mode = 'today' | 'practice'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(TILES_KEY))
  } catch {
    return readSaved(null)
  }
}
const STYLE_NAMES: Record<Saved['style'], string> = { ivory: 'Ivory', jade: 'Jade', night: 'Night' }
const SHAPE_NAMES = ['circle', 'triangle', 'square', 'diamond', 'star', 'heart']
/** a kind is a shape and how many of it: one, two or three — never told apart by colour alone */
const kindName = (k: number) =>
  `${['one', 'two', 'three'][colourOf(k)]} ${SHAPE_NAMES[k % 6]}${colourOf(k) ? 's' : ''}`
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function Clock({ from, to, extra }: { from: number | null; to: number | null; extra: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (from === null || to !== null) return
    const t = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(t)
  }, [from, to])
  const s = from === null ? 0 : Math.floor(((to ?? performance.now()) - from) / 1000)
  return <strong>{fmt(s + extra)}</strong>
}

export function TilesDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('today')
  const layoutFor = (m: Mode, id: string) =>
    m === 'today'
      ? LAYOUTS[daySeed(new Date()) % LAYOUTS.length]
      : (LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0])
  const [board, setBoard] = useState<Board>(() =>
    deal(layoutFor('today', saved.layout), daySeed(new Date())),
  )
  const [history, setHistory] = useState<Board[]>([])
  const [picked, setPicked] = useState<number | null>(null)
  const [hint, setHint] = useState<[number, number] | null>(null)
  const [extra, setExtra] = useState(0)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [line, setLine] = useState(
    "Today's tiles — the same for everyone today. Take matching free pairs: nothing on top, and one side open.",
  )
  const [share, setShare] = useState('')
  const [cursor, setCursor] = useState(-1)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    try {
      localStorage.setItem(TILES_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const places = board.layout.places
  const isFree = (i: number) => free(places, board.filled, i)
  const open = pairs(board)
  const left = board.filled.filter(Boolean).length

  const fresh = (m: Mode = mode, id: string = saved.layout) => {
    const l = layoutFor(m, id)
    setMode(m)
    setBoard(deal(l, m === 'today' ? daySeed(new Date()) : (Math.random() * 2 ** 31) | 0))
    setHistory([])
    setPicked(null)
    setHint(null)
    setExtra(0)
    setFrom(null)
    setTo(null)
    setShare('')
    setCursor(-1)
    setLine(
      m === 'today'
        ? `Today's tiles: ${l.name}, the same for everyone today.`
        : `${l.name}. Take matching free pairs.`,
    )
  }

  const win = (b: Board, t0: number) => {
    const end = performance.now()
    setTo(end)
    const secs = Math.floor((end - t0) / 1000) + extra
    const id = b.layout.id
    const prev = saved.best[id]
    const day = daySeed(new Date())
    setSaved((s) => ({
      ...s,
      cleared: s.cleared + 1,
      best: { ...s.best, [id]: Math.min(s.best[id] ?? Infinity, secs) },
      today:
        mode === 'today'
          ? {
              day,
              seconds: s.today && s.today.day === day ? Math.min(s.today.seconds, secs) : secs,
            }
          : s.today,
    }))
    setLine(
      `🏆 Cleared in ${fmt(secs)}${prev === undefined || secs < prev ? ` — your best on ${b.layout.name}!` : `. Your best there is ${fmt(prev)}.`}`,
    )
    if (mode === 'today')
      setShare(`I cleared today's Tile pairs in ${fmt(secs)}. Your go:\n${here()}#lab?demo=tiles`)
  }

  const tap = (i: number) => {
    if (to !== null || !board.filled[i]) return
    setCursor(i)
    if (!isFree(i)) {
      setLine(
        'That tile is held in: something is on top of it, or it has neighbours on both sides.',
      )
      return
    }
    if (picked === null || picked === i) {
      setPicked(picked === i ? null : i)
      return
    }
    if (board.kind[picked] !== board.kind[i]) {
      setPicked(i)
      setLine(`Not a pair — ${kindName(board.kind[picked])} and ${kindName(board.kind[i])}.`)
      return
    }
    const t0 = from ?? performance.now()
    if (from === null) setFrom(t0)
    const next = take(board, picked, i)
    setHistory((h) => [...h, board])
    setBoard(next)
    setPicked(null)
    setHint(null)
    if (cleared(next)) return win(next, t0)
    const n = pairs(next).length
    setLine(
      n
        ? `${next.filled.filter(Boolean).length} tiles left, ${n} ${n === 1 ? 'pair' : 'pairs'} free.`
        : `No free pairs left — shuffle the rest (+${PENALTY} s).`,
    )
  }
  const useHint = () => {
    if (!open.length || to !== null) return
    setHint(open[0])
    setExtra((e) => e + PENALTY)
    setLine(`A pair is lit: ${kindName(board.kind[open[0][0]])}. (+${PENALTY} s)`)
  }
  const doShuffle = () => {
    if (to !== null || !left) return
    setHistory((h) => [...h, board])
    setBoard(shuffle(board, (Math.random() * 2 ** 31) | 0))
    setExtra((e) => e + PENALTY)
    setPicked(null)
    setHint(null)
    setLine(`Shuffled — every tile left can still be cleared. (+${PENALTY} s)`)
  }
  const undo = () => {
    if (!history.length || to !== null) return
    setBoard(history[history.length - 1])
    setHistory((h) => h.slice(0, -1))
    setPicked(null)
    setHint(null)
  }

  // arrow keys hop between free tiles, to the nearest one that way
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }
    if (!d[e.key]) return
    e.preventDefault()
    e.stopPropagation()
    const frees = board.filled.map((_, i) => i).filter(isFree)
    if (!frees.length) return
    const here_ = cursor >= 0 && board.filled[cursor] ? places[cursor] : null
    let best = frees[0]
    if (here_) {
      let bd = Infinity
      for (const j of frees) {
        const dx = places[j].x - here_.x
        const dy = places[j].y - here_.y
        const along = dx * d[e.key][0] + dy * d[e.key][1]
        if (along <= 0) continue
        const dist = along + Math.abs(dx * d[e.key][1] - dy * d[e.key][0]) * 2
        if (dist < bd) {
          bd = dist
          best = j
        }
      }
      if (bd === Infinity) best = cursor
    }
    setCursor(best)
    refs.current[best]?.focus()
  }

  const W = Math.max(...places.map((p) => p.x)) / 2 + 1
  const H = Math.max(...places.map((p) => p.y)) / 2 + 1
  const day = daySeed(new Date())
  const todayBest = saved.today && saved.today.day === day ? saved.today.seconds : null
  const best = mode === 'today' ? todayBest : (saved.best[board.layout.id] ?? null)
  const firstFree = board.filled.findIndex((f, i) => f && isFree(i))
  const tabTo = cursor >= 0 && board.filled[cursor] ? cursor : firstFree

  return (
    <div className={`lab-keys tl-room is-${saved.style}${saved.glow ? ' is-glow' : ''}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Which tiles">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'today'}
            onClick={() => fresh('today')}
          >
            Today's tiles
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
          <div className="lab-group" role="group" aria-label="Layout">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                className="btn btn-ghost"
                aria-pressed={saved.layout === l.id}
                onClick={() => {
                  setSaved((s) => ({ ...s, layout: l.id }))
                  fresh('practice', l.id)
                }}
              >
                {l.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="lab-controls">
        <button className="btn btn-ghost" onClick={useHint} disabled={!open.length || to !== null}>
          💡 Hint (+{PENALTY} s)
        </button>
        <button className="btn btn-ghost" onClick={doShuffle} disabled={to !== null || !left}>
          🔀 Shuffle (+{PENALTY} s)
        </button>
        <button className="btn btn-ghost" onClick={undo} disabled={!history.length || to !== null}>
          ↶ Undo
        </button>
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ {mode === 'today' ? 'Start again' : 'New deal'}
        </button>
      </div>

      <div className="dice-scores tl-hud">
        <div className="dice-score">
          <span>Time</span>
          <Clock from={from} to={to} extra={extra} />
        </div>
        <div className="dice-score">
          <span>Tiles left</span>
          <strong>{left}</strong>
          <span className="muted">
            {open.length} {open.length === 1 ? 'pair' : 'pairs'} free
          </span>
        </div>
        <div className="dice-score">
          <span>{mode === 'today' ? 'Best today' : 'Best here'}</span>
          <strong>{best !== null ? fmt(best) : '—'}</strong>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="tl-fit">
        <div
          className="tl-board"
          style={{ '--tl-w': W, '--tl-h': H } as CSSProperties}
          role="group"
          aria-label="The tiles. Arrow keys move between free tiles; Enter picks one, and a matching one takes the pair."
          onKeyDown={onKey}
        >
          {places.map((p, i) => {
            if (!board.filled[i]) return null
            const k = board.kind[i]
            const f = isFree(i)
            return (
              <button
                key={i}
                ref={(el) => {
                  refs.current[i] = el
                }}
                className={[
                  'tl-tile',
                  `c${colourOf(k)}`,
                  f ? 'is-free' : '',
                  picked === i ? 'is-picked' : '',
                  hint && hint.includes(i) ? 'is-hint' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={
                  {
                    '--x': p.x / 2,
                    '--y': p.y / 2,
                    '--z': p.z,
                    zIndex: p.z * 1000 + p.y * 20 + p.x,
                  } as CSSProperties
                }
                tabIndex={i === tabTo ? 0 : -1}
                aria-disabled={!f}
                aria-label={`${kindName(k)}, layer ${p.z + 1}${f ? ', free' : ', held in'}${picked === i ? ', picked' : ''}`}
                onFocus={() => setCursor(i)}
                onClick={() => tap(i)}
              >
                <span aria-hidden>{shapeOf(k).repeat(colourOf(k) + 1)}</span>
              </button>
            )
          })}
        </div>
      </div>
      {share && <CopyLink text={share} label="🔗 Copy my time" />}
      <p className="sun-reading">
        <span className="muted">
          Boards cleared {saved.cleared}
          {LAYOUTS.filter((l) => saved.best[l.id] !== undefined)
            .map((l) => ` · ${l.name.toLowerCase()} ${fmt(saved.best[l.id])}`)
            .join('')}
        </span>
      </p>

      <div className="fw-panel">
        <section aria-label="Tiles">
          <h3 className="fw-h">Tiles</h3>
          <div className="lab-controls" role="group" aria-label="Tile style">
            {STYLES.map((st) => (
              <button
                key={st}
                className="btn btn-ghost"
                aria-pressed={saved.style === st}
                onClick={() => setSaved((s) => ({ ...s, style: st }))}
              >
                {STYLE_NAMES[st]}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.glow}
              onClick={() => setSaved((s) => ({ ...s, glow: !s.glow }))}
            >
              Light up the free tiles
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Take the tiles away in matching pairs. A tile can be taken when it is free: nothing on top
        of it, and no neighbour on at least one side, left or right. A kind is a shape and how many
        of it — one, two or three — so colour is never needed to tell two apart. Every deal can be
        cleared: it is made by clearing the empty layout first. A hint or a shuffle adds thirty
        seconds; undo is free. Today's tiles are the same for everyone. Keys: arrows move between
        free tiles, Enter picks.
      </p>
    </div>
  )
}
