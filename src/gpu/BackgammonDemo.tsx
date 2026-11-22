import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  BACKGAMMON_KEY,
  BAR,
  BOARDS,
  CHECKERS,
  LEVELS,
  OFF,
  apply,
  choose,
  pips,
  plays,
  readSaved,
  result,
  startPos,
  type Level,
  type Play,
  type Pos,
  type Saved,
  type Step,
  type Who,
} from './backgammon'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'
import { type BackgammonGame, type Turn } from './backgammonRoom'
import { useLabMatch } from '../lab/matches/useLabMatch'
import { MatchBar, MatchSend } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'

type Phase = 'opening' | 'roll' | 'move' | 'cpu' | 'over'
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const BOARD_NAMES: Record<Saved['board'], string> = {
  walnut: 'Walnut',
  felt: 'Felt',
  marble: 'Marble',
}
const CHECKER_NAMES: Record<Saved['checkers'], string> = {
  classic: 'Ivory and ebony',
  jewel: 'Sapphire and ruby',
  sweet: 'Mint and berry',
}
const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']
const roll = (): [number, number] => [
  1 + Math.floor(Math.random() * 6),
  1 + Math.floor(Math.random() * 6),
]
const sameStep = (a: Step, b: Step) => a.from === b.from && a.to === b.to && a.die === b.die
/** the points in the order they are drawn: the top row left to right, then the bottom row left to right */
const TOP = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
const BOTTOM = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
const placeName = (i: number) =>
  i === BAR ? 'the bar' : i === OFF ? 'off the board' : `point ${i + 1}`

