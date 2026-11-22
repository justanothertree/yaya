import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { LabStage } from './LabStage'
import {
  readSaved,
  type Best,
  ALL,
  FILE_LIMIT,
  N,
  PUZZLES,
  SHADOWBOX_KEY,
  TALL,
  at,
  blocks,
  emptyBuild,
  fewest,
  pickCell,
  matches,
  readBuild,
  shadowsOf,
  type Build,
  type Show,
} from './shadowbox'
import { createShadowbox, type ShadowboxView } from './shadowboxEngine'
import { writeKept } from './kept'
import {
  owesBox,
  randomBox,
  overPar,
  standIn,
  totals,
  waiting,
  type BoxGame,
  type Clue,
} from './shadowboxRoom'
import { useLabMatch } from '../lab/matches/useLabMatch'
import { MatchBar, MatchSend } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Mode = 'puzzle' | 'pass'
/** pass and play: one builds, the device is passed with the box behind a curtain, the other rebuilds */
type Phase = 'build' | 'curtain' | 'guess' | 'reveal'

/* what the toy keeps, read by the toy's module (so the share card reads it the same way) */
const load = () => {
  try {
    return readSaved(localStorage.getItem(SHADOWBOX_KEY))
  } catch {
    return readSaved(null)
  }
}
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const MATCH_LEVELS = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
/** a clue's shadows as a build throws them, for the GPU: the shadows its lamps show, and par */
const castOf = (c: Clue) => standIn(c)
const WALL_NAMES: [keyof Show, string][] = [
  ['front', 'Back wall'],
  ['side', 'Left wall'],
  ['top', 'Floor'],
]

