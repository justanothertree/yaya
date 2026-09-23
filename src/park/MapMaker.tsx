import { useMemo, useState, useSyncExternalStore } from 'react'
import { ArtThumb } from '../draw/ArtThumb'
import { gallery, subscribeGallery } from '../draw/gallery'
import type { Drawing } from '../draw/strokes'
import { worldOf, type MapDoc, type Piece } from './mapDoc'
import type { PlaceKind } from './mapOf'
import { mapBytes, MAP_LIMIT, saveMap } from './maps'

/**
 * Making a map by putting things on it.
 *
 * ⚠️ WHY THIS EXISTS BESIDE THE OTHER ONE. The first map maker read a DRAWING: one named layer
 * was one place, so a field of twenty rocks meant twenty layers against a cap of twenty-four,
 * each named by hand. Asked for instead as drawing a thing once and stamping it everywhere,
 * which is a different shape of data and therefore a different room — see mapDoc.
 *
 * ⚠️ NOTHING IS NAMED HERE. That is the whole gain. A stamp carries its kind and its height
 * from the two pickers above the field, chosen once and reused for every press, so placing the
 * fiftieth rock costs one click and no typing.
 *
 * ⚠️ AND THE PIECES POINT AT A PALETTE THIS BUILDS AS IT GOES. A drawing joins the map the
 * first time it is stamped and never again, so fifty rocks are fifty positions and one picture
 * — see mapDoc, where that is the reason a map can carry its own art at all.
 */

const KINDS: Array<[PlaceKind, string]> = [
  ['rocks', 'Rocks'],
  ['grove', 'Trees'],
  ['pond', 'Water'],
  ['ring', 'Ring'],
  ['wall', 'Wall'],
  ['flat', 'Just a place'],
]

/**
 * ⚠️ HEIGHTS AS WORDS, NOT A NUMBER TO TYPE. The old reader took `rocks 0.5` and meant half a
 * creature high, which is a thing you have to be told. Three choices cover what the built-in
 * park actually uses — its ring and rocks are low, its far trees need wings — and a person
 * picking "you can stand on it" does not have to know what 0.5 was measured in.
 */
const TOPS: Array<[number, string]> = [
  [0, 'Walk past it'],
  [0.5, 'Stand on it'],
  [0.8, 'Only with wings'],
]

const SIZES: Array<[number, string]> = [
  [0.06, 'Small'],
  [0.12, 'Middling'],
  [0.2, 'Big'],
]