export function BackgammonDemo() {
  const [saved, setSaved] = useKept(BACKGAMMON_KEY, readSaved)
  const [level, setLevel] = useState<Level>(saved.level)
  const [pos, setPos] = useState<Pos>(startPos)
  const [phase, setPhase] = useState<Phase>('opening')
  const [dice, setDice] = useState<[number, number] | null>(null)
  /** the turn so far: where it began, every legal whole turn for the roll, and the steps taken */
  const [turn, setTurn] = useState<{ start: Pos; all: Play[]; taken: Step[] } | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [line, setLine] = useState(
    'Each side rolls one die: the higher starts, and plays both numbers.',
  )
  const [cursor, setCursor] = useState(5)
  const refs = useRef(new Map<number, HTMLButtonElement | null>())
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  /* ── a match by turns, when the address names one (src/lab/matches/useLabMatch.ts). The server
     rolls every die (backgammonRoom.ts): a turn is played here step by step as alone, from the
     dice the server rolled, then proposed and sent; the board waits for the next roll. */
  const lm = useLabMatch('backgammon')
  const inMatch = !!lm.id
  const signedIn = useSignedIn()
  const mg = inMatch ? (lm.shown as BackgammonGame | null) : null
  /** my side: the second only in seat 1 of a versus match; together, the team plays the first */
  const me: Who = inMatch && lm.view?.mode === 'versus' && lm.view.you === 1 ? 2 : 1
  const them: Who = me === 1 ? 2 : 1
  /**
   * The board turned half round for the second side, so its checkers run to its own home at the
   * bottom right as the first side's do: point i is drawn where 23 - i would be, and numbered
   * from that side, 24 - i.
   */
  const flip = me === 2
  const top = flip ? TOP.map((i) => 23 - i) : TOP
  const bottom = flip ? BOTTOM.map((i) => 23 - i) : BOTTOM
  const order = [...top, BAR, ...bottom, OFF]
  const num = (i: number) => (flip ? 24 - i : i + 1)
  const together = lm.view?.mode === 'together'
  const theirName = !inMatch || together || !lm.view ? 'the computer' : otherName(lm.view)
  const whose = (w: Who) => (w === me ? 'of yours' : `of ${theirName}’s`)
  const named = (w: Who) => (w === me ? (together ? 'You two' : 'You') : theirName)

  const finish = (p: Pos) => {
    const r = result(p)
    if (!r) return false
    const won = r.winner === 1
    setSaved((s) => {
      const t = s.record[level]
      return {
        ...s,
        record: {
          ...s.record,
          [level]: {
            won: t.won + (won ? 1 : 0),
            lost: t.lost + (won ? 0 : 1),
            points: t.points + (won ? r.points : 0),
            against: t.against + (won ? 0 : r.points),
          },
        },
      }
    })
    const kind = r.points === 3 ? 'a backgammon' : r.points === 2 ? 'a gammon' : 'the game'
    setLine(
      won
        ? `🏆 You win ${kind} — ${r.points} ${r.points === 1 ? 'point' : 'points'}!`
        : `The computer wins ${kind} — ${r.points} ${r.points === 1 ? 'point' : 'points'}.`,
    )
    setPhase('over')
    setTurn(null)
    return true
  }

  /** the computer's whole turn, its checkers moving one step at a time */
  const computer = (p: Pos, d: [number, number]) => {
    setPhase('cpu')
    setDice(d)
    const play = choose(p, 2, d, level)
    if (!play.steps.length) {
      setLine(`The computer rolls ${d[0]}–${d[1]} and cannot move. Your roll.`)
      later(900, () => setPhase('roll'))
      return
    }
    setLine(`The computer rolls ${d[0]}–${d[1]}…`)
    const gap = reduced() ? 0 : 380
    let cur = p
    play.steps.forEach((st, k) => {
      later(500 + gap * k, () => {
        cur = apply(cur, 2, st)
        setPos(cur)
        if (k === play.steps.length - 1 && !finish(cur)) {
          const hits = play.steps.filter((s) => s.hit).length
          setLine(
            `The computer played ${d[0]}–${d[1]}${hits ? `, hitting ${hits === 1 ? 'one of yours' : `${hits} of yours`}` : ''}. Your roll.`,
          )
          setPhase('roll')
        }
      })
    })
  }

  const startTurn = (p: Pos, d: [number, number]) => {
    const all = plays(p, 1, d, true)
    setDice(d)
    if (!all[0].steps.length) {
      setLine(`You roll ${d[0]}–${d[1]} — no move is possible. The computer's turn.`)
      setPhase('cpu')
      later(1100, () => computer(p, roll()))
      return
    }
    setTurn({ start: p, all, taken: [] })
    setPicked(null)
    setPhase('move')
    setLine(
      `You rolled ${d[0]}–${d[1]}${d[0] === d[1] ? ' — a double, four moves' : ''}. ${p.bar[1] ? 'Bring your checker in from the bar first.' : 'Pick a checker, then where it goes.'}`,
    )
  }

  const opening = () => {
    let a = 0
    let b = 0
    while (a === b) [a, b] = roll()
    setDice([a, b])
    if (a > b) {
      setLine(`You roll ${a}, the computer ${b}: you start, playing ${a}–${b}.`)
      startTurn(pos, [a, b])
    } else {
      setLine(`You roll ${a}, the computer ${b}: the computer starts.`)
      setPhase('cpu')
      later(900, () => computer(pos, [b, a]))
    }
  }

  const fresh = (lv: Level = saved.level) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    setLevel(lv)
    setPos(startPos())
    setTurn(null)
    setDice(null)
    setPicked(null)
    setPhase('opening')
    setLine('Each side rolls one die: the higher starts, and plays both numbers.')
  }

  /* the match as the server has it: its board and dice, and a turn to play when it is ours */
  const turnWords = (t: Turn) =>
    t.steps.length
      ? `${named(t.by)} played ${t.dice[0]}–${t.dice[1]}${
          t.steps.some((x) => x.hit)
            ? `, hitting ${t.by === me ? `one of ${theirName}’s` : 'one of yours'}`
            : ''
        }.`
      : `${named(t.by)} rolled ${t.dice[0]}–${t.dice[1]} and could not move.`
  const matchLine = (g: BackgammonGame) => {
    const lastTwo = g.turns.slice(-2).filter((t) => t.by === them || g.turns.length === 1)
    const before = lastTwo.map(turnWords).join(' ')
    if (g.turn === null) {
      const r = result(g.pos)
      if (!r) return 'Three hundred turns and nobody home: a draw.'
      const kind = r.points === 3 ? 'a backgammon' : r.points === 2 ? 'a gammon' : 'the game'
      return `${before} ${named(r.winner)} ${r.winner === me && !together ? 'win' : 'wins'} ${kind} — ${r.points} ${r.points === 1 ? 'point' : 'points'}.`.trim()
    }
    const open =
      g.turns.length === 0 && g.opening
        ? `Opening roll: ${named(1)} ${g.opening[0]}, ${named(2)} ${g.opening[1]}. `
        : ''
    if (lm.hasPending) return 'Your turn is played: send it, and the server rolls for the next.'
    if (g.turn === me && lm.canPlay && g.dice)
      return `${open}${before ? before + ' ' : ''}You rolled ${g.dice[0]}–${g.dice[1]}${g.dice[0] === g.dice[1] ? ' — a double, four moves' : ''}. ${g.pos.bar[me] ? 'Bring your checker in from the bar first.' : 'Pick a checker, then where it goes.'}`
    return `${open}${before ? before + ' ' : ''}${g.turn === me ? 'Your teammate’s roll.' : `${theirName[0].toUpperCase()}${theirName.slice(1)} to play${g.dice ? ` ${g.dice[0]}–${g.dice[1]}` : ''}.`}`
  }
  useEffect(() => {
    if (!inMatch || !mg) return
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    setPos(mg.pos)
    setDice(mg.dice)
    setPicked(null)
    if (lm.canPlay && mg.dice && mg.turn === me) {
      setTurn({ start: mg.pos, all: plays(mg.pos, me, mg.dice, true), taken: [] })
      setPhase('move')
    } else {
      setTurn(null)
      setPhase(mg.turn === null ? 'over' : 'cpu')
    }
    setLine(matchLine(mg))
    // a new board from the server, or my turn coming round, is the only cue
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMatch, mg, lm.canPlay, lm.hasPending])
  /* leaving a match, the toy starts afresh rather than playing on from somebody else's board */
  const wasInMatch = useRef(inMatch)
  useEffect(() => {
    if (wasInMatch.current && !inMatch) fresh()
    wasInMatch.current = inMatch
    // only leaving the match starts a game
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMatch])

  // the steps that may come next: the next step of every legal whole turn that starts with the ones taken
  const fits = turn
    ? turn.all.filter((pl) => turn.taken.every((s, k) => pl.steps[k] && sameStep(pl.steps[k], s)))
    : []
  const nexts = fits.map((pl) => pl.steps[turn!.taken.length]).filter(Boolean)
  const froms = new Set(nexts.map((s) => s.from))
  const targets = new Set(
    picked === null ? [] : nexts.filter((s) => s.from === picked).map((s) => s.to),
  )

  const take = (st: Step) => {
    if (!turn) return
    const next = apply(pos, me, st)
    const taken = [...turn.taken, st]
    setPos(next)
    setPicked(null)
    // in a match the server says when the game is won; alone, the board here does
    if (!inMatch && finish(next)) return
    const more = turn.all.some(
      (pl) => pl.steps.length > taken.length && taken.every((s, k) => sameStep(pl.steps[k], s)),
    )
    if (more) {
      setTurn({ ...turn, taken })
      setLine(
        `${st.hit ? 'Hit! ' : ''}${placeName(st.from)} to ${placeName(st.to)}. ${next.bar[1] ? 'Another from the bar.' : 'Next move.'}`,
      )
    } else if (inMatch) {
      // the whole turn, proposed: Send plays it, and the server rolls for whoever is next
      setTurn(null)
      setPhase('cpu')
      lm.play(taken.map((s) => [s.from, s.to]))
    } else {
      setTurn(null)
      setLine(`${st.hit ? 'Hit! ' : ''}Turn played. The computer rolls…`)
      setPhase('cpu')
      later(600, () => computer(next, roll()))
    }
  }
  const tap = (i: number) => {
    if (phase !== 'move' || !turn) return
    if (picked !== null && targets.has(i)) {
      const st = nexts.find((s) => s.from === picked && s.to === i)!
      take(st)
    } else if (froms.has(i)) setPicked(picked === i ? null : i)
  }
  const undo = () => {
    if (!turn || !turn.taken.length) return
    let p = turn.start
    const taken = turn.taken.slice(0, -1)
    for (const s of taken) p = apply(p, me, s)
    setPos(p)
    setTurn({ ...turn, taken })
    setPicked(null)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key
    if (k === 'u' || k === 'U') return undo()
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return
    e.preventDefault()
    e.stopPropagation()
    let at = order.indexOf(cursor)
    if (k === 'ArrowLeft') at = Math.max(0, at - 1)
    else if (k === 'ArrowRight') at = Math.min(order.length - 1, at + 1)
    else if (k === 'ArrowUp' && at > 12) at = Math.max(0, at - 13)
    else if (k === 'ArrowDown' && at < 13) at = Math.min(order.length - 1, at + 13)
    setCursor(order[at])
    refs.current.get(order[at])?.focus()
  }

  const used = turn ? turn.taken.map((s) => s.die) : []
  const diceShown = dice ? (dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice) : []
  const usedLeft = [...used]
  const diceUsed = diceShown.map((d) => {
    const k = usedLeft.indexOf(d)
    if (k < 0) return false
    usedLeft.splice(k, 1)
    return true
  })

  const stack = (n: number, side: 1 | 2) => {
    const show = Math.min(n, 5)
    return Array.from({ length: show }, (_, k) => (
      <span key={k} className={`bg-man is-p${side}`}>
        {k === show - 1 && n > 5 ? n : ''}
      </span>
    ))
  }
  const point = (i: number, top: boolean) => {
    const c = pos.board[i]
    const n = Math.abs(c)
    const side = c > 0 ? 1 : 2
    const canFrom = phase === 'move' && froms.has(i)
    const isTarget = targets.has(i)
    return (
      <button
        key={i}
        ref={(el) => {
          refs.current.set(i, el)
        }}
        className={[
          'bg-point',
          top ? 'is-top' : 'is-bottom',
          i % 2 ? 'is-odd' : 'is-even',
          picked === i ? 'is-picked' : '',
          isTarget ? 'is-target' : '',
          canFrom && saved.hints && picked === null ? 'can-move' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        tabIndex={cursor === i ? 0 : -1}
        aria-label={`Point ${num(i)}: ${n ? `${n} ${whose(side)}` : 'empty'}${canFrom ? ', can move' : ''}${isTarget ? ', can go here' : ''}${picked === i ? ', picked' : ''}`}
        onFocus={() => setCursor(i)}
        onClick={() => {
          setCursor(i)
          tap(i)
        }}
      >
        <span className="bg-stack">{n ? stack(n, side) : null}</span>
        <span className="bg-num" aria-hidden>
          {num(i)}
        </span>
      </button>
    )
  }

  const r = saved.record[saved.level]
  /** the two sides by the checkers chosen: "ivory" and "ebony", the first side's first */
  const colours = CHECKER_NAMES[saved.checkers].toLowerCase().split(' and ') as [string, string]
  return (
    <div className={`lab-keys bg-room is-${saved.board} men-${saved.checkers}`}>
      {inMatch && <MatchBar lm={lm} sides={colours} />}
      <div className="lab-controls">
        {!inMatch && (
          <div className="lab-group" role="group" aria-label="How well the computer plays">
            {LEVELS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.level === l}
                onClick={() => {
                  setSaved((s) => ({ ...s, level: l }))
                  if (phase === 'opening' || phase === 'over') fresh(l)
                }}
              >
                {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
        )}
        {phase === 'opening' && !inMatch && (
          <button className="btn" onClick={opening}>
            🎲 Opening roll
          </button>
        )}
        {phase === 'roll' && (
          <button className="btn" onClick={() => startTurn(pos, roll())}>
            🎲 Roll
          </button>
        )}
        {phase === 'move' && (
          <button className="btn btn-ghost" onClick={undo} disabled={!turn?.taken.length}>
            ↶ Undo
          </button>
        )}
        {!inMatch && (
          <button className="btn btn-ghost" onClick={() => fresh()}>
            ↻ New game
          </button>
        )}
        {!inMatch && signedIn && (
          <MatchChallenge demo="backgammon" settings={{}} levelNames={LEVEL_NAMES} />
        )}
      </div>

      <p className="mc-line" aria-live="polite">
        {line}
      </p>
      <div
        className="bg-dice"
        aria-label={dice ? `Dice: ${dice[0]} and ${dice[1]}` : 'No dice rolled'}
        role="img"
      >
        {diceShown.map((d, k) => (
          <span
            key={k}
            className={`bg-die${diceUsed[k] && phase === 'move' ? ' is-used' : ''}${phase === 'cpu' ? ' is-theirs' : ''}`}
          >
            {DIE[d]}
          </span>
        ))}
        {saved.pips && (
          <span className="muted bg-pips">
            Pips: you {pips(pos, me)}, {theirName} {pips(pos, them)}
          </span>
        )}
      </div>

      <div
        className="bg-board"
        role="group"
        aria-label="The board. Arrow keys move between points, Enter picks and moves, U undoes."
        onKeyDown={onKey}
      >
        <div className="bg-half is-top">
          {top.slice(0, 6).map((i) => point(i, true))}
          <div className="bg-bar-gap" aria-hidden />
          {top.slice(6).map((i) => point(i, true))}
        </div>
        <button
          ref={(el) => {
            refs.current.set(BAR, el)
          }}
          className={`bg-bar${picked === BAR ? ' is-picked' : ''}${phase === 'move' && froms.has(BAR) && saved.hints && picked === null ? ' can-move' : ''}`}
          tabIndex={cursor === BAR ? 0 : -1}
          aria-label={`The bar: ${pos.bar[me]} of yours, ${pos.bar[them]} of ${theirName}’s${froms.has(BAR) ? ', bring one in' : ''}`}
          onFocus={() => setCursor(BAR)}
          onClick={() => {
            setCursor(BAR)
            tap(BAR)
          }}
        >
          {stack(pos.bar[them], them)}
          {stack(pos.bar[me], me)}
          {!pos.bar[1] && !pos.bar[2] && <span className="muted">bar</span>}
        </button>
        <div className="bg-half is-bottom">
          {bottom.slice(0, 6).map((i) => point(i, false))}
          <div className="bg-bar-gap" aria-hidden />
          {bottom.slice(6).map((i) => point(i, false))}
        </div>
        <button
          ref={(el) => {
            refs.current.set(OFF, el)
          }}
          className={`bg-off${targets.has(OFF) ? ' is-target' : ''}`}
          tabIndex={cursor === OFF ? 0 : -1}
          aria-label={`Borne off: ${pos.off[me]} of yours, ${pos.off[them]} of ${theirName}’s${targets.has(OFF) ? ', bear off here' : ''}`}
          onFocus={() => setCursor(OFF)}
          onClick={() => {
            setCursor(OFF)
            tap(OFF)
          }}
        >
          <span>Off</span>
          <strong>
            {pos.off[me]} · {pos.off[them]}
          </strong>
        </button>
      </div>
      {inMatch && <MatchSend lm={lm} />}
      {!inMatch && (
        <p className="sun-reading">
          <span className="muted">
            Against {LEVEL_NAMES[saved.level]}: won {r.won}, lost {r.lost} · points {r.points} to{' '}
            {r.against}
          </span>
        </p>
      )}
      {!inMatch && level !== saved.level && phase !== 'opening' && phase !== 'over' && (
        <p className="muted mc-note">The new level starts with the next game.</p>
      )}

      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Board and checkers</h3>
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
          <div className="lab-controls" role="group" aria-label="Checkers">
            {CHECKERS.map((c) => (
              <button
                key={c}
                className="btn btn-ghost"
                aria-pressed={saved.checkers === c}
                onClick={() => setSaved((s) => ({ ...s, checkers: c }))}
              >
                {CHECKER_NAMES[c]}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Show which checkers can move
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={saved.pips}
              onClick={() => setSaved((s) => ({ ...s, pips: !s.pips }))}
            >
              Pip counts
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        You play the {colours[me - 1]} checkers, moving round from point 24 to point 1 and then off
        {flip ? ' — your board turned round, so your points count from your side' : ''}. Each die
        moves one checker that many points, onto a point that is empty, yours, or holds a single one
        of theirs — which you hit, sending it to the bar to start again. Two or more of a side on a
        point block it. A checker on the bar must come in before anything else moves. With all
        fifteen in your last six points you bear off. Use both dice if you can; if only one, the
        larger. First to bear off all fifteen wins: double if the other side has borne none off (a
        gammon), triple if one of theirs is still on the bar or in your home (a backgammon). Easy
        judges loosely, Fair carefully, Hard also counts the rolls that would hit each lone checker.
        Keys: arrows move between points, Enter picks and moves, U undoes. Challenge a friend and
        the server rolls every die, so neither of you can see a roll before it is made; the higher
        of the opening roll starts.
      </p>
    </div>
  )
}
