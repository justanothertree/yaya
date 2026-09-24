import { useEffect, useRef, useSyncExternalStore } from 'react'
import { party, currentRoute, hueFor, type PartyPeer } from './party'
import { shared } from './shared'
import { cursorHot, cursorMark } from '../ui/cursorSkin'
import { hslToHex } from '../theme/customTheme'
import './party.css'

/**
 * Everyone else's pointer, drawn over the page.
 *
 * ⚠️ POSITIONED IN A rAF LOOP, NOT FROM REACT STATE. The pointers move at 15Hz each and the page
 * scrolls at 60, so every cursor would have to be repositioned on every scroll event — as React
 * state that is a re-render of the whole overlay per frame, and it lands on the same main thread
 * the visualiser and the synth are already using. React owns which cursors EXIST; this loop owns
 * where they are, which is the part that changes constantly and needs no reconciliation.
 *
 * Also why the transform is set directly rather than through style props: a transform is the one
 * property the compositor can animate without laying anything out again.
 */

/** how big a worn pointer is drawn, matching the built-in arrow's 18×22 box closely enough */
const MARK = 22

export function PartyCursors() {
  const state = useSyncExternalStore(party.subscribe, party.getState, party.getState)
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const peersRef = useRef<Record<string, PartyPeer>>({})
  peersRef.current = state.peers

  useEffect(() => party.start(), [])
  /**
   * ⚠️ Started here, next to the cursors, rather than inside any window that uses it. The
   * registry has to be listening BEFORE a window mounts, or a shared window that is already
   * being offered when you open it never sees the offer — and the offer only comes round again
   * when the sharer next changes something.
   */
  useEffect(() => shared.start(), [])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const box = document.getElementById('content')
      if (!box) return
      const r = box.getBoundingClientRect()
      const here = currentRoute()
      const sy = window.scrollY
      for (const [id, el] of nodes.current) {
        const p = peersRef.current[id]
        if (!p) continue
        /**
         * Someone on another page is not drawn at all, rather than drawn at the edge or faded.
         * A cursor floating over content it is not actually pointing at is worse than no cursor:
         * it is a wrong answer to "what are they looking at" rather than no answer. The voice
         * bar names the page they are on instead, which is the true version of that fact.
         */
        if (p.route !== here) {
          el.style.visibility = 'hidden'
          continue
        }
        const x = r.left + p.x * r.width
        const y = p.y - sy
        // off-screen by a wide margin: skip the paint rather than pile up layers at the edge
        el.style.visibility =
          y < -80 || y > window.innerHeight + 80 ? 'hidden' : ('visible' as const)
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const list = Object.values(state.peers)
  if (!state.sharing || !list.length) return null

  /**
   * Somebody else's pointer, drawn the way THEY are wearing it.
   *
   * ⚠️ THEIR SHAPE, THE ROOM'S COLOUR, and the split is the whole design. In the People
   * directory a pointer badge is drawn in that person's own accent, because the avatar beside it
   * is already carrying who they are. Here the colour IS who they are — hueFor gives every
   * person a stable hue so the same friend is the same colour on their cursor, their notes on
   * the keyboard and their name in the roster. Take their accent instead and a room where
   * everybody kept the default theme is a room of identical green arrows.
   *
   * ⚠️ AND THE HOTSPOT IS APPLIED, or the drawing is not where the person is. The tip of
   * an arrow is its corner and the point of a dot is its middle, so a skin has to be pulled back
   * by its own hotspot — otherwise a dot cursor floats eleven pixels down and right of where
   * its owner is actually pointing.
   *
   * ⚠️ IN TWO DIFFERENT WAYS, WHICH IS NOT AN ACCIDENT. Sideways it is a MARGIN, so the
   * name follows the picture: done with a transform the label kept a fixed distance from the
   * POINT, and a dot — whose hotspot is its middle — sat twenty pixels away from its own name
   * with nothing in between. Vertically it is a TRANSFORM, so the label does not follow: a pen
   * points from its bottom corner, and a label that tracked it would end up above the pointer
   * while every other label sat below one. Names belong in the same place for everybody.
   */
  const worn = (p: PartyPeer) => {
    const skin = state.here[p.id]?.skin
    const mark = cursorMark(skin, hslToHex({ h: hueFor(p.id), s: 0.85, l: 0.58 }))
    const hot = cursorHot(skin)
    if (!mark || !hot) return null
    return (
      <img
        className="party-cursor-mark"
        src={mark}
        alt=""
        width={MARK}
        height={MARK}
        draggable={false}
        style={{
          marginLeft: -hot.x * MARK,
          transform: `translateY(${-hot.y * MARK}px)`,
        }}
      />
    )
  }

  return (
    <div className="party-cursors" aria-hidden>
      {list.map((p) => (
        <div
          key={p.id}
          className="party-cursor"
          style={{ ['--party-hue' as string]: hueFor(p.id) }}
          ref={(el) => {
            if (el) nodes.current.set(p.id, el)
            else nodes.current.delete(p.id)
          }}
        >
          {/* the built-in arrow is what somebody wearing the system pointer has to show, which
              is most people — so it stays exactly as it was rather than becoming a skin */}
          {worn(p) ?? (
            <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
              <path
                d="M2 1.5 L2 17 L6.2 13.2 L8.8 19.4 L11.6 18.2 L9 12.2 L14.6 12 Z"
                fill="hsl(var(--party-hue) 85% 58%)"
                stroke="rgba(0,0,0,.55)"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <span className="party-cursor-name">{p.name}</span>
        </div>
      ))}
    </div>
  )
}
