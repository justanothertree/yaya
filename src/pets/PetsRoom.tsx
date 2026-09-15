import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { gallery, subscribeGallery, type Art } from '../draw/gallery'
import { PetView } from './PetView'
import { PART_DOES, rigOf, type PartKind } from './rig'
import { pets, removePet, renamePet, savePet, subscribePets, type Pet } from './pets'
import { companion, setCompanion, subscribeCompanion } from './companion'

/**
 * The room the pets live in.
 *
 * ⚠️ YOU DO NOT MAKE A PET HERE, YOU ADOPT A DRAWING. There is no creature builder with body
 * types and a parts bin, and there was never going to be one: this site already has a paint room
 * with eighteen brushes, layers, symmetry and a frame editor, and a parts bin would be a worse
 * drawing tool bolted next to a better one. Anything anybody has already drawn is already a pet —
 * it breathes and bobs the moment it is adopted — and it gets better if they go back and name its
 * layers. That is the whole feature: the thing people wanted to build has been in the gallery all
 * along.
 *
 * ⚠️ THE ROOM SAYS WHAT IT UNDERSTOOD. A rig read out of layer names is invisible: there is no
 * way to tell from looking at a still pet whether the engine found a wing or just a lump. So the
 * parts it recognised are printed with what each one does, and the names it did NOT recognise are
 * printed too. That list is the entire documentation for the feature, and it is written in the
 * words of the person's own drawing.
 */

const REST = 0.55
const PROD = 1
const CALM_AFTER_MS = 2600