export function ShadowboxDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(load()).current
  const [live, setLive] = useState(false)
  const [mode, setMode] = useState<Mode>('puzzle')
  const [puzzle, setPuzzle] = useState(saved.puzzle)
  const [best, setBest] = useState<Best>(saved.best)
  const [mine, setMine] = useState<Build>(emptyBuild())
  const [phase, setPhase] = useState<Phase>('build')
  const [secret, setSecret] = useState<Build>(emptyBuild())
  const [show, setShow] = useState<Show>(ALL)
  const [checks, setChecks] = useState(0)
  const [shown, setShown] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [cursor, setCursor] = useState(at(2, 2))
  const [yaw, setYaw] = useState(0.75)
  /** a tap on the box takes a block away instead of adding one */
  const [taking, setTaking] = useState(false)

  /* ── a match by turns, when the address names one (src/lab/matches/useLabMatch.ts): rounds of
     hide and rebuild, scored over par (shadowboxRoom.ts). A move is a rebuild of their waiting box
     and, when one is due, a box of your own to hide — the friend's first comes with their yes.
     Their boxes are kept back by the server; what arrives is the shadows each throws, and the GPU
     casts them from par, which throws the very same ones. ⚠️ NO PREVIEW: the shadows of the box you
     hide are worked out on the server, and nobody's box is shown until the match is over. */
  const [mRebuild, setMRebuild] = useState<Build>(emptyBuild())
  const [mHide, setMHide] = useState<Build>(emptyBuild())
  const [mShow, setMShow] = useState<Show>({ front: true, side: true, top: false })
  const [mStep, setMStep] = useState<'rebuild' | 'hide'>('rebuild')
  const [peek, setPeek] = useState<{ side: 0 | 1; round: number } | null>(null)
  const hideNow = useRef({ build: mHide, show: mShow })
  hideNow.current = { build: mHide, show: mShow }
  const lm = useLabMatch('shadowbox', { preview: false, bring: () => hideNow.current })
  const inMatch = !!lm.id
  const signedIn = useSignedIn()
  const minvited = lm.view?.status === 'invited'
  // an invitation has no game yet: the friend builds their box against a fresh one
  const mg = inMatch
    ? ((lm.shown as BoxGame | null) ??
      (minvited && lm.rules ? (lm.rules.fresh() as BoxGame) : null))
    : null
  const mside: 0 | 1 = lm.view?.mode === 'together' ? 0 : lm.view?.you === 1 ? 1 : 0
  const mtheirs: 0 | 1 = mside === 0 ? 1 : 0
  const mover = lm.view?.status === 'finished'
  /** the box I must rebuild now, and whether my move owes a box of my own */
  const mClue = mg && lm.canPlay ? waiting(mg, mside) : null
  const mOwes =
    !!mg &&
    (minvited
      ? lm.view?.you === 1 && lm.view?.mode !== 'together'
      : lm.canPlay && owesBox(mg, mside))
  const step = minvited ? (mOwes ? 'hide' : null) : mClue ? (mOwes ? mStep : 'rebuild') : null
  /* each move starts afresh: a new box to rebuild, a new box to hide */
  const moves = mg ? mg.rebuilds[0].length + mg.rebuilds[1].length : -1
  useEffect(() => {
    setMRebuild(emptyBuild())
    // a box to hide starts as a random one, as Sea battle's fleet starts shuffled: Accept always
    // brings one, and it can be cleared and built afresh
    setMHide(randomBox(Math.random).build)
    setMStep('rebuild')
    setPeek(null)
    setPhase('build')
    setNote(null)
  }, [moves, lm.id])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const turn = useRef<{ x: number; y: number; yaw: number; moved: boolean } | null>(null)

  /* what the GPU draws: the hidden build's shadows and the player's build over them */
  const p = PUZZLES[puzzle]
  let view =
    mode === 'puzzle'
      ? { hidden: p.hidden, mine, show: p.show, curtain: false }
      : phase === 'build'
        ? { hidden: mine, mine, show, curtain: false }
        : phase === 'curtain'
          ? { hidden: secret, mine: emptyBuild(), show, curtain: true }
          : phase === 'guess'
            ? { hidden: secret, mine, show, curtain: false }
            : { hidden: secret, mine: secret, show, curtain: false }
  const peekBox = peek && mg ? mg.boxes[peek.side][peek.round] : null
  const lastMine = mg?.rebuilds[mside].length ?? 0
  const lastClue = mg && lastMine ? mg.clues[mtheirs][lastMine - 1] : null
  const matchView = !inMatch
    ? null
    : peekBox
      ? { hidden: peekBox.build, mine: peekBox.build, show: peekBox.show, curtain: false }
      : step === 'hide'
        ? { hidden: mHide, mine: mHide, show: mShow, curtain: false }
        : lm.hasPending && mg && waiting(mg, mside)
          ? {
              hidden: castOf(waiting(mg, mside)!),
              mine: mRebuild,
              show: waiting(mg, mside)!.show,
              curtain: false,
            }
          : step === 'rebuild' && mClue
            ? { hidden: castOf(mClue), mine: mRebuild, show: mClue.show, curtain: false }
            : lastClue && mg
              ? {
                  hidden: castOf(lastClue),
                  mine: mg.rebuilds[mside][lastMine - 1],
                  show: lastClue.show,
                  curtain: false,
                }
              : { hidden: emptyBuild(), mine: emptyBuild(), show: ALL, curtain: false }
  if (matchView) view = matchView
  /** the build the grid shows and edits */
  const cur = matchView ? matchView.mine : mine
  const now = useRef({ view, yaw })
  now.current = { view, yaw }
  const engine = useRef<ShadowboxView | null>(null)

  useEffect(() => {
    try {
      writeKept(SHADOWBOX_KEY, JSON.stringify({ puzzle, best }))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [puzzle, best])

  const clue = shadowsOf(view.hidden)
  const solvedPuzzle = mode === 'puzzle' && blocks(mine) > 0 && matches(mine, clue, p.show)
  const par = mode === 'puzzle' ? blocks(fewest(clue, p.show)) : 0

  /* a puzzle solved is kept as a best, unless the answer was shown */
  useEffect(() => {
    if (!solvedPuzzle || shown) return
    const n = blocks(mine)
    setBest((b) => (b[p.name] && b[p.name] <= n ? b : { ...b, [p.name]: n }))
  }, [solvedPuzzle, shown, mine, p.name])

  const pick = (k: number) => {
    setPuzzle(k)
    setMine(emptyBuild())
    setShown(false)
    setNote(null)
  }
  const setStack = (i: number, h: number) => {
    if (inMatch) {
      if (!step) return
      ;(step === 'hide' ? setMHide : setMRebuild)((b) => {
        const out = b.slice()
        out[i] = Math.max(0, Math.min(TALL, h))
        return out
      })
      return
    }
    if (phase === 'curtain' || phase === 'reveal') return
    setMine((b) => {
      const out = b.slice()
      out[i] = Math.max(0, Math.min(TALL, h))
      return out
    })
    setNote(null)
  }
  const hide = () => {
    if (blocks(mine) === 0) return setNote('Build something first.')
    if (!show.front && !show.side && !show.top) return setNote('Leave at least one lamp on.')
    setSecret(mine)
    setMine(emptyBuild())
    setChecks(0)
    setPhase('curtain')
    setNote(null)
  }
  const check = () => {
    setChecks((c) => c + 1)
    if (matches(mine, clue, show)) {
      setPhase('reveal')
      setNote(`✨ Right — the same shadows, in ${checks + 1} ${checks ? 'checks' : 'check'}.`)
      return
    }
    const s = shadowsOf(mine)
    const wrong = [
      show.front && s.front.some((v, i) => v !== clue.front[i]),
      show.side && s.side.some((v, i) => v !== clue.side[i]),
      show.top && s.top.some((v, i) => v !== clue.top[i]),
    ].filter(Boolean).length
    setNote(`Not yet: ${wrong} of the shadows ${wrong === 1 ? 'is' : 'are'} wrong (the red).`)
  }
  const newRound = () => {
    setMine(emptyBuild())
    setSecret(emptyBuild())
    setPhase('build')
    setChecks(0)
    setNote('A new round: the builder builds.')
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const x = cursor % N
    const z = Math.floor(cursor / N)
    if (k === 'arrowleft') setCursor(at(Math.max(0, x - 1), z))
    else if (k === 'arrowright') setCursor(at(Math.min(N - 1, x + 1), z))
    else if (k === 'arrowup') setCursor(at(x, Math.min(N - 1, z + 1)))
    else if (k === 'arrowdown') setCursor(at(x, Math.max(0, z - 1)))
    else if (/^[0-4]$/.test(k)) setStack(cursor, Number(k))
    else if (k === '+' || k === '=') setStack(cursor, cur[cursor] + 1)
    else if (k === '-') setStack(cursor, cur[cursor] - 1)
    else return
    e.preventDefault()
  }

  const hiddenUntilReady = mode === 'pass' && phase === 'curtain'
  const status =
    mode === 'puzzle'
      ? solvedPuzzle
        ? `✨ Matched with ${blocks(mine)} blocks${blocks(mine) <= par ? ' — par!' : ` (par ${par})`}`
        : `${blocks(mine)} blocks · par ${par}`
      : phase === 'build'
        ? `Builder: ${blocks(mine)} blocks`
        : phase === 'curtain'
          ? 'Behind the curtain'
          : phase === 'guess'
            ? `Guesser: ${blocks(mine)} blocks · ${checks} checks`
            : 'The hidden box'
  /* the match's own controls and words, under the grid */
  let matchPanel = null
  if (inMatch && mg) {
    const together = lm.view?.mode === 'together'
    const them = !lm.view ? 'They' : together ? 'The computer' : otherName(lm.view)
    const tot = totals(mg)
    const done = mg.rebuilds[mside].length
    const round = Math.min(mg.rounds, done + 1)
    const fits = mClue ? matches(mRebuild, mClue.shadows, mClue.show) : false
    const par = mClue ? blocks(fewest(mClue.shadows, mClue.show)) : 0
    const lampsOn = mShow.front || mShow.side || mShow.top
    const play = () => {
      if (!mClue) return
      if (!fits) {
        setMStep('rebuild')
        return setNote('Not yet: your blocks do not throw their shadows (the red).')
      }
      if (mOwes && (blocks(mHide) === 0 || !lampsOn)) {
        setMStep('hide')
        return setNote(blocks(mHide) ? 'Leave at least one lamp on.' : 'Build a box to hide first.')
      }
      setNote(null)
      lm.play(
        mOwes ? { rebuild: mRebuild, box: { build: mHide, show: mShow } } : { rebuild: mRebuild },
      )
    }
    const words = minvited
      ? step
        ? 'Build a box for them to rebuild — a random one is ready — and choose its lamps, then accept.'
        : ''
      : mover
        ? `${together ? 'You two' : 'You'}: ${tot[mside]} over par. ${them}: ${tot[mtheirs]}.`
        : step === 'hide'
          ? 'Your box to hide: build it and choose its lamps — those are the shadows they get.'
          : step === 'rebuild'
            ? `Round ${round} of ${mg.rounds}: build something that throws their shadows, in as few blocks as you can${mOwes ? ' — then hide a box of your own' : ''}.`
            : lm.hasPending
              ? 'Send it.'
              : `${them} is rebuilding.`
    const overIn = (s: 0 | 1, i: number) => overPar(mg.rebuilds[s][i], mg.clues[s === 0 ? 1 : 0][i])
    matchPanel = (
      <>
        <div className="dice-scores">
          <div className="dice-score">
            <span>{together ? 'You two' : 'You'} · over par</span>
            <strong>{tot[mside]}</strong>
          </div>
          <div className="dice-score">
            <span>{them} · over par</span>
            <strong>{tot[mtheirs]}</strong>
          </div>
        </div>
        <p className="mc-line" aria-live="polite">
          {note ?? words}
        </p>
        {step && (
          <div className="lab-controls">
            {mOwes && !minvited && (
              <div className="lab-group" role="group" aria-label="Which build the grid is for">
                <button
                  className="btn btn-ghost"
                  aria-pressed={step === 'rebuild'}
                  onClick={() => setMStep('rebuild')}
                >
                  🔍 Rebuild theirs
                </button>
                <button
                  className="btn btn-ghost"
                  aria-pressed={step === 'hide'}
                  onClick={() => setMStep('hide')}
                >
                  🙈 Your box to hide
                </button>
              </div>
            )}
            {step === 'rebuild' && (
              <span className="lab-score">
                {blocks(mRebuild)} blocks · par {par} · {fits ? '✓ their shadows' : 'not yet'}
              </span>
            )}
            {step === 'hide' && (
              <div
                className="lab-group"
                role="group"
                aria-label="Which lamps are on: the shadows they will see"
              >
                {WALL_NAMES.map(([k, name]) => (
                  <button
                    key={k}
                    className="btn btn-ghost"
                    aria-pressed={mShow[k]}
                    onClick={() => setMShow((v) => ({ ...v, [k]: !v[k] }))}
                  >
                    💡 {name}
                  </button>
                ))}
              </div>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => (step === 'hide' ? setMHide : setMRebuild)(emptyBuild())}
            >
              🧹 Clear
            </button>
            {!minvited && (
              <button className="btn" onClick={play}>
                ✔ Play round {round}
              </button>
            )}
          </div>
        )}
        <MatchSend lm={lm} />
        {(done > 0 || mg.rebuilds[mtheirs].length > 0) && (
          <ol className="sbx-rounds" aria-label="The rounds so far">
            {Array.from({ length: mg.rounds }, (_, i) => i)
              .filter((i) => i < Math.max(done, mg.rebuilds[mtheirs].length))
              .map((i) => (
                <li key={i}>
                  <span>Round {i + 1}</span>
                  <span>
                    {together ? 'You two' : 'You'} {i < done ? `+${overIn(mside, i)}` : '…'} ·{' '}
                    {them} {i < mg.rebuilds[mtheirs].length ? `+${overIn(mtheirs, i)}` : '…'}
                  </span>
                  {mover && (
                    <span className="lab-controls">
                      <button
                        className="btn btn-ghost"
                        aria-pressed={peek?.side === mtheirs && peek.round === i}
                        onClick={() => setPeek({ side: mtheirs, round: i })}
                      >
                        👁 Their box
                      </button>
                      <button
                        className="btn btn-ghost"
                        aria-pressed={peek?.side === mside && peek.round === i}
                        onClick={() => setPeek({ side: mside, round: i })}
                      >
                        👁 Yours
                      </button>
                    </span>
                  )}
                </li>
              ))}
          </ol>
        )}
        <p className="muted lab-hint">
          Each round you each hide a box and rebuild the other’s from its shadows alone. A rebuild
          must throw the same shadows; it is scored on the blocks it takes over par, the fewest that
          could. The fewer over par across the rounds wins — so hide a box that is hard to rebuild
          cheaply. Grid: tap a stack to add a block, or arrow keys and 0–{TALL}.
        </p>
      </>
    )
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Shadow box">
      <LabStage
        label="A small box of stacked blocks lit by three lamps, so their shadows fall on the back wall, the left wall and the floor"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createShadowbox(device, context, format, canvas)
          engine.current = v
          let t = 0
          let last = ''
          return {
            frame: (dt: number) => {
              t += dt
              const n = now.current
              const key = JSON.stringify([n.view.hidden, n.view.mine])
              if (key !== last) {
                last = key
                v.builds(n.view.hidden, n.view.mine)
              }
              v.frame({
                show: n.view.show,
                mine: true,
                hidden: n.view.curtain,
                time: t,
                yaw: n.yaw,
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          turn.current = { x: e.clientX, y: e.clientY, yaw, moved: false }
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const d = turn.current
          if (!d) return
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && !d.moved) return
          d.moved = true
          const r = e.currentTarget.getBoundingClientRect()
          // drag sideways to turn the box, not so far that a wall is seen edge on
          setYaw(Math.max(0.45, Math.min(1.05, d.yaw + ((e.clientX - d.x) / r.width) * 2)))
        }}
        onPointerUp={(e) => {
          const d = turn.current
          turn.current = null
          if (!d || d.moved) return
          // a tap, not a drag: build on the stack under the finger (or the floor cell)
          const r = e.currentTarget.getBoundingClientRect()
          const i = pickCell(view.mine, [r.width, r.height], yaw, [
            e.clientX - r.left,
            e.clientY - r.top,
          ])
          if (i < 0) return
          setCursor(i)
          setStack(i, cur[i] + (taking ? -1 : 1))
        }}
      />

      {inMatch && <MatchBar lm={lm} sides={['the first to rebuild', 'the second to rebuild']} />}
      {live && !inMatch && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Puzzles or pass and play">
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'puzzle'}
              onClick={() => {
                setMode('puzzle')
                pick(puzzle)
              }}
            >
              🧩 Puzzles
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'pass'}
              onClick={() => {
                setMode('pass')
                newRound()
                setNote(null)
              }}
            >
              👥 Pass and play
            </button>
          </div>
          <span className="lab-score" aria-live="polite">
            {status}
          </span>
          {signedIn && <MatchChallenge demo="shadowbox" settings={{}} levelNames={MATCH_LEVELS} />}
          {mode === 'puzzle' && (
            <label className="studio-pick">
              <span className="muted">Puzzle</span>
              <select value={puzzle} onChange={(e) => pick(Number(e.target.value))}>
                {PUZZLES.map((q, k) => (
                  <option key={q.name} value={k}>
                    {k + 1}. {q.name}
                    {best[q.name] ? ` ✓ ${best[q.name]}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {live && (inMatch ? !!step : !hiddenUntilReady && phase !== 'reveal') && (
        <div
          className="shadowbox-grid"
          role="grid"
          aria-label="The floor of the box: tap a stack to add a block"
        >
          {Array.from({ length: N }, (_, r) => N - 1 - r).map((z) => (
            <div key={z} className="shadowbox-row" role="row">
              {Array.from({ length: N }, (_, x) => {
                const i = at(x, z)
                return (
                  <button
                    key={x}
                    role="gridcell"
                    className="shadowbox-cell"
                    data-h={cur[i]}
                    data-cursor={cursor === i ? 'yes' : undefined}
                    aria-label={`Column ${x + 1}, row ${z + 1} from the front: ${cur[i]} blocks`}
                    onClick={() => {
                      setCursor(i)
                      setStack(i, cur[i] === TALL ? 0 : cur[i] + 1)
                    }}
                  >
                    {cur[i] || '·'}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {live && (inMatch ? !!step : mode === 'puzzle' || phase === 'build' || phase === 'guess') && (
        <div className="lab-controls">
          <button
            className="btn btn-ghost"
            aria-pressed={taking}
            onClick={() => setTaking((v) => !v)}
          >
            {taking ? '➖ Tap takes a block' : '➕ Tap adds a block'}
          </button>
        </div>
      )}
      {live && !inMatch && mode === 'puzzle' && (
        <div className="lab-controls">
          <button className="btn btn-ghost" onClick={() => setMine(emptyBuild())}>
            🧹 Clear
          </button>
          {solvedPuzzle && puzzle < PUZZLES.length - 1 && (
            <button className="btn" onClick={() => pick(puzzle + 1)}>
              ⏭ Next puzzle
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => {
              setMine(fewest(clue, p.show))
              setShown(true)
              setNote('One answer in par — there are others. (Not kept as a best.)')
            }}
          >
            💡 Show an answer
          </button>
        </div>
      )}

      {live && !inMatch && mode === 'pass' && (
        <div className="lab-controls">
          {phase === 'build' && (
            <>
              <div
                className="lab-group"
                role="group"
                aria-label="Which lamps are on: the shadows the guesser will see"
              >
                {WALL_NAMES.map(([k, name]) => (
                  <button
                    key={k}
                    className="btn btn-ghost"
                    aria-pressed={show[k]}
                    onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
                  >
                    💡 {name}
                  </button>
                ))}
              </div>
              <button className="btn" onClick={hide}>
                🙈 Hide it
              </button>
              <button
                className="btn btn-ghost"
                onClick={() =>
                  download(
                    new Blob([JSON.stringify({ build: mine, show })], { type: 'application/json' }),
                    'shadow-box.json',
                  )
                }
                disabled={blocks(mine) === 0}
              >
                ⬇ Save box
              </button>
              <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                ⬆ Open a box to solve…
              </button>
            </>
          )}
          {phase === 'curtain' && (
            <button className="btn" onClick={() => setPhase('guess')}>
              👀 I’m the guesser — show me the shadows
            </button>
          )}
          {phase === 'guess' && (
            <>
              <button className="btn" onClick={check}>
                ✔ Check
              </button>
              <button className="btn btn-ghost" onClick={() => setMine(emptyBuild())}>
                🧹 Clear
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setPhase('reveal')
                  setNote('Given up — there is the hidden box.')
                }}
              >
                🏳 Give up
              </button>
            </>
          )}
          {phase === 'reveal' && (
            <button className="btn" onClick={newRound}>
              🔁 Swap and play again
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              const r =
                f.size <= FILE_LIMIT
                  ? readBuild(await f.text())
                  : 'That file is too big to be a box.'
              if (typeof r === 'string') return setNote(r)
              // straight behind the curtain: whoever opened it does not get to see it
              setSecret(r.build)
              setShow(r.show)
              setMine(emptyBuild())
              setChecks(0)
              setPhase('curtain')
              setNote(`Opened ${f.name}, hidden. Ready when you are.`)
            }}
          />
        </div>
      )}

      {live && matchPanel}
      {live && !inMatch && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <strong>{note} </strong>}
          {mode === 'puzzle' ? (
            <>
              {p.hint} Tap the box to add a block where you tap (➖ to take one away), or use the
              grid — tap a stack to add a block (past {TALL}, back to none), or arrow keys and 0–
              {TALL}. Your shadows fall over the hidden ones in blue; red is shadow the hidden box
              does not throw. Drag the box to turn it.
            </>
          ) : phase === 'build' ? (
            <>
              Builder: stack blocks on the grid, choose which lamps are on — those are the shadows
              the guesser gets — then 🙈 Hide it and pass the device.
            </>
          ) : phase === 'curtain' ? (
            <>Pass the device to the guesser. Nothing of the box shows until they are ready.</>
          ) : phase === 'guess' ? (
            <>
              Guesser: build something that throws the same shadows — it need not be the same
              blocks. Blue is right, red is shadow that should not be there. ✔ Check when you think
              so.
            </>
          ) : (
            <>The hidden box, as it was built. Swap roles and go again.</>
          )}
        </p>
      )}
    </div>
  )
}
