import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  JIGSAW_BESTS_KEY,
  JIGSAW_KEY,
  OWN_PICTURE_LIMIT,
  OWN_PICTURE_SIDE,
  PICTURES,
  PICTURE_ASPECT,
  SIZES,
  clock,
  cut,
  deal,
  done,
  fit,
  fromSaved,
  grid,
  hint,
  hit,
  move,
  placedCount,
  raise,
  readBests,
  readSaved,
  settle,
  table as layTable,
  tidy,
  toSaved,
  toTable,
  type Bests,
  type PictureId,
  type Puzzle,
  type Size,
  type Table,
  type V2,
} from './jigsaw'
import { createJigsaw, type JigsawView } from './jigsawEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Picture = PictureId | 'own'
/** what is on the table: the puzzle itself and everything it was made from */
type Game = {
  p: Puzzle
  t: Table
  picture: Picture
  size: Size
  seed: number
  aspect: number
}

const store = {
  read: (key: string) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  write: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* private mode, or a full store: the puzzle stays for this visit */
    }
  },
}

/** a phone's stage fits about two dozen pieces big enough for a finger */
const firstSize = (): Size => (window.innerWidth < 600 ? 24 : 48)
const newSeed = () => Math.floor(Math.random() * 2 ** 31)
const pictureName = (pic: Picture) =>
  pic === 'own' ? 'your picture' : (PICTURES.find((q) => q.id === pic)?.name ?? pic)

/** the middle of an image, cropped to the board's shape and no bigger than the texture allows */
async function cropped(file: File, cols: number, rows: number): Promise<ImageBitmap> {
  const probe = await createImageBitmap(file)
  const want = cols / rows
  let sw = probe.width
  let sh = probe.height
  if (sw / sh > want) sw = Math.round(sh * want)
  else sh = Math.round(sw / want)
  const sx = Math.floor((probe.width - sw) / 2)
  const sy = Math.floor((probe.height - sh) / 2)
  probe.close()
  const k = Math.min(1, OWN_PICTURE_SIDE / Math.max(sw, sh))
  return createImageBitmap(file, sx, sy, sw, sh, {
    resizeWidth: Math.max(1, Math.round(sw * k)),
    resizeHeight: Math.max(1, Math.round(sh * k)),
  })
}

