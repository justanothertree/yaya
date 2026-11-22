import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  DOMINOES_KEY,
  LEVELS,
  STYLES,
  TARGETS,
  choose,
  deal,
  drawOrPass,
  ends,
  fits,
  lay,
  playable,
  readSaved,
  same,
  type Level,
  type Round,
  type Saved,
  type Side,
  type Tile,
} from './dominoes'
import { motionReduced as reduced } from '../ui/motion'
import { PIPS } from './pips'
import { useKept } from './kept'
import { totals as dominoTotals, type DominoGame } from './dominoesRoom'
import { useLabMatch, type LabMatch } from '../lab/matches/useLabMatch'
import { MatchBar } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'
import { myHidden } from '../lab/matches/cloud'

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const STYLE_NAMES: Record<Saved['style'], string> = {
  ivory: 'Ivory',
  ebony: 'Ebony',
  candy: 'Candy',
}
const WORDS = ['blank', 'one', 'two', 'three', 'four', 'five', 'six']
const tileName = (t: [number, number]) => `${WORDS[t[0]]}–${WORDS[t[1]]}`

/** where the pips sit on a half, for each number, in a 3 × 3 */
function Half({ n, x }: { n: number; x: number }) {
  return (
    <>
      {PIPS[n].map((k) => (
        <circle key={k} cx={x + 8.5 + (k % 3) * 8} cy={7 + Math.floor(k / 3) * 8} r={2.4} />
      ))}
    </>
  )
}
function Domino({ a, b }: { a: number; b: number }) {
  return (
    <svg className="dm-tile" viewBox="0 0 66 30" aria-hidden>
      <rect x={1} y={1} width={64} height={28} rx={5} className="dm-face" />
      <line x1={33} y1={4} x2={33} y2={26} className="dm-bar" />
      <g className="dm-pips">
        <Half n={a} x={0} />
        <Half n={b} x={33} />
      </g>
    </svg>
  )
}

export function DominoesDemo() {
  /* a match by turns, when the address names one (src/lab/matches/useLabMatch.ts): the hands and
     boneyard kept back by the server (dominoesRoom.ts), each player's own fetched from lab-move */
  const lm = useLabMatch('dominoes', { preview: false })
  if (lm.id) return <DominoesMatch lm={lm} />
  return <DominoesAlone />
}

