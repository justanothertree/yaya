import { useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from './PetView'
import { petRatio, rigOf } from './rig'
import { attacksOf, pairOf, petWide, type Attack } from './attack'
import {
  fightEffort,
  fightStance,
  foeInput,
  freshFighter,
  IDLE,
  respawn,
  STAGE,
  stepFighter,
  STOCKS,
  trade,
  winnerOf,
  RING,
  type FightInput,
  type Fighter,
} from './fight'
import { PET_TALL, traitsOf, traitWords, type Traits } from './play'

/**
 * Two of the things you drew, hitting each other.
 *
 * ⚠️ NOTHING HERE IS NEW EXCEPT THE RULES. The creatures are the pets, the physics is the
 * platformer's stepBody, the poses are the rig's, and the attacks are read out of the same layer
 * names that decide how a wing flaps. What this room adds is damage, stocks and a stage with
 * edges — everything else was already standing there.
 *
 * ⚠️ THE MATHS IS NEXT DOOR, in fight.ts and attack.ts, because requestAnimationFrame does not
 * run in the browser pane. Every number in this game was settled before this file existed: that a
 * fresh fighter cannot be killed off the top, that ring-outs start landing around 35–100% damage,
 * that a long tail out-ranges a short one by 42%, and that an AI round actually finishes. A loop
 * that owned its own maths could not have been asked any of that.
 */

export type FightPet = { name: string; art: Drawing }

const KEYS: Array<Record<string, keyof FightInput>> = [
  {
    a: 'left',
    A: 'left',
    d: 'right',
    D: 'right',
    w: 'jump',
    W: 'jump',
    f: 'quick',
    F: 'quick',
    g: 'heavy',
    G: 'heavy',
  },
  {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'jump',
    '.': 'quick',
    '>': 'quick',
    '/': 'heavy',
    '?': 'heavy',
  },
]

/** Whose colour is whose, so a readout and a creature can be matched without reading a name. */
const SIDE = ['p1', 'p2']

export function PetFight({ pets }: { pets: FightPet[] }) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [pick, setPick] = useState<[number, number]>([0, Math.min(1, pets.length - 1)])
  const [cpu, setCpu] = useState(true)
  /* ⚠️ bumped to start a fresh round; the loop hangs off it so a rematch rebuilds everything */
  const [round, setRound] = useState(0)

  const side = useMemo(() => pick.map((i) => pets[i] ?? pets[0]).filter(Boolean), [pets, pick])

  /**
   * ⚠️ READ ONCE PER FIGHTER, not once per frame. rigOf walks every stroke to find the part
   * boxes and attacksOf walks the parts again; both are asked inside the loop otherwise, sixty
   * times a second, for something that cannot change while a round is running.
   */
  const kit = useMemo(() => {
    const rigs = side.map((p) => rigOf(p.art))
    return {
      moves: rigs.map((r) => attacksOf(r)) as Attack[][],
      traits: rigs.map((r) => traitsOf(r)) as Traits[],
      wides: side.map((p) => petWide(p.art)),
    }
  }, [side])

  const [shown, setShown] = useState<Fighter[]>(() => [freshFighter(0), freshFighter(1)])
  const [over, setOver] = useState<number | null>(null)
  const fighters = useRef<Fighter[]>([freshFighter(0), freshFighter(1)])
  const held = useRef<FightInput[]>([{ ...IDLE }, { ...IDLE }])
  const cpuRef = useRef(cpu)
  cpuRef.current = cpu

  const [still, setStill] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setStill(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const stillRef = useRef(still)
  stillRef.current = still

  /* ⚠️ the first frame comes from here rather than from the loop — see the note in PetPlay:
     a room whose resting state is "nothing yet" blinks on arrival and is blank in the pane */
  useEffect(() => {
    fighters.current = [freshFighter(0), freshFighter(1)]
    held.current = [{ ...IDLE }, { ...IDLE }]
    setShown(fighters.current)
    setOver(null)
  }, [round, side])

  useEffect(() => {
    const r = host.current?.getBoundingClientRect()
    if (r && r.width > 1) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    const fit = () => {
      const box = host.current?.getBoundingClientRect()
      if (box && box.width > 1) setSize({ w: Math.round(box.width), h: Math.round(box.height) })
    }
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  /**
   * ⚠️ TWO PLAYERS ON ONE KEYBOARD, so the two maps must not overlap — and preventDefault on
   * both, or player two's arrow keys scroll the page out from under player one.
   */
  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      for (let i = 0; i < KEYS.length; i++) {
        const k = KEYS[i][e.key]
        if (!k) continue
        /* ⚠️ the second set is dead while a machine is using it, or a spectator leaning on an
           arrow key would fight the opponent they are watching */
        if (i === 1 && cpuRef.current) continue
        e.preventDefault()
        held.current[i][k] = on
        return
      }
    }
    const down = (e: KeyboardEvent) => set(e, true)
    const up = (e: KeyboardEvent) => set(e, false)
    /* ⚠️ a key held when the window loses focus never sends its keyup — see PetPlay */
    const drop = () => {
      held.current = [{ ...IDLE }, { ...IDLE }]
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', drop)
    window.addEventListener('pointerup', drop)
    window.addEventListener('pointercancel', drop)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', drop)
      window.removeEventListener('pointerup', drop)
      window.removeEventListener('pointercancel', drop)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let clock = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      clock += dt
      const lot = fighters.current
      const done = winnerOf(lot)

      if (done === null) {
        const inputs = lot.map((f, i) =>
          i === 1 && cpuRef.current
            ? foeInput(f, lot[0], kit.moves[1] ?? [], kit.wides[0] ?? PET_TALL, clock)
            : held.current[i],
        )
        let next = lot.map((f, i) =>
          f.stocks > 0
            ? stepFighter(f, inputs[i], kit.moves[i] ?? [], dt, kit.traits[i], STAGE, RING)
            : f,
        )
        /* ⚠️ null when nothing landed and null when nobody fell, so a quiet frame costs two
           comparisons and no renders — the same bargain collect makes in the playground */
        const swap = trade(next, kit.moves, kit.wides)
        if (swap) next = swap.next
        const back = respawn(next)
        if (back) next = back
        const end = winnerOf(next)
        /* ⚠️ the round stops being stepped the moment it is decided, so whatever the winner
           happened to be doing on that frame is what stays on screen — which was a creature
           frozen mid-swing, lit up, apparently attacking nobody for ever */
        if (end !== null) next = next.map((f) => ({ ...f, swing: 0, stun: 0, vx: 0 }))
        fighters.current = next
        setShown(next)
        if (end !== null) setOver(end)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [kit, round])

  /* the same sizing as the playground, and for the same reason — PetView's size is the LONG side */
  const petSize = (art: Drawing) => {
    const tall = Math.max(22, size.h * PET_TALL)
    const wh = petRatio(art)
    return Math.round(wh >= 1 ? tall * wh : tall)
  }

  if (pets.length < 1) return null

  return (
    <div className="pet-fight">
      <div className="pet-fight-hud">
        {side.map((p, i) => {
          const f = shown[i]
          const [quick, heavy] = pairOf(kit.moves[i] ?? [])
          return (
            <div key={i} className={'pet-fight-card is-' + SIDE[i]}>
              <PetView art={p.art} size={34} energy={0} label="" />
              <span className="pet-fight-who">
                <strong>{p.name}</strong>
                <span className="pet-fight-moves">
                  {quick.name} · {heavy.name}
                </span>
              </span>
              {/* ⚠️ the number AND the pips: a damage figure alone does not say how close anyone
                  is to losing, and pips alone do not say how close the next hit is to a KO */}
              <span className="pet-fight-hurt">{Math.round(f?.hurt ?? 0)}%</span>
              <span className="pet-fight-stocks" aria-label={`${f?.stocks ?? 0} lives left`}>
                {Array.from({ length: STOCKS }, (_, s) => (
                  <i key={s} className={s < (f?.stocks ?? 0) ? 'is-on' : ''} />
                ))}
              </span>
            </div>
          )
        })}
      </div>

      <div className="pet-fight-field">
        <div className="pet-fight-stage" ref={host}>
          {STAGE.map((l, i) => (
            <span
              key={i}
              className={'pet-fight-ledge' + (i === 0 ? ' is-deck' : '')}
              style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%` }}
              aria-hidden
            />
          ))}
          {side.map((p, i) => {
            const f = shown[i]
            if (!f || f.stocks <= 0) return null
            return (
              <span
                key={`${p.name}-${i}`}
                className={
                  'pet-fight-pet is-' +
                  SIDE[i] +
                  (f.stun > 0 ? ' is-hit' : '') +
                  (f.safe > 0 ? ' is-safe' : '') +
                  (f.swing > 0 ? ' is-swing' : '')
                }
                style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%` }}
              >
                <PetView
                  art={p.art}
                  size={petSize(p.art)}
                  energy={fightEffort(f, stillRef.current)}
                  facing={f.facing}
                  stance={fightStance(f)}
                  label={`${p.name}, on ${Math.round(f.hurt)} per cent`}
                />
              </span>
            )
          })}
          {over !== null && (
            <div className="pet-fight-over">
              <strong>{over >= 0 ? `${side[over]?.name ?? 'Nobody'} wins` : 'Nobody wins'}</strong>
              <button className="btn" onClick={() => setRound((r) => r + 1)}>
                Again
              </button>
            </div>
          )}
        </div>

        {/* ⚠️ ONE PAD, FOR PLAYER ONE. Two sets of thumbs on one phone is not a thing that fits,
            so on a touch screen the honest offer is you against the machine — which is why the
            pad only appears with a machine to fight. */}
        {cpu && (
          <div className="pet-fight-pad">
            <span className="pet-fight-pad-side">
              {(['left', 'right'] as const).map((k) => (
                <button
                  key={k}
                  className="pet-play-key"
                  aria-label={k === 'left' ? 'Move left' : 'Move right'}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    held.current[0][k] = true
                  }}
                  onPointerUp={() => (held.current[0][k] = false)}
                  onPointerCancel={() => (held.current[0][k] = false)}
                  onPointerLeave={() => (held.current[0][k] = false)}
                >
                  {k === 'left' ? '◀' : '▶'}
                </button>
              ))}
            </span>
            <span className="pet-fight-pad-side">
              {(['quick', 'heavy', 'jump'] as const).map((k) => (
                <button
                  key={k}
                  className={'pet-play-key' + (k === 'jump' ? ' is-jump' : '')}
                  aria-label={k === 'jump' ? 'Jump, press again in the air' : `${k} attack`}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    held.current[0][k] = true
                  }}
                  onPointerUp={() => (held.current[0][k] = false)}
                  onPointerCancel={() => (held.current[0][k] = false)}
                  onPointerLeave={() => (held.current[0][k] = false)}
                >
                  {k === 'jump' ? '⬆' : k === 'quick' ? '✦' : '✸'}
                </button>
              ))}
            </span>
          </div>
        )}
      </div>

      <div className="pet-fight-setup">
        <button
          className="btn"
          onClick={() => setCpu((c) => !c)}
          aria-pressed={!cpu}
          title={cpu ? 'Two people on one keyboard' : 'Play against the machine'}
        >
          {cpu ? '👤 vs 💻' : '👤 vs 👤'}
        </button>
        {pets.length > 1 &&
          ([0, 1] as const).map((seat) => (
            <label key={seat} className="pet-fight-seat">
              <span className={'pet-fight-dot is-' + SIDE[seat]} aria-hidden />
              <span className="sr-only">{seat === 0 ? 'Player one' : 'Player two'}</span>
              <select
                value={pick[seat]}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setPick((p) => (seat === 0 ? [n, p[1]] : [p[0], n]))
                  setRound((r) => r + 1)
                }}
              >
                {pets.map((p, i) => (
                  <option key={i} value={i}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
      </div>

      {/* ⚠️ in the room rather than in a tooltip, the same as the playground: this is the other
          place on the site where the keyboard IS the interface, and a phone has no tooltips */}
      <p className="muted pet-fight-keys">
        <strong>Player one</strong> — <strong>A D</strong> to move, <strong>W</strong> to jump
        (again in the air to recover), <strong>F</strong> quick, <strong>G</strong> heavy.
        {!cpu && (
          <>
            {' '}
            <strong>Player two</strong> — <strong>← →</strong>, <strong>↑</strong>,{' '}
            <strong>.</strong> and <strong>/</strong>.
          </>
        )}{' '}
        Nobody has a health bar: damage makes you fly further, and you lose by leaving the stage.
        What each creature is made of is what it can hit you with — a tail sweeps, wings send you
        upward, a mouth bites hardest
        {side[0] && traitWords(kit.traits[0] ?? { speed: 1, jump: 1, gravity: 1, glide: 1 }).length
          ? `. ${side[0].name} ${traitWords(kit.traits[0]).join(', ')}.`
          : '.'}
      </p>
    </div>
  )
}
