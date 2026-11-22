import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  ARTILLERY_KEY,
  COLS,
  DX,
  FIELD_W,
  GUN_R,
  LEVELS,
  LIFE,
  SKIES,
  gunAt,
  gunner,
  mirror,
  newField,
  readSaved,
  shoot,
  type Field,
  type Flight,
  type Level,
  type Saved,
  type Who,
} from './artillery'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'
import { artilleryRules, replay, type ArtilleryGame } from './artilleryRoom'
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
const SKY: Record<
  Saved['sky'],
  { name: string; top: string; low: string; hill: string; rim: string }
> = {
  dusk: { name: 'Dusk', top: '#2b1d3f', low: '#f08a5d', hill: '#3d5a3a', rim: '#7fae6f' },
  day: { name: 'Day', top: '#5fa8e8', low: '#d6ecff', hill: '#6a9b4c', rim: '#9fd27a' },
  night: { name: 'Night', top: '#05060d', low: '#1d2a4a', hill: '#22303d', rim: '#4b6a80' },
}
const FIELD_H = 0.8
const GUNS = ['#ffd34d', '#ff6b6b']
/** 'call': the room shared with friends in your call (src/lab/social/useLabRoom.ts) */
type Mode = 'bot' | 'call'
/** a shell's path seen from the other side of the field */
const flipPath = (p: number[]) => p.map((v, i) => (i % 2 ? v : FIELD_W - v))
type Show = { path: number[]; t: number; burst: { x: number; y: number } | null; after: () => void }

