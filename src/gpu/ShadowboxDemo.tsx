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
  const fileRef = useRef<HTMLInputElement | null>(null)
  const turn = useRef<{ x: number; y: number; yaw: number; moved: boolean } | null>(null)

  /* what the GPU draws: the hidden build's shadows and the player's build over them */
  const p = PUZZLES[puzzle]
  const view =
    mode === 'puzzle'
      ? { hidden: p.hidden, mine, show: p.show, curtain: false }
      : phase === 'build'
        ? { hidden: mine, mine, show, curtain: false }
        : phase === 'curtain'
          ? { hidden: secret, mine: emptyBuild(), show, curtain: true }
          : phase === 'guess'
            ? { hidden: secret, mine, show, curtain: false }
            : { hidden: secret, mine: secret, show, curtain: false }
  const now = useRef({ view, yaw })
  now.current = { view, yaw }
  const engine = useRef<ShadowboxView | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(SHADOWBOX_KEY, JSON.stringify({ puzzle, best }))
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
    else if (k === '+' || k === '=') setStack(cursor, mine[cursor] + 1)
    else if (k === '-') setStack(cursor, mine[cursor] - 1)
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
          setStack(i, mine[i] + (taking ? -1 : 1))
        }}
      />

      {live && (
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

      {live && !hiddenUntilReady && phase !== 'reveal' && (
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
                    data-h={mine[i]}
                    data-cursor={cursor === i ? 'yes' : undefined}
                    aria-label={`Column ${x + 1}, row ${z + 1} from the front: ${mine[i]} blocks`}
                    onClick={() => {
                      setCursor(i)
                      setStack(i, mine[i] === TALL ? 0 : mine[i] + 1)
                    }}
                  >
                    {mine[i] || '·'}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {live && (mode === 'puzzle' || phase === 'build' || phase === 'guess') && (
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
      {live && mode === 'puzzle' && (
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

      {live && mode === 'pass' && (
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

      {live && (
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