export function MapMaker() {
  const kept = useSyncExternalStore(subscribeGallery, gallery, gallery)
  const [name, setName] = useState('')
  const [palette, setPalette] = useState<Drawing[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [pick, setPick] = useState(0)
  const [kind, setKind] = useState<PlaceKind>('rocks')
  const [top, setTop] = useState(0.5)
  const [wide, setWide] = useState(0.12)
  const [erasing, setErasing] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  const chosen = kept[pick]?.art ?? null

  const doc: MapDoc | null = useMemo(
    () =>
      palette.length && pieces.length
        ? { v: 1, name: name.trim() || 'Map', palette, pieces }
        : null,
    [name, palette, pieces],
  )
  const world = doc ? worldOf(doc) : null
  const bytes = doc ? mapBytes(doc) : 0

  /**
   * ⚠️ THE PRESS IS SPENT ON ONE THING. Stamping and removing are a MODE rather than two
   * buttons on the same press, because a click that both places a rock and might delete the one
   * underneath is a click nobody can predict — the lesson the paint room's text tool already
   * learned about a control that swallowed the next drag.
   */
  const put = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width < 2) return
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    if (erasing) {
      /* the nearest piece to the press, within its own half-width — so a miss removes nothing */
      let best = -1
      let near = Infinity
      pieces.forEach((p, i) => {
        const d = Math.hypot(p.at.x - x, p.at.y - y)
        if (d < p.wide / 2 && d < near) {
          near = d
          best = i
        }
      })
      if (best >= 0) setPieces(pieces.filter((_, i) => i !== best))
      return
    }
    if (!chosen) return
    /* ⚠️ the drawing joins the palette once, on its first stamp, and every later copy is an index */
    let at = palette.indexOf(chosen)
    let next = palette
    if (at < 0) {
      at = palette.length
      next = [...palette, chosen]
      setPalette(next)
    }
    setPieces([...pieces, { art: at, at: { x, y }, wide, kind, top }])
    setSaid(null)
  }

  const keep = () => {
    if (!doc) return setSaid('Put something on it first.')
    if (bytes > MAP_LIMIT.bytes)
      return setSaid(
        `Too big to keep — ${Math.round(bytes / 1024)}KB of ${Math.round(MAP_LIMIT.bytes / 1024)}KB. Use simpler drawings.`,
      )
    setSaid(saveMap(doc) ? `Kept "${doc.name}".` : 'That could not be kept.')
  }

  return (
    <section className="card map-maker">
      <div className="map-bar">
        <label className="sr-only" htmlFor="map-name">
          What to call it
        </label>
        <input
          id="map-name"
          className="map-name"
          value={name}
          placeholder="Name this place"
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn" onClick={keep} disabled={!doc}>
          ⬇ Keep the map
        </button>
        <span className="muted map-count">
          {pieces.length} thing{pieces.length === 1 ? '' : 's'}
          {world ? ` · ${world.across}×${world.down} screens` : ''}
        </span>
      </div>

      {/* ⚠️ THE PICTURES, NOT THEIR NAMES — the same reason the gallery menu shows thumbnails:
          a list of "rock" and "rock1" is a list you have to open twice to tell apart. */}
      {kept.length === 0 ? (
        <p className="muted">Nothing drawn yet — make something in Paint and it turns up here.</p>
      ) : (
        <div className="map-palette" role="group" aria-label="What to stamp">
          {kept.map((a, i) => (
            <button
              key={a.id}
              className={'map-stamp' + (i === pick ? ' is-on' : '')}
              aria-pressed={i === pick}
              title={a.name}
              onClick={() => {
                setPick(i)
                setErasing(false)
              }}
            >
              <ArtThumb art={a.art} w={44} h={34} />
            </button>
          ))}
        </div>
      )}

      <div className="map-row">
        <label>
          <span className="sr-only">What it is</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as PlaceKind)}>
            {KINDS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">How high</span>
          <select value={top} onChange={(e) => setTop(Number(e.target.value))}>
            {TOPS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">How big</span>
          <select value={wide} onChange={(e) => setWide(Number(e.target.value))}>
            {SIZES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className={'btn' + (erasing ? ' is-on' : '')}
          aria-pressed={erasing}
          onClick={() => setErasing((v) => !v)}
        >
          {erasing ? '✕ Taking things off' : '✕ Take things off'}
        </button>
      </div>

      {/* ⚠️ THE FIELD IS THE MAP, one press one thing. It is the world's own shape rather than
          whatever the card is wide, so where you put something is where it is — the one promise
          the first map maker made and kept, and the only part of it worth carrying over. */}
      <div
        className={'map-field' + (erasing ? ' is-erasing' : '')}
        onClick={put}
        role="presentation"
      >
        {pieces.map((p, i) => {
          const art = palette[p.art]
          if (!art) return null
          const ar = art.ratio > 0.05 && art.ratio < 20 ? art.ratio : 1
          return (
            <span
              key={i}
              className={'map-piece is-' + p.kind}
              style={{
                left: `${p.at.x * 100}%`,
                top: `${p.at.y * 100}%`,
                width: `${p.wide * 100}%`,
                aspectRatio: String(ar),
              }}
              aria-hidden
            >
              <ArtThumb art={art} w={220} h={Math.round(220 / ar)} />
            </span>
          )
        })}
      </div>

      {said && (
        <p className="muted" role="status">
          {said}
        </p>
      )}
      <p className="muted map-note">
        Pick a picture, then press the field to put it down. The same picture can go down as many
        times as you like — it is only kept once.
      </p>
    </section>
  )
}
