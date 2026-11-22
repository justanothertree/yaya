import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
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
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'
import { fencesRules, isMove, type FencesGame } from './fencesRoom'
import { useLabRoom } from '../lab/social/useLabRoom'
import { CallTable } from '../lab/social/CallTable'
import { tableSeats } from '../lab/social/table'
import { myTurn } from '../lab/social/room'
import { useLabMatch } from '../lab/matches/useLabMatch'
import { MatchBar, MatchSend } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'

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
  const [saved, setSaved] = useKept(FENCES_KEY, readSaved)
  /** 'call': the room shared with friends in your call (src/lab/social/useLabRoom.ts) */
  const [mode, setMode] = useState<'bot' | 'call'>('bot')
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

  /* ── a match by turns, when the address names one (src/lab/matches/useLabMatch.ts). It takes
     the board over whatever else was showing; leaving it puts the toy back as it was. A move
     shows at once and waits for Send; the server plays it and the board comes back. */
  const lm = useLabMatch('fences')
  const inMatch = !!lm.id
  const signedIn = useSignedIn()
  const matchGame = inMatch ? (lm.shown as FencesGame | null) : null

  /* ── the call's room: the host's size starts each game, which travels as its moves */
  const roomRules = useMemo(() => fencesRules(saved.size), [saved.size])
  const lab = useLabRoom('fences', roomRules)
  const words = tableSeats(lab, roomRules)
  const room = mode === 'call' && !inMatch ? lab.room : null
  /** the game on screen: the match's, the call's in a call, else this one */
  const view = matchGame ? matchGame.g : room ? room.game.g : game
  const viewLast = matchGame ? matchGame.last : room ? room.game.last : last

  const n = view.n
  /** the side you race for: the top one only in seat 1 of a versus game, in a call or a match */
  const you: Who = (
    inMatch
      ? lm.view?.mode === 'versus' && lm.view.you === 1
      : room?.mode === 'versus' && words.mySeat === 1
  )
    ? 1
    : 0
  const them: Who = you === 0 ? 1 : 0
  /**
   * ⚠️ THE BOARD TURNS HALF ROUND FOR WHOEVER RACES FROM THE TOP, so their pawn starts at the
   * bottom like everybody else's. Every place on screen goes through these: a square (r, c) is
   * drawn at (n-1-r, n-1-c), and a fence's crossing (r, c) at (n-2-r, n-2-c), the same way up.
   * Half a turn is its own inverse, so the same two functions read the screen back.
   */
  const flip = you === 1
  const sq = (r: number, c: number): [number, number] => (flip ? [n - 1 - r, n - 1 - c] : [r, c])
  const cross = (r: number, c: number): [number, number] => (flip ? [n - 2 - r, n - 2 - c] : [r, c])
  const yourTurn = inMatch
    ? lm.canPlay
    : room
      ? lab.live && myTurn(roomRules, room)
      : mode === 'bot' && game.winner === null && game.turn === you
  const lit = yourTurn && !fencing ? steps(view) : []
  const litSet = new Set(lit.map(([r, c]) => r * n + c))
  const yourWay = saved.guide ? new Set(path(view, you).map(([r, c]) => r * n + c)) : new Set()
  const theirWay = saved.guide ? new Set(path(view, them).map(([r, c]) => r * n + c)) : new Set()
  const aimOk = yourTurn && fencing && fenceOk(view, aim.o, aim.r, aim.c)
  /** who a side is, on the cards and the squares */
  const nameOf = (w: Who) =>
    inMatch && lm.view
      ? lm.view.mode === 'together'
        ? w === 0
          ? 'You two'
          : 'The computer'
        : w === lm.view.you
          ? 'You'
          : otherName(lm.view)
      : room
        ? room.mode === 'together'
          ? w === 0
            ? 'Together'
            : 'The computer'
          : words.who(room.seats[w])
        : w === you
          ? 'You'
          : `The computer · ${LEVEL_NAMES[level]}`

  const describeMove = (m: Move, by: Who) => {
    const who = by === you ? 'You' : 'The computer'
    if (m.kind === 'step')
      return `${who} ${by === you ? 'step' : 'steps'} to ${sqName(n, ...m.to)}.`
    return `${who} ${by === you ? 'put' : 'puts'} down ${fenceName(n, m.o, m.r, m.c)}.`
  }

  const apply = (m: Move) => {
    if (inMatch) {
      // the move shows at once and waits for Send; the server plays it
      if (!yourTurn || !isMove(view, m)) return false
      lm.play(m)
      setFencing(false)
      setArmed(false)
      return true
    }
    if (room) {
      // in the call the host decides: this asks it, and the board comes back with everybody's
      if (!yourTurn || !isMove(view, m)) return false
      lab.act({ t: 'move', move: m })
      setFencing(false)
      setArmed(false)
      return true
    }
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
    if (mode !== 'bot' || inMatch || game.winner !== null || game.turn === you) return
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
  /* leaving a match, the toy starts afresh rather than playing on from somebody else's board */
  const wasInMatch = useRef(inMatch)
  useEffect(() => {
    if (wasInMatch.current && !inMatch) {
      setMode('bot')
      fresh()
    }
    wasInMatch.current = inMatch
    // only leaving the match starts a game
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMatch])
  /**
   * ⚠️ A SEATED PLAYER LEFT ALONE carries on against the computer, which always races from the
   * top: the board on screen comes with you when yours is the bottom side, else a new game.
   */
  const carryOn = () => {
    const r = room ?? lab.room
    setMode('bot')
    if (!r || r.game.g.winner !== null || you !== 0) return fresh()
    recorded.current = false
    setGame(r.game.g)
    setLast(r.game.last)
    setMine(0)
    setFencing(false)
    setArmed(false)
    setLine(r.game.g.turn === 0 ? 'Your move.' : 'The computer is thinking…')
  }

  /** the groove crossing nearest a point on the board */
  const crossingAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = board.current!.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * n
    const y = ((e.clientY - box.top) / box.height) * n
    const clamp = (v: number) => Math.max(0, Math.min(n - 2, v))
    const [r, c] = cross(clamp(Math.round(y) - 1), clamp(Math.round(x) - 1))
    return { r, c }
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
      fenceOk(view, aim.o, r, c)
        ? `Aiming ${fenceName(n, aim.o, r, c)}. Tap it again to put it down, or ⟲ to turn it.`
        : `No fence there: ${whyNot(r, c)}.`,
    )
  }
  const whyNot = (r: number, c: number) => TROUBLE[fenceTrouble(view, aim.o, r, c) ?? 'off']
  const turnFence = () => setAim((a) => ({ ...a, o: a.o === 'h' ? 'v' : 'h' }))

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key
    if (k === 'f' || k === 'F') {
      if (yourTurn && view.left[you]) setFencing((f) => !f)
    } else if (k === 'r' || k === 'R') {
      if (fencing) turnFence()
    } else if (fencing && (k === 'Enter' || k === ' ')) {
      if (!apply({ kind: 'fence', o: aim.o, r: aim.r, c: aim.c }))
        setLine(`No fence there: ${whyNot(aim.r, aim.c)}.`)
    } else if (k.startsWith('Arrow')) {
      // on a turned board every arrow means its opposite in the board's own rows and columns
      const way = flip ? -1 : 1
      const dr = (k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0) * way
      const dc = (k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0) * way
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
  const fenceStyle = (o: Orient, br: number, bc: number) => {
    const [r, c] = cross(br, bc)
    return o === 'h'
      ? { left: `${c * cell + cell * 0.08}%`, top: `${(r + 1) * cell}%`, width: `${cell * 1.84}%` }
      : { top: `${r * cell + cell * 0.08}%`, left: `${(c + 1) * cell}%`, height: `${cell * 1.84}%` }
  }
  const placed: Aim[] = []
  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      if (view.h[r * (n - 1) + c]) placed.push({ o: 'h', r, c })
      if (view.v[r * (n - 1) + c]) placed.push({ o: 'v', r, c })
    }
  const isLast = (f: Aim) =>
    viewLast?.kind === 'fence' && viewLast.o === f.o && viewLast.r === f.r && viewLast.c === f.c
  const record = saved.record[saved.level]

  return (
    <div className={`lab-keys fe-room is-${saved.theme}`}>
      {inMatch && <MatchBar lm={lm} sides={['the bottom', 'the top']} />}
      {!inMatch && (
        <div className="lab-controls">
          {(lab.live || mode === 'call') && (
            <div className="lab-group" role="group" aria-label="Opponent">
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'bot'}
                onClick={() => {
                  setMode('bot')
                  fresh()
                }}
              >
                Against the computer
              </button>
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'call'}
                onClick={() => {
                  setMode('call')
                  setFencing(false)
                  setArmed(false)
                }}
              >
                👥 With the call
              </button>
            </div>
          )}
          {mode === 'bot' && (
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
          )}
          {mode === 'bot' && (
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
          )}
          {mode === 'bot' && (
            <button className="btn btn-ghost" onClick={() => fresh()}>
              ↻ New game
            </button>
          )}
          {signedIn && mode === 'bot' && !inMatch && (
            <MatchChallenge
              demo="fences"
              settings={{ size: saved.size }}
              levelNames={LEVEL_NAMES}
            />
          )}
        </div>
      )}
      {mode === 'call' && !inMatch && (
        <CallTable
          table={lab}
          rules={roomRules}
          sides={['the bottom', 'the top']}
          levelNames={LEVEL_NAMES}
          score={(d) => (d.g.winner === null ? null : ' — first to the far edge')}
          onCarryOn={carryOn}
        />
      )}

      <div className="dice-scores">
        {([you, them] as Who[]).map((w) => (
          <div
            key={w}
            className={`dice-score fe-score-${w}${view.turn === w && view.winner === null ? ' is-up' : ''}`}
          >
            <span>{nameOf(w)}</span>
            <strong>{dist(view, w)}</strong>
            <span className="muted">
              to go · {view.left[w]} fence{view.left[w] === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
      {mode === 'bot' && !inMatch && (
        <p className="mc-line" aria-live="polite">
          {line}
        </p>
      )}

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
            disabled={!view.left[you] || view.winner !== null}
            onClick={() => setFencing(true)}
          >
            ▭ Fence ({view.left[you]})
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
          {Array.from({ length: n * n }, (_, k) => {
            const [r, c] = sq(Math.floor(k / n), k % n)
            const i = r * n + c
            const here = (w: Who) => view.pos[w][0] === r && view.pos[w][1] === c
            const at = here(you) ? you : here(them) ? them : null
            // against the computer the words stay as they were; in a call, the seat's own name
            const who =
              at === null
                ? ''
                : !room && !inMatch
                  ? at === you
                    ? 'you'
                    : 'the computer'
                  : nameOf(at)
            const notes = [
              litSet.has(i) ? 'you can step here' : '',
              yourWay.has(i) ? 'on your shortest way' : '',
              theirWay.has(i)
                ? `on ${room || inMatch ? 'the other side’s' : 'the computer’s'} shortest way`
                : '',
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
                  viewLast?.kind === 'step' && viewLast.to[0] === r && viewLast.to[1] === c
                    ? 'is-last'
                    : '',
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
                {at !== null && <span className={`fe-pawn is-${at}`} aria-hidden />}
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

      {inMatch && <MatchSend lm={lm} />}
      {mode === 'bot' && !inMatch && (
        <p className="sun-reading">
          <span className="muted">
            On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.best ? ` · fastest win ${record.best} moves` : ''}
          </span>
        </p>
      )}
      {mode === 'bot' && !inMatch && !untouched && (level !== saved.level || n !== saved.size) && (
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