export function PetsRoom() {
  const mine = useSyncExternalStore(subscribePets, pets, pets)
  const drawings = useSyncExternalStore(subscribeGallery, gallery, gallery)
  const follows = useSyncExternalStore(subscribeCompanion, companion, companion)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adopting, setAdopting] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  /* ⚠️ Live, not read once — the same rule the art block follows. Somebody can turn the setting
     on while the page is open, and a room full of moving things is the one to obey it fastest. */
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

  const chosen: Pet | undefined = mine.find((p) => p.id === openId) ?? mine[0]

  const [energy, setEnergy] = useState(REST)
  const calmTimer = useRef(0)
  const prod = () => {
    if (still) return
    setEnergy(PROD)
    window.clearTimeout(calmTimer.current)
    calmTimer.current = window.setTimeout(() => setEnergy(REST), CALM_AFTER_MS)
  }
  useEffect(() => () => window.clearTimeout(calmTimer.current), [])

  const parts = useMemo(() => (chosen ? rigOf(chosen.art) : []), [chosen])
  const known = useMemo(() => {
    const seen = new Map<PartKind, number>()
    for (const p of parts) seen.set(p.kind, (seen.get(p.kind) ?? 0) + 1)
    return [...seen]
  }, [parts])
  const unnamed = parts.filter((p) => p.name === 'unnamed').length
  const following = follows.on && (follows.name === chosen?.name || !follows.name)

  const say = (msg: string) => {
    setNote(msg)
    window.setTimeout(() => setNote((n) => (n === msg ? null : n)), 4000)
  }

  const adopt = (a: Art) => {
    const name = window.prompt('What is this one called?', a.name)?.trim() ?? ''
    if (!name) return
    const made = savePet(name, a.art)
    if (!made) {
      say('That drawing could not be read.')
      return
    }
    setOpenId(made.id)
    setAdopting(false)
    say(`${made.name} is yours.`)
  }

  return (
    <section className="card pets-room">
      <div className="pets-head">
        <h2>Pets</h2>
        <p className="muted">
          Anything you have drawn can live here. It breathes and bobs straight away — and if you go
          back to the Paint room and <strong>name its layers</strong>, the names tell it how to
          move. A layer called <em>wing</em> flaps. One called <em>tail</em> wags.
        </p>
      </div>

      {note && (
        <p className="muted pets-note" role="status">
          {note}
        </p>
      )}

      {!mine.length ? (
        <p className="muted">
          {drawings.length
            ? 'No pets yet. Adopt one of your drawings below.'
            : 'Nothing to adopt yet — draw something in the Paint room and press Keep, then come back.'}
        </p>
      ) : (
        <>
          <div className="pets-strip">
            {mine.map((p) => (
              <button
                key={p.id}
                className={'pets-chip' + (chosen?.id === p.id ? ' is-on' : '')}
                aria-pressed={chosen?.id === p.id}
                onClick={() => setOpenId(p.id)}
                title={p.name}
              >
                {/* ⚠️ the pets in the strip are alive too, at rest. A row of still thumbnails
                    beside one moving pet reads as the others being broken. */}
                <PetView art={p.art} size={54} energy={still ? 0 : REST * 0.7} label={p.name} />
                <span className="pets-chip-name">{p.name}</span>
              </button>
            ))}
          </div>

          {chosen && (
            <div className="pets-stage">
              {/* ⚠️ A BUTTON, not a canvas with a click handler. Prodding the pet is the only
                  interaction in the room and it has to be reachable with a keyboard like
                  everything else here. */}
              <button
                className="pets-poke"
                onClick={prod}
                title={
                  still ? 'Motion is off in your system settings' : `Say hello to ${chosen.name}`
                }
              >
                <PetView
                  art={chosen.art}
                  size={220}
                  energy={still ? 0 : energy}
                  label={`${chosen.name}, waving about`}
                />
              </button>

              <div className="pets-facts">
                <strong>{chosen.name}</strong>
                {/* the rig, in the words of this person's own drawing — see the note at the top */}
                <ul className="pets-parts">
                  {known.map(([kind, n]) => (
                    <li key={kind}>
                      <span className="pets-part">{kind}</span>
                      <span className="muted">
                        {n > 1 ? ` ×${n} — ` : ' — '}
                        {PART_DOES[kind]}
                      </span>
                    </li>
                  ))}
                </ul>
                {unnamed > 0 && (
                  <span className="muted pets-hint">
                    {unnamed === parts.length
                      ? 'None of its layers are named, so all of it just breathes. Name one wing, head, leg, tail, ear, eye, arm or antenna in the Paint room and it will start doing that.'
                      : `${unnamed} unnamed layer${unnamed === 1 ? '' : 's'} — those parts just breathe.`}
                  </span>
                )}
                <div className="pets-acts">
                  {/**
                   * ⚠️ THE ONE CONTROL THAT PUTS SOMETHING ON EVERY OTHER PAGE, so it says exactly
                   * that rather than "follow me". It is off until pressed, per pet, and the ✕ on
                   * the corner pet itself is the way back out — see companion.ts.
                   */}
                  <button
                    className={'btn' + (following ? ' is-on' : '')}
                    aria-pressed={following}
                    onClick={() =>
                      setCompanion(following ? { on: false } : { on: true, name: chosen.name })
                    }
                    title={
                      following
                        ? `Stop ${chosen.name} appearing in the corner of every page`
                        : `${chosen.name} will sit in the corner of every page on the site until you put them away`
                    }
                  >
                    {following ? '◉ In the corner' : '◎ Keep me company'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      const to = window.prompt('Call it what?', chosen.name)?.trim()
                      if (to) renamePet(chosen.id, to)
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      if (
                        window.confirm(`Let ${chosen.name} go? The drawing stays in your gallery.`)
                      )
                        removePet(chosen.id)
                    }}
                  >
                    Let it go
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="pets-adopt">
        <button
          className={'btn' + (adopting ? ' is-on' : '')}
          aria-pressed={adopting}
          disabled={!drawings.length}
          onClick={() => setAdopting((v) => !v)}
          title={drawings.length ? 'Turn one of your drawings into a pet' : 'Draw something first'}
        >
          ✚ Adopt a drawing
        </button>
        {adopting && (
          <div className="fx-style-row">
            {drawings.map((a: Art) => (
              <button key={a.id} className="fx-style-btn" onClick={() => adopt(a)}>
                <span aria-hidden>🖼</span>
                <span className="fx-style-label">{a.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
