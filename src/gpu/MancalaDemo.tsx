import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import {
  LEVELS,
  LOOKS,
  MANCALA_KEY,
  PIT_CHOICES,
  SEED_CHOICES,
  SEED_LOOKS,
  choose,
  owner,
  pitsFor,
  readSaved,
  score,
  sow,
  start,
  storeOf,
  type Board,
  type Level,
  type Rules,
  type Saved,
  type Side,
} from './mancala'
import { motionReduced as still } from '../ui/motion'

type Mode = 'bot' | 'two'
type Game = {
  rules: Rules
  board: Board
  side: Side
  over: boolean
  /** the last sowing, lit on the board until the next one */
  path: number[]
  /** who went first, so the next game can swap */
  first: Side
  /** how well the computer plays this game; a change waits for the next one */
  level: Level
}

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(MANCALA_KEY))
  } catch {
    return readSaved(null)
  }
}

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK_NAMES: Record<Saved['look'], string> = { wood: 'Wood', stone: 'Stone', sea: 'Sea' }
const SEED_NAMES: Record<Saved['seedLook'], string> = {
  beads: 'Glass beads',
  pebbles: 'Pebbles',
  gems: 'Gems',
}
const SEED_COLOURS: Record<Saved['seedLook'], string[]> = {
  beads: ['#e85d75', '#4fb3e8', '#f2c14e', '#7bd389', '#b28dff', '#ff9f5a'],
  pebbles: ['#9a958c', '#c7c0b3', '#6f6a63', '#b5a48f', '#8a9198'],
  gems: ['#ff3d7f', '#21d4fd', '#ffd23f', '#3ddc97', '#9b5de5', '#f15bb5'],
}

/** a fixed little hash, for where each seed sits in its pit */
const h = (a: number, b: number) => {
  let x = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)
  x ^= x >>> 15
  x = Math.imul(x, 0x2c1b3c6d)
  x ^= x >>> 12
  return ((x >>> 0) % 10000) / 10000
}

function Seeds({
  n,
  pit,
  look,
  cap,
}: {
  n: number
  pit: number
  look: Saved['seedLook']
  cap: number
}) {
  const colours = SEED_COLOURS[look]
  return (
    <span className="mc-seeds" aria-hidden>
      {Array.from({ length: Math.min(n, cap) }, (_, k) => {
        const a = h(pit, k) * Math.PI * 2
        const r = Math.sqrt(h(k, pit + 31)) * 34
        const style: CSSProperties = {
          left: `${50 + Math.cos(a) * r}%`,
          top: `${50 + Math.sin(a) * r}%`,
          background: colours[(pit * 7 + k * 3) % colours.length],
        }
        return <span key={k} className={`mc-seed is-${look}`} style={style} />
      })}
    </span>
  )
}

