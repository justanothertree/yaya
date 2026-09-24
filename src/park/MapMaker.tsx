import { useMemo, useState, useSyncExternalStore } from 'react'
import { ArtThumb } from '../draw/ArtThumb'
import { gallery, subscribeGallery } from '../draw/gallery'
import type { Drawing } from '../draw/strokes'
import { MapGuide } from './MapGuide'
import { cropToInk, worldOf, type MapDoc, type Piece } from './mapDoc'
import type { PlaceKind } from './mapOf'
import { mapBytes, MAP_LIMIT, parkMaps, removeMap, saveMap, subscribeMaps } from './maps'

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

/**
 * What a piece DOES, in the only three answers that change anything.
 *
 * ⚠️ THE OLD LIST WAS THE PARK'S VOCABULARY, NOT A MAP-MAKER'S. Rocks, trees, water, ring
 * and "just a place" are the five kinds the built-in park happens to contain, and offering them
 * asked somebody to sort their own drawing into somebody else's categories — reported as not
 * understanding what they were for, which is fair, because for a stamped map they decided almost
 * nothing: the picture is the picture whichever word is picked.
 *
 * ⚠️ WHAT ACTUALLY DIFFERS IS WHETHER YOU CAN WALK THROUGH IT AND WHETHER YOU STAND ON
 * TOP. So it asks that, and nothing else. Naming an area is a separate want and can wait for
 * somebody to have it.
 */
const DOES: Array<[string, string, PlaceKind, number]> = [
  ['past', 'Walk over it', 'flat', 0],
  ['solid', 'Solid — blocks you', 'wall', 0],
  ['stand', 'Stand on top', 'rocks', 0.5],
]

/**
 * ⚠️ ONLY ASKED WHEN IT MATTERS. Height means nothing for scenery you walk over and
 * nothing for a wall you cannot climb, so the question only appears for something you stand on
 * — which is half of why the old three-way was confusing: it was asked of everything.
 *
 * ⚠️ IN CREATURES, because that is the only ruler on this page. "Only with wings" was the
 * park's own rule wearing a costume; this says the number and lets the reference creature in
 * the guide underneath show what it means.
 */
const HIGHS: Array<[number, string]> = [
  [0.5, 'Half a creature high'],
  [0.8, 'A creature high — needs wings'],
  [1.4, 'Twice that'],
]

const SIZES: Array<[number, string]> = [
  [0.06, 'Small'],
  [0.12, 'Middling'],
  [0.2, 'Big'],
]

export function MapMaker() {
  const kept = useSyncExternalStore(subscribeGallery, gallery, gallery)
  /** the maps already kept, live — so one saved here is in this list without a reload */
  const mine = useSyncExternalStore(subscribeMaps, parkMaps, parkMaps)
  const [name, setName] = useState('')
  const [palette, setPalette] = useState<Drawing[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [pick, setPick] = useState(0)
  const [does, setDoes] = useState('past')
  const [high, setHigh] = useState(0.5)
  const [wide, setWide] = useState(0.12)
  const [erasing, setErasing] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  /**
   * ⚠️ CROPPED ONCE, HERE, AND MEMOISED. A stamp is the thing somebody drew, not the sheet
   * it was drawn on — see cropToInk. Doing it in a memo also keeps each cropped drawing's
   * identity stable, which is what lets `palette.indexOf` go on recognising a repeat stamp as
   * the same picture instead of adding a second copy of it.
   */
  const stamps = useMemo(
    () => kept.map((a) => ({ id: a.id, name: a.name, art: cropToInk(a.art) })),
    [kept],
  )
  const chosen = stamps[pick]?.art ?? null

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
    const row = DOES.find((d) => d[0] === does) ?? DOES[0]
    setPieces([
      ...pieces,
      { art: at, at: { x, y }, wide, kind: row[2], top: row[0] === 'stand' ? high : 0 },
    ])
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
        {/* ⚠️ IT SAYS WHICH IT IS. Keeping under a name already taken REPLACES it — the rule
            the gallery and the minions share — and a button that said "keep" either way would
            be the only warning somebody got that their other map had gone. */}
        <button className="btn" onClick={keep} disabled={!doc}>
          {mine.some((m) => m.name.toLowerCase() === (name.trim() || 'Map').toLowerCase())
            ? '⬇ Replace that map'
            : '⬇ Keep the map'}
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
          {stamps.map((a, i) => (
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
          <span className="sr-only">What it does</span>
          <select value={does} onChange={(e) => setDoes(e.target.value)}>
            {DOES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {does === 'stand' && (
          <label>
            <span className="sr-only">How high</span>
            <select value={high} onChange={(e) => setHigh(Number(e.target.value))}>
              {HIGHS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
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
        {/* ⚠️ HOW BIG A SCREEN IS, DRAWN ON THE FIELD. This field is the WHOLE world, which
            is three screenfuls across — so two stamps at opposite ends are nowhere near each
            other and nothing said so. That is the same mistake the old paint-room guide was
            built to stop ("every test map came out bigger than any landmark the real park
            has"), which is why this is that guide rather than a second one: same lines, same
            creature-inside-a-place reference, derived from the same PARK numbers. */}
        <MapGuide />
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
      {/**
        ⚠️ THE ONES ALREADY KEPT, WITH A WAY OUT OF THEM. The store holds twelve and had no
        way to delete one or to fix one after keeping it — a cap with no door, and a typo in a
        name meaning start again. Pressing one loads it back in to work on; the ✕ puts it out.
      */}
      {mine.length > 0 && (
        <div className="map-kept">
          <span className="muted map-count">
            {mine.length} of {MAP_LIMIT.items} kept
          </span>
          {mine.map((m) => (
            <span key={m.id} className="map-kept-one">
              <button
                className="map-kept-open"
                title={`Work on ${m.name}`}
                onClick={() => {
                  setName(m.doc.name)
                  setPalette(m.doc.palette)
                  setPieces(m.doc.pieces)
                  setErasing(false)
                  setSaid(`Working on "${m.doc.name}".`)
                }}
              >
                🗺 {m.name}
                <span className="muted"> · {m.doc.pieces.length}</span>
              </button>
              <button
                className="map-kept-bin"
                aria-label={`Delete ${m.name}`}
                title={`Delete ${m.name}`}
                onClick={() => {
                  removeMap(m.id)
                  setSaid(`Deleted "${m.name}".`)
                }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="muted map-note">
        Pick a picture, then press the field to put it down. The same picture can go down as many
        times as you like — it is only kept once.
      </p>
    </section>
  )
}