export function JigsawDemo({ running, setRunning, onAdapter }: Props) {
  const kept = useRef(readSaved(store.read(JIGSAW_KEY))).current
  const [live, setLive] = useState(false)
  /** what the controls say the NEXT puzzle will be; the one on the table is `game` */
  const [picture, setPicture] = useState<Picture>(kept?.picture ?? 'dusk')
  const [size, setSize] = useState<Size>(kept?.size ?? firstSize())
  const [bests, setBests] = useState<Bests>(() => readBests(store.read(JIGSAW_BESTS_KEY)))
  const [ghost, setGhost] = useState(false)
  const [sound, setSound] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  /** what the words under the stage show — the puzzle itself lives in a ref, and changes per frame */
  const [shown, setShown] = useState({ placed: 0, total: 0, seconds: 0, hints: 0, done: false })
  const [armed, setArmed] = useState(false)
  const [current, setCurrent] = useState<{ picture: Picture; size: Size } | null>(null)

  const game = useRef<Game | null>(null)
  const seconds = useRef(kept?.seconds ?? 0)
  const hints = useRef(kept?.hints ?? 0)
  /** a piece has been moved since this puzzle was dealt: from then on, the clock runs */
  const started = useRef((kept?.seconds ?? 0) > 0)
  const finishedAt = useRef<number | null>(null)
  const time = useRef(0)
  const drag = useRef<{ group: number; last: V2; pointer: number } | null>(null)
  const engine = useRef<JigsawView | null>(null)
  const dirty = useRef(true)
  const ownFile = useRef<File | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const stage = useRef<HTMLCanvasElement | null>(null)
  const voices = useRef(new Map<string, number>())
  const soundNow = useRef(sound)
  soundNow.current = sound
  const ghostNow = useRef(ghost)
  ghostNow.current = ghost

  /* sound stops when the toy goes: every note still ringing is let go and no timer outlives it */
  useEffect(
    () => () => {
      for (const [id, t] of voices.current) {
        window.clearTimeout(t)
        noteOff(id)
      }
      voices.current.clear()
    },
    [],
  )
  const play = (instrument: 'pluck' | 'bell' | 'marimba', midi: number, ms: number, wait = 0) => {
    if (!soundNow.current || voices.current.size > 12) return
    const id = `jigsaw-${midi}-${performance.now()}-${wait}`
    const t = window.setTimeout(() => {
      noteOn(id, instrument, midi)
      voices.current.set(
        id,
        window.setTimeout(() => {
          noteOff(id)
          voices.current.delete(id)
        }, ms),
      )
    }, wait)
    voices.current.set(id, t)
  }

  /** what the words say, from the puzzle as it stands */
  const report = () => {
    const g = game.current
    if (!g) return
    setShown({
      placed: placedCount(g.p),
      total: g.p.pieces.length,
      seconds: Math.floor(seconds.current),
      hints: hints.current,
      done: finishedAt.current !== null,
    })
  }

  /** kept in this browser — a picture of your own is not, and the last built-in puzzle stays */
  const save = () => {
    const g = game.current
    if (!g || g.picture === 'own') return
    store.write(
      JIGSAW_KEY,
      JSON.stringify(
        toSaved(g.p, {
          picture: g.picture,
          size: g.size,
          seed: g.seed,
          aspect: g.aspect,
          seconds: seconds.current,
          hints: hints.current,
        }),
      ),
    )
  }
  /* the clock is kept as you leave, not only when a piece is let go */
  useEffect(() => {
    const keep = () => save()
    window.addEventListener('pagehide', keep)
    return () => {
      window.removeEventListener('pagehide', keep)
      keep()
    }
  }, [])

  /** put a puzzle on the table and its picture on the GPU */
  const show = async (g: Game, v: JigsawView) => {
    game.current = g
    v.cut(g.p)
    if (g.picture === 'own') {
      const f = ownFile.current
      if (!f) return
      const bitmap = await cropped(f, g.p.cuts.cols, g.p.cuts.rows)
      // a newer puzzle may have been dealt while the picture was being read
      if (game.current !== g || engine.current !== v) return bitmap.close()
      v.photo(bitmap)
      bitmap.close()
    } else v.paint(g.picture)
    v.pieces(g.p)
    setCurrent({ picture: g.picture, size: g.size })
    dirty.current = true
    report()
  }

  /** a fresh puzzle of this picture and size, on a table the stage's shape */
  const fresh = (pic: Picture, n: Size, aspect: number): Game => {
    const { cols, rows } = grid(n, PICTURE_ASPECT)
    const seed = newSeed()
    const a = Math.min(3, Math.max(0.4, aspect))
    const t = layTable(cols, rows, a)
    return { p: deal(cut(cols, rows, seed), t, seed), t, picture: pic, size: n, seed, aspect: a }
  }

  const stageAspect = () => {
    const c = stage.current
    return c && c.clientHeight ? c.clientWidth / c.clientHeight : 1.5
  }

  const begin = (pic = picture, n = size) => {
    const v = engine.current
    if (!v) return
    seconds.current = 0
    hints.current = 0
    started.current = false
    finishedAt.current = null
    drag.current = null
    setArmed(false)
    const g = fresh(pic, n, stageAspect())
    void show(g, v).then(() => {
      save()
      setNote(
        pic === 'own'
          ? 'Your picture stays on this device and is not kept: leaving or reloading loses this puzzle. Your last puzzle of a built-in picture is still kept.'
          : null,
      )
    })
  }

  /** whether starting again would throw away work, which then wants a second press */
  const inProgress = () => started.current && finishedAt.current === null

  const choose = (pic: Picture, n: Size) => {
    setPicture(pic)
    setSize(n)
    if (inProgress())
      return setNote(
        `Press 🔀 New puzzle to start ${pictureName(pic)} in ${n} pieces — this one stays until you do.`,
      )
    begin(pic, n)
  }

  const newPuzzle = () => {
    if (inProgress() && !armed) {
      setArmed(true)
      window.setTimeout(() => setArmed(false), 4000)
      return
    }
    begin()
  }

  const finish = () => {
    const g = game.current
    if (!g) return
    finishedAt.current = time.current
    const key = `${g.picture}:${g.size}`
    const s = Math.max(1, Math.floor(seconds.current))
    if (g.picture !== 'own' && hints.current === 0)
      setBests((b) => {
        if (b[key] && b[key] <= s) return b
        const next = { ...b, [key]: s }
        store.write(JIGSAW_BESTS_KEY, JSON.stringify(next))
        return next
      })
    ;[72, 76, 79, 84].forEach((m, i) => play('bell', m, 900, i * 140))
    if (!running) setRunning(true)
  }

  /** after anything that moves pieces: tell the GPU, the words, the store */
  const after = (outcome?: { joined: number; placed: boolean }) => {
    const g = game.current
    const v = engine.current
    if (!g || !v) return
    v.pieces(g.p)
    dirty.current = true
    if (outcome?.joined) play('pluck', 67 + Math.min(outcome.joined, 5) * 2, 160)
    if (outcome?.placed) play('marimba', 79, 300, outcome.joined ? 80 : 0)
    if (finishedAt.current === null && done(g.p)) finish()
    report()
    save()
  }

  const hintOne = () => {
    const g = game.current
    if (!g || finishedAt.current !== null) return
    started.current = true
    if (hint(g.p) < 0) return
    hints.current++
    after({ joined: 0, placed: true })
  }

  const edgesFirst = () => {
    const g = game.current
    if (!g || finishedAt.current !== null) return
    tidy(g.p, g.t)
    after()
    setNote('Loose edge pieces are laid nearest the board; joined groups stay where they are.')
  }

  /** a point of the canvas, in the table's cells */
  const at = (e: PointerEvent<HTMLCanvasElement>): V2 | null => {
    const g = game.current
    if (!g) return null
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const k = c.width / r.width
    const f = fit(g.t, [c.width, c.height])
    const p = toTable(f, [(e.clientX - r.left) * k, (e.clientY - r.top) * k])
    // held to the table, so a piece cannot be dragged out of reach
    return [Math.min(g.t.x1, Math.max(g.t.x0, p[0])), Math.min(g.t.y1, Math.max(g.t.y0, p[1]))]
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === 'e') edgesFirst()
    else if (k === 'g') setGhost((v) => !v)
    else if (k === 'h') hintOne()
    else if (k === 'n') newPuzzle()
    else return
    e.preventDefault()
  }

  const bestKey = current ? `${current.picture}:${current.size}` : ''
  const best = current?.picture !== 'own' ? bests[bestKey] : undefined
  return (
    <div className="lab-keys lab-jigsaw" tabIndex={0} onKeyDown={onKey} aria-label="Jigsaw">
      <LabStage
        label={`A jigsaw of ${pictureName(current?.picture ?? picture)} on a green felt table: ${shown.placed} of ${shown.total} pieces in place`}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createJigsaw(device, context, format, canvas)
          engine.current = v
          stage.current = canvas
          // the puzzle survives the GPU: a switch away and back, or a lost device, re-shows it
          const g =
            game.current ??
            (kept
              ? {
                  p: fromSaved(kept),
                  t: layTable(...gridOf(kept.size), kept.aspect),
                  picture: kept.picture,
                  size: kept.size,
                  seed: kept.seed,
                  aspect: kept.aspect,
                }
              : fresh(picture, size, canvas.width / Math.max(1, canvas.height)))
          // a puzzle kept finished comes back finished, without its sheen playing again
          if (!game.current && kept && done(g.p)) finishedAt.current = -10
          if (g.picture === 'own' && !ownFile.current) {
            // nothing to paint it with any more: start this size again on a built-in picture
            await show(fresh('dusk', g.size, canvas.width / Math.max(1, canvas.height)), v)
          } else await show(g, v)
          // a fresh deal is kept at once, so a reload brings back the same deal rather than a new one
          save()
          let lastSecond = Math.floor(seconds.current)
          let sinceSave = 0
          return {
            frame: (dt: number) => {
              time.current += dt
              const g = game.current
              if (!g) return
              const ticking = started.current && finishedAt.current === null
              if (ticking && dt > 0) {
                seconds.current += dt
                sinceSave += dt
                if (Math.floor(seconds.current) !== lastSecond) {
                  lastSecond = Math.floor(seconds.current)
                  report()
                }
                if (sinceSave > 15) {
                  sinceSave = 0
                  save()
                }
              }
              const since = finishedAt.current === null ? -1 : time.current - finishedAt.current
              // a still table is not redrawn: the canvas keeps its last frame
              const sheen = since >= 0 && since < 3
              if (!dirty.current && !sheen && dt > 0) return
              dirty.current = false
              v.frame({
                fit: fit(g.t, [canvas.width, canvas.height]),
                table: g.t,
                time: time.current,
                ghost: ghostNow.current ? 1 : 0,
                held: drag.current?.group ?? -1,
                finished: sheen ? since : -1,
              })
            },
            resize: () => {
              dirty.current = true
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const g = game.current
          const p = at(e)
          if (!g || !p || drag.current || finishedAt.current !== null) return
          const k = hit(g.p, p[0], p[1])
          if (k < 0) return
          const group = g.p.pieces[k].group
          if (g.p.placed.has(group)) return
          raise(g.p, group)
          drag.current = { group, last: p, pointer: e.pointerId }
          started.current = true
          engine.current?.pieces(g.p)
          dirty.current = true
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          const g = game.current
          if (!d || !g || e.pointerId !== d.pointer) return
          const p = at(e)
          if (!p) return
          move(g.p, d.group, p[0] - d.last[0], p[1] - d.last[1])
          d.last = p
          engine.current?.pieces(g.p)
          dirty.current = true
        }}
        onPointerUp={(e) => {
          const d = drag.current
          const g = game.current
          if (!d || !g || e.pointerId !== d.pointer) return
          drag.current = null
          after(settle(g.p, d.group))
        }}
      />

      {live && (
        <div className="lab-controls">
          <label className="studio-pick">
            <span className="muted">Picture</span>
            <select
              value={picture}
              onChange={(e) => {
                const v = e.target.value as Picture
                if (v === 'own') return fileRef.current?.click()
                choose(v, size)
              }}
            >
              {PICTURES.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
              <option value="own">Your own picture…</option>
            </select>
          </label>
          <label className="studio-pick">
            <span className="muted">Pieces</span>
            <select value={size} onChange={(e) => choose(picture, Number(e.target.value) as Size)}>
              {SIZES.map((n) => {
                const { cols, rows } = grid(n, PICTURE_ASPECT)
                return (
                  <option key={n} value={n}>
                    {cols * rows}
                    {bests[`${picture}:${n}`] ? ` ✓ ${clock(bests[`${picture}:${n}`])}` : ''}
                  </option>
                )
              })}
            </select>
          </label>
          <button className="btn" onClick={newPuzzle}>
            {armed ? '🔀 Sure? Press again' : '🔀 New puzzle'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              if (f.size > OWN_PICTURE_LIMIT)
                return setNote('That file is too big — a picture under 25 MB, please.')
              // asked before it is used: a file that is not a picture is said so, not dealt
              createImageBitmap(f)
                .then((b) => {
                  b.close()
                  ownFile.current = f
                  choose('own', size)
                })
                .catch(() => setNote('That file could not be read as a picture.'))
            }}
          />
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <span className="lab-score" aria-live="polite">
            {shown.placed}/{shown.total} in place · ⏱ {clock(shown.seconds)}
            {best ? ` · best ${clock(best)}` : ''}
          </span>
          <button className="btn btn-ghost" onClick={edgesFirst} disabled={shown.done}>
            🧱 Edges first
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={ghost}
            onClick={() => setGhost((v) => !v)}
          >
            👁 Picture on the board
          </button>
          <button className="btn btn-ghost" onClick={hintOne} disabled={shown.done}>
            🪄 Place one
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((v) => !v)}
          >
            {sound ? '🔔 Sound' : '🔕 Muted'}
          </button>
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {shown.done && (
            <strong>
              ✨ Finished in {clock(shown.seconds)}
              {shown.hints
                ? ` with ${shown.hints} placed for you (not kept as a best).`
                : best === shown.seconds
                  ? ' — your best for this picture and size.'
                  : '.'}{' '}
            </strong>
          )}
          {armed && <strong>That throws this puzzle away. </strong>}
          {note && <strong>{note} </strong>}
          Drag pieces onto the board: laid near a neighbour they join, laid near their place they
          fix there. 🧱 sorts the loose edge pieces nearest the board. 👁 shows the picture faintly
          in the tray. 🪄 places one for you. Progress is kept in this browser as you go. Keys: E
          edges, G picture, H place one, N new.
        </p>
      )}
    </div>
  )
}

const gridOf = (n: Size): [number, number] => {
  const { cols, rows } = grid(n, PICTURE_ASPECT)
  return [cols, rows]
}
