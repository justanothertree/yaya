import { BANNER_STYLES, hueFor } from '../profile/look'

/**
 * The small living picture on each "Have a go" invitation.
 *
 * ⚠️ SVG AND CSS KEYFRAMES, NOT SCRIPT. Eight tiles each running their own
 * requestAnimationFrame loop would be eight loops on the one page that has to load fast for
 * somebody skimming for ninety seconds, and it would still be eight loops while scrolled past.
 * Declarative animation runs on the compositor, costs no main thread, stops when the tab
 * backgrounds without anybody writing that code, and goes still on its own for a reader who has
 * asked for less motion. Only the two tiles you can actually TOUCH — the scribble pad and the
 * snake board — earn a script.
 *
 * ⚠️ NOTHING HERE IS A FAKE READOUT. The members-only rooms (the circuit, the ratings pool, a
 * call) cannot show a visitor real data — that is the whole reason they are members-only — so
 * these are plainly ornamental: bars with no numbers, a wheel with no words, levels with no
 * names. A home page that invents a scoreboard and presents it as somebody's is worse than a
 * home page with a plain rectangle on it.
 *
 * ⚠️ The profile one is NOT ornamental and deliberately so: it is built from the real
 * BANNER_STYLES and the real hueFor(), so the thing cycling there is exactly what a page looks
 * like. That is the tile whose whole claim is "everyone's looks different".
 */

export type TileArtKind = 'keys' | 'profile' | 'viz' | 'circuit' | 'ratings' | 'calls'

/** the four looks the profile card cycles — picked to be different in KIND, not four gradients */
const CYCLE = ['aurora', 'bands', 'rings', 'ember'] as const

export function TileArt({ kind }: { kind: TileArtKind }) {
  if (kind === 'profile') return <ProfileArt />
  return (
    <svg className="hag-art" viewBox="0 0 320 104" aria-hidden preserveAspectRatio="xMidYMid slice">
      {kind === 'keys' && <Keys />}
      {kind === 'viz' && <Viz />}
      {kind === 'circuit' && <Bars />}
      {kind === 'ratings' && <Wheel />}
      {kind === 'calls' && <Levels />}
    </svg>
  )
}

/** A key strip with a phrase running across it, and the shape of it drawn above. */
function Keys() {
  const keys = Array.from({ length: 12 }, (_, i) => i)
  return (
    <g>
      <path
        className="hag-art-wave"
        d="M8 30 Q 34 10 60 30 T 112 30 T 164 30 T 216 30 T 268 30 T 312 30"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.5"
      />
      {keys.map((i) => (
        <rect
          key={i}
          className="hag-art-key"
          x={8 + i * 25.6}
          y={46}
          width={22}
          height={48}
          rx={3}
          /* ⚠️ the stagger IS the melody — a delay per key, so the highlight walks the strip
             instead of every key flashing at once */
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </g>
  )
}

/** Rings breathing out of the middle — the kaleidoscope, at a glance. */
function Viz() {
  const rings = [0, 1, 2, 3, 4]
  return (
    <g transform="translate(160 52)">
      {rings.map((i) => (
        <circle
          key={i}
          className="hag-art-ring"
          /* ⚠️ A REAL RADIUS EACH, not all 14 with the animation doing the spreading. With motion
             off the animation never runs, and five identical circles at opacity 0 is an empty
             tile — the one reader who asked for calm got a blank rectangle. Spread statically,
             this is concentric rings whether or not anything moves. */
          r={8 + i * 9.5}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ animationDelay: `${i * 0.5}s` }}
        />
      ))}
      <circle className="hag-art-core" r="6" fill="currentColor" />
    </g>
  )
}

/** Bars filling and settling. No scale, no numbers — see the note at the top. */
function Bars() {
  const bars = [58, 34, 72, 46, 88, 62, 40]
  return (
    <g>
      {bars.map((h, i) => (
        <rect
          key={i}
          className="hag-art-bar"
          x={14 + i * 43}
          width={26}
          rx={4}
          y={96 - h}
          height={h}
          style={{ animationDelay: `${i * 0.12}s`, transformOrigin: `0 96px` }}
        />
      ))}
    </g>
  )
}

/** A wheel that spins and lands. Six blank wedges — it is the gesture, not a real pool. */
function Wheel() {
  const wedges = Array.from({ length: 6 }, (_, i) => i)
  return (
    <g transform="translate(160 52)">
      <g className="hag-art-wheel">
        {wedges.map((i) => {
          const a0 = (i * Math.PI) / 3
          const a1 = ((i + 1) * Math.PI) / 3
          const R = 40
          return (
            <path
              key={i}
              d={`M0 0 L ${R * Math.cos(a0)} ${R * Math.sin(a0)} A ${R} ${R} 0 0 1 ${R * Math.cos(a1)} ${R * Math.sin(a1)} Z`}
              fill="currentColor"
              opacity={i % 2 ? 0.55 : 0.28}
            />
          )
        })}
      </g>
      <circle r="7" fill="var(--surface, #111)" stroke="currentColor" strokeWidth="2" />
      <path d="M0 -46 L 6 -36 L -6 -36 Z" fill="currentColor" />
    </g>
  )
}

/** Somebody talking: a level meter, and rings off the one making the noise. */
function Levels() {
  const bars = Array.from({ length: 14 }, (_, i) => i)
  return (
    <g>
      <g transform="translate(46 52)">
        {[0, 1].map((i) => (
          <circle
            key={i}
            className="hag-art-ping"
            /* a real radius each — see the note on the rings above */
            r={22 + i * 11}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ animationDelay: `${i * 0.9}s` }}
          />
        ))}
        <circle r="15" fill="currentColor" opacity="0.85" />
      </g>
      {bars.map((i) => (
        <rect
          key={i}
          className="hag-art-level"
          x={92 + i * 16}
          width={8}
          rx={4}
          y={36}
          height={32}
          style={{ animationDelay: `${(i % 5) * 0.17}s`, transformOrigin: `0 52px` }}
        />
      ))}
    </g>
  )
}

/**
 * A page wearing four different looks in turn.
 *
 * ⚠️ Built from the REAL banner CSS and the REAL derived hue, so this is not an impression of a
 * profile — it is one, at small size. If the banner set changes, this changes with it.
 */
function ProfileArt() {
  const hues = ['ada', 'bo', 'cleo', 'dmitri'].map(hueFor)
  return (
    <div className="hag-art hag-art-profile" aria-hidden>
      {CYCLE.map((style, i) => (
        <span
          key={style}
          className="hag-mini"
          style={{
            background: BANNER_STYLES[style].css(hues[i]),
            animationDelay: `${i * 2.4}s`,
          }}
        >
          <span className="hag-mini-face" style={{ background: `hsl(${hues[i]} 72% 52%)` }} />
          <span className="hag-mini-bar" />
          <span className="hag-mini-bar is-short" />
        </span>
      ))}
    </div>
  )
}
