import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react'
import {
  LAMPS_KEY,
  LOOKS,
  PATTERNS,
  SIZES,
  dark,
  keepBest,
  make,
  press,
  readSaved,
  reach,
  seedFor as daySeedFor,
  solve,
  type Pattern,
  type Saved,
  type Size,
} from './lamps'
import { dayNumber } from './daily'
import { useKept } from './kept'
import { lampsRules } from './lampsRoom'
import { useLabRoom } from '../lab/social/useLabRoom'
import { CallTable } from '../lab/social/CallTable'
import { tableSeats } from '../lab/social/table'
import { myTurn } from '../lab/social/room'
import { boardOf, parOf, pressesBoth, type DuelGame } from './lampsDuel'
import { useLabMatch, type LabMatch } from '../lab/matches/useLabMatch'
import { MatchBar } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'
import { myHidden } from '../lab/matches/cloud'
import { BeatBanner, BeatShare } from '../lab/BeatShare'
import { useChallenge } from '../lab/useChallenge'
import { newSeed, outcome, verdict, type Beat } from '../lab/beat'

const LOOK_NAMES: Record<Saved['look'], string> = {
  bulbs: 'Bulbs',
  lanterns: 'Lanterns',
  neon: 'Neon',
}
const PATTERN_NAMES: Record<Pattern, string> = { plus: '✚ Beside', cross: '✖ Corners' }
/* today's board — one function with whatever checks a solve later (lamps.ts seedFor) */
const seedFor = (size: number, pattern: Pattern) => daySeedFor(dayNumber(), size, pattern)

export function LampsDemo() {
  /* a duel by turns, when the address names one (src/lab/matches/useLabMatch.ts): the same board
     for both, the friend's solve sealed by the server until the challenger's is in (lampsDuel.ts) */
  const lm = useLabMatch('lamps', { preview: false })
  // keyed by the match: another duel starts with nothing of this one's presses
  if (lm.id) return <LampsDuel key={lm.id} lm={lm} />
  return <LampsAlone />
}

