import { useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from './PetView'
import { ScrapFriend } from './ScrapFriend'
import { footRoom, petCanvas, rigOf } from './rig'
import { movesOf, pairOf, petWide, type Attack } from './attack'
import {
  fightEffort,
  fightStance,
  foeInput,
  FRAME,
  freshFighter,
  IDLE,
  liveBox,
  lungeOf,
  MAX_CATCHUP,
  phaseOf,
  STAGE,
  stepFight,
  STOCKS,
  winnerOf,
  RING,
  type FightInput,
  type Fighter,
} from './fight'
import {
  advance,
  DELAY,
  framesFor,
  heard,
  newTape,
  packInput,
  ready,
  REMATCH_AFTER,
  STALL_SAYS,
  take,
  type Tape,
} from './bout'
import {
  boutCode,
  boutFromHash,
  boutLink,
  joinBout,
  newBout,
  type Bout,
  type BoutState,
} from './boutRoom'
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

export function PetFight({
  pets,
  myName,
  authed,
}: {
  pets: FightPet[]
  myName: string
  authed?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [pick, setPick] = useState<[number, number]>([0, Math.min(1, pets.length - 1)])
  const [cpu, setCpu] = useState(true)
  /* ⚠️ bumped to start a fresh round; the loop hangs off it so a rematch rebuilds everything */
  const [round, setRound] = useState(0)

  /** the bout code, once you have opened one or followed somebody's link */
  const [code, setCode] = useState<string | null>(() => boutFromHash(window.location.hash))
  /** bumped when the other side turns up, leaves, or something goes wrong */
  const [wire, setWire] = useState(0)
  const bout = useRef<BoutState>(newBout())
  const post = useRef<Bout | null>(null)
  const tape = useRef<Tape>(newTape())
  const online = !!code

  /**
   * Who is fighting, in seat order.
   *
   * ⚠️ ONLINE, BOTH SIDES FIGHT THE CREATURES THAT WENT OVER THE WIRE — including your own. A look
   * is thinned before it is sent, and thinning moves points, so reach and body width come out
   * slightly different for the drawing you kept and the one they received. Both feed hit detection
   * directly, so two machines would disagree about whether a swipe connected from the very first
   * exchange, with nothing wrong in the netcode at all. See BoutState.mine.
   */
  const side = useMemo(() => {
    /* ⚠️ READ, NOT IGNORED: `bout` is a ref, so a foe arriving is invisible to the dependency
       list unless the counter that says one did is actually used in here */
    void wire
    if (online) {
      const foe = bout.current.foe
      const mineArt = bout.current.mine
      if (!foe || !mineArt) return []
      const meEntry = { name: myName, art: mineArt }
      const themEntry = { name: foe.name, art: foe.art }
      return bout.current.seat === 0 ? [meEntry, themEntry] : [themEntry, meEntry]
    }
    return pick.map((i) => pets[i] ?? pets[0]).filter(Boolean)
  }, [pets, pick, online, wire, myName])

  /**
   * ⚠️ READ ONCE PER FIGHTER, not once per frame. rigOf walks every stroke to find the part
   * boxes and attacksOf walks the parts again; both are asked inside the loop otherwise, sixty
   * times a second, for something that cannot change while a round is running.
   */
  const kit = useMemo(() => {
    const rigs = side.map((p) => rigOf(p.art))
    return {
      /* ⚠️ the six-slot table, not the raw part list — see moveTable. A fighter stores which
         move it is throwing as an index into whatever it was given, so this has to be the same
         list the hit test, the phase readout and the network all look up. */
      moves: side.map((p) => movesOf(p.art)) as Attack[][],
      traits: rigs.map((r) => traitsOf(r)) as Traits[],
      wides: side.map((p) => petWide(p.art)),
    }
  }, [side])

  /** how many seconds the fight has been waiting on somebody else's buttons */
  const [stalled, setStalled] = useState(0)
  /** the frame a round was decided on, so both sides can start the next one together */
  const endedAt = useRef<number | null>(null)
  /** frames until the next round, for the countdown — online only */
  const [nextIn, setNextIn] = useState(0)
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
    tape.current = newTape()
    endedAt.current = null
    setShown(fighters.current)
    setOver(null)
    setStalled(0)
    setNextIn(0)
  }, [round, side])

  /**
   * ⚠️ JOINING IS A THING YOU DO. Following somebody's link fills in the code and connects; it
   * does not reach into your creatures and pick one, and it cannot happen to you by opening a tab.
   */
  useEffect(() => {
    if (!code || !authed) return
    const mineNow = pets[pick[0]] ?? pets[0]
    if (!mineNow) return
    bout.current = newBout()
    tape.current = newTape()
    const bump = () => setWire((n) => n + 1)
    const b = joinBout(
      code,
      { name: myName, art: mineNow.art },
      bout.current,
      bump,
      (seat, frame, input) => heard(tape.current, seat, frame, input),
    )
    post.current = b
    bump()
    return () => {
      b?.leave()
      post.current = null
      bout.current = newBout()
    }
  }, [code, authed, pets, pick, myName])

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

  /**
   * The clock.
   *
   * ⚠️ A FIXED STEP, ONLINE AND OFF. Stepping by however long the last animation frame happened to
   * take is fine on one screen and useless across two: the same inputs on a 60Hz laptop and a
   * 144Hz monitor are a different fight within seconds. It is the same step locally so that what
   * you practise against the machine is the game you take online.
   *
   * ⚠️ ONLINE, THE TAPE DECIDES WHETHER TIME PASSES AT ALL. Nobody goes past a frame until both
   * sides' buttons for it are in hand — which is why both screens always show the same fight, and
   * why a bad connection shows up as a pause rather than as two worlds quietly drifting apart.
   */
  useEffect(() => {
    if (!kit.moves.length) return
    let raf = 0
    let last = performance.now()
    let owed = 0
    let waited = 0
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      owed += dt / FRAME
      let runs = framesFor(owed, MAX_CATCHUP)
      owed -= runs
      let moved = false

      while (runs-- > 0) {
        const lot = fighters.current
        let inputs: FightInput[]

        if (online) {
          /**
           * ⚠️ THE CLOCK KEEPS RUNNING AFTER A KNOCKOUT, and it has to. The frame counter is the
           * one thing two machines share, so it may never go backwards or pause on one side
           * while a bout is connected — a round ending is the fighters resetting, not time
           * stopping. Inputs keep being posted and consumed through the gap for the same reason.
           */
          const mySeat = bout.current.seat
          const want = tape.current.at + DELAY
          if (!tape.current.seen[mySeat]?.has(want)) {
            const mine = packInput(held.current[0])
            heard(tape.current, mySeat, want, mine)
            post.current?.step(want, mine)
          }
          if (!ready(tape.current)) break
          inputs = take(tape.current)
          advance(tape.current)

          if (endedAt.current !== null) {
            const togo = endedAt.current + REMATCH_AFTER - tape.current.at
            moved = true
            if (togo > 0) {
              setNextIn(Math.ceil(togo * FRAME))
              continue
            }
            /* both sides reach this on the same frame, having agreed on the one before it */
            fighters.current = [freshFighter(0), freshFighter(1)]
            endedAt.current = null
            setOver(null)
            setNextIn(0)
            continue
          }
        } else {
          if (winnerOf(lot) !== null) break
          const frame = tape.current.at
          inputs = lot.map((f, i) =>
            i === 1 && cpuRef.current
              ? foeInput(f, lot[0], kit.moves[1] ?? [], kit.wides[0] ?? PET_TALL, frame * FRAME)
              : held.current[i],
          )
          tape.current.at++
        }

        let next = stepFight(lot, inputs, kit.moves, kit.traits, kit.wides, STAGE, RING)
        const end = winnerOf(next)
        /* ⚠️ the round stops being stepped the moment it is decided, so whatever the winner
           happened to be doing on that frame is what stays on screen — which was a creature
           frozen mid-swing, lit up, apparently attacking nobody for ever */
        if (end !== null) next = next.map((f) => ({ ...f, swing: 0, stun: 0, vx: 0 }))
        fighters.current = next
        moved = true
        if (end !== null) {
          endedAt.current = tape.current.at
          setOver(end)
          if (!online) break
        }
      }

      if (moved) {
        setShown(fighters.current)
        waited = 0
        setStalled((v) => (v === 0 ? v : 0))
      } else if (online && bout.current.foe && winnerOf(fighters.current) === null) {
        /* ⚠️ a stall and a dropped player look identical, and only a clock tells them apart —
           below a second it is the network breathing and deserves no words */
        waited += dt
        if (waited > STALL_SAYS) setStalled(Math.round(waited))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [kit, round, online])

  /* the same sizing as the playground, and for the same reason — PetView's size is the LONG side */
  /* ⚠️ the CREATURE is this tall, not its canvas — see petCanvas */
  const petSize = (art: Drawing) => petCanvas(art, Math.max(22, size.h * PET_TALL))

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
                {/* ⚠️ the two NEUTRAL moves, because six names will not fit on a card — the rest
                    are found by pointing, which the legend under the stage explains */}
                <span className="pet-fight-moves">
                  {quick.name} · {heavy.name}
                </span>
              </span>
              {/* ⚠️ the number AND the pips: a damage figure alone does not say how close anyone
                  is to losing, and pips alone do not say how close the next hit is to a KO */}
              {/* ⚠️ what they are DOING, beside what they have taken — a heavy is worth
                  reacting to and there was no way to know one was coming */}
              {f && phaseOf(f, kit.moves[i] ?? []) !== 'ready' ? (
                <span className={'pet-fight-doing is-' + phaseOf(f, kit.moves[i] ?? [])}>
                  {/* ⚠️ THE MOVE ACTUALLY BEING THROWN, looked up by the index the fighter is
                      carrying — this used to compare against the heavy's name and guess, which
                      could only ever name two of the six. */}
                  {phaseOf(f, kit.moves[i] ?? []) === 'stunned'
                    ? 'hit'
                    : ((kit.moves[i] ?? [])[f.move]?.name ?? '')}
                </span>
              ) : null}
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

      {online && !authed && (
        <p className="muted pet-fight-say" role="status">
          Members only — your creature is drawn on somebody else's screen.{' '}
          <a href="#signin">Sign in</a>.
        </p>
      )}
      {online && authed && bout.current.trouble && (
        <p className="muted pet-fight-say" role="status">
          {bout.current.trouble}
        </p>
      )}
      {online && authed && !bout.current.foe && !bout.current.trouble && (
        <p className="muted pet-fight-say" role="status">
          Waiting for somebody to take the other side — the link is on your clipboard. They need an
          account and a creature of their own.
        </p>
      )}
      {online && stalled > 0 && (
        <p className="muted pet-fight-say" role="status">
          Waiting on {bout.current.foe?.name ?? 'them'}
          {stalled > 3 ? ' — they may have dropped out' : '…'}
        </p>
      )}

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
                  ' is-' +
                  phaseOf(f, kit.moves[i] ?? []) +
                  (f.safe > 0 ? ' is-safe' : '')
                }
                /* ⚠️ the lunge rides on the same transform that centres the creature, so it
                   moves the picture without moving where it actually IS — the hitbox and the
                   collision are the simulation's, and neither knows about this */
                style={{
                  left: `${f.x * 100}%`,
                  top: `${f.y * 100}%`,
                  transform: `translate(calc(-50% + ${(
                    f.facing *
                    lungeOf(f, kit.moves[i] ?? []) *
                    100
                  ).toFixed(1)}%), calc(-100% + ${(footRoom(p.art) * 100).toFixed(1)}%))`,
                }}
              >
                <PetView
                  art={p.art}
                  size={petSize(p.art)}
                  energy={fightEffort(f, stillRef.current)}
                  facing={f.facing}
                  stance={fightStance(f)}
                  /* ⚠️ only while the swing is actually out, so a drawn attack appears for the
                     frames it exists and is gone the rest of the time — see PetPaint.show */
                  show={f.swing > 0 ? (kit.moves[i] ?? [])[f.move]?.layer : undefined}
                  label={`${p.name}, on ${Math.round(f.hurt)} per cent`}
                />
              </span>
            )
          })}
          {/**
           * ⚠️ THE HITBOX ITSELF, not an impression of one. It is read from the same `liveBox` the
           * hit test uses, so what lights up IS what can hurt you, for exactly the frames it can —
           * which is the difference between learning the range of a move and guessing at it.
           * There is nothing to draw until an attack is live, so a quiet fight shows nothing.
           */}
          {side.map((_p, i) => {
            const f = shown[i]
            if (!f || f.stocks <= 0) return null
            const box = liveBox(f, kit.moves[i] ?? [])
            if (!box) return null
            return (
              <span
                key={`hit-${i}`}
                className={'pet-fight-swipe is-' + SIDE[i]}
                style={{
                  left: `${box.x0 * 100}%`,
                  top: `${box.y0 * 100}%`,
                  width: `${(box.x1 - box.x0) * 100}%`,
                  height: `${(box.y1 - box.y0) * 100}%`,
                }}
                aria-hidden
              />
            )
          })}
          {over !== null && (
            <div className="pet-fight-over">
              <strong>{over >= 0 ? `${side[over]?.name ?? 'Nobody'} wins` : 'Nobody wins'}</strong>
              {/* ⚠️ ONLINE THERE IS NO BUTTON, because a rematch is not one person's to call: the
                  next round begins on a frame both machines worked out for themselves. */}
              {online ? (
                <span className="muted">Next round in {nextIn}…</span>
              ) : (
                <button className="btn" onClick={() => setRound((r) => r + 1)}>
                  Again
                </button>
              )}
            </div>
          )}
        </div>

        {/* ⚠️ ONE PAD, FOR PLAYER ONE. Two sets of thumbs on one phone is not a thing that fits,
            so on a touch screen the honest offer is you against the machine — which is why the
            pad only appears with a machine to fight. */}
        {(cpu || online) && (
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
        {!online && (
          <button
            className="btn"
            onClick={() => setCpu((c) => !c)}
            aria-pressed={!cpu}
            title={cpu ? 'Two people on one keyboard' : 'Play against the machine'}
          >
            {cpu ? '👤 vs 💻' : '👤 vs 👤'}
          </button>
        )}
        {/* ⚠️ THE LINK IS THE INVITE, the same shape Snake's challenge already uses: no pending
            state to expire, nothing to reconcile if nobody answers, and it works from a phone or
            pasted anywhere. */}
        {!online ? (
          <button
            className="btn"
            disabled={!authed}
            title={
              authed
                ? 'Open a bout and send somebody the link'
                : 'Fighting online is for people with an account'
            }
            onClick={() => {
              const made = boutCode()
              setCode(made)
              void navigator.clipboard?.writeText(boutLink(made)).catch(() => {})
            }}
          >
            🌐 Fight a friend
          </button>
        ) : (
          <>
            <button
              className="btn"
              onClick={() => {
                setCode(null)
                setRound((r) => r + 1)
              }}
            >
              ← Back to local
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void navigator.clipboard?.writeText(boutLink(code)).catch(() => {})}
              title={boutLink(code)}
            >
              🔗 Copy the link
            </button>
            {/* ⚠️ BESIDE THE LINK RATHER THAN INSTEAD OF IT. Copying still wins for somebody you
                are already talking to somewhere else; this is for the case the link cannot
                serve — asked for directly, because Snake has it and a scrap did not. */}
            <ScrapFriend code={code} />
            <span className="muted pet-fight-code">{code}</span>
          </>
        )}
        {/**
         * ⚠️ ONLINE YOU PICK YOUR OWN, AND ONLY WHILE YOU ARE WAITING. The seat pickers were
         * hidden outright once a bout had a code, so following somebody's link brought whichever
         * creature happened to be selected and there was no way at all to change it — watched
         * happening: he loaded in with his second minion and was stuck with it.
         *
         * ⚠️ AND NOT ONCE THE FIGHT IS ON. A bout is lockstep: both machines run the same
         * simulation from the same drawing, so swapping a creature underneath it would give the two
         * sides different move tables and different hitboxes for the same frame, which is a desync
         * rather than a swap. `side` is empty until a foe and my own look are both in hand, so this
         * is the lobby and nothing else.
         */}
        {online && pets.length > 1 && side.length < 2 && (
          <label className="pet-fight-seat">
            <span className={'pet-fight-dot is-' + SIDE[0]} aria-hidden />
            <span className="sr-only">Which minion you are bringing</span>
            <select
              value={pick[0]}
              onChange={(e) => {
                const n = Number(e.target.value)
                setPick((p) => [n, p[1]])
              }}
            >
              {pets.map((p, i) => (
                <option key={i} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!online &&
          pets.length > 1 &&
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
        <strong>{online ? 'You' : 'Player one'}</strong> — <strong>A D</strong> to move,{' '}
        <strong>W</strong> to jump (again in the air to recover), <strong>F</strong> quick,{' '}
        <strong>G</strong> heavy. <strong>Hold W or S as you hit</strong> for an up or down attack —
        six in all, out of what you drew.
        {!cpu && !online && (
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