function DominoesAlone() {
  const signedIn = useSignedIn()
  const [saved, setSaved] = useKept(DOMINOES_KEY, readSaved)
  const [level, setLevel] = useState<Level>(saved.level)
  const [round, setRound] = useState<Round>(() => deal((Math.random() * 2 ** 31) | 0, 0))
  const [totals, setTotals] = useState<[number, number]>([0, 0])
  const [picked, setPicked] = useState<Tile | null>(null)
  const [line, setLine] = useState('Your lead: lay any tile to start the line.')
  const [cursor, setCursor] = useState(0)
  const [over, setOver] = useState(false)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const timer = useRef(0)
  const levelRef = useRef(level)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const settle = (r: Round, t: [number, number]) => {
    const o = r.over!
    const next: [number, number] = [...t]
    if (o.winner !== null) next[o.winner] += o.points
    setTotals(next)
    const why =
      o.why === 'out'
        ? `${o.winner === 0 ? 'You are' : 'The computer is'} out`
        : 'The line is blocked'
    const gain =
      o.winner === null
        ? 'a tie — no points'
        : `${o.winner === 0 ? 'you score' : 'the computer scores'} ${o.points}`
    if (Math.max(...next) >= saved.target) {
      const won = next[0] > next[1]
      const lv = levelRef.current
      setSaved((s) => ({
        ...s,
        record: {
          ...s.record,
          [lv]: { won: s.record[lv].won + (won ? 1 : 0), lost: s.record[lv].lost + (won ? 0 : 1) },
        },
      }))
      setOver(true)
      setLine(
        `${why}: ${gain}. ${won ? '🏆 You win the game' : 'The computer wins the game'}, ${Math.max(...next)} to ${Math.min(...next)}.`,
      )
    } else setLine(`${why}: ${gain}. Next round when you are ready.`)
  }

  /** the computer's turn, an action at a time: lay, or draw (and look again), or pass */
  const computer = (r: Round, t: [number, number]) => {
    const gap = reduced() ? 150 : 650
    timer.current = window.setTimeout(() => {
      if (r.over) return
      const c = choose(r, levelRef.current)
      let next: Round
      if (c) {
        next = lay(r, c.tile, c.side)
        setLine(`The computer lays ${tileName(c.tile)}.`)
      } else {
        next = drawOrPass(r)
        setLine(
          r.yard.length
            ? 'The computer draws from the boneyard…'
            : 'The computer cannot play, and passes.',
        )
      }
      setRound(next)
      if (next.over) return settle(next, t)
      if (next.turn === 1) computer(next, t)
      else
        setLine((l) => `${l} Your turn.${playable(next, 0).length ? '' : ' Nothing fits — draw.'}`)
    }, gap)
  }
  const after = (r: Round) => {
    setRound(r)
    setPicked(null)
    if (r.over) return settle(r, totals)
    if (r.turn === 1) {
      setLine('The computer is thinking…')
      computer(r, totals)
    }
  }
  const tap = (t: Tile) => {
    if (over || round.over || round.turn !== 0) return
    const sides = fits(round, t)
    if (!sides.length) return setLine(`${tileName(t)} does not match either end.`)
    if (sides.length === 1) return after(lay(round, t, sides[0]))
    setPicked(t)
    setLine(`${tileName(t)} fits both ends — which side?`)
  }
  const draw = () => {
    if (round.turn !== 0 || round.over || playable(round, 0).length) return
    const next = drawOrPass(round)
    if (next.turn === 1) setLine('You pass.')
    else setLine(`You draw ${tileName(next.hands[0][next.hands[0].length - 1])}.`)
    after(next)
  }
  const nextRound = (fresh = false) => {
    window.clearTimeout(timer.current)
    const first = (fresh ? 0 : round.over && round.over.winner === 1 ? 1 : 0) as 0 | 1
    if (fresh) {
      setTotals([0, 0])
      setOver(false)
      levelRef.current = saved.level
      setLevel(saved.level)
    }
    const r = deal((Math.random() * 2 ** 31) | 0, first)
    setRound(r)
    setPicked(null)
    setCursor(0)
    if (first === 1) {
      setLine('The computer leads this round…')
      computer(r, fresh ? [0, 0] : totals)
    } else setLine('Your lead: lay any tile to start the line.')
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const n = Math.max(
      0,
      Math.min(round.hands[0].length - 1, cursor + (e.key === 'ArrowLeft' ? -1 : 1)),
    )
    setCursor(n)
    refs.current[n]?.focus()
  }

  const e = ends(round)
  const can = new Set(
    round.turn === 0 && !round.over ? playable(round, 0).map((t) => t.join()) : [],
  )
  const mustDraw = round.turn === 0 && !round.over && !can.size
  const r = saved.record[saved.level]
  return (
    <div className={`lab-keys dm-room is-${saved.style}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer plays">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (over || (totals[0] + totals[1] === 0 && !round.line.length)) {
                  levelRef.current = l
                  setLevel(l)
                }
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="Play to">
          {TARGETS.map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.target === n}
              onClick={() => setSaved((s) => ({ ...s, target: n }))}
            >
              To {n}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => nextRound(true)}>
          ↻ New game
        </button>
        {signedIn && (
          <MatchChallenge
            demo="dominoes"
            settings={{ target: saved.target }}
            levelNames={LEVEL_NAMES}
          />
        )}
      </div>
      <div className="dice-scores">
        <div className={`dice-score${round.turn === 0 && !round.over ? ' is-up' : ''}`}>
          <span>You</span>
          <strong>{totals[0]}</strong>
          <span className="muted">{round.hands[0].length} tiles</span>
        </div>
        <div className={`dice-score${round.turn === 1 && !round.over ? ' is-up' : ''}`}>
          <span>The computer · {LEVEL_NAMES[level]}</span>
          <strong>{totals[1]}</strong>
          <span className="muted">
            {round.hands[1].length} tiles · boneyard {round.yard.length}
          </span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="dm-table">
        <div
          className="dm-theirs"
          role="img"
          aria-label={`The computer holds ${round.hands[1].length} tiles`}
        >
          {round.hands[1].map((_, k) => (
            <span key={k} className="dm-back" />
          ))}
        </div>
        <div
          className="dm-line"
          role="img"
          aria-label={
            e
              ? `The line, ${round.line.length} tiles: the left end is ${e[0]}, the right end ${e[1]}`
              : 'The table is empty'
          }
        >
          {round.line.map((l, k) => (
            <span
              key={k}
              className={`dm-laid${k === 0 || k === round.line.length - 1 ? ' is-end' : ''}${l.a === l.b ? ' is-double' : ''}`}
            >
              <Domino a={l.a} b={l.b} />
            </span>
          ))}
          {!round.line.length && <span className="muted">The line starts here.</span>}
        </div>
        {e && (
          <p className="dm-ends" aria-hidden>
            ends: <strong>{e[0]}</strong> and <strong>{e[1]}</strong>
          </p>
        )}
      </div>

      {picked && (
        <div className="lab-controls" role="group" aria-label="Which end">
          {(['left', 'right'] as Side[]).map((sd) => (
            <button key={sd} className="btn" onClick={() => after(lay(round, picked, sd))}>
              On the {sd} ({sd === 'left' ? e![0] : e![1]})
            </button>
          ))}
          <button className="btn btn-ghost" onClick={() => setPicked(null)}>
            Not this one
          </button>
        </div>
      )}
      <div
        className="dm-hand"
        role="group"
        aria-label="Your tiles. Left and right arrows move along them, Enter lays one."
        onKeyDown={onKey}
      >
        {round.hands[0].map((t, k) => {
          const ok = can.has(t.join())
          return (
            <button
              key={t.join()}
              ref={(el) => {
                refs.current[k] = el
              }}
              className={`dm-mine${ok && saved.hints ? ' is-ok' : ''}${picked && same(picked, t) ? ' is-picked' : ''}`}
              tabIndex={k === cursor ? 0 : -1}
              aria-label={`${tileName(t)}${ok ? ', fits' : ''}`}
              onFocus={() => setCursor(k)}
              onClick={() => {
                setCursor(k)
                tap(t)
              }}
            >
              <Domino a={t[0]} b={t[1]} />
            </button>
          )
        })}
      </div>
      <div className="lab-controls">
        {mustDraw && (
          <button className="btn" onClick={draw}>
            {round.yard.length ? `Draw from the boneyard (${round.yard.length})` : 'Pass'}
          </button>
        )}
        {round.over && !over && (
          <button className="btn" onClick={() => nextRound()}>
            ▶ Next round
          </button>
        )}
        {over && (
          <button className="btn" onClick={() => nextRound(true)}>
            ↻ New game
          </button>
        )}
      </div>
      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {r.won}, lost {r.lost}
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
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Light up what fits
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Lay a tile whose number matches an open end of the line. With nothing that fits, draw from
        the boneyard until something does, and pass when it is empty. Out first and you score the
        pips left in the computer's hand; if neither of you can play, the lighter hand scores the
        difference. First to the target wins. Easy lays anything that fits; Fair keeps its hand
        varied and sheds heavy tiles; Hard also remembers what you could not follow and counts the
        tiles it has not seen. Keys: left and right arrows move along your tiles, Enter lays one.
      </p>
    </div>
  )
}

/** a match by turns: the line both players see, and my own tiles as lab-move shows them */
function DominoesMatch({ lm }: { lm: LabMatch }) {
  const [saved] = useKept(DOMINOES_KEY, readSaved)
  const g = lm.shown as DominoGame | null
  const together = lm.view?.mode === 'together'
  const side: 0 | 1 = together ? 0 : lm.view?.you === 1 ? 1 : 0
  const theirs: 0 | 1 = side === 0 ? 1 : 0
  const them = !lm.view ? 'They' : together ? 'The computer' : otherName(lm.view)
  const myName = together ? 'You two' : 'You'
  const [hand, setHand] = useState<Tile[] | null>(null)
  const [picked, setPicked] = useState<Tile | null>(null)
  /** the hand at the last look, and which round it was in: a new deal is not a draw */
  const before = useRef<{ hand: Tile[]; round: number } | null>(null)
  const [fresh, setFresh] = useState<string[]>([])
  const seq = lm.view?.seq
  const round = g?.done.length ?? 0
  const active = lm.view?.status === 'active' || lm.view?.status === 'finished'
  useEffect(() => {
    if (!lm.id || !active) return
    let live = true
    myHidden(lm.id)
      .then((h) => {
        if (!live || !Array.isArray(h)) return
        const now = h as Tile[]
        const was = before.current?.round === round ? before.current.hand : null
        // tiles that have just come from the boneyard, to be found in the hand
        setFresh(
          was && now.length > was.length
            ? now.filter((t) => !was.some((x) => same(x, t))).map((t) => t.join())
            : [],
        )
        before.current = { hand: now, round }
        setHand(now)
        setPicked(null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [lm.id, seq, active, round])
  if (!g)
    return (
      <div className="lab-keys dm-room">
        <MatchBar lm={lm} sides={['the first to lay', 'the second']} />
      </div>
    )
  const table = { line: g.line } as unknown as Round
  const e = ends(table)
  const t = dominoTotals(g)
  const myTurn = lm.canPlay
  const can = new Set(
    myTurn && hand ? hand.filter((x) => fits(table, x).length).map((x) => x.join()) : [],
  )
  const mustDraw = myTurn && !!hand && !can.size
  const last = g.done[g.done.length - 1] ?? null
  const newRound = !!last && g.line.length === 0
  const lastWords = !last
    ? ''
    : last.why === 'out'
      ? `${last.winner === side ? myName : them} went out: +${last.points}.`
      : last.winner === null
        ? 'The line blocked with the hands level: no score.'
        : `The line blocked; ${last.winner === side ? myName.toLowerCase() : them} had the lighter hand: +${last.points}.`
  const words =
    lm.view?.status === 'finished'
      ? lastWords
      : myTurn
        ? `${newRound ? `${lastWords} A new round. ` : ''}${mustDraw ? (g.yardLeft ? 'Nothing fits: draw until something does.' : 'Nothing fits and the boneyard is empty: pass.') : fresh.length ? `You drew ${fresh.length === 1 ? 'a tile' : `${fresh.length} tiles`}. Lay one that fits.` : 'Your tile: lay one that fits.'}`
        : `${newRound ? `${lastWords} ` : ''}${together && lm.view?.turn !== lm.view?.you ? 'Your partner is' : `${them} is`} playing.`
  const layIt = (x: Tile, sd: Side) => {
    setPicked(null)
    lm.commit({ lay: x, side: sd })
  }
  const tap = (x: Tile) => {
    if (!myTurn) return
    const where = fits(table, x)
    if (!where.length) return
    if (where.length === 1 || (e && e[0] === e[1])) layIt(x, where[0])
    else setPicked(x)
  }
  return (
    <div className={`lab-keys dm-room is-${saved.style}`}>
      <MatchBar lm={lm} sides={['the first to lay', 'the second']} />
      <div className="dice-scores">
        <div className={`dice-score${g.turn === side && !g.between ? ' is-up' : ''}`}>
          <span>{myName}</span>
          <strong>{t[side]}</strong>
          <span className="muted">{g.sizes[side]} tiles</span>
        </div>
        <div className={`dice-score${g.turn === theirs && !g.between ? ' is-up' : ''}`}>
          <span>{them}</span>
          <strong>{t[theirs]}</strong>
          <span className="muted">
            {g.sizes[theirs]} tiles · boneyard {g.yardLeft} · to {g.target}
          </span>
        </div>
      </div>
      {words && (
        <p className="mc-line" aria-live="polite">
          {words}
        </p>
      )}
      <div className="dm-table">
        <div className="dm-theirs" role="img" aria-label={`${them} holds ${g.sizes[theirs]} tiles`}>
          {Array.from({ length: g.sizes[theirs] }, (_, k) => (
            <span key={k} className="dm-back" />
          ))}
        </div>
        <div
          className="dm-line"
          role="img"
          aria-label={
            e
              ? `The line, ${g.line.length} tiles: the left end is ${e[0]}, the right end ${e[1]}`
              : 'The table is empty'
          }
        >
          {g.line.map((l, k) => (
            <span
              key={k}
              className={`dm-laid${k === 0 || k === g.line.length - 1 ? ' is-end' : ''}${l.a === l.b ? ' is-double' : ''}`}
            >
              <Domino a={l.a} b={l.b} />
            </span>
          ))}
          {!g.line.length && <span className="muted">The line starts here.</span>}
        </div>
        {e && (
          <p className="dm-ends" aria-hidden>
            ends: <strong>{e[0]}</strong> and <strong>{e[1]}</strong>
          </p>
        )}
      </div>
      {picked && e && (
        <div className="lab-controls" role="group" aria-label="Which end">
          {(['left', 'right'] as Side[]).map((sd) => (
            <button key={sd} className="btn" disabled={lm.busy} onClick={() => layIt(picked, sd)}>
              On the {sd} ({sd === 'left' ? e[0] : e[1]})
            </button>
          ))}
          <button className="btn btn-ghost" onClick={() => setPicked(null)}>
            Not this one
          </button>
        </div>
      )}
      {hand && !g.between && (
        <div className="dm-hand" role="group" aria-label="Your tiles">
          {hand.map((x) => {
            const ok = can.has(x.join())
            return (
              <button
                key={x.join()}
                className={`dm-mine${ok && saved.hints ? ' is-ok' : ''}${picked && same(picked, x) ? ' is-picked' : ''}${fresh.includes(x.join()) ? ' is-new' : ''}`}
                disabled={lm.busy || !ok}
                aria-label={`${tileName(x)}${ok ? ', fits' : ''}${fresh.includes(x.join()) ? ', just drawn' : ''}`}
                onClick={() => tap(x)}
              >
                <Domino a={x[0]} b={x[1]} />
              </button>
            )
          })}
        </div>
      )}
      {mustDraw && (
        <div className="lab-controls">
          <button className="btn" disabled={lm.busy} onClick={() => lm.commit({ draw: true })}>
            {g.yardLeft ? `Draw until something fits (${g.yardLeft} left)` : 'Pass'}
          </button>
        </div>
      )}
      {last && (newRound || lm.view?.status === 'finished') && (
        <section className="dm-last" aria-label="How the last round ended">
          <h3 className="fw-h">Round {g.done.length}: the hands as it ended</h3>
          {([side, theirs] as (0 | 1)[]).map((w) => (
            <div
              key={w}
              className="dm-ended"
              role="img"
              aria-label={`${w === side ? 'Your' : `${them}’s`} last hand: ${last.hands[w].map(tileName).join(', ') || 'empty — out'}`}
            >
              <span className="muted">{w === side ? myName : them}:</span>
              {last.hands[w].length ? (
                last.hands[w].map((x) => <Domino key={x.join()} a={x[0]} b={x[1]} />)
              ) : (
                <span className="muted"> out</span>
              )}
            </div>
          ))}
        </section>
      )}
      <p className="muted lab-hint">
        Dominoes by turns, to {g.target}: each round is dealt by the server and your tiles are shown
        to you alone. Lay a tile that matches an open end; with nothing that fits, draw until
        something does, and pass when the boneyard is empty. Out first scores the pips left in the
        other hand; a blocked line goes to the lighter hand.
        {together ? ' Together, the two of you hold one hand and take its moves in turn.' : ''}
      </p>
    </div>
  )
}