function LampsAlone() {
  const signedIn = useSignedIn()
  const [saved, setSaved] = useKept(LAMPS_KEY, readSaved)
  /**
   * A friend's board to beat, from the address: its seed, size and pattern, and the presses that
   * switched it off — replayed when the link is read (beat.ts), so the banner can say they work.
   * It is played on your own; a call's room and a duel ignore it.
   */
  const [challenge, leaveChallenge] = useChallenge('lamps')
  const [seed, setSeed] = useState(() => challenge?.seed ?? seedFor(saved.size, saved.pattern))
  const n = saved.size
  const pattern = saved.pattern
  const daily = seed === seedFor(n, pattern)
  /** the link's board is today's board here, so finishing it counts as your own today's */
  const todayEqual = !!challenge && challenge.seed === seedFor(challenge.size, challenge.pattern)
  const onLinkBoard =
    !!challenge && seed === challenge.seed && n === challenge.size && pattern === challenge.pattern
  const fresh = useMemo(() => make(n, pattern, seed), [n, pattern, seed])
  const par = useMemo(() => solve(fresh, n, pattern)!.length, [fresh, n, pattern])
  /**
   * The lamps, kept with the board they belong to. A new size renders once before the effect below
   * can reset anything, and that render drew the old lamps on the new grid — 25 lamps in four
   * columns after 4×4 was pressed on a 5×5 board. Cages crashed the Lab from the same shape (12 Nov);
   * here it was one wrong frame, so the same fix: a render whose board is not the one the lamps were
   * lit on reads the new board
   */
  const [play, setPlay] = useState(() => ({ fresh, lit: fresh }))
  const lit = play.fresh === fresh ? play.lit : fresh
  const setLit = (next: boolean[]) => setPlay({ fresh, lit: next })
  const [history, setHistory] = useState<boolean[][]>([])
  /**
   * Every press on this board, and -1 for each undo — the run, kept with the day's best so the
   * finish can be checked by replaying it (verifyLamps). A ref: nothing on screen reads it.
   */
  const actions = useRef<number[]>([])
  const [presses, setPresses] = useState(0)
  const [hints, setHints] = useState(0)
  const [hint, setHint] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [kept, setCursor] = useState(0)
  /** this board's finish as a link would carry it, kept from the moment it went dark */
  const [finished, setFinished] = useState<Extract<Beat, { game: 'lamps' }> | null>(null)
  // the same for the keyboard's place: on the last lamp of 7×7, 4×4 had no lamp to Tab to for a render
  const cursor = kept < n * n ? kept : 0
  const [line, setLine] = useState(
    'Press a lamp and it switches, and so do the ones beside it. Switch them all off.',
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  // a fresh board whenever the size, pattern or seed changes
  useEffect(() => {
    setPlay({ fresh, lit: fresh })
    setHistory([])
    actions.current = []
    setPresses(0)
    setHints(0)
    setHint(null)
    setDone(false)
    setFinished(null)
    setCursor(0)
  }, [fresh])

  const today = dayNumber()
  const best = saved.bests.find((b) => b.day === today && b.size === n && b.pattern === pattern)

  /* ── the call's room: today's board at the host's size, together or a race */
  const [withCall, setWithCall] = useState(false)
  const roomRules = useMemo(() => lampsRules(today, n, pattern), [today, n, pattern])
  const lab = useLabRoom('lamps', roomRules)
  /** a control that changes the board leaves a link first, so the address names what is on screen */
  const leave = () => {
    if (challenge) leaveChallenge()
  }
  /* a link names its board, written as the size and pattern buttons write them, so every record
     keyed on the size is the board's own. And a link that leaves the address some other way than
     Leave (Back, say) takes its board with it: today's board comes back, as Leave deals it, so a
     link's board never goes on to record as your own. Both wait while the call has the board —
     the call's room is ruled by this size and pattern */
  const lastLink = useRef(challenge)
  useEffect(() => {
    if (withCall) return
    const was = lastLink.current
    lastLink.current = challenge
    if (challenge) {
      setSaved((x) =>
        x.size === challenge.size && x.pattern === challenge.pattern
          ? x
          : { ...x, size: challenge.size, pattern: challenge.pattern },
      )
      setSeed(challenge.seed)
    } else if (was && seed === was.seed && n === was.size && pattern === was.pattern)
      setSeed(seedFor(n, pattern))
    // only a new link, or the call letting go of the board, should run this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge, withCall])
  const words = tableSeats(lab, roomRules)
  const room = withCall ? lab.room : null
  const g = room?.game
  // the board on screen: the one board together; in a race your own, or the first for a watcher
  const mine = g ? (g.boards.length === 1 ? 0 : (words.mySeat ?? 0)) : 0
  const callN = g?.size ?? n
  const callPattern = g?.pattern ?? pattern
  const shownLit = g ? g.lit[mine] : lit
  const callTurn = !!room && lab.live && myTurn(roomRules, room)
  const N = g ? callN : n
  const P = g ? callPattern : pattern
  const on = shownLit.filter(Boolean).length

  const tap = (i: number) => {
    if (room) {
      if (callTurn) lab.act({ t: 'move', move: i })
      return
    }
    if (done) return
    const next = press(lit, n, i, pattern)
    setHistory((h) => [...h.slice(-300), lit])
    actions.current = [...actions.current, i]
    setLit(next)
    setHint(null)
    const count = presses + 1
    setPresses(count)
    if (dark(next)) {
      setDone(true)
      const result: Extract<Beat, { game: 'lamps' }> = {
        game: 'lamps',
        seed,
        size: n,
        pattern,
        presses: [...actions.current],
      }
      setFinished(result)
      /* ⚠️ A LINK'S BOARD IS PRACTICE: its presses were in the address, and "start again" replays
         it. Unless it is today's board here — then it is your own today's, kept as Today's keeps it */
      const onLink = challenge !== null && outcome(result, challenge) !== null
      if (!onLink || daily)
        setSaved((s) => ({
          ...s,
          solvedCount: s.solvedCount + 1,
          bests: daily
            ? keepBest(
                s.bests,
                { day: today, size: n, pattern, presses: count, par, actions: actions.current },
                today,
              )
            : s.bests,
        }))
      setLine(
        `🎉 All dark in ${count} presses${count === par ? ' — that is par, the fewest there are!' : `; par is ${par}.`}${hints ? ` (${hints} hint${hints === 1 ? '' : 's'})` : ''}${challenge ? verdict(result, challenge) : ''}`,
      )
    } else setLine(`${next.filter(Boolean).length} lamps still lit.`)
  }
  const undo = () => {
    const last = history[history.length - 1]
    if (!last || done) return
    setLit(last)
    setHistory((h) => h.slice(0, -1))
    actions.current = [...actions.current, -1]
    setPresses((p) => p + 1)
    setHint(null)
    setLine('Taken back — it still counts as a press.')
  }
  const askHint = () => {
    if (done) return
    const s = solve(lit, n, pattern)
    if (!s || !s.length) return
    // the press nearest the top-left of the shortest way from here, so the hint reads in order
    setHint(s[0])
    setHints((h) => h + 1)
    setCursor(s[0])
    refs.current[s[0]]?.focus()
    setLine(`From here it can be done in ${s.length}. Try the marked lamp.`)
  }
  const restart = () => {
    setLit(fresh)
    setHistory([])
    actions.current = []
    setPresses(0)
    setHints(0)
    setHint(null)
    setDone(false)
    setFinished(null)
    setLine('The same board again, from the start.')
  }

  /** a seat's progress in a race: how many of its lamps are still lit */
  const litOf = (k: number) => g?.lit[k]?.filter(Boolean).length ?? 0
  /** a seated player left alone carries on alone, from the board on screen */
  const carryOn = () => {
    const r = room ?? lab.room
    setWithCall(false)
    if (!r || r.game.winner !== null || r.game.size !== n || r.game.pattern !== pattern) return
    const k = r.game.boards.length === 1 ? 0 : (words.mySeat ?? 0)
    // the call's board, not a link's: carrying it on leaves the link
    leave()
    setFinished(null)
    setSeed(seedFor(n, pattern))
    setPlay({ fresh, lit: r.game.lit[k] })
    actions.current = []
    setHistory([])
    setPresses(r.game.boards[k].length)
    setLine('Carrying on alone, from where the call left it.')
  }

  return (
    <div className={`lab-keys lp-room is-${saved.look}`}>
      {!withCall && challenge && (
        <BeatBanner
          beat={challenge}
          today={todayEqual}
          onLeave={() => {
            leaveChallenge()
            setSeed(seedFor(n, pattern))
          }}
        />
      )}
      {(lab.live || withCall) && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Who with">
            <button
              className="btn btn-ghost"
              aria-pressed={!withCall}
              onClick={() => setWithCall(false)}
            >
              On your own
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={withCall}
              onClick={() => setWithCall(true)}
            >
              👥 With the call
            </button>
          </div>
        </div>
      )}
      {withCall && (
        <CallTable
          table={lab}
          rules={roomRules}
          sides={['Player 1', 'Player 2']}
          together="one board between you"
          anyTime={
            g && g.boards.length === 2
              ? 'A race on the same board: first to switch theirs off wins.'
              : 'Either of you, any lamp, any time.'
          }
          score={(gm) =>
            gm.winner === null
              ? null
              : ` in ${pressed(gm.boards[gm.boards.length === 1 ? 0 : gm.winner].length)}`
          }
          onCarryOn={carryOn}
        />
      )}
      {!withCall && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Board size">
            {SIZES.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={n === s}
                onClick={() => {
                  leave()
                  setSaved((x) => ({ ...x, size: s as Size }))
                  setSeed(seedFor(s, pattern))
                }}
              >
                {s}×{s}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Which lamps a press switches">
            {PATTERNS.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={pattern === p}
                onClick={() => {
                  leave()
                  setSaved((x) => ({ ...x, pattern: p }))
                  setSeed(seedFor(n, p))
                }}
              >
                {PATTERN_NAMES[p]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Which board">
            <button
              className="btn btn-ghost"
              aria-pressed={daily}
              onClick={() => {
                leave()
                setSeed(seedFor(n, pattern))
              }}
            >
              Today’s
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                leave()
                setSeed(newSeed())
              }}
            >
              ⟳ New board
            </button>
          </div>
          {signedIn && (
            <MatchChallenge demo="lamps" settings={{ size: n, pattern }} levelNames={{}} />
          )}
        </div>
      )}
      {g ? (
        <div className="dice-scores">
          {g.boards.length === 2 ? (
            ([0, 1] as const).map((k) => (
              <div key={k} className={`dice-score${k === mine ? ' is-up' : ''}`}>
                <span>{words.who(room!.seats[k])}</span>
                <strong>{litOf(k)}</strong>
                <span className="muted">lit · {pressed(g.boards[k].length)}</span>
              </div>
            ))
          ) : (
            <div className="dice-score is-up">
              <span>Together</span>
              <strong>{litOf(0)}</strong>
              <span className="muted">lit · {pressed(g.boards[0].length)}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="dice-scores">
          <div className="dice-score is-up">
            <span>Presses</span>
            <strong>{presses}</strong>
            <span className="muted">par {par}</span>
          </div>
          <div className="dice-score">
            <span>Lit</span>
            <strong>{on}</strong>
            <span className="muted">
              {hints ? `${hints} hint${hints === 1 ? '' : 's'}` : 'no hints'}
            </span>
          </div>
          <div className="dice-score">
            <span>Today’s best</span>
            <strong>{best ? best.presses : '—'}</strong>
            <span className="muted">
              {daily ? 'today’s board' : onLinkBoard ? 'the link’s board' : 'a random board'}
            </span>
          </div>
        </div>
      )}
      {!withCall && (
        <p className="mc-line" aria-live="polite">
          {line}
        </p>
      )}
      {!withCall && finished && <BeatShare beat={finished} answering={challenge} />}

      <LampGrid
        n={N}
        pattern={P}
        lit={shownLit}
        done={g ? g.winner !== null : done}
        hint={g ? null : hint}
        cursor={cursor}
        setCursor={setCursor}
        refs={refs}
        keysWord={g ? '' : ', H is a hint, U undoes'}
        onPress={tap}
        onKey={(k) => {
          if (room) return false
          if (k === 'h' || k === 'H') askHint()
          else if (k === 'u' || k === 'U') undo()
          else return false
          return true
        }}
      />
      {!withCall && (
        <div className="lab-controls">
          <button className="btn btn-ghost" onClick={undo} disabled={!history.length || done}>
            ↶ Undo
          </button>
          <button className="btn btn-ghost" onClick={askHint} disabled={done}>
            💡 Hint
          </button>
          <button className="btn btn-ghost" onClick={restart}>
            ↺ Start this board again
          </button>
        </div>
      )}

      <p className="sun-reading">
        <span className="muted">Boards cleared: {saved.solvedCount}</span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Lamps</h3>
          <div className="lab-controls" role="group" aria-label="Which lamps">
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
        </section>
      </div>
      <p className="muted lab-hint">
        Press a lamp and it switches — on to off, off to on — and so do its neighbours: the four
        beside it, or with Corners the four on its diagonals. Switch every lamp off. Par is the
        fewest presses that can do it, worked out exactly; pressing a lamp twice undoes it, so no
        lamp ever needs pressing more than once. Today’s board is the same for everyone. Keys:
        arrows move, Enter or Space presses, H is a hint, U undoes.
      </p>
    </div>
  )
}

/**
 * The lamps, as buttons in a grid: arrow keys move, Enter or Space presses, and `onKey` may take
 * other keys (the toy's H and U). The cursor and the buttons are the caller's, so a hint can move
 * the focus to the lamp it names.
 */
function LampGrid({
  n,
  pattern,
  lit,
  done,
  hint,
  cursor,
  setCursor,
  refs,
  keysWord,
  onPress,
  onKey,
}: {
  n: number
  pattern: Pattern
  lit: boolean[]
  done: boolean
  hint: number | null
  cursor: number
  setCursor: (i: number) => void
  refs: MutableRefObject<(HTMLButtonElement | null)[]>
  /** the keys beyond moving and pressing, for the board's name */
  keysWord: string
  onPress: (i: number) => void
  onKey?: (key: string) => boolean
}) {
  const at = cursor < n * n ? cursor : 0
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const r = Math.floor(at / n)
    const c = at % n
    let next = -1
    if (e.key === 'ArrowLeft') next = r * n + Math.max(0, c - 1)
    else if (e.key === 'ArrowRight') next = r * n + Math.min(n - 1, c + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, r - 1) * n + c
    else if (e.key === 'ArrowDown') next = Math.min(n - 1, r + 1) * n + c
    else if (!onKey?.(e.key)) return
    e.preventDefault()
    e.stopPropagation()
    if (next >= 0) {
      setCursor(next)
      refs.current[next]?.focus()
    }
  }
  const switched = new Set(reach(n, at, pattern))
  return (
    <div
      className={`lp-board${done ? ' is-done' : ''}`}
      style={{ ['--lp-n' as string]: n }}
      role="group"
      aria-label={`The lamps, ${n} by ${n}. Arrow keys move, Enter or Space presses${keysWord}.`}
      onKeyDown={keyDown}
    >
      {lit.map((v, i) => (
        <button
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          className={[
            'lp-lamp',
            v ? 'is-on' : '',
            hint === i ? 'is-hint' : '',
            i !== at && switched.has(i) ? 'is-near' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          tabIndex={i === at ? 0 : -1}
          aria-label={`Row ${Math.floor(i / n) + 1}, column ${(i % n) + 1}: ${v ? 'lit' : 'dark'}${hint === i ? ', the hint' : ''}`}
          aria-pressed={v}
          onFocus={() => setCursor(i)}
          onClick={() => {
            setCursor(i)
            onPress(i)
          }}
        >
          <span aria-hidden />
        </button>
      ))}
    </div>
  )
}

/** a number of presses, said as one says it */
const pressed = (k: number) => `${k} ${k === 1 ? 'press' : 'presses'}`

/**
 * A duel by turns: both switch off one board, each on their own, and the fewer presses wins. The
 * friend's solve is sealed until the challenger's is in, so neither knows the number to beat.
 */
function LampsDuel({ lm }: { lm: LabMatch }) {
  const [saved] = useKept(LAMPS_KEY, readSaved)
  const x = lm.shown as DuelGame | null
  const side: 0 | 1 = lm.view?.you === 1 ? 1 : 0
  const theirs: 0 | 1 = side === 0 ? 1 : 0
  const them = lm.view ? otherName(lm.view) : 'They'
  const board = x ? boardOf(x) : null
  const n = x?.size ?? 5
  const pattern = x?.pattern ?? 'plus'
  const [lit, setLit] = useState<boolean[] | null>(null)
  const [history, setHistory] = useState<boolean[][]>([])
  const [actions, setActions] = useState<number[]>([])
  const [cursor, setCursor] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [sealedMine, setSealedMine] = useState<number[] | null>(null)
  const seq = lm.view?.seq
  const sealed = !!x?.sealed
  useEffect(() => {
    // the friend's own sealed solve, from lab-move: the state says only that one is in
    if (!lm.id || !sealed || side !== 1) return
    let live = true
    myHidden(lm.id)
      .then((d) => {
        if (live) setSealedMine(Array.isArray(d) ? (d as number[]) : null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [lm.id, seq, sealed, side])
  if (!x || !board)
    return (
      <div className={`lab-keys lp-room is-${saved.look}`}>
        <MatchBar lm={lm} sides={['solves second', 'solves first']} />
      </div>
    )

  const par = parOf(x)!
  const both = pressesBoth(x)
  const myGo = lm.canPlay
  const now = lit ?? board
  const isDark = !now.some(Boolean)
  const tap = (i: number) => {
    if (!myGo || isDark) return
    setHistory((h) => [...h, now])
    setActions((a) => [...a, i])
    setLit(press(now, n, i, pattern))
  }
  const undo = () => {
    const last = history[history.length - 1]
    if (!last || isDark) return
    setLit(last)
    setHistory((h) => h.slice(0, -1))
    setActions((a) => [...a, -1])
  }
  const restart = () => {
    setLit(null)
    setHistory([])
    setActions([])
  }
  const line = (() => {
    if (both) {
      const [me, other] = [both[side], both[theirs]]
      const how = `You ${pressed(me)}, ${them} ${pressed(other)}; par is ${par}.`
      return me < other ? `🏆 ${how}` : me > other ? `${them} wins. ${how}` : `A draw. ${how}`
    }
    if (!myGo)
      return side === 1
        ? `Your solve is in${sealedMine ? ` — ${pressed(sealedMine.length)}` : ''}, sealed until ${them}’s is in.`
        : `${them} is solving it. Yours comes after, and theirs stays sealed until you send it.`
    if (isDark) return `All dark in ${pressed(actions.length)}. Send it, or start again for fewer.`
    return side === 0
      ? `${them}’s solve is in, sealed. Switch every lamp off in as few presses as you can: par is ${par}.`
      : `Switch every lamp off in as few presses as you can: par is ${par}. ${them} solves the same board after you, without seeing yours.`
  })()
  return (
    <div className={`lab-keys lp-room is-${saved.look}`}>
      <MatchBar lm={lm} sides={['solves second', 'solves first']} />
      <div className="dice-scores">
        <div className="dice-score is-up">
          <span>{both ? 'You' : 'Presses'}</span>
          <strong>{both ? both[side] : myGo ? actions.length : '—'}</strong>
          <span className="muted">par {par}</span>
        </div>
        <div className="dice-score">
          <span>{them}</span>
          <strong>{both ? both[theirs] : '?'}</strong>
          <span className="muted">
            {both ? 'presses' : sealed || side === 1 ? 'sealed' : 'solving'}
          </span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>
      {!myGo && <p className="muted">The board as it began:</p>}
      <LampGrid
        n={n}
        pattern={pattern}
        lit={myGo ? now : board}
        done={!myGo || isDark}
        hint={null}
        cursor={cursor}
        setCursor={setCursor}
        refs={refs}
        keysWord={myGo ? ', U undoes' : ''}
        onPress={tap}
        onKey={(k) => {
          if (!myGo || (k !== 'u' && k !== 'U')) return false
          undo()
          return true
        }}
      />
      {myGo && (
        <div className="lab-controls">
          <button className="btn btn-ghost" onClick={undo} disabled={!history.length || isDark}>
            ↶ Undo
          </button>
          <button className="btn btn-ghost" onClick={restart} disabled={!actions.length}>
            ↺ Start again
          </button>
          <button
            className="btn"
            disabled={!isDark || lm.busy}
            onClick={() => lm.commit({ solve: actions })}
          >
            {isDark ? `Send my solve — ${pressed(actions.length)}` : 'Switch them all off to send'}
          </button>
        </div>
      )}
      <p className="muted lab-hint">
        A duel by turns: the same {n}×{n} board for you both, made by the server when the challenge
        was accepted. Each of you switches it off alone, and the fewer presses wins — an undo
        counts, as it does in the toy. The first solve is sealed until the second is in. No hints
        here.
      </p>
    </div>
  )
}
