import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { gallery, subscribeGallery, type Art } from '../draw/gallery'
import { useOneShot } from './oneShot'
import { PetPlay } from './PetPlay'
import { PetView } from './PetView'
import { PART_DOES, PART_WORDS, STANCES, rigOf, type PartKind, type Mood } from './rig'
import { pets, removePet, renamePet, savePet, subscribePets, type Pet } from './pets'
import { companion, cornerSize, setCompanion, subscribeCompanion } from './companion'
import { PET_WIDTHS, petGif, petSeconds, petStill } from './petFile'
import { fileNameFor, save, sizeLabel } from '../draw/export'
import { packDrawing } from '../draw/strokes'
import { paintSession } from '../draw/session'
import { packPet } from './pets'

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

/* ⚠️ multiples of what the screen suggests, not pixel counts — see Companion.size */
const CORNER_SIZES: Array<[string, number]> = [
  ['Small', 0.7],
  ['Medium', 1],
  ['Big', 1.5],
]

const REST = 0.55
const PROD = 1
const CALM_AFTER_MS = 2600

export function PetsRoom({ onControlChange }: { onControlChange?: (on: boolean) => void } = {}) {
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

  const [stance, setStance] = useState<Mood['stance']>('idle')
  /**
   * Playing with it, rather than looking at it.
   *
   * ⚠️ A MODE AND NOT A SECOND ROOM, because it is the same pet doing the same five things
   * it already does — the difference is only whether the stance comes from a button or from your
   * hands. Asked for as "a mode or space or way to select them and control them like a 2d
   * platformer", and the selecting is the list that was already here.
   */
  const [playing, setPlaying] = useState(false)
  /* ⚠️ a thing it DOES rather than a thing it is — see useOneShot */
  const [pouncing, pounce] = useOneShot()

  /**
   * ⚠️ THE PAGE'S KEYBOARD SHORTCUTS STAND DOWN WHILE YOU PLAY, the same way they do for the
   * snake. The site navigates on single letters, so steering a pet meant any key the game does not
   * use took you to another room — measured: pressing `q` while playing left for Contact, with the
   * creature still walking. Reported by nobody, because it was found before anybody had to.
   */
  useEffect(() => {
    onControlChange?.(playing)
    return () => onControlChange?.(false)
  }, [playing, onControlChange])
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
  /**
   * ⚠️ IT SAYS THE WORD YOU TYPED, not the kind it matched. A layer called `wheel` matches the
   * spin kind, and reading "spin — spins" back at somebody who wrote "wheel" is the engine talking
   * about itself. An unnamed layer has no word of its own, so it falls back to the kind.
   */
  const known = useMemo(() => {
    const seen = new Map<PartKind, { n: number; word: string }>()
    for (const p of parts) {
      const had = seen.get(p.kind)
      seen.set(p.kind, {
        n: (had?.n ?? 0) + 1,
        word: had?.word ?? (p.name === 'unnamed' ? p.kind : p.name.toLowerCase().slice(0, 18)),
      })
    }
    return [...seen]
  }, [parts])
  const unnamed = parts.filter((p) => p.name === 'unnamed').length
  const following = follows.on && (follows.name === chosen?.name || !follows.name)

  /**
   * The drawing this pet was made from, if it has changed since.
   *
   * ⚠️ A PET HOLDS A COPY, and it has to — it syncs to the account and gets embedded in a
   * profile block, so a pointer at a gallery item would break both. The cost of that copy is that
   * fixing a pet used to mean: notice the rig read it wrong, go to Paint, open the drawing, rename
   * a layer, Keep over it, come back, let the pet go, adopt it again. Six steps to change one
   * word, on a feature whose entire premise is "name a layer and see what happens".
   *
   * ⚠️ OFFERED ONLY WHEN THERE IS SOMETHING TO TAKE, compared on the packed bytes rather than
   * on a timestamp. A button that is always there is one you have to press to find out whether it
   * would do anything.
   */
  const fresher = useMemo(() => {
    if (!chosen) return null
    const src = drawings.find((a) => a.name.toLowerCase() === chosen.name.toLowerCase())
    if (!src) return null
    const same = JSON.stringify(packDrawing(src.art)) === JSON.stringify(packPet(chosen).a)
    return same ? null : src
  }, [chosen, drawings])

  const [width, setWidth] = useState<number>(PET_WIDTHS[1][1])
  const [busy, setBusy] = useState<string | null>(null)
  const grab = async (kind: 'still' | 'moving') => {
    if (!chosen) return
    setBusy(kind === 'still' ? 'Drawing…' : 'Frame 1…')
    try {
      const blob =
        kind === 'still'
          ? await petStill(chosen, width)
          : await petGif(chosen, width, (a, b) => setBusy(`Frame ${a} of ${b}…`))
      if (!blob) return
      const name = fileNameFor(
        { ...chosen.art, name: chosen.name },
        kind === 'still' ? 'png' : 'gif',
      )
      save(blob, name)
      say(`Saved ${name} · ${sizeLabel(blob.size)}`)
    } finally {
      setBusy(null)
    }
  }

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
        <h2>Minions</h2>
        <p className="muted">
          A minion is a drawing that moves. Draw each part of a creature on its own layer, tell the
          layer what that part is, and it starts doing what that part does.
        </p>
        {/**
         * ⚠️ THE INSTRUCTIONS WERE ONE SENTENCE AND NOBODY COULD ACT ON THEM. "Name its layers"
         * assumes you already know the creature is meant to be drawn in PIECES, one per layer —
         * which is the entire technique, and was the one thing never said. Reported exactly that
         * way: "not clear and confusing to even know what to go and draw or what i can do."
         *
         * ⚠️ OPEN UNTIL YOU HAVE ONE, then folded away. Somebody with no minions is reading this
         * page to find out how; somebody with three has read it.
         */}
        <details className="pets-how" open={!mine.length}>
          <summary>How to make one</summary>
          <ol>
            <li>
              Go to <strong>🎨 Paint</strong> and draw the <em>body</em> of a creature.
            </li>
            <li>
              Press <strong>+ layer</strong>, then draw one part on it — a wing, a leg, a tail.
            </li>
            <li>
              Press <strong>✎</strong> on that layer and name it after the part:{' '}
              {PART_WORDS.map((w, i) => (
                <span key={w}>
                  {i ? ', ' : ''}
                  <code>{w}</code>
                </span>
              ))}
              .
            </li>
            <li>Repeat 2 and 3 for every part that should move on its own.</li>
            <li>
              Press <strong>⬇ Keep</strong> to save the drawing.
            </li>
            <li>
              Come back here and press <strong>✚ Adopt a drawing</strong>.
            </li>
          </ol>
          <p className="muted">
            Each named part then moves by itself — a <code>wing</code> flaps, a <code>tail</code>{' '}
            wags, <code>legs</code> take turns. Anything you leave unnamed just breathes along with
            the body, which is why a drawing with one layer still makes a minion: it simply
            breathes.
          </p>
          {/*
            ⚠️ EVERY OTHER NAME IN THAT LIST EXPLAINS ITSELF AND THIS ONE DOES NOT. A wing flaps
            and a tail wags; `hit` is not a part of the creature at all, it is the weapon, and it
            was sitting in the middle of the list with nothing to say what it was for. Watched a
            drawing get made from these instructions and the one thing it could not tell you was
            the only thing on the page you cannot guess.

            ⚠️ AND WHERE YOU DRAW IT IS THE WHOLE POINT, so the sentence has to say so. The reach
            and the damage are read straight off the ink — how far it gets from the middle of the
            body, and how much of it there is — which is a real mechanic nobody can use without
            being told it exists. Measured on a drawing made this way: a creature with a hit layer
            hits for 11–25 against 5–10 for the same creature without one.
          */}
          <p className="muted">
            One of those is not a part of the creature. A layer called <code>hit</code> is the{' '}
            <em>attack</em> — draw it out to one side, clear of the body, because how far the ink
            reaches is how far the attack reaches and how much of it there is is how hard it lands.
            It stays invisible until your creature swings it, in the park and the fighting ring.
          </p>
          <p className="muted">
            It does not matter how big you drew it or where on the page — a minion is cropped to the
            creature. And if you would rather animate it yourself, a drawing made with{' '}
            <strong>🎬 Frames</strong> plays its frames instead of being moved for you.
          </p>
        </details>
      </div>

      {note && (
        <p className="muted pets-note" role="status">
          {note}
        </p>
      )}

      {!mine.length ? (
        <p className="muted">
          {drawings.length
            ? 'No minions yet. Adopt one of your drawings below.'
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
              {playing ? (
                /* ⚠️ IN PLACE OF THE POKE-ABLE PET, not beside it. Two of the same creature on
                   one screen, one of them answering the keyboard and one of them not, is a
                   question about which one is real — and the field is the same pet, so nothing is
                   lost by swapping. */
                <PetPlay
                  pets={mine.map((p) => ({ name: p.name, art: p.art }))}
                  startAt={Math.max(
                    0,
                    mine.findIndex((p) => p.id === chosen.id),
                  )}
                />
              ) : (
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
                    stance={pouncing ? 'pounce' : stance}
                    watch="hover"
                    label={`${chosen.name}, waving about`}
                  />
                </button>
              )}

              <div className="pets-facts">
                <strong>{chosen.name}</strong>
                {/* ⚠️ first, because once you know it can be played with, the five buttons
                    underneath read as what they are — a way to look at one pose on purpose */}
                <div className="pets-stances">
                  <button
                    className={'btn' + (playing ? ' is-on' : '')}
                    aria-pressed={playing}
                    onClick={() => setPlaying((v) => !v)}
                    title={
                      playing
                        ? `Stop playing and look at ${chosen.name}`
                        : `Walk ${chosen.name} about with the arrow keys`
                    }
                  >
                    {playing ? '■ Stop' : '🎮 Play'}
                  </button>
                </div>
                {/**
                 * ⚠️ NONE OF THESE NEEDED A SECOND DRAWING. Running is the same legs faster and
                 * further with the body leaning into it; sleeping is everything slowed almost to
                 * nothing with the eyes shut. The rig already knows which layer is a leg, so the
                 * creature somebody drew once can do all five — see TUNE in rig.ts.
                 */}
                <div className="pets-stances">
                  {/* ⚠️ apart from the five, because it is not one of them: those are poses to
                      leave a creature in, and this one gives the creature back after a moment */}
                  <button
                    className={'btn' + (pouncing ? ' is-on' : '')}
                    onClick={pounce}
                    title={`Make ${chosen.name} pounce`}
                  >
                    ⚡ Pounce
                  </button>
                  {STANCES.map(([id, label]) => (
                    <button
                      key={id}
                      className={'btn btn-ghost' + (stance === id ? ' is-on' : '')}
                      aria-pressed={stance === id}
                      onClick={() => setStance(id)}
                      title={`Show ${chosen.name} ${label.toLowerCase()}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="muted pets-hint">
                  {playing
                    ? 'It runs, crouches and braces on the way down using the layer names you gave it.'
                    : 'It follows your pointer with its head and eyes while you are over it.'}
                </span>
                {/* the rig, in the words of this person's own drawing — see the note at the top */}
                <ul className="pets-parts">
                  {known.map(([kind, { n, word }]) => (
                    <li key={kind}>
                      <span className="pets-part">{word}</span>
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
                      ? `Every layer is unnamed, so the whole thing just breathes. In the Paint room, press ✎ on a layer and call it one of: ${PART_WORDS.join(', ')}.`
                      : `${unnamed} unnamed layer${unnamed === 1 ? '' : 's'} — those parts just breathe.`}
                  </span>
                )}
                {fresher && (
                  <button
                    className="btn"
                    onClick={() => {
                      const made = savePet(chosen.name, fresher.art)
                      if (made) {
                        setOpenId(made.id)
                        say(`${made.name} caught up with your drawing.`)
                      }
                    }}
                    title={`Your drawing “${fresher.name}” has changed — take the new version`}
                  >
                    ↻ Update from the drawing
                  </button>
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
                  {/* ⚠️ Only once one is actually in the corner. How big the corner pet should be
                      is not a question worth asking somebody who has not got one. */}
                  {following && <span className="muted pets-size-for">size</span>}
                  {following &&
                    CORNER_SIZES.map(([label, mult]) => (
                      <button
                        key={label}
                        className={'btn btn-ghost' + (follows.size === mult ? ' is-on' : '')}
                        aria-pressed={follows.size === mult}
                        onClick={() => setCompanion({ size: mult })}
                        title={`${label} — about ${Math.round(cornerSize(Math.min(window.innerWidth, window.innerHeight)) * mult)} pixels on this screen`}
                      >
                        {label}
                      </button>
                    ))}
                  {/**
                   * ⚠️ A WAY BACK TO THE PENCIL. Adding a part to a creature you already keep meant
                   * Paint, Gallery, Open — and only if the original drawing was still in the
                   * gallery, which for anything made a while ago it was not. A minion carries its
                   * own drawing, so the whole of "edit this one" is handing that drawing to the
                   * room that edits drawings. Asked for twice.
                   *
                   * ⚠️ IT DOES NOT TOUCH THE MINION. What opens is the picture; keeping it again
                   * is a new minion until you overwrite it, which is the same bargain the gallery
                   * has always had. Said on the button rather than assumed.
                   */}
                  <button
                    className="btn btn-ghost"
                    title={`Open ${chosen.name}'s drawing in Paint`}
                    onClick={() => {
                      paintSession.keep({
                        strokes: chosen.art.strokes,
                        bg: chosen.art.bg,
                        hidden: [],
                        layerNames: chosen.art.layers ?? [],
                        /* its own proportions, or Paint re-shapes it to whatever this window is */
                        ratio: chosen.art.ratio,
                        /* and its own name, or keeping it again makes a second creature */
                        name: chosen.name,
                        /* and its own rate, or an animated one comes back at the default */
                        fps: chosen.art.fps,
                      })
                      window.location.hash = '#paint'
                    }}
                  >
                    ✎ Edit the drawing
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
                {/* ⚠️ ITS OWN LINE. With the size chips inline the row was eight buttons — three
                    things you can do to a minion and five that are about making a file — all the same
                    weight, wrapping to four lines on a phone. Two kinds of thing, two rows. */}
                <div className="pets-files">
                  <button
                    className="btn btn-ghost"
                    disabled={!!busy}
                    onClick={() => void grab('still')}
                  >
                    {busy && busy.startsWith('Drawing') ? busy : '⤓ Picture'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={!!busy}
                    onClick={() => void grab('moving')}
                  >
                    {busy && busy.startsWith('Frame') ? busy : `⤓ Moving · ${petSeconds}s`}
                  </button>
                  {/* ⚠️ one size for both, because the two files are the same creature and nobody
                      wants to answer the same question twice a press apart */}
                  {/**
                   * ⚠️ THE PIXELS ARE IN THE LABEL, and that is not decoration. This row and the
                   * corner-size row both said Small / Medium / Big, a few lines apart on one
                   * screen, meaning two completely different things — reported as "there are two
                   * sets of buttons and only the new ones work". Three identical words twice is
                   * the bug; saying what these ones are makes them a different control at a
                   * glance, and matches how the paint room's own download panel reads.
                   */}
                  {PET_WIDTHS.map(([label, w]) => (
                    <button
                      key={w}
                      className={'btn btn-ghost' + (width === w ? ' is-on' : '')}
                      aria-pressed={width === w}
                      onClick={() => setWidth(w)}
                      title={`${label} — ${w} pixels across`}
                    >
                      {label} · {w}px
                    </button>
                  ))}
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
          title={
            drawings.length ? 'Turn one of your drawings into a minion' : 'Draw something first'
          }
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