export function ArtilleryDemo() {
  const [saved, setSaved] = useKept(ARTILLERY_KEY, readSaved)
  const [level, setLevel] = useState<Level>(saved.level)
  const [field, setField] = useState<Field>(() => newField((Math.random() * 2 ** 31) >>> 0, 0))
  const [angle, setAngle] = useState(45)
  const [charge, setCharge] = useState(0.6)
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState(
    'Your gun is on the left. Set the angle and the charge, mind the wind, and fire.',
  )
  const [shots, setShots] = useState(0)
  const [mode, setMode] = useState<Mode>('bot')

  /* ── a match by turns, when the address names one (src/lab/matches/useLabMatch.ts). It takes
     the field over whatever else was showing; leaving it puts the toy back as it was.
     ⚠️ NO PREVIEW: a shot shown landing before Send would let it be aimed, watched and taken
     back until it hits. Fire only proposes it; the server fires it and the shell flies when the
     field comes back, as a call's shots do. */
  const lm = useLabMatch('artillery', { preview: false })
  const inMatch = !!lm.id
  const signedIn = useSignedIn()
  const matchGame = inMatch ? (lm.shown as ArtilleryGame | null) : null

  /* ── the call's room: seat 0 the left gun, seat 1 the right; the game travels as its shots */
  const lab = useLabRoom('artillery', artilleryRules)
  const words = tableSeats(lab, artilleryRules)
  const room = mode === 'call' && !inMatch ? lab.room : null
  /** shared with somebody, in a call or a match: the shots arrive and fly, the line is theirs */
  const shared = !!room || inMatch
  /** my seat in a match or a call, null when I only watch */
  const mySeat = inMatch ? (lm.view?.you ?? null) : words.mySeat
  /** the mode of the shared game: versus, or together against the computer */
  const sharedMode = inMatch ? lm.view?.mode : room?.mode
  /**
   * ⚠️ THE RIGHT GUN'S PLAYER SEES THE FIELD FROM THEIR SIDE: their gun on the left, like the
   * toy's own, so the controls, the drag and the guide all mean what they always mean. The field
   * is mirrored to draw it, and firing is symmetric, so nothing else needs to know.
   */
  const flip = sharedMode === 'versus' && mySeat === 1
  /** the field on screen: the one held here, from this player's side */
  const view = useMemo(() => (flip ? mirror(field) : field), [flip, field])
  /** a real gun, by where it is drawn: the left one is this player's */
  const realGun = (d: Who): Who => (flip ? (d === 0 ? 1 : 0) : d)
  const fieldRef = useRef(view)
  fieldRef.current = view
  const aimRef = useRef({ angle, charge })
  aimRef.current = { angle, charge }
  const savedRef = useRef(saved)
  savedRef.current = saved
  const trail = useRef<number[] | null>(null)
  const show = useRef<Show | null>(null)
  const flash = useRef<{ x: number; y: number; t: number } | null>(null)
  const drag = useRef(false)
  const timers = useRef<number[]>([])
  const recorded = useRef(false)
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  const yourTurn = inMatch
    ? lm.canPlay && !busy
    : room
      ? lab.live && myTurn(artilleryRules, room) && !busy
      : mode === 'bot' && field.turn === 0 && field.winner === null && !busy
  /** what the frame needs that is not the field: whose colours are where, and whether to aim */
  const drawRef = useRef({ flip, aiming: yourTurn })
  drawRef.current = { flip, aiming: yourTurn }
  const windWords = (w: number) =>
    w === 0 ? 'no wind' : `wind ${Math.abs(w).toFixed(2)} to the ${w > 0 ? 'right' : 'left'}`

  /** fire for whoever's turn it is, show the shell flying, then settle the turn */
  const fire = (f: Field, a: number, c: number) => {
    const by = f.turn
    const r = shoot(f, a, c)
    setBusy(true)
    if (by === 0) {
      trail.current = r.flight.path
      setShots((s) => s + 1)
    }
    const after = () => {
      show.current = null
      if (r.flight.burst) flash.current = { ...r.flight.burst, t: performance.now() }
      setField(r.field)
      const who = by === 0 ? 'You' : 'The computer'
      const hit = r.hurt[by === 0 ? 1 : 0]
      const self = r.hurt[by]
      const said = !r.flight.burst
        ? `${by === 0 ? 'Your' : 'Its'} shell sails over and off the field.`
        : r.flight.struck === (by === 0 ? 1 : 0)
          ? `A direct hit! ${hit} damage.`
          : hit
            ? `Close — ${hit} damage.`
            : self
              ? `${who} ${by === 0 ? 'hurt yourself' : 'hurts itself'}: ${self}.`
              : `${who} ${by === 0 ? 'miss' : 'misses'}.`
      if (r.field.winner !== null) {
        const won = r.field.winner === 0
        if (!recorded.current) {
          recorded.current = true
          const n = shots + (by === 0 ? 1 : 0)
          setSaved((s) => {
            const t = s.record[level]
            return {
              ...s,
              record: {
                ...s.record,
                [level]: {
                  won: t.won + (won ? 1 : 0),
                  lost: t.lost + (won ? 0 : 1),
                  fewest: won && (!t.fewest || n < t.fewest) ? n : t.fewest,
                },
              },
            }
          })
        }
        setLine(
          `${said} ${won ? '🏆 The other gun is out of action — you win!' : 'Your gun is out of action. The computer wins.'}`,
        )
        setBusy(false)
        return
      }
      if (r.field.turn === 1) {
        setLine(`${said} Now the ${windWords(r.field.wind)}. The computer takes aim…`)
        later(reduced() ? 300 : 900, () => {
          const s = gunner(r.field, level)
          fire(r.field, s.angle, s.charge)
        })
      } else {
        setLine(`${said} Your turn — ${windWords(r.field.wind)}.`)
        setBusy(false)
      }
    }
    if (reduced()) {
      show.current = { path: r.flight.path.slice(-2), t: 0, burst: r.flight.burst, after: () => {} }
      later(300, after)
    } else show.current = { path: r.flight.path, t: 0, burst: r.flight.burst, after }
  }

  const newGame = (lv: Level = saved.level) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    show.current = null
    trail.current = null
    recorded.current = false
    setLevel(lv)
    setShots(0)
    setBusy(false)
    const first: Who = field.winner === 0 || field.turn === 1 ? 1 : 0
    const f = newField((Math.random() * 2 ** 31) >>> 0, first)
    setField(f)
    if (first === 1) {
      setBusy(true)
      setLine(`A new field, and the computer fires first — ${windWords(f.wind)}.`)
      later(900, () => {
        const s = gunner(f, lv)
        fire(f, s.angle, s.charge)
      })
    } else setLine(`A new field. Your shot — ${windWords(f.wind)}.`)
  }

  /* ── the call's shots, shown as they arrive: each one flown in turn, then the field it left */
  const seen = useRef<{ seed: number; shots: number } | null>(null)
  const queue = useRef<ArtilleryGame[]>([])
  const [said, setSaid] = useState('')
  const callName = (w: Who) =>
    inMatch && lm.view
      ? lm.view.mode === 'together'
        ? w === 1
          ? 'The computer'
          : 'You two'
        : w === lm.view.you
          ? 'You'
          : otherName(lm.view)
      : !room
        ? ''
        : room.mode === 'together'
          ? w === 1
            ? 'The computer'
            : words.mySeat !== null
              ? 'Your side'
              : 'The team'
          : words.who(room.seats[w])
  const callShot = (g: ArtilleryGame) => {
    const { by, flight, hurt } = g.last!
    const other: Who = by === 0 ? 1 : 0
    const what = !flight.burst
      ? 'it sails off the field'
      : flight.struck === other
        ? `a direct hit, ${hurt[other]} damage`
        : hurt[other]
          ? `close, ${hurt[other]} damage`
          : hurt[by]
            ? `it came down on its own gun, ${hurt[by]} damage`
            : 'a miss'
    return `${callName(by)} fired: ${what}.`
  }
  const playNext = () => {
    const g = queue.current.shift()
    if (!g) return setBusy(false)
    const { by, flight } = g.last!
    const path = flip ? flipPath(flight.path) : flight.path
    const burst: Flight['burst'] =
      flight.burst && (flip ? { x: FIELD_W - flight.burst.x, y: flight.burst.y } : flight.burst)
    const ours = shared && (sharedMode === 'together' ? by === 0 : by === mySeat)
    if (ours) trail.current = path
    const done = () => {
      show.current = null
      if (burst) flash.current = { ...burst, t: performance.now() }
      setField(g.f)
      setSaid(callShot(g))
      playNext()
    }
    setBusy(true)
    if (reduced()) {
      show.current = { path: path.slice(-2), t: 0, burst, after: () => {} }
      later(300, done)
    } else show.current = { path, t: 0, burst, after: done }
  }
  const callGame = matchGame ?? room?.game
  useEffect(() => {
    if (!callGame) {
      // nothing shared yet (a match still waiting for its friend): nothing of the last one is said
      seen.current = null
      queue.current = []
      setSaid('')
      return
    }
    const s = seen.current
    if (s && s.seed === callGame.seed && s.shots === callGame.shots.length) return
    // a match together comes back two shots on, yours and the computer's: each is flown in turn,
    // the field before the last replayed from the seed, since only the last shot travels with it
    const more = s && s.seed === callGame.seed ? callGame.shots.length - s.shots : 0
    const next = more >= 1 && more <= 2 && !!callGame.last
    const from = s?.shots ?? 0
    seen.current = { seed: callGame.seed, shots: callGame.shots.length }
    if (!next) {
      // a new game, or one joined part way: the field as it stands, nothing to fly
      queue.current = []
      show.current = null
      trail.current = null
      flash.current = null
      setField(callGame.f)
      setSaid('')
      setBusy(false)
      return
    }
    for (let k = from + 1; k < callGame.shots.length; k++) {
      const g = replay(callGame.seed, callGame.shots.slice(0, k))
      if (g?.last) queue.current.push(g)
    }
    queue.current.push(callGame)
    if (!show.current) playNext()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new game state is the only cue
  }, [callGame])

  const stopHere = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    show.current = null
    trail.current = null
    queue.current = []
    seen.current = null
    setBusy(false)
  }
  /** fire this aim: in the call the host fires it, and the shot comes back to everybody */
  const pull = () => {
    if (!yourTurn) return
    if (inMatch) lm.play({ angle, charge })
    else if (room) lab.act({ t: 'move', move: { angle, charge } })
    else fire(field, angle, charge)
  }

  /**
   * ⚠️ A SEATED PLAYER LEFT ALONE carries on against the computer from the field on screen, as
   * the left gun — the right gun's player on the field mirrored, which is the field they were
   * looking at — or starts a new field if that game was over.
   */
  const carryOn = () => {
    const r = room ?? lab.room
    const mine: Who = r?.mode === 'versus' && words.mySeat === 1 ? 1 : 0
    stopHere()
    setMode('bot')
    if (!r || artilleryRules.turn(r.game) === null) return newGame()
    const f = mine === 1 ? mirror(r.game.f) : r.game.f
    recorded.current = false
    setShots(0)
    setField(f)
    if (f.turn === 1) {
      setBusy(true)
      setLine('Carrying on against the computer, which fires next…')
      later(900, () => {
        const s = gunner(f, level)
        fire(f, s.angle, s.charge)
      })
    } else setLine(`Carrying on against the computer. Your turn — ${windWords(f.wind)}.`)
  }

  /* leaving a match, the toy starts afresh rather than playing on from somebody else's field */
  const wasInMatch = useRef(inMatch)
  useEffect(() => {
    if (wasInMatch.current && !inMatch) {
      stopHere()
      setMode('bot')
      newGame()
    }
    wasInMatch.current = inMatch
    // only leaving the match starts a game
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMatch])

  /* -------------------------------------------------------------------- aiming by hand */

  const toField = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const s = r.width / FIELD_W
    return { x: (e.clientX - r.left) / s, y: FIELD_H - (e.clientY - r.top) / s }
  }
  const aimAt = (p: { x: number; y: number }) => {
    const g = gunAt(fieldRef.current, 0)
    const dx = p.x - g.x
    const dy = p.y - g.y
    if (Math.hypot(dx, dy) < 0.02) return
    setAngle(
      Math.round(Math.max(5, Math.min(85, (Math.atan2(dy, Math.max(0.001, dx)) * 180) / Math.PI))),
    )
    setCharge(Math.round(Math.max(0.1, Math.min(1, Math.hypot(dx, dy) / 0.5)) * 100) / 100)
  }
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!yourTurn) return
    drag.current = true
    aimAt(toField(e))
  }
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current && yourTurn) aimAt(toField(e))
  }
  const onUp = () => {
    drag.current = false
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!yourTurn) return
    const fine = e.shiftKey ? 0.25 : 1
    if (e.key === 'ArrowLeft') setAngle((a) => Math.min(85, Math.round((a + fine) * 4) / 4))
    else if (e.key === 'ArrowRight') setAngle((a) => Math.max(5, Math.round((a - fine) * 4) / 4))
    else if (e.key === 'ArrowUp')
      setCharge((c) => Math.min(1, Math.round((c + 0.01 * fine * 4) * 100) / 100))
    else if (e.key === 'ArrowDown')
      setCharge((c) => Math.max(0.1, Math.round((c - 0.01 * fine * 4) * 100) / 100))
    else if (e.key === ' ' || e.key === 'Enter') pull()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const rec = saved.record[saved.level]
  const untouched = shots === 0 && field.turn === 0 && field.winner === null

  return (
    <div className={`lab-keys at-room is-${saved.sky}`}>
      {inMatch && <MatchBar lm={lm} sides={['the left gun', 'the right gun']} />}
      {!inMatch && (
        <div className="lab-controls">
          {(lab.live || mode === 'call') && (
            <div className="lab-group" role="group" aria-label="Opponent">
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'bot'}
                onClick={() => {
                  if (mode === 'bot') return
                  stopHere()
                  setMode('bot')
                  newGame()
                }}
              >
                Against the computer
              </button>
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'call'}
                onClick={() => {
                  stopHere()
                  setMode('call')
                }}
              >
                👥 With the call
              </button>
            </div>
          )}
          {mode === 'bot' && (
            <div className="lab-group" role="group" aria-label="How well the computer shoots">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  className="btn btn-ghost"
                  aria-pressed={saved.level === l}
                  onClick={() => {
                    setSaved((s) => ({ ...s, level: l }))
                    if (untouched || field.winner !== null) newGame(l)
                  }}
                >
                  {LEVEL_NAMES[l]}
                </button>
              ))}
            </div>
          )}
          {mode === 'bot' && (
            <button className="btn btn-ghost" onClick={() => newGame()}>
              ↻ New field
            </button>
          )}
          {signedIn && mode === 'bot' && !inMatch && (
            <MatchChallenge demo="artillery" settings={{}} levelNames={LEVEL_NAMES} />
          )}
        </div>
      )}
      {mode === 'call' && !inMatch && (
        <CallTable
          table={lab}
          rules={artilleryRules}
          sides={['the left gun', 'the right gun']}
          ink={[GUNS[0], GUNS[1]]}
          levelNames={LEVEL_NAMES}
          score={(g) =>
            g.f.winner === null ? null : ` with ${g.f.guns[g.f.winner].life} to spare`
          }
          onCarryOn={carryOn}
        />
      )}
      <div className="dice-scores">
        {([0, 1] as Who[]).map((w) => (
          <div
            key={w}
            className={`dice-score${view.turn === w && view.winner === null ? ' is-up' : ''}`}
          >
            <span>
              {shared
                ? callName(realGun(w))
                : w === 0
                  ? 'Your gun'
                  : `The computer · ${LEVEL_NAMES[level]}`}
            </span>
            <strong>{view.guns[w].life}</strong>
            <span className="at-life" aria-hidden>
              <span
                style={{
                  width: `${(view.guns[w].life / LIFE) * 100}%`,
                  background: GUNS[realGun(w)],
                }}
              />
            </span>
          </div>
        ))}
      </div>
      {shared || mode === 'call' ? (
        said && (
          <p className="muted at-said" aria-live="polite">
            {said}
          </p>
        )
      ) : (
        <p className="mc-line" aria-live="polite">
          {line}
        </p>
      )}

      <div
        className="at-wrap"
        tabIndex={0}
        role="group"
        aria-label="The field. Drag from anywhere to aim your gun — the direction from your gun is the angle, the distance the charge. Keys: left and right turn the barrel, up and down set the charge, Space fires."
        onKeyDown={onKey}
      >
        <CanvasStage
          className="at-stage"
          label={`A field with two guns, ${windWords(view.wind)}. ${shared || mode === 'call' ? said : line}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          make={(ctx, c) => {
            let last = ''
            let lastField: Field | null = null
            return {
              frame: (dt) => {
                const sh = show.current
                if (sh) {
                  sh.t += dt * 60
                  if (sh.t * 2 >= sh.path.length / 2 - 1) sh.after()
                }
                const f = fieldRef.current
                const sv = savedRef.current
                const a = aimRef.current
                const dr = drawRef.current
                const fl = flash.current
                const flashing = fl && performance.now() - fl.t < (reduced() ? 600 : 450)
                const key = `${c.width}x${c.height}|${sv.sky}|${sv.trail}|${f.guns[0].life},${f.guns[1].life}|${a.angle},${a.charge}|${sh ? sh.t.toFixed(1) : ''}|${flashing ? performance.now() : ''}|${f.turn}|${f.wind}|${dr.flip}|${dr.aiming}`
                // a field is replaced, never changed, so the object itself says whether it moved
                if (key === last && f === lastField) return
                last = key
                lastField = f
                const w = c.width
                const h = c.height
                const s = w / FIELD_W
                const X = (x: number) => x * s
                const Y = (y: number) => h - y * s
                const L = SKY[sv.sky]
                const sky = ctx.createLinearGradient(0, 0, 0, h)
                sky.addColorStop(0, L.top)
                sky.addColorStop(1, L.low)
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.fillStyle = sky
                ctx.fillRect(0, 0, w, h)
                ctx.fillStyle = L.hill
                ctx.beginPath()
                ctx.moveTo(0, h)
                for (let i = 0; i <= COLS; i++) ctx.lineTo(X(i * DX), Y(f.ground[i]))
                ctx.lineTo(w, h)
                ctx.fill()
                ctx.strokeStyle = L.rim
                ctx.lineWidth = Math.max(1.5, s * 0.004)
                ctx.beginPath()
                for (let i = 0; i <= COLS; i++) {
                  if (i) ctx.lineTo(X(i * DX), Y(f.ground[i]))
                  else ctx.moveTo(0, Y(f.ground[0]))
                }
                ctx.stroke()
                // the wind, as an arrow along the top
                const wx = w / 2
                const wy = h * 0.08
                const len = (f.wind / 0.35) * w * 0.12
                ctx.strokeStyle = 'rgba(255,255,255,0.85)'
                ctx.fillStyle = 'rgba(255,255,255,0.85)'
                ctx.lineWidth = 3
                ctx.beginPath()
                ctx.moveTo(wx - len, wy)
                ctx.lineTo(wx + len, wy)
                ctx.stroke()
                if (Math.abs(len) > 3) {
                  const d = Math.sign(len)
                  ctx.beginPath()
                  ctx.moveTo(wx + len + d * 8, wy)
                  ctx.lineTo(wx + len - d * 2, wy - 6)
                  ctx.lineTo(wx + len - d * 2, wy + 6)
                  ctx.fill()
                }
                ctx.font = `600 ${Math.max(11, s * 0.026)}px system-ui, sans-serif`
                ctx.textAlign = 'center'
                ctx.fillText(
                  f.wind === 0 ? 'calm' : `wind ${Math.abs(f.wind).toFixed(2)}`,
                  wx,
                  wy + 22,
                )
                // your last shell's path, to aim the next by
                if (sv.trail && trail.current && !sh) {
                  ctx.fillStyle = 'rgba(255,255,255,0.55)'
                  const p = trail.current
                  for (let i = 0; i < p.length; i += 8)
                    ctx.fillRect(X(p[i]) - 1.5, Y(p[i + 1]) - 1.5, 3, 3)
                }
                // the guns, each with its barrel
                for (const who of [0, 1] as Who[]) {
                  const g = gunAt(f, who)
                  const gx = X(g.x)
                  const gy = Y(g.y)
                  const r = GUN_R * s
                  const ang = who === 0 ? a.angle : 45
                  const dir = who === 0 ? 1 : -1
                  ctx.strokeStyle = '#222'
                  ctx.lineWidth = Math.max(3, r * 0.5)
                  ctx.beginPath()
                  ctx.moveTo(gx, gy)
                  ctx.lineTo(
                    gx + dir * Math.cos((ang * Math.PI) / 180) * r * 1.9,
                    gy - Math.sin((ang * Math.PI) / 180) * r * 1.9,
                  )
                  ctx.stroke()
                  const ink = GUNS[dr.flip ? (who === 0 ? 1 : 0) : who]
                  ctx.fillStyle = f.guns[who].life > 0 ? ink : '#555'
                  ctx.beginPath()
                  ctx.arc(gx, gy, r, Math.PI, 0)
                  ctx.fill()
                  ctx.fillRect(gx - r * 1.2, gy, r * 2.4, r * 0.7)
                }
                // the aim, as a short guide from your barrel, while it is your turn
                if (dr.aiming && !sh) {
                  const g = gunAt(f, 0)
                  const rad = (a.angle * Math.PI) / 180
                  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
                  ctx.setLineDash([4, 6])
                  ctx.lineWidth = 2
                  ctx.beginPath()
                  ctx.moveTo(X(g.x), Y(g.y))
                  ctx.lineTo(
                    X(g.x + Math.cos(rad) * a.charge * 0.5),
                    Y(g.y + Math.sin(rad) * a.charge * 0.5),
                  )
                  ctx.stroke()
                  ctx.setLineDash([])
                }
                // the shell in flight
                if (sh) {
                  const k = Math.min(sh.path.length / 2 - 1, Math.floor(sh.t * 2))
                  ctx.fillStyle = '#fff'
                  ctx.beginPath()
                  ctx.arc(
                    X(sh.path[k * 2]),
                    Y(sh.path[k * 2 + 1]),
                    Math.max(2.5, s * 0.006),
                    0,
                    Math.PI * 2,
                  )
                  ctx.fill()
                }
                // the burst: a ring, still under reduced motion and growing otherwise
                if (flashing && fl) {
                  const age = (performance.now() - fl.t) / 450
                  const rr = (reduced() ? 1 : 0.4 + age * 0.6) * 0.11 * s
                  ctx.strokeStyle = 'rgba(255,200,80,0.9)'
                  ctx.lineWidth = 4
                  ctx.beginPath()
                  ctx.arc(X(fl.x), Y(fl.y), rr, 0, Math.PI * 2)
                  ctx.stroke()
                }
              },
            }
          }}
        />
      </div>

      <div className="lab-controls" role="group" aria-label="Your aim">
        <span className="at-set">
          <button
            className="btn btn-ghost"
            aria-label="Raise the barrel"
            disabled={!yourTurn}
            onClick={() => setAngle((a) => Math.min(85, a + 1))}
          >
            ↺
          </button>
          <span className="at-read">Angle {angle}°</span>
          <button
            className="btn btn-ghost"
            aria-label="Lower the barrel"
            disabled={!yourTurn}
            onClick={() => setAngle((a) => Math.max(5, a - 1))}
          >
            ↻
          </button>
        </span>
        <span className="at-set">
          <button
            className="btn btn-ghost"
            aria-label="Less charge"
            disabled={!yourTurn}
            onClick={() => setCharge((c) => Math.max(0.1, Math.round((c - 0.02) * 100) / 100))}
          >
            −
          </button>
          <span className="at-read">Charge {Math.round(charge * 100)}%</span>
          <button
            className="btn btn-ghost"
            aria-label="More charge"
            disabled={!yourTurn}
            onClick={() => setCharge((c) => Math.min(1, Math.round((c + 0.02) * 100) / 100))}
          >
            +
          </button>
        </span>
        <button className="btn at-fire" disabled={!yourTurn} onClick={pull}>
          💥 Fire
        </button>
      </div>
      {inMatch && <MatchSend lm={lm} />}
      {mode === 'bot' && !inMatch && field.winner !== null && (
        <div className="lab-controls">
          <button className="btn" onClick={() => newGame()}>
            ↻ Play again
          </button>
        </div>
      )}

      {mode === 'bot' && !inMatch && (
        <p className="sun-reading">
          <span className="muted">
            Against {LEVEL_NAMES[saved.level]}: won {rec.won}, lost {rec.lost}
            {rec.fewest ? ` · fewest shots to win ${rec.fewest}` : ''}
          </span>
        </p>
      )}
      {mode === 'bot' &&
        !inMatch &&
        level !== saved.level &&
        !untouched &&
        field.winner === null && (
          <p className="muted mc-note">The new level starts with the next field.</p>
        )}
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Look</h3>
          <div className="lab-controls" role="group" aria-label="Sky">
            {SKIES.map((k) => (
              <button
                key={k}
                className="btn btn-ghost"
                aria-pressed={saved.sky === k}
                onClick={() => setSaved((s) => ({ ...s, sky: k }))}
              >
                {SKY[k].name}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.trail}
              onClick={() => setSaved((s) => ({ ...s, trail: !s.trail }))}
            >
              Show my last shot
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Two guns, turn about. Set your barrel’s angle and the charge — drag from anywhere on the
        field (the direction from your gun is the angle, the distance the charge), or use the
        buttons or keys — and fire. Gravity pulls the shell down and the wind, which changes a
        little every turn, pushes it sideways. A shell digs a crater where it lands, and a gun whose
        ground is dug away drops into the hole. A direct hit does the most; a near one less. Three
        good hits win. The computer works out the shot that would land on you exactly; Easy, Fair
        and Hard differ in how steady their hand is. In a call, 👥 With the call puts a friend on
        the other gun, or the two of you on one gun against the computer; whoever has the right gun
        sees the field from their side.
      </p>
    </div>
  )
}
