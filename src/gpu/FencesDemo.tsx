import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  FENCES,
  FENCES_KEY,
  LEVELS,
  SIZES,
  THEMES,
  choose,
  dist,
  fenceOk,
  fenceTrouble,
  newGame,
  path,
  play,
  readSaved,
  steps,
  type Game,
  type Level,
  type Move,
  type Orient,
  type Saved,
  type Trouble,
  type Size,
  type Who,
} from './fences'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(FENCES_KEY))
  } catch {
    return readSaved(null)
  }
}
const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const THEME_NAMES: Record<Saved['theme'], string> = {
  meadow: 'Meadow',
  slate: 'Slate',
  sand: 'Sand',
}
const FILES = 'abcdefghi'
/** a square named from your side: files left to right, ranks counted up from your edge */
const sqName = (n: number, r: number, c: number) => `${FILES[c]}${n - r}`
const fenceName = (n: number, o: Orient, r: number, c: number) =>
  o === 'h'
    ? `a flat fence between ${sqName(n, r, c)}–${sqName(n, r, c + 1)} and ${sqName(n, r + 1, c)}–${sqName(n, r + 1, c + 1)}`
    : `a standing fence between ${sqName(n, r, c)}–${sqName(n, r + 1, c)} and ${sqName(n, r, c + 1)}–${sqName(n, r + 1, c + 1)}`
const TROUBLE: Record<Trouble, string> = {
  over: 'the game is over',
  spent: 'you have no fences left',
  off: 'it would hang off the board',
  cross: 'it would cross another fence',
  overlap: 'it would overlap another fence',
  shut: 'it would shut somebody in',
}
const squares = (k: number) => `${k} square${k === 1 ? '' : 's'}`

type Aim = { o: Orient; r: number; c: number }

