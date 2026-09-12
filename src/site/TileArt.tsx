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

export type TileArtKind = 'profile' | 'viz' | 'circuit' | 'ratings' | 'calls'

/** the four looks the profile card cycles — picked to be different in KIND, not four gradients */
const CYCLE = ['aurora', 'bands', 'rings', 'ember'] as const

export function TileArt({ kind }: { kind: TileArtKind }) {
  if (kind === 'profile') return <ProfileArt />
  return (
    <svg className="hag-art" viewBox="0 0 320 104" aria-hidden preserveAspectRatio="xMidYMid slice">
      {kind === 'viz' && <Viz />}
      {kind === 'circuit' && <Bars />}
      {kind === 'ratings' && <Wheel />}
      {kind === 'calls' && <Levels />}
    </svg>
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
 * A whole page at small size, wearing four different looks in turn.
 *
 * ⚠️ IT WAS A BANNER AND A COUPLE OF BARS, in a third of a row, which showed that pages have
 * colours and nothing else — not that a page is BUILT, out of blocks somebody chose and
 * arranged. So it is a banner, a name, and three blocks under it, in a wide slot.
 *
 * ⚠️ Built from the REAL banner CSS and the REAL derived hue, so this is not an impression of
 * a profile — it is one. If the banner set changes, this changes with it.
 */
/**
 * Four people's pages, cycling.
 *
 * ⚠️ IT HAD TO SAY WHAT IT WAS. This was a gradient, a dot, a grey pill where a name goes and
 * three abstract shapes — which reads as "some coloured rectangles", not "a page somebody built".
 * A visitor who cannot tell what they are looking at learns nothing from it cycling four times.
 *
 * ⚠️ So there are WORDS in it now: a real name on the banner, what you can do from somebody's
 * page, and a label on each block saying what kind of block it is. Text is the only thing at this
 * size that cannot be misread, and the blocks are the whole idea of the room — a page is built
 * out of them, and everybody's is different.
 *
 * ⚠️ Still the real BANNER_STYLES and the real hueFor, so the looks cycling here are exactly
 * what a page looks like rather than four gradients somebody picked for a picture.
 */
const FOLK = ['Ada', 'Bo', 'Cleo', 'Dmitri']

function ProfileArt() {
  const hues = ['ada', 'bo', 'cleo', 'dmitri'].map(hueFor)
  return (
    <div className="hag-art hag-art-profile" aria-hidden>
      {CYCLE.map((style, i) => (
        <span key={style} className="hag-mini" style={{ animationDelay: `${i * 2.4}s` }}>
          <span
            className="hag-mini-banner"
            style={{ background: BANNER_STYLES[style].css(hues[i]) }}
          >
            <span className="hag-mini-face" style={{ background: `hsl(${hues[i]} 72% 52%)` }} />
            <span className="hag-mini-who">
              <span className="hag-mini-name">{FOLK[i]}</span>
              <span className="hag-mini-sub">add · message · call</span>
            </span>
          </span>
          <span className="hag-mini-blocks">
            {/* the kinds of block a page actually carries, named so they are not just shapes */}
            <span className="hag-mini-block">
              <span className="hag-mini-row">
                <span
                  className="hag-mini-play"
                  style={{ borderLeftColor: `hsl(${hues[i]} 80% 62%)` }}
                />
                <span className="hag-mini-wave" />
              </span>
              <span className="hag-mini-tag">song</span>
            </span>
            <span className="hag-mini-block">
              <span className="hag-mini-row">
                <span
                  className="hag-mini-daub"
                  style={{ background: `hsl(${(hues[i] + 70) % 360} 75% 58%)` }}
                />
                <span
                  className="hag-mini-daub is-two"
                  style={{ background: `hsl(${(hues[i] + 160) % 360} 75% 58%)` }}
                />
              </span>
              <span className="hag-mini-tag">drawing</span>
            </span>
            <span className="hag-mini-block">
              <span className="hag-mini-row is-num" style={{ color: `hsl(${hues[i]} 80% 66%)` }}>
                225
              </span>
              <span className="hag-mini-tag">score</span>
            </span>
          </span>
        </span>
      ))}
    </div>
  )
}
