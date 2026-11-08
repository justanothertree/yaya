import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { LabStage } from './LabStage'
import {
  PLACES,
  ROUNDS,
  SUN_KEY,
  apart,
  clock,
  compass,
  dateOf,
  dayOf,
  dayOfDate,
  fromClock,
  fromView,
  path,
  points,
  question,
  readSaved,
  shadow,
  sunAt,
  toClock,
  zoneOffset,
  zoneWords,
  type Question,
  type Saved,
  type Scale,
  type Sky,
} from './sun'
import { createSun, type SunView } from './sunEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const CUSTOM = 'Somewhere else'
const QUICK = [
  { label: 'Midsummer', day: dayOfDate(5, 21) },
  { label: 'Equinox', day: dayOfDate(2, 20) },
  { label: 'Midwinter', day: dayOfDate(11, 21) },
]
const hours = (h: number) =>
  `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`
const latText = (lat: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(SUN_KEY))
  } catch {
    return readSaved(null)
  }
}

export function SunDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const first = useMemo(load, [])
  const [saved, setSaved] = useState<Saved>(first)
  const [mode, setMode] = useState<'explore' | 'game'>('explore')
  const [place, setPlace] = useState(first.place)
  const [lat, setLat] = useState(first.lat)
  const [day, setDay] = useState(first.day)
  const [hour, setHour] = useState(15)
  const [scale, setScale] = useState<Scale>(first.scale)
  const year = useMemo(() => new Date().getFullYear(), [])
  // a place with a zone this browser can read is told on its clock; a latitude alone cannot be
  const here = PLACES.find((x) => x.name === place) ?? null
  const zonesWork = useMemo(() => zoneOffset('Europe/London', Date.UTC(2026, 6, 1)) === 1, [])
  const onClock = scale === 'clock' && here !== null && zonesWork
  const [playing, setPlaying] = useState(false)
  // the game
  const [q, setQ] = useState<Question | null>(null)
  const [round, setRound] = useState(0)
  const [score, setScore] = useState(0)
  const [guess, setGuess] = useState<Sky | null>(null)
  const [answered, setAnswered] = useState<number | null>(null)
  const [over, setOver] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(SUN_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(() => {
    setSaved((s) => ({ ...s, place, lat, day, scale }))
  }, [place, lat, day, scale])

  // what is being shown: the explorer's settings, or the round's
  // `hour` is on whichever clock is showing; the sky is asked in sun time
  const P = mode === 'game' && q ? q.place : here
  const lon = P?.lon ?? 0
  const L = mode === 'game' && q ? q.place.lat : lat
  const D = mode === 'game' && q ? q.day : day
  const Hr =
    mode === 'game' && q
      ? q.solar
      : onClock && here
        ? (fromClock(here, year, day, hour) ?? hour)
        : hour
  const clockShown = mode === 'game' && q ? q.scale === 'clock' : onClock
  const sun = useMemo(() => sunAt(L, D, Hr, year, lon), [L, D, Hr, year, lon])
  const arc = useMemo(() => path(L, D, year, lon), [L, D, year, lon])
  const today = useMemo(() => dayOf(L, D, year, lon), [L, D, year, lon])
  /** a sun-time hour in the words of the clock being shown */
  const told = (solar: number) => {
    const c = clockShown && P ? toClock(P, year, D, solar) : null
    return c
      ? { text: clock(c.hour), late: c.hour >= 24, zone: zoneWords(P!, year, c.offset) }
      : { text: clock(solar), late: false, zone: null }
  }

  const engine = useRef<SunView | null>(null)
  const now = useRef({ sun, arc, guess, show: true, mode, playing, hour })
  now.current = {
    sun,
    arc,
    guess,
    show: mode === 'explore' || answered !== null,
    mode,
    playing,
    hour,
  }
  const hourRef = useRef(hour)
  hourRef.current = hour

  const choosePlace = (name: string) => {
    setPlace(name)
    const p = PLACES.find((x) => x.name === name)
    if (p) setLat(p.lat)
  }

  /* ── the game */
  const ask = () => {
    setQ(question(Math.random, zonesWork ? scale : 'sun', year))
    setGuess(null)
    setAnswered(null)
  }
  const start = () => {
    setMode('game')
    setRound(0)
    setScore(0)
    setOver(null)
    setPlaying(false)
    ask()
    if (!running) setRunning(true)
  }
  const submit = () => {
    if (!q || !guess || answered !== null) return
    const off = apart(guess, sun)
    const got = points(off)
    setAnswered(off)
    setScore((s) => s + got)
  }
  const next = () => {
    if (round + 1 < ROUNDS) {
      setRound(round + 1)
      ask()
      return
    }
    const total = score
    setOver(`✨ ${total} of ${ROUNDS * 100}${total > saved.best ? ' — your best yet' : ''}.`)
    setSaved((s) => ({ ...s, best: Math.max(s.best, total) }))
    setQ(null)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.target !== e.currentTarget) return
    if (mode === 'game' && q && answered === null) {
      const g = guess ?? { azimuth: 180, elevation: 30 }
      const step = e.shiftKey ? 10 : 2
      const moves: Record<string, Sky> = {
        ArrowLeft: { ...g, azimuth: (g.azimuth - step + 360) % 360 },
        ArrowRight: { ...g, azimuth: (g.azimuth + step) % 360 },
        ArrowUp: { ...g, elevation: Math.min(90, g.elevation + step) },
        ArrowDown: { ...g, elevation: Math.max(-20, g.elevation - step) },
      }
      if (moves[e.key]) setGuess(moves[e.key])
      else if (e.key === 'Enter' && guess) submit()
      else return
    } else if (mode === 'game' && answered !== null && e.key === 'Enter') next()
    else if (mode === 'explore' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
      setHour((h) => (h + (e.key === 'ArrowLeft' ? -0.25 : 0.25) + 24) % 24)
    else if (mode === 'explore' && e.key === ' ') setPlaying((p) => !p)
    else return
    e.preventDefault()
  }

  /* ── words */
  const up = sun.elevation > 0
  const where = up
    ? `${sun.elevation.toFixed(0)}° up, in the ${compass(sun.azimuth)}`
    : `below the horizon (${sun.elevation.toFixed(0)}°), ${compass(sun.azimuth)}`
  /* ⚠️ A SUN-TIME READING IS NEVER CALLED "SUNRISE 03:44" — that sentence is a claim about a clock
     and nobody's clock says it. On the clock the zone is named in the same breath; in sun time the
     sentence says so before it gives a number. */
  const shown = told(Hr)
  const zoneName = P ? `${P.name} time` : ''
  const dayWords =
    today.kind === 'polar-day'
      ? 'The sun does not set today.'
      : today.kind === 'polar-night'
        ? 'The sun does not rise today.'
        : (() => {
            const r = told(today.rise)
            const s = told(today.set)
            return clockShown
              ? `Sunrise ${r.text} · sunset ${s.text}${s.late ? ' (after midnight)' : ''} · ${hours(today.length)} of daylight — ${zoneName}, ${s.zone}.`
              : `In sun time it rises at ${r.text} and sets at ${s.text} · ${hours(today.length)} of daylight. A clock there reads differently.`
          })()
  const timeWords = clockShown
    ? `${shown.text} ${zoneName} (${shown.zone})`
    : `${shown.text} sun time`
  const label =
    mode === 'explore'
      ? `Sky over ${place === CUSTOM ? latText(lat) : place} on ${dateOf(day)} at ${timeWords}: the sun is ${where}. ${dayWords}`
      : q
        ? `Where is the sun over ${q.place.name} on ${dateOf(q.day)} at ${timeWords}? ${guess ? `Your guess: ${guess.elevation.toFixed(0)}° up, ${compass(guess.azimuth)}.` : 'Tap the sky to guess.'}${answered !== null ? ` It was ${where}.` : ''}`
        : `Where's the sun? ${over ?? ''}`

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Sun path">
      <LabStage
        label={label}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createSun(device, context, format, canvas)
          engine.current = v
          let t = 0
          let owed = 0
          return {
            frame: (dt: number) => {
              t += dt
              const n = now.current
              // playing the day: an hour and a half a second, handed to React twenty times a second
              // rather than every frame
              if (n.mode === 'explore' && n.playing && dt > 0) {
                owed += dt * 1.5
                if (owed > 0.075) {
                  const by = owed
                  owed = 0
                  setHour((h) => (h + by) % 24)
                }
              }
              v.frame({
                time: t,
                sun: n.sun,
                showSun: n.show,
                guess: n.mode === 'game' ? n.guess : null,
                path: n.show ? n.arc : null,
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          if (mode !== 'game' || !q || answered !== null) return
          const r = e.currentTarget.getBoundingClientRect()
          setGuess(fromView(e.clientX - r.left, e.clientY - r.top, r.width, r.height))
          if (!running) setRunning(true)
        }}
      />
      {live && (
        <div className="sun-compass" aria-hidden="true">
          {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'].map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
      )}

      {live && (
        <>
          <div className="lab-controls">
            <div className="lab-group" role="group" aria-label="What to do">
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'explore'}
                onClick={() => {
                  setMode('explore')
                  setQ(null)
                }}
              >
                🌍 Explore
              </button>
              <button className="btn btn-ghost" aria-pressed={mode === 'game'} onClick={start}>
                🎯 Where’s the sun?
              </button>
            </div>
            {mode === 'explore' && (
              <>
                <label className="studio-pick">
                  <span className="sr-only">Place</span>
                  <select value={place} onChange={(e) => choosePlace(e.target.value)}>
                    {PLACES.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} ({latText(p.lat)})
                      </option>
                    ))}
                    <option value={CUSTOM}>{CUSTOM}…</option>
                  </select>
                </label>
                {here && zonesWork && (
                  <div className="lab-group" role="group" aria-label="Which clock">
                    {(['clock', 'sun'] as const).map((k) => (
                      <button
                        key={k}
                        className="btn btn-ghost"
                        aria-pressed={scale === k}
                        onClick={() => {
                          if (k === scale) return
                          // the same moment, told on the other clock
                          const solar = Hr
                          const c = toClock(here, year, day, solar)
                          setHour(k === 'clock' && c ? ((c.hour % 24) + 24) % 24 : solar)
                          setScale(k)
                        }}
                      >
                        {k === 'clock' ? '🕒 Clock time' : '☀️ Sun time'}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="btn"
                  aria-pressed={playing}
                  onClick={() => {
                    setPlaying((p) => !p)
                    if (!running) setRunning(true)
                  }}
                  aria-keyshortcuts="Space"
                >
                  {playing ? '⏸ Pause' : '▶ Play the day'}
                </button>
              </>
            )}
          </div>

          {mode === 'explore' && (
            <>
              <div className="sun-sliders">
                {place === CUSTOM && (
                  <label>
                    <span>Latitude {latText(lat)}</span>
                    <input
                      type="range"
                      min={-89}
                      max={89}
                      step={0.5}
                      value={lat}
                      onChange={(e) => setLat(Number(e.target.value))}
                    />
                  </label>
                )}
                <label>
                  <span>Date {dateOf(day)}</span>
                  <input
                    type="range"
                    min={1}
                    max={365}
                    step={1}
                    value={day}
                    onChange={(e) => setDay(Number(e.target.value))}
                  />
                </label>
                <label>
                  <span>
                    {onClock && here
                      ? `${here.name} time ${clock(hour)} (${shown.zone})`
                      : `Sun time ${clock(hour)}`}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    step={0.25}
                    value={hour}
                    onChange={(e) => {
                      setHour(Number(e.target.value))
                      setPlaying(false)
                    }}
                  />
                </label>
              </div>
              <div className="lab-controls">
                {QUICK.map((x) => (
                  <button
                    key={x.label}
                    className="btn btn-ghost"
                    aria-pressed={day === x.day}
                    onClick={() => setDay(x.day)}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
              <p className="sun-reading" aria-live="off">
                <strong>The sun is {where}.</strong>{' '}
                {up
                  ? `A 1 m stick throws a shadow ${shadow(sun.elevation) < 50 ? `${shadow(sun.elevation).toFixed(1)} m long` : 'tens of metres long'}.`
                  : ''}
                <br />
                {dayWords}
              </p>
            </>
          )}

          {mode === 'game' && (
            <>
              {q && (
                <p className="sun-reading" aria-live="polite">
                  <strong>
                    {round + 1} of {ROUNDS}: {q.place.name} ({latText(q.place.lat)}),{' '}
                    {dateOf(q.day)}, {timeWords}.
                  </strong>{' '}
                  {answered === null
                    ? guess
                      ? `Your guess: ${guess.elevation.toFixed(0)}° up, ${compass(guess.azimuth)}.`
                      : 'Tap the sky where you think the sun is (or use the arrow keys).'
                    : `It was ${where} — you were ${answered.toFixed(0)}° off: ${points(answered)} points.`}
                </p>
              )}
              <div className="lab-controls">
                {q && answered === null && (
                  <button
                    className="btn"
                    disabled={!guess}
                    onClick={submit}
                    aria-keyshortcuts="Enter"
                  >
                    That’s my guess
                  </button>
                )}
                {q && answered !== null && (
                  <button className="btn" onClick={next} aria-keyshortcuts="Enter">
                    {round + 1 < ROUNDS ? 'Next ›' : 'See the score'}
                  </button>
                )}
                {!q && (
                  <button className="btn" onClick={start}>
                    ▶ Play again
                  </button>
                )}
                <span className="lab-score">
                  {score} points{saved.best ? ` · best ${saved.best}` : ''}
                </span>
              </div>
              {over && (
                <p className="sun-reading">
                  <strong>{over}</strong>
                </p>
              )}
            </>
          )}

          <p className="muted lab-hint">
            The sky as you would see it turning on the spot: north at both edges, south in the
            middle.{' '}
            {here && zonesWork
              ? 'Clock time is what a clock there reads, summer time included (from this browser’s time-zone data, to about a minute); sun time puts noon where the sun is highest, which a clock can miss by an hour or more.'
              : !here
                ? 'A latitude alone has no time zone, so times here are sun time: noon is when the sun is highest, which a clock can miss by an hour or more.'
                : 'This browser cannot read time zones, so times are sun time: noon is when the sun is highest.'}{' '}
            Keys: ← → move the time
            {mode === 'game'
              ? ', or the guess (↑ ↓ too, Shift for bigger steps; Enter to answer)'
              : ', Space plays the day'}
            .
          </p>
        </>
      )}
    </div>
  )
}
