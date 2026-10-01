import { useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { gallery, subscribeGallery } from '../draw/gallery'
import { pets as myPets, subscribePets } from '../pets/pets'
import { bakeWalk, blitBaked } from '../pets/bake'
import { FLOCK, onCamera, ringOf, stepSwarm, type Mob } from '../park/swarm'

/**
 * Fifty of your drawing, coming for you — #dev-swarm.
 *
 * ⚠️ A WORKBENCH BECAUSE THE PARK NEEDS AN ACCOUNT, which is the same reason #dev-park exists.
 * The question this answers is not "does it run" — the spike settled that, and the answer was 800
 * for less than a millisecond — but "what does fifty of MY creature feel like", which is a
 * question only Evan can answer and which he cannot get at without a field to put them on.
 *
 * ⚠️ AND IT IS NOT THE PARK AND DOES NOT PRETEND TO BE. There is no boss, no relay, no hit
 * detection and nothing at stake: it is the crowd, at the size the park draws creatures, so the
 * numbers and the spacing can be judged before any of it is wired into a room people use.
 */

/* ⚠️ swarm.ts is unitless on purpose — the caller says what one unit is. Here it is one creature's
   height in pixels, which is the unit the park thinks in and the one the tuning was written in. */
const TALL = 54

export function SwarmPreview() {
  const kept = useSyncExternalStore(subscribeGallery, gallery, gallery)
  const mine = useSyncExternalStore(subscribePets, myPets, myPets)
  const choices = useMemo(
    () => [
      ...mine.map((p) => ({ name: p.name, art: p.art })),
      ...kept.map((a) => ({ name: a.name, art: a.art })),
    ],
    [mine, kept],
  )
  const [pick, setPick] = useState(0)
  const [many, setMany] = useState(50)
  const [ms, setMs] = useState(0)
  const [shown, setShown] = useState(0)
  const cv = useRef<HTMLCanvasElement>(null)
  const seek = useRef({ x: 600, y: 320 })
  const art = choices[Math.min(pick, choices.length - 1)]?.art ?? null

  const baked = useMemo(() => (art ? bakeWalk(art, TALL) : null), [art])

  useEffect(() => {
    const el = cv.current
    if (!el || !baked) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    /**
     * In the caller's unit, which here is pixels — see TALL.
     *
     * ⚠️ HOW FAR APART THEY STAND COMES FROM THE CREATURE, not from a constant. FLOCK's defaults
     * are in creature-heights and a drawing is not square: this one bakes to 76px wide at 54
     * tall, so a separation of 0.55 heights packed a hundred and fifty of them into a solid disc
     * — every one overlapping its neighbours by more than half. Measured off the sprite, a wide
     * creature keeps more room than a narrow one, which is the same principle footSpan follows
     * and one less number to tune by eye.
     */
    const tune = {
      ...FLOCK,
      speed: FLOCK.speed * TALL,
      apart: baked.w * 0.72,
      reach: baked.w * 0.9,
    }
    /* ⚠️ just off the edge, so they walk in rather than appear — and so they ARRIVE: spawned a
       screen and a half out they spend ten seconds offstage before anything happens. */
    let mobs: Mob[] = ringOf(many, 1234, seek.current, el.width * 0.58)
    let raf = 0
    let last = performance.now()
    let frames = 0
    let since = last
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      mobs = stepSwarm(mobs, seek.current, dt, tune)
      ctx.clearRect(0, 0, el.width, el.height)
      /* ⚠️ thinking is not culled and drawing is — see onCamera. Everything above stepped. */
      let on = 0
      const t = now / 1000
      for (const m of mobs) {
        if (
          !onCamera(
            m,
            { x: el.width / 2, y: el.height / 2 },
            el.width / 2 + TALL,
            el.height / 2 + TALL,
          )
        )
          continue
        on++
        blitBaked(ctx, baked, m.x, m.y, t + m.x * 0.01, m.vx < 0 ? -1 : 1)
      }
      frames++
      if (now - since > 400) {
        setMs(+((now - since) / frames).toFixed(1))
        setShown(on)
        frames = 0
        since = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [baked, many])

  return (
    <section className="card">
      <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
        dev preview — #dev-swarm · a crowd, at the size the park draws one. No boss, no relay,
        nothing at stake.
      </p>
      {!choices.length ? (
        <p className="muted">Nothing drawn in this browser yet — draw something in Paint first.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <span className="muted">Creature</span>
              <select
                className="viz-select"
                value={pick}
                onChange={(e) => setPick(Number(e.target.value))}
              >
                {choices.map((c, i) => (
                  <option key={i} value={i}>
                    {c.name || `drawing ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            {[10, 50, 150, 300].map((n) => (
              <button
                key={n}
                className={'btn' + (many === n ? ' is-on' : '')}
                aria-pressed={many === n}
                onClick={() => setMany(n)}
              >
                {n}
              </button>
            ))}
            <span className="muted">
              {shown} on screen · {ms}ms a frame
            </span>
          </div>
          <canvas
            ref={cv}
            width={1200}
            height={640}
            style={{
              width: '100%',
              maxWidth: '100%',
              borderRadius: 10,
              background: '#14161c',
              touchAction: 'none',
            }}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              seek.current = {
                x: ((e.clientX - r.left) / r.width) * e.currentTarget.width,
                y: ((e.clientY - r.top) / r.height) * e.currentTarget.height,
              }
            }}
          />
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Move the pointer over the field and they come for it.
          </p>
        </>
      )}
    </section>
  )
}