export function MancalaDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('bot')
  const [game, setGame] = useState<Game>(() => ({
    rules: saved.rules,
    board: start(saved.rules),
    side: 0,
    over: false,
    path: [],
    first: 0,
    level: saved.level,
  }))
  /** the board as it is drawn while seeds are still being sown, and the pit the hand is over */
  const [shown, setShown] = useState<{ board: Board; at: number } | null>(null)
  const [line, setLine] = useState('Your turn — pick a pit on your side to sow.')
  const [hover, setHover] = useState<number | null>(null)
  const timers = useRef<number[]>([])
  const boardRef = useRef<HTMLDivElement | null>(null)
  const later = (f: () => void, ms: number) => timers.current.push(window.setTimeout(f, ms))
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  useEffect(() => {
    try {
      localStorage.setItem(MANCALA_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const names = mode === 'bot' ? ['You', 'The computer'] : ['Player 1', 'Player 2']
  const busy = shown !== null
  const computerTurn = mode === 'bot' && game.side === 1 && !game.over
  const humanTurn = !game.over && !busy && !computerTurn

  const finish = (g: Game) => {
    const [a, b] = score(g.board)
    if (mode === 'bot') {
      setSaved((s) => {
        const r = s.record[g.level]
        const won = a > b
        return {
          ...s,
          record: {
            ...s.record,
            [g.level]: {
              won: r.won + (won ? 1 : 0),
              lost: r.lost + (a < b ? 1 : 0),
              drawn: r.drawn + (a === b ? 1 : 0),
              best: won ? Math.max(r.best, a - b) : r.best,
            },
          },
        }
      })
      setLine(
        a > b
          ? `🏆 You win, ${a} to ${b}!`
          : a < b
            ? `The computer wins, ${b} to ${a}.`
            : `A draw, ${a} each.`,
      )
    } else
      setLine(
        a === b
          ? `A draw, ${a} each.`
          : `🏆 ${names[a > b ? 0 : 1]} wins, ${Math.max(a, b)} to ${Math.min(a, b)}.`,
      )
  }

  /** sow from a pit: seed by seed on screen, or at once under reduced motion */
  const play = (pit: number) => {
    const g = game
    const who = g.side
    const s = sow(g.board, pit, who, g.rules)
    const after: Game = { ...g, board: s.board, side: s.next, over: s.over, path: s.path }
    const say = () => {
      const by = mode === 'bot' ? (who === 0 ? 'You' : 'The computer') : names[who]
      const parts = [
        s.captured
          ? `${by} took ${s.captured.seeds} seeds!`
          : `${by} sowed ${s.path.length} seed${s.path.length === 1 ? '' : 's'}.`,
      ]
      if (!s.over && s.next === who)
        parts.push(mode === 'bot' && who === 0 ? 'Go again.' : 'Again!')
      else if (!s.over)
        parts.push(
          mode === 'bot'
            ? s.next === 0
              ? 'Your turn.'
              : 'The computer is thinking…'
            : `${names[s.next]}’s turn.`,
        )
      setLine(parts.join(' '))
    }
    if (still()) {
      setGame(after)
      say()
      if (s.over) finish(after)
      return
    }
    const board = [...g.board]
    board[pit] = 0
    setShown({ board: [...board], at: pit })
    s.path.forEach((at, k) => {
      later(
        () => {
          board[at]++
          setShown({ board: [...board], at })
        },
        150 * (k + 1),
      )
    })
    later(
      () => {
        setShown(null)
        setGame(after)
        say()
        if (s.over) finish(after)
      },
      150 * (s.path.length + 1) + (s.captured ? 250 : 0),
    )
  }

  // the computer's turn: a moment to think, then it sows
  useEffect(() => {
    if (!computerTurn || busy) return
    const t = window.setTimeout(() => {
      play(choose(game.board, 1, game.level, game.rules))
    }, 650)
    return () => window.clearTimeout(t)
    // play reads the game it is given; re-running on every render would schedule twice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn, busy, game])

  const newGame = (m: Mode = mode, rules: Rules = saved.rules, level: Level = saved.level) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    const first: Side = game.over || m !== mode ? (game.first === 0 ? 1 : 0) : game.first
    setMode(m)
    setShown(null)
    setGame({ rules, board: start(rules), side: first, over: false, path: [], first, level })
    setLine(
      m === 'bot'
        ? first === 0
          ? 'Your turn — pick a pit on your side to sow.'
          : 'The computer goes first this time…'
        : `${first === 0 ? 'Player 1' : 'Player 2'} first.`,
    )
  }
  const started = game.path.length > 0 || busy
  const setRules = (p: Partial<Rules>) => {
    const rules = { ...saved.rules, ...p }
    setSaved((s) => ({ ...s, rules }))
    // a game not yet begun takes the new rules at once; one under way finishes on its own
    if (!started || game.over) newGame(mode, rules)
  }

  const board = shown?.board ?? game.board
  const n = game.rules.pits
  const [a, b] = score(board)
  const record = saved.record[saved.level]
  const hint = useMemo(() => {
    if (!saved.hints || hover === null || !humanTurn || game.board[hover] === 0) return null
    if (owner(game.board, hover) !== game.side) return null
    const s = sow(game.board, hover, game.side, game.rules)
    const end = s.path[s.path.length - 1]
    if (s.captured) return { end, text: `ends in an empty pit — takes ${s.captured.seeds}` }
    if (!s.over && s.next === game.side) return { end, text: 'ends in your store — go again' }
    return {
      end,
      text: owner(game.board, end) === game.side ? 'ends on your side' : 'ends on their side',
    }
  }, [saved.hints, hover, humanTurn, game])

  /** where each place sits on the board, across (wide) and down (narrow) */
  const place = (i: number): CSSProperties => {
    const s0 = storeOf(board, 0)
    const s1 = storeOf(board, 1)
    if (i === s1) return { '--hc': 1, '--vr': 1 } as CSSProperties
    if (i === s0) return { '--hc': n + 2, '--vr': n + 2 } as CSSProperties
    if (i < n) return { '--hc': i + 2, '--hr': 2, '--vc': 1, '--vr': i + 2 } as CSSProperties
    const k = 2 * n - i // the pit opposite your pit k
    return { '--hc': k + 2, '--hr': 1, '--vc': 2, '--vr': k + 2 } as CSSProperties
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const num = Number(e.key)
    if (Number.isInteger(num) && num >= 1 && num <= n && humanTurn) {
      const pit = pitsFor(game.board, game.side)[game.side === 0 ? num - 1 : n - num]
      if (game.board[pit] > 0) {
        e.preventDefault()
        play(pit)
      }
      return
    }
    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown'
    ) {
      const buttons = [
        ...(boardRef.current?.querySelectorAll<HTMLButtonElement>('button.mc-pit:not(:disabled)') ??
          []),
      ]
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (i < 0 || !buttons.length) return
      e.preventDefault()
      e.stopPropagation()
      const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
      buttons[(i + (back ? buttons.length - 1 : 1)) % buttons.length].focus()
    }
  }

  const pitLabel = (i: number) => {
    const side = owner(board, i)
    const who = mode === 'bot' ? (side === 0 ? 'Your' : 'The computer’s') : `${names[side ?? 0]}’s`
    const k = side === 0 ? i + 1 : 2 * n + 1 - i
    return `${who} pit ${k}, ${board[i]} seed${board[i] === 1 ? '' : 's'}`
  }

  return (
    <div className={`lab-keys mc-room is-${saved.look}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Opponent">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'bot'}
            onClick={() => newGame('bot')}
          >
            Against the computer
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'two'}
            onClick={() => newGame('two')}
          >
            Two players
          </button>
        </div>
        {mode === 'bot' && (
          <div className="lab-group" role="group" aria-label="How well the computer plays">
            {LEVELS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.level === l}
                onClick={() => {
                  setSaved((s) => ({ ...s, level: l }))
                  if (!started || game.over) newGame(mode, saved.rules, l)
                }}
              >
                {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
        )}
        <button className="btn btn-ghost" onClick={() => newGame()}>
          ↻ New game
        </button>
      </div>

      <div className="dice-scores">
        {names.map((nm, i) => (
          <div key={nm} className={`dice-score${game.side === i && !game.over ? ' is-up' : ''}`}>
            <span>{nm}</span>
            <strong>{i === 0 ? a : b}</strong>
          </div>
        ))}
      </div>

      <div
        ref={boardRef}
        className="mc-board"
        style={{ '--n': n } as CSSProperties}
        role="group"
        aria-label="The board. Number keys sow from your pits; arrow keys move between them."
        onKeyDown={onKey}
      >
        <span className="mc-side is-top" aria-hidden>
          {names[1]}
        </span>
        {Array.from({ length: board.length }, (_, i) => {
          const side = owner(board, i)
          const isStore = side === null
          const lit = shown ? shown.at === i : game.path.includes(i)
          const cls = `${isStore ? 'mc-store' : 'mc-pit'}${lit ? ' is-lit' : ''}${hint?.end === i ? ' is-hint' : ''}${shown?.at === i ? ' is-hand' : ''}`
          const content = (
            <>
              <Seeds n={board[i]} pit={i} look={saved.seedLook} cap={isStore ? 60 : 24} />
              <span className="mc-count">{board[i]}</span>
            </>
          )
          if (isStore)
            return (
              <div
                key={i}
                className={cls}
                style={place(i)}
                role="img"
                aria-label={`${i === storeOf(board, 0) ? names[0] : names[1]}’s store, ${board[i]} seeds`}
              >
                {content}
              </div>
            )
          const mine = humanTurn && side === game.side
          return (
            <button
              key={i}
              className={cls}
              style={place(i)}
              aria-label={pitLabel(i)}
              disabled={!mine || board[i] === 0}
              onClick={() => play(i)}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((x) => (x === i ? null : x))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((x) => (x === i ? null : x))}
            >
              {content}
            </button>
          )
        })}
        <span className="mc-side is-bottom" aria-hidden>
          {names[0]}
        </span>
      </div>

      <p className="mc-line" aria-live="polite">
        {line}
        {hint && <span className="muted"> · this pit {hint.text}</span>}
      </p>
      {mode === 'bot' && (
        <p className="sun-reading">
          <span className="muted">
            On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.drawn ? `, drawn ${record.drawn}` : ''}
            {record.best > 0 && <> · widest win {record.best} seeds</>}
          </span>
        </p>
      )}

      <div className="fw-panel">
        <section aria-label="Rules">
          <h3 className="fw-h">Rules</h3>
          <div className="lab-controls" role="group" aria-label="Pits a side">
            <span className="fw-label">Pits</span>
            {PIT_CHOICES.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={saved.rules.pits === p}
                aria-label={`${p} pits a side`}
                onClick={() => setRules({ pits: p })}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Seeds a pit">
            <span className="fw-label">Seeds</span>
            {SEED_CHOICES.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={saved.rules.seeds === p}
                aria-label={`${p} seeds a pit`}
                onClick={() => setRules({ seeds: p })}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.rules.captures}
              onClick={() => setRules({ captures: !saved.rules.captures })}
            >
              Captures
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Show where a pit ends
            </button>
          </div>
          {started &&
            !game.over &&
            (JSON.stringify(saved.rules) !== JSON.stringify(game.rules) ||
              (mode === 'bot' && saved.level !== game.level)) && (
              <p className="muted mc-note">Your changes start with the next game.</p>
            )}
        </section>
        <section aria-label="The board">
          <h3 className="fw-h">The board</h3>
          <div className="lab-controls" role="group" aria-label="Board">
            {LOOKS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.look === l}
                onClick={() => setSaved((s) => ({ ...s, look: l }))}
              >
                {LOOK_NAMES[l]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Seeds">
            {SEED_LOOKS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.seedLook === l}
                onClick={() => setSaved((s) => ({ ...s, seedLook: l }))}
              >
                {SEED_NAMES[l]}
              </button>
            ))}
          </div>
        </section>
      </div>

      <p className="muted lab-hint">
        Take every seed from one of your pits and sow them one by one around the board, the way the
        arrows of a clock do not go: into your own store as you pass it, never into the other
        side’s. End in your store and you go again. End in an empty pit of your own and you take
        that seed and everything opposite it. When either side has no seeds left the game ends, each
        side keeps what is on it, and the fuller store wins. Easy looks one move ahead, Fair four,
        Hard nine. Keys: 1–{n} sow from your pits counting from the left (the top on a phone);
        arrows move between them.
      </p>
    </div>
  )
}
