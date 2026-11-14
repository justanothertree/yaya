import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Piece } from './ChessPieces'
import {
  BOARDS,
  CHESS_KEY,
  LEVELS,
  SETS,
  START,
  choose,
  fromFen,
  inCheck,
  kingSq,
  moves,
  outcome,
  play,
  posKey,
  readSaved,
  san,
  sqName,
  type Level,
  type Move,
  type Pos,
  type Saved,
  type Side,
} from './chess'
import { useKept } from './kept'
import { chessRules, uci } from './chessRoom'
import { useLabRoom } from '../lab/social/useLabRoom'
import { CallTable } from '../lab/social/CallTable'
import { useCallWords } from '../lab/social/callWords'
import { myTurn } from '../lab/social/room'

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const BOARD_NAMES: Record<Saved['board'], string> = { wood: 'Wood', green: 'Green', blue: 'Blue' }
const SET_NAMES: Record<Saved['set'], string> = {
  ivory: 'Ivory and ebony',
  coral: 'Coral and teal',
}
const NAMES: Record<string, string> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
}
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const sideName = (s: Side) => (s === 'w' ? 'white' : 'black')

type Turn = { pos: Pos; move: Move | null; name: string }

export function ChessDemo() {
  const [saved, setSaved] = useKept(CHESS_KEY, readSaved)
  const [level, setLevel] = useState<Level>(saved.level)
  const [you, setYou] = useState<Side>('w')
  const [line, setLine] = useState<Turn[]>(() => [{ pos: fromFen(START), move: null, name: '' }])
  const [picked, setPicked] = useState<number | null>(null)
  const [promo, setPromo] = useState<Move[] | null>(null)
  const [thinking, setThinking] = useState(false)
  const [over, setOver] = useState<string | null>(null)
  const [cursor, setCursor] = useState(52)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const recorded = useRef(false)
  const timer = useRef(0)
  /**
   * ⚠️ WHICH SIDE YOU PLAY AND THE LEVEL ARE READ THROUGH REFS. The computer's reply runs from a
   * timer set by an earlier render, and a new game changes both: read from that render's state,
   * the computer's opening move as white thought you were still white too, and went on to play
   * black's move for you.
   */
  const youRef = useRef(you)
  const levelRef = useRef(level)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  /* ── the call's room (src/lab/social/useLabRoom.ts): the game travels as its moves */
  const [withCall, setWithCall] = useState(false)
  const lab = useLabRoom('chess', chessRules)
  const words = useCallWords(lab, chessRules)
  const room = withCall ? lab.room : null
  // the side I move for: white in seat 0 or together, black in seat 1
  const callSide: Side = room && room.mode === 'versus' && words.mySeat === 1 ? 'b' : 'w'
  const callTurn = !!room && lab.live && myTurn(chessRules, room)

  const shown = room ? room.game.turns : line
  const pos = shown[shown.length - 1].pos
  const last = shown[shown.length - 1].move
  const ended = room ? !!room.game.over : !!over
  const legal = ended ? [] : moves(pos)
  // whose pieces are at the bottom, and whose a tap may pick up
  const me: Side = room ? callSide : you

  const finish = (p: Pos, hist: string[]) => {
    const o = outcome(p, hist)
    if (!o) return false
    if (!recorded.current) {
      recorded.current = true
      const lv = levelRef.current
      const r = o.winner === null ? 'drawn' : o.winner === youRef.current ? 'won' : 'lost'
      setSaved((s) => ({
        ...s,
        record: { ...s.record, [lv]: { ...s.record[lv], [r]: s.record[lv][r] + 1 } },
      }))
    }
    setOver(
      o.winner === null
        ? `A draw — ${o.why}.`
        : `${o.winner === youRef.current ? '🏆 You win' : 'The computer wins'} by ${o.why}.`,
    )
    return true
  }
  const advance = (turns: Turn[], m: Move) => {
    const p = turns[turns.length - 1].pos
    const next = play(p, m)
    const out = [...turns, { pos: next, move: m, name: san(p, m) }]
    setLine(out)
    setPicked(null)
    setPromo(null)
    if (
      finish(
        next,
        out.map((t) => posKey(t.pos)),
      )
    )
      return
    if (next.turn !== youRef.current) {
      setThinking(true)
      // a moment for the board to show your move before the search takes the page
      timer.current = window.setTimeout(() => {
        const reply = choose(
          next,
          levelRef.current,
          Math.random,
          out.map((t) => posKey(t.pos)),
        )
        setThinking(false)
        advance(out, reply)
      }, 120)
    }
  }

  /** a move made here: to the room in a call, else against the computer */
  const make = (m: Move) => {
    if (!room) return advance(line, m)
    setPicked(null)
    setPromo(null)
    lab.act({ t: 'move', move: uci(m) })
  }
  const tap = (i: number) => {
    if (room) {
      if (!callTurn || promo) return
      if (picked !== null) {
        const options = legal.filter((m) => m.from === picked && m.to === i)
        if (options.length > 1) return setPromo(options)
        if (options.length === 1) return make(options[0])
      }
      const mine = pos.sq[i] && (pos.sq[i] === pos.sq[i].toUpperCase() ? 'w' : 'b') === callSide
      return setPicked(mine && picked !== i ? i : null)
    }
    if (over || thinking || pos.turn !== you || promo) return
    if (picked !== null) {
      const options = legal.filter((m) => m.from === picked && m.to === i)
      if (options.length > 1) return setPromo(options)
      if (options.length === 1) return advance(line, options[0])
    }
    const mine = pos.sq[i] && (pos.sq[i] === pos.sq[i].toUpperCase() ? 'w' : 'b') === you
    setPicked(mine && picked !== i ? i : null)
  }

  const fresh = (
    lv: Level = saved.level,
    side: Side = line.length > 1 ? (you === 'w' ? 'b' : 'w') : you,
  ) => {
    window.clearTimeout(timer.current)
    recorded.current = false
    setLevel(lv)
    setYou(side)
    levelRef.current = lv
    youRef.current = side
    const start: Turn[] = [{ pos: fromFen(START), move: null, name: '' }]
    setLine(start)
    setPicked(null)
    setPromo(null)
    setOver(null)
    setThinking(false)
    setCursor(side === 'w' ? 52 : 12)
    if (side === 'b') {
      setThinking(true)
      timer.current = window.setTimeout(() => {
        setThinking(false)
        advance(start, choose(start[0].pos, lv))
      }, 300)
    }
  }
  /** take back your last move and the computer's answer */
  const takeBack = () => {
    if (thinking) return
    // drop moves from the end until it is your turn again, at least one of yours gone
    let n = line.length - 1
    while (n > 1 && line[n - 1].pos.turn !== you) n--
    // playing black with only the computer's first move made, there is nothing of yours to take back
    if (n < 1 || line[n - 1].pos.turn !== you) return
    setLine(line.slice(0, n))
    setOver(null)
    setPicked(null)
    recorded.current = false
  }
  const resign = () => {
    if (over || line.length < 2) return
    recorded.current = true
    setSaved((s) => ({
      ...s,
      record: { ...s.record, [level]: { ...s.record[level], lost: s.record[level].lost + 1 } },
    }))
    setOver('You resigned. The computer wins.')
  }

  /**
   * ⚠️ A SEATED PLAYER LEFT ALONE CARRIES ON AGAINST THE COMPUTER from the board on screen,
   * keeping their side — or starts a new game if that one was over.
   */
  const carryOn = () => {
    const r = room ?? lab.room
    setWithCall(false)
    if (!r || r.game.over) return fresh(saved.level, callSide)
    window.clearTimeout(timer.current)
    recorded.current = false
    setLevel(saved.level)
    levelRef.current = saved.level
    setYou(callSide)
    youRef.current = callSide
    const turns = r.game.turns
    setLine(turns)
    setPicked(null)
    setPromo(null)
    setOver(null)
    const p = turns[turns.length - 1].pos
    if (p.turn !== callSide) {
      setThinking(true)
      timer.current = window.setTimeout(() => {
        setThinking(false)
        advance(
          turns,
          choose(
            p,
            levelRef.current,
            Math.random,
            turns.map((t) => posKey(t.pos)),
          ),
        )
      }, 300)
    }
  }

  // the board as drawn: your side at the bottom
  const order = Array.from({ length: 64 }, (_, k) => (me === 'w' ? k : 63 - k))
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }
    if (!d[e.key]) return
    e.preventDefault()
    e.stopPropagation()
    const k = order.indexOf(cursor)
    const r = Math.max(0, Math.min(7, Math.floor(k / 8) + d[e.key][0]))
    const c = Math.max(0, Math.min(7, (k % 8) + d[e.key][1]))
    const next = order[r * 8 + c]
    setCursor(next)
    refs.current[next]?.focus()
  }

  const targets = new Set(
    picked === null ? [] : legal.filter((m) => m.from === picked).map((m) => m.to),
  )
  const checked = inCheck(pos) ? kingSq(pos, pos.turn) : -1
  // what each side has taken, and who is ahead on material
  const taken = { w: [] as string[], b: [] as string[] }
  for (const t of shown)
    if (t.move?.take)
      taken[t.move.piece === t.move.piece.toUpperCase() ? 'w' : 'b'].push(t.move.take.toLowerCase())
  const material = (s: Side) => taken[s].reduce((a, x) => a + VALUE[x], 0)
  const lead = material(me) - material(me === 'w' ? 'b' : 'w')
  const r = saved.record[saved.level]
  const pairs: string[][] = []
  shown
    .slice(1)
    .forEach((t, k) => (k % 2 ? pairs[pairs.length - 1].push(t.name) : pairs.push([t.name])))

  return (
    <div className={`lab-keys ch-room is-${saved.board} set-${saved.set}`}>
      {(lab.live || withCall) && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Opponent">
            <button
              className="btn btn-ghost"
              aria-pressed={!withCall}
              onClick={() => {
                setWithCall(false)
                setPicked(null)
              }}
            >
              Against the computer
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={withCall}
              onClick={() => {
                setWithCall(true)
                setPicked(null)
                setPromo(null)
              }}
            >
              👥 With the call
            </button>
          </div>
        </div>
      )}
      {withCall && (
        <CallTable
          lab={lab}
          rules={chessRules}
          sides={['White', 'Black']}
          levelNames={LEVEL_NAMES}
          score={(g) => (g.over ? ` by ${g.over.why}` : null)}
          onCarryOn={carryOn}
        />
      )}
      {!withCall && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="How well the computer plays">
            {LEVELS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.level === l}
                onClick={() => {
                  setSaved((s) => ({ ...s, level: l }))
                  if (line.length === 1 || over) fresh(l, you)
                }}
              >
                {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
          <button
            className="btn btn-ghost"
            onClick={takeBack}
            disabled={thinking || line.length < 2}
          >
            ↶ Take back
          </button>
          <button className="btn btn-ghost" onClick={resign} disabled={!!over || line.length < 2}>
            Resign
          </button>
          <button className="btn btn-ghost" onClick={() => fresh()}>
            ↻ New game
          </button>
        </div>
      )}
      {withCall ? (
        callTurn && (
          <p className="muted mc-note">
            You play {sideName(callSide)}.{checked >= 0 ? ' Check!' : ''}
            {last ? ` Last move ${shown[shown.length - 1].name}.` : ''}
          </p>
        )
      ) : (
        <p className="mc-line" aria-live="polite">
          {over ??
            (thinking
              ? 'The computer is thinking…'
              : pos.turn === you
                ? `Your move — you play ${sideName(you)}.${checked >= 0 ? ' Check!' : ''}${last ? ` They played ${line[line.length - 1].name}.` : ''}`
                : '')}
        </p>
      )}
      <div className="ch-layout">
        <div
          className="ch-board"
          role="grid"
          aria-label="The board. Arrow keys move between squares, Enter picks a piece and moves it."
          onKeyDown={onKey}
        >
          {order.map((i) => {
            const x = pos.sq[i]
            const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1
            const kind = x.toLowerCase()
            return (
              <button
                key={i}
                ref={(el) => {
                  refs.current[i] = el
                }}
                role="gridcell"
                className={[
                  'ch-sq',
                  dark ? 'is-dark' : 'is-light',
                  picked === i ? 'is-picked' : '',
                  saved.hints && targets.has(i) ? (x ? 'is-take' : 'is-to') : '',
                  last && (last.from === i || last.to === i) ? 'is-last' : '',
                  checked === i ? 'is-check' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                tabIndex={cursor === i ? 0 : -1}
                aria-label={`${sqName(i)}: ${x ? `${x === x.toUpperCase() ? 'white' : 'black'} ${NAMES[kind]}` : 'empty'}${targets.has(i) ? ', can move here' : ''}${picked === i ? ', picked' : ''}`}
                onFocus={() => setCursor(i)}
                onClick={() => {
                  setCursor(i)
                  tap(i)
                }}
              >
                {x && (
                  <Piece kind={kind} side={x === x.toUpperCase() ? 'w' : 'b'} colours={saved.set} />
                )}
              </button>
            )
          })}
        </div>
        <div className="ch-side">
          <p
            className="ch-taken"
            aria-label={`You have taken: ${taken[me].map((t) => NAMES[t]).join(', ') || 'nothing'}`}
          >
            {taken[me].map((t, k) => (
              <Piece
                key={k}
                kind={t}
                side={me === 'w' ? 'b' : 'w'}
                colours={saved.set}
                size="1.5rem"
              />
            ))}
            {lead > 0 && <span className="muted"> +{lead}</span>}
          </p>
          <ol className="ch-moves" aria-label="The moves so far, white then black">
            {pairs.map((p, k) => (
              <li key={k}>
                <span aria-hidden>{k + 1}.</span>
                <span>{p[0]}</span>
                <span>{p[1] ?? ''}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {promo && (
        <div className="lab-controls ch-promo" role="group" aria-label="Promote the pawn to">
          {promo.map((m) => (
            <button key={m.promo} className="btn" onClick={() => make(m)}>
              <Piece kind={m.promo.toLowerCase()} side={me} colours={saved.set} size="1.6rem" />{' '}
              {NAMES[m.promo.toLowerCase()]}
            </button>
          ))}
        </div>
      )}
      {!withCall && (
        <p className="sun-reading">
          <span className="muted">
            Against {LEVEL_NAMES[saved.level]}: won {r.won}, lost {r.lost}
            {r.drawn ? `, drawn ${r.drawn}` : ''} · you play {sideName(you)}, and swap each game
          </span>
        </p>
      )}
      {level !== saved.level && line.length > 1 && !over && (
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
            {SETS.map((st) => (
              <button
                key={st}
                className="btn btn-ghost"
                aria-pressed={saved.set === st}
                onClick={() => setSaved((s) => ({ ...s, set: st }))}
              >
                {SET_NAMES[st]}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Show where a piece can go
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Every rule is here: castling, en passant, promotion to any piece, and draws by stalemate,
        fifty moves, the same position three times, or too little left to mate. Pick a piece, then
        its square. You take turns playing white and black; take back a move whenever you like. Easy
        looks one move ahead and sometimes wanders, Fair two, Hard three — and all of them follow
        every capture to the end before judging. Keys: arrows move between squares, Enter picks and
        moves.
      </p>
    </div>
  )
}
