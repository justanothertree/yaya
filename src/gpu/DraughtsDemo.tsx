import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  BOARDS,
  DRAUGHTS_KEY,
  LEVELS,
  PIECES,
  at,
  choose,
  colOf,
  count,
  isKing,
  moves,
  newGame,
  owner,
  play,
  readSaved,
  rowOf,
  type Game,
  type Level,
  type Move,
  type Saved,
  type Who,
} from './draughts'
import { useKept } from './kept'

type Mode = 'bot' | 'two'
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const BOARD_NAMES: Record<Saved['board'], string> = { classic: 'Classic', wood: 'Wood', ice: 'Ice' }
/** each set of pieces names its two sides */
const SIDES: Record<Saved['pieces'], [string, string]> = {
  red: ['Red', 'Black'],
  wood: ['Light', 'Dark'],
  mint: ['Mint', 'Plum'],
}
const FILES = 'abcdefgh'
const COUNT_WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
const squareName = (i: number) => `${FILES[colOf(i)]}${8 - rowOf(i)}`
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function DraughtsDemo() {
  const [saved, setSaved] = useKept(DRAUGHTS_KEY, readSaved)
  const [mode, setMode] = useState<Mode>('bot')
  const [game, setGame] = useState<Game>(newGame)
  const [you, setYou] = useState<Who>(1)
  const [level, setLevel] = useState<Level>(saved.level)
  /** the squares picked so far: the piece, then each landing of a jump in progress */
  const [prefix, setPrefix] = useState<number[]>([])
  const [last, setLast] = useState<Move | null>(null)
  const [line, setLine] = useState('You play from the bottom and move first.')
  const [cursor, setCursor] = useState(at(5, 0))
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const recorded = useRef(false)

  const sides = SIDES[saved.pieces]
  const all = moves(game)
  const yours = !game.winner && (mode === 'two' || game.turn === you)
  const computerTurn = mode === 'bot' && !game.winner && game.turn !== you
  // the board turns round so the side you play is always at the bottom
  const flip = mode === 'bot' ? you === 2 : false
  const nameOf = (w: Who) => (mode === 'bot' ? (w === you ? 'You' : 'The computer') : sides[w - 1])
  const verb = (w: Who, plain: string, s: string) => (nameOf(w) === 'You' ? plain : s)

  const candidates = prefix.length
    ? all.filter((m) => same(m.path.slice(0, prefix.length), prefix))
    : []
  const movable = new Set(all.map((m) => m.path[0]))
  const lit = new Set(candidates.map((m) => m.path[prefix.length]).filter((x) => x !== undefined))
  // pieces already jumped in a take that is still going
  const jumped = new Set(
    candidates.length ? candidates[0].taken.slice(0, Math.max(0, prefix.length - 1)) : [],
  )

  const apply = (m: Move) => {
    const by = game.turn
    const g = play(game, m)
    setGame(g)
    setLast(m)
    setPrefix([])
    if (g.winner) {
      if (mode === 'bot' && !recorded.current) {
        recorded.current = true
        const r = g.winner === 3 ? 'drawn' : g.winner === you ? 'won' : 'lost'
        setSaved((s) => ({
          ...s,
          record: { ...s.record, [level]: { ...s.record[level], [r]: s.record[level][r] + 1 } },
        }))
      }
      const w = g.winner
      setLine(
        w === 3
          ? 'A draw — only kings moving, and nothing taken, for forty moves each.'
          : `${w === you || mode === 'two' ? '🏆 ' : ''}${nameOf(w)} ${verb(w, 'win', 'wins')} — ${count(g, w === 1 ? 2 : 1) ? 'no move left for the other side' : 'every piece taken'}.`,
      )
      return
    }
    const crowned = !isKing(game.board[m.path[0]]) && isKing(g.board[m.path[m.path.length - 1]])
    const took = m.taken.length
      ? `${nameOf(by)} ${verb(by, 'take', 'takes')} ${COUNT_WORDS[m.taken.length] ?? m.taken.length}${crowned ? ' and crowns' : ''}. `
      : crowned
        ? `${nameOf(by)} ${verb(by, 'reach', 'reaches')} the far row: a king. `
        : ''
    const forced = moves(g)[0]?.taken.length ? ' A take is there, so it must be taken.' : ''
    setLine(
      `${took}${mode === 'bot' ? (g.turn === you ? `Your move.${forced}` : 'The computer is thinking…') : `${sides[g.turn - 1]} to move.${forced}`}`,
    )
  }

  const tap = (i: number) => {
    if (!yours) return
    if (movable.has(i) && (prefix.length <= 1 || !lit.has(i))) {
      setPrefix(prefix[0] === i ? [] : [i])
      return
    }
    if (!lit.has(i)) return
    const next = [...prefix, i]
    const done = all.find((m) => same(m.path, next))
    if (done) apply(done)
    else setPrefix(next)
  }

  useEffect(() => {
    if (!computerTurn) return
    const t = window.setTimeout(() => apply(choose(game, level)), 600)
    return () => window.clearTimeout(t)
    // the game is what starts the computer's move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn, game])

  const fresh = (m: Mode = mode, lv: Level = saved.level) => {
    const nextYou: Who = last && m === mode ? (you === 1 ? 2 : 1) : 1
    recorded.current = false
    setMode(m)
    setLevel(lv)
    setYou(nextYou)
    setGame(newGame())
    setPrefix([])
    setLast(null)
    setLine(
      m === 'two'
        ? `${sides[0]} moves first, up the board.`
        : nextYou === 1
          ? 'You play from the bottom and move first.'
          : 'You play from the bottom; the computer moves first this time…',
    )
  }

  /** display row and column of a square, with the board turned when it is */
  const view = (i: number) => (flip ? [7 - rowOf(i), 7 - colOf(i)] : [rowOf(i), colOf(i)])
  const fromView = (r: number, c: number) => (flip ? at(7 - r, 7 - c) : at(r, c))
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const [r, c] = view(cursor)
    let next = -1
    if (e.key === 'ArrowLeft') next = fromView(r, c - 2)
    else if (e.key === 'ArrowRight') next = fromView(r, c + 2)
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const nr = r + (e.key === 'ArrowUp' ? -1 : 1)
      next = fromView(nr, c + 1) >= 0 ? fromView(nr, c + 1) : fromView(nr, c - 1)
    } else return
    e.preventDefault()
    e.stopPropagation()
    if (next < 0) return
    setCursor(next)
    refs.current[next]?.focus()
  }

  const describe = (i: number) => {
    const p = game.board[i]
    const o = owner(p)
    const what = o ? `${sides[o - 1]} ${isKing(p) ? 'king' : 'man'}` : 'empty'
    const extra = [
      prefix[0] === i ? 'picked' : '',
      lit.has(i) ? 'can go here' : '',
      jumped.has(i) ? 'being taken' : '',
      saved.hints && yours && !prefix.length && movable.has(i) ? 'can move' : '',
    ].filter(Boolean)
    return `${squareName(i)}: ${what}${extra.length ? `, ${extra.join(', ')}` : ''}`
  }

  const record = saved.record[saved.level]
  const marks = new Set(last ? [...last.path, ...last.taken] : [])
  return (
    <div className={`lab-keys dr-room is-${saved.board} pieces-${saved.pieces}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Opponent">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'bot'}
            onClick={() => fresh('bot')}
          >
            Against the computer
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'two'}
            onClick={() => fresh('two')}
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
                  if (!last || game.winner) fresh(mode, l)
                }}
              >
                {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
        )}
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>

      <div className="dice-scores">
        {([1, 2] as Who[]).map((w) => (
          <div key={w} className={`dice-score${game.turn === w && !game.winner ? ' is-up' : ''}`}>
            <span>
              {nameOf(w)} · {sides[w - 1].toLowerCase()}
            </span>
            <strong>{count(game, w)}</strong>
            <span className="muted">
              {game.board.filter((p) => owner(p) === w && isKing(p)).length || 'no'} king
              {game.board.filter((p) => owner(p) === w && isKing(p)).length === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="dr-board"
        role="group"
        aria-label="The board. Arrow keys move between the dark squares, Enter picks and moves."
        onKeyDown={onKey}
      >
        {Array.from({ length: 64 }, (_, k) => {
          const r = k >> 3
          const c = k & 7
          const i = fromView(r, c)
          if (i < 0) return <div key={k} className="dr-light" aria-hidden />
          const p = game.board[i]
          const o = owner(p)
          return (
            <button
              key={k}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={[
                'dr-sq',
                o ? `is-p${o}` : '',
                isKing(p) ? 'is-king' : '',
                prefix[0] === i ? 'is-picked' : '',
                prefix.slice(1).includes(i) ? 'is-path' : '',
                lit.has(i) ? 'is-lit' : '',
                jumped.has(i) ? 'is-jumped' : '',
                saved.hints && yours && !prefix.length && movable.has(i) ? 'can-move' : '',
                marks.has(i) ? 'is-last' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              tabIndex={i === cursor ? 0 : -1}
              aria-label={describe(i)}
              onFocus={() => setCursor(i)}
              onClick={() => {
                setCursor(i)
                tap(i)
              }}
            >
              <span aria-hidden>{isKing(p) ? '♛' : ''}</span>
            </button>
          )
        })}
      </div>
      {mode === 'bot' && (
        <p className="sun-reading">
          <span className="muted">
            On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.drawn ? `, drawn ${record.drawn}` : ''} · you are {sides[you - 1].toLowerCase()}
          </span>
        </p>
      )}
      {mode === 'bot' && last && !game.winner && level !== saved.level && (
        <p className="muted mc-note">The new level starts with the next game.</p>
      )}

      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Board and pieces</h3>
          <div className="lab-controls" role="group" aria-label="Board">
            {BOARDS.map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={saved.board === b}
                onClick={() => setSaved((s) => ({ ...s, board: b }))}
              >
                {BOARD_NAMES[b]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Pieces">
            {PIECES.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={saved.pieces === p}
                onClick={() => setSaved((s) => ({ ...s, pieces: p }))}
              >
                {SIDES[p].join(' and ')}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Show which pieces can move
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Men move one square diagonally forward. Take by jumping over a piece onto the empty square
        beyond — and when a take is there, you must take it, and keep jumping with the same piece
        while it can. A man that reaches the far row is crowned a king, which moves and takes
        backwards too. Take every piece or leave the other side no move to win. Pick a piece, then
        its square; for a jump of several, pick each landing in turn. Easy looks two moves ahead,
        Fair four and Hard six, and every take is followed to its end. Keys: arrows move between the
        dark squares, Enter picks and moves.
      </p>
    </div>
  )
}