export function FencesDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [game, setGame] = useState<Game>(() => newGame(saved.size, 0))
  const [level, setLevel] = useState<Level>(saved.level)
  const [fencing, setFencing] = useState(false)
  const [aim, setAim] = useState<Aim>({
    o: 'h',
    r: (saved.size >> 1) - 1,
    c: (saved.size >> 1) - 1,
  })
  /** a touch aims first and places on a second tap at the same crossing; a mouse shows it on hover */
  const [armed, setArmed] = useState(false)
  const [last, setLast] = useState<Move | null>(null)
  const [mine, setMine] = useState(0)
  /** who goes first in the next game: you and the computer take turns */
  const [nextFirst, setNextFirst] = useState<Who>(1)
  const [line, setLine] = useState('You start at the bottom and move first: reach the top edge.')
  const [cursor, setCursor] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const board = useRef<HTMLDivElement>(null)
  const pointer = useRef('mouse')
  const recorded = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(FENCES_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const n = game.n
  const you: Who = 0
  const yourTurn = game.winner === null && game.turn === you
  const lit = yourTurn && !fencing ? steps(game) : []
  const litSet = new Set(lit.map(([r, c]) => r * n + c))
  const yourWay = saved.guide ? new Set(path(game, 0).map(([r, c]) => r * n + c)) : new Set()
  const theirWay = saved.guide ? new Set(path(game, 1).map(([r, c]) => r * n + c)) : new Set()
  const aimOk = yourTurn && fencing && fenceOk(game, aim.o, aim.r, aim.c)

  const describeMove = (m: Move, by: Who) => {
    const who = by === you ? 'You' : 'The computer'
    if (m.kind === 'step')
      return `${who} ${by === you ? 'step' : 'steps'} to ${sqName(n, ...m.to)}.`
    return `${who} ${by === you ? 'put' : 'puts'} down ${fenceName(n, m.o, m.r, m.c)}.`
  }

  const apply = (m: Move) => {
    const by = game.turn
    const g = play(game, m)
    if (g === game) return false
    setGame(g)
    setLast(m)
    setArmed(false)
    // a fence is a one-off: most turns are steps, so the next one starts as a step again
    if (m.kind === 'fence' && by === you) setFencing(false)
    const myMoves = mine + (by === you ? 1 : 0)
    setMine(myMoves)
    if (g.winner !== null) {
      if (!recorded.current) {
        recorded.current = true
        const won = g.winner === you
        setSaved((s) => {
          const t = s.record[level]
          return {
            ...s,
            record: {
              ...s.record,
              [level]: {
                won: t.won + (won ? 1 : 0),
                lost: t.lost + (won ? 0 : 1),
                best: won && (!t.best || myMoves < t.best) ? myMoves : t.best,
              },
            },
          }
        })
        const prev = saved.record[level].best
        setLine(
          won
            ? `🏆 You reach the far edge in ${myMoves} moves${!prev || myMoves < prev ? ' — your best against ' + LEVEL_NAMES[level] : ''}.`
            : `${describeMove(m, by)} The computer reaches your edge first.`,
        )
      }
      setFencing(false)
      return true
    }
    const left = dist(g, 0)
    setLine(
      `${describeMove(m, by)} ${
        g.turn === you
          ? `Your move: ${squares(left)} to go${g.left[0] ? `, ${g.left[0]} fence${g.left[0] === 1 ? '' : 's'} left` : ', and no fences left'}.`
          : 'The computer is thinking…'
      }`,
    )
    return true
  }

  useEffect(() => {
    if (game.winner !== null || game.turn === you) return
    const t = window.setTimeout(() => apply(choose(game, level)), reduced() ? 150 : 550)
    return () => window.clearTimeout(t)
    // the game is what starts the computer's move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game])

  const fresh = (size: Size = saved.size, lv: Level = saved.level) => {
    // a game that was never begun does not use up a turn at going first
    const first: Who = game.plies ? nextFirst : game.turn
    if (game.plies) setNextFirst(first === 0 ? 1 : 0)
    recorded.current = false
    setGame(newGame(size, first))
    setLevel(lv)
    setMine(0)
    setLast(null)
    setFencing(false)
    setArmed(false)
    setCursor(0)
    setAim({ o: 'h', r: (size >> 1) - 1, c: (size >> 1) - 1 })
    setLine(
      first === you
        ? 'You start at the bottom and move first: reach the top edge.'
        : 'You start at the bottom; the computer moves first this time…',
    )
  }
  const untouched = game.plies === 0 || game.winner !== null

  /** the groove crossing nearest a point on the board */
  const crossingAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = board.current!.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * n
    const y = ((e.clientY - box.top) / box.height) * n
    const clamp = (v: number) => Math.max(0, Math.min(n - 2, v))
    return { r: clamp(Math.round(y) - 1), c: clamp(Math.round(x) - 1) }
  }
  const onBoardMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!fencing || e.pointerType !== 'mouse') return
    const { r, c } = crossingAt(e)
    if (r !== aim.r || c !== aim.c) setAim({ ...aim, r, c })
  }
  const onBoardUp = (e: PointerEvent<HTMLDivElement>) => {
    pointer.current = e.pointerType
    if (!fencing || !yourTurn) return
    const { r, c } = crossingAt(e)
    const same = r === aim.r && c === aim.c
    if (e.pointerType === 'mouse' || (same && armed)) {
      if (!apply({ kind: 'fence', o: aim.o, r, c })) setLine(`No fence there: ${whyNot(r, c)}.`)
      return
    }
    setAim({ ...aim, r, c })
    setArmed(true)
    setLine(
      fenceOk(game, aim.o, r, c)
        ? `Aiming ${fenceName(n, aim.o, r, c)}. Tap it again to put it down, or ⟲ to turn it.`
        : `No fence there: ${whyNot(r, c)}.`,
    )
  }
  const whyNot = (r: number, c: number) => TROUBLE[fenceTrouble(game, aim.o, r, c) ?? 'off']
  const turnFence = () => setAim((a) => ({ ...a, o: a.o === 'h' ? 'v' : 'h' }))

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key
    if (k === 'f' || k === 'F') {
      if (yourTurn && game.left[0]) setFencing((f) => !f)
    } else if (k === 'r' || k === 'R') {
      if (fencing) turnFence()
    } else if (fencing && (k === 'Enter' || k === ' ')) {
      if (!apply({ kind: 'fence', o: aim.o, r: aim.r, c: aim.c }))
        setLine(`No fence there: ${whyNot(aim.r, aim.c)}.`)
    } else if (k.startsWith('Arrow')) {
      const dr = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0
      const dc = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0
      if (fencing) {
        const r = Math.max(0, Math.min(n - 2, aim.r + dr))
        const c = Math.max(0, Math.min(n - 2, aim.c + dc))
        setAim({ ...aim, r, c })
      } else {
        const r = Math.max(0, Math.min(n - 1, Math.floor(cursor / n) + dr))
        const c = Math.max(0, Math.min(n - 1, (cursor % n) + dc))
        setCursor(r * n + c)
        refs.current[r * n + c]?.focus()
      }
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  const cell = 100 / n
  const fenceStyle = (o: Orient, r: number, c: number) =>
    o === 'h'
      ? { left: `${c * cell + cell * 0.08}%`, top: `${(r + 1) * cell}%`, width: `${cell * 1.84}%` }
      : { top: `${r * cell + cell * 0.08}%`, left: `${(c + 1) * cell}%`, height: `${cell * 1.84}%` }
  const placed: Aim[] = []
  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      if (game.h[r * (n - 1) + c]) placed.push({ o: 'h', r, c })
      if (game.v[r * (n - 1) + c]) placed.push({ o: 'v', r, c })
    }
  const isLast = (f: Aim) =>
    last?.kind === 'fence' && last.o === f.o && last.r === f.r && last.c === f.c
  const record = saved.record[saved.level]

  return (
    <div className={`lab-keys fe-room is-${saved.theme}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer plays">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (untouched) fresh(saved.size, l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="Board size">
          {SIZES.map((s) => (
            <button
              key={s}
              className="btn btn-ghost"
              aria-pressed={saved.size === s}
              onClick={() => {
                setSaved((x) => ({ ...x, size: s }))
                if (untouched) fresh(s, saved.level)
              }}
            >
              {s}×{s}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>

      <div className="dice-scores">
        {([0, 1] as Who[]).map((w) => (
          <div
            key={w}
            className={`dice-score fe-score-${w}${game.turn === w && game.winner === null ? ' is-up' : ''}`}
          >
            <span>{w === you ? 'You' : `The computer · ${LEVEL_NAMES[level]}`}</span>
            <strong>{dist(game, w)}</strong>
            <span className="muted">
              to go · {game.left[w]} fence{game.left[w] === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="What your turn does">
          <button
            className="btn btn-ghost"
            aria-pressed={!fencing}
            onClick={() => {
              setFencing(false)
              setArmed(false)
            }}
          >
            ♟ Step
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={fencing}
            disabled={!game.left[0] || game.winner !== null}
            onClick={() => setFencing(true)}
          >
            ▭ Fence ({game.left[0]})
          </button>
        </div>
        {fencing && (
          <button className="btn btn-ghost" onClick={turnFence}>
            ⟲ Turn it: {aim.o === 'h' ? 'flat' : 'standing'}
          </button>
        )}
      </div>

      <div className="fe-fit">
        <div
          ref={board}
          className={`fe-board${fencing ? ' is-fencing' : ''}`}
          style={{ ['--fe-n' as string]: n }}
          role="group"
          aria-label={`The board, ${n} by ${n}. ${fencing ? 'Arrow keys move the fence, R turns it, Enter puts it down, F goes back to stepping.' : 'Arrow keys move between squares, Enter steps; F to put down a fence.'}`}
          onKeyDown={onKey}
          onPointerMove={onBoardMove}
          onPointerUp={onBoardUp}
        >
          {Array.from({ length: n * n }, (_, i) => {
            const r = Math.floor(i / n)
            const c = i % n
            const here = (w: Who) => game.pos[w][0] === r && game.pos[w][1] === c
            const who = here(0) ? 'you' : here(1) ? 'the computer' : ''
            const notes = [
              litSet.has(i) ? 'you can step here' : '',
              yourWay.has(i) ? 'on your shortest way' : '',
              theirWay.has(i) ? 'on the computer’s shortest way' : '',
            ].filter(Boolean)
            return (
              <button
                key={i}
                ref={(el) => {
                  refs.current[i] = el
                }}
                className={[
                  'fe-sq',
                  litSet.has(i) ? 'is-lit' : '',
                  yourWay.has(i) ? 'way-0' : '',
                  theirWay.has(i) ? 'way-1' : '',
                  r === 0 ? 'goal-0' : '',
                  r === n - 1 ? 'goal-1' : '',
                  last?.kind === 'step' && last.to[0] === r && last.to[1] === c ? 'is-last' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                tabIndex={i === cursor ? 0 : -1}
                aria-label={`${sqName(n, r, c)}${who ? `: ${who}` : ''}${notes.length ? `, ${notes.join(', ')}` : ''}`}
                onFocus={() => setCursor(i)}
                onClick={() => {
                  setCursor(i)
                  if (fencing) return
                  if (litSet.has(i)) apply({ kind: 'step', to: [r, c] })
                  else if (yourTurn && !who) setLine('That square is not a step away.')
                }}
              >
                {who && <span className={`fe-pawn is-${here(0) ? 0 : 1}`} aria-hidden />}
              </button>
            )
          })}
          <div className="fe-fences" aria-hidden>
            {placed.map((f) => (
              <span
                key={`${f.o}${f.r},${f.c}`}
                className={`fe-fence is-${f.o}${isLast(f) ? ' is-last' : ''}`}
                style={fenceStyle(f.o, f.r, f.c)}
              />
            ))}
            {fencing && yourTurn && (
              <span
                className={`fe-fence is-${aim.o} is-ghost${aimOk ? '' : ' is-bad'}`}
                style={fenceStyle(aim.o, aim.r, aim.c)}
              />
            )}
          </div>
        </div>
      </div>
      {fencing && yourTurn && (
        <p className="muted mc-note" aria-live="polite">
          {aimOk
            ? `Aiming ${fenceName(n, aim.o, aim.r, aim.c)}.`
            : `Not there: ${whyNot(aim.r, aim.c)}.`}
        </p>
      )}

      <p className="sun-reading">
        <span className="muted">
          On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
          {record.best ? ` · fastest win ${record.best} moves` : ''}
        </span>
      </p>
      {!untouched && (level !== saved.level || n !== saved.size) && (
        <p className="muted mc-note">The new choice starts with the next game.</p>
      )}

      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Board</h3>
          <div className="lab-controls" role="group" aria-label="Look">
            {THEMES.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={saved.theme === t}
                onClick={() => setSaved((s) => ({ ...s, theme: t }))}
              >
                {THEME_NAMES[t]}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.guide}
              onClick={() => setSaved((s) => ({ ...s, guide: !s.guide }))}
            >
              Show both shortest ways
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Race to the far edge. Each turn, either step one square — over the other side if you meet
        face to face, or past them when something blocks the hop — or put down a fence two squares
        long to make their way longer. A fence may not cross or overlap another, and may never shut
        anybody in. You have {FENCES[n as Size]} on this board; so does the computer. Pick ▭ Fence
        for one turn; the next starts as a step again. With a mouse, the fence follows the pointer
        and a click puts it down; on a touch screen, tap a groove to aim and tap it again to place.
        Keys: F switches between stepping and fencing, arrows move, R turns the fence, Enter puts it
        down. Easy walks its shortest way and now and then drops a fence at random; Fair and Hard
        look three moves ahead, and Hard saves its fences for when they hurt.
      </p>
    </div>
  )
}
