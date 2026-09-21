import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { CONFIG_LIMIT, configSize } from '../profile/blockSize'
import { PetView } from './PetView'
import { simplifyDrawing } from '../draw/strokes'
import { packPet, pets, readPet, subscribePets, type Pet } from './pets'

/**
 * How far a point may move when a pet is packed into a block, in the drawing's own 0–1 space.
 *
 * ⚠️ A THIRD OF A PIXEL AT THE SIZE A BLOCK DRAWS IT. Pets on a page are 120 to 180 across
 * (see the sizes below), so 0.0018 of the picture is well under one pixel of what a visitor
 * actually sees. The room samples a point every 0.002 while you draw at full canvas size, which is
 * where all the detail a block cannot afford comes from.
 */
const BLOCK_TOLERANCE = 0.0018

/** the copy that travels — see simplifyDrawing */
const packForBlock = (p: Pet) => packPet({ ...p, art: simplifyDrawing(p.art, BLOCK_TOLERANCE) })

/**
 * Somebody's pets, alive on their page.
 *
 * ⚠️ NOTHING IS HOSTED, which is the same property the art and song blocks have and the reason
 * all three were possible without a byte of storage: a pet is the strokes that made it, so the
 * visitor's own browser draws it. No image, no upload, no CDN, no third party told that somebody
 * looked at this page — and no video of a creature moving, because the movement is read out of
 * the layer names at forty frames a second in the visitor's tab (see rig.ts).
 *
 * ⚠️ SIZED BY HOW MANY THERE ARE, not by measuring the block. The art block measures its host and
 * recomputes a backing store, because a drawing is a picture and a picture wants the width it is
 * given. A pet is a character: it wants to be about the size of a character, and three of them
 * side by side at 120px reads as a little group, while one stretched to fill a full-width block
 * reads as a mistake. Two numbers and a wrap, instead of a ResizeObserver and a loop to get wrong.
 */

const REST = 0.5

export function PetBlock({ cfg }: { cfg: Record<string, unknown> }) {
  const kept = useMemo(() => {
    const raw = Array.isArray(cfg.pets) ? cfg.pets : []
    return raw.map(readPet).filter((p): p is { name: string; art: Pet['art'] } => !!p)
  }, [cfg.pets])

  /* ⚠️ Live, not read once — somebody's setting can change while the page is open, and a page
     with three moving things on it is the one to obey it fastest. Same as the art block. */
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

  const [awake, setAwake] = useState<number | null>(null)
  useEffect(() => {
    if (awake === null) return
    const t = window.setTimeout(() => setAwake(null), 2600)
    return () => window.clearTimeout(t)
  }, [awake])

  if (!kept.length) return null
  const size = kept.length === 1 ? 180 : kept.length === 2 ? 150 : 120

  return (
    <div className="card profile-block profile-pets">
      {kept.map((p, i) => (
        /* ⚠️ A button, so a visitor can say hello with a keyboard as well as a thumb. It is the
           only thing there is to do here and it should not need a mouse. */
        <button
          key={`${p.name}-${i}`}
          className="profile-pet"
          onClick={() => setAwake(i)}
          title={still ? p.name : `Say hello to ${p.name}`}
        >
          <PetView
            art={p.art}
            size={size}
            energy={still ? 0 : awake === i ? 1 : REST}
            label={p.name}
          />
          <span className="profile-pet-name muted">{p.name}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Which of your pets are on the page.
 *
 * ⚠️ IT SHOWS THE BUDGET, and for this block that is not a nicety. A pet is a whole drawing, and
 * a block's budget covers everything it holds — so two detailed creatures can still be the
 * difference between a page that saves and one the server refuses. The art picker learned this
 * first; a pet is bigger than a drawing by the length of its name and nothing else.
 */
export function PetPicker({
  value,
  onChange,
}: {
  value: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const mine = useSyncExternalStore(subscribePets, pets, pets)
  const chosen = Array.isArray(value.pets) ? value.pets : []
  const names = chosen.map((p) => readPet(p)?.name ?? '?')
  const used = configSize({ ...value, pets: chosen })

  /**
   * What each pet would ADD, measured the way the server measures it.
   *
   * ⚠️ MEMOISED, because packing a drawing is real work and this is asked once per pet on
   * every render of the picker — and the answer only changes when the pets in this browser do.
   */
  const costs = useMemo(
    () =>
      new Map(
        mine.map((p) => [p.id, configSize({ pets: [packForBlock(p)] }) - configSize({ pets: [] })]),
      ),
    [mine],
  )

  if (!mine.length && !chosen.length)
    return (
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        No minions yet. Adopt one of your drawings in the <strong>Minions</strong> room, then come
        back — or sign in, if you have made some on another machine.
      </p>
    )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {/* what the block HOLDS, which is not the same list as what this browser can offer */}
      {!mine.length && (
        <span className="muted" style={{ fontSize: '0.75rem' }}>
          {/* ⚠️ THIS USED TO SAY THERE WAS NOTHING TO BE DONE ABOUT IT, and that was not true:
              these are one of the kinds the library syncs (see library/cloud.ts, kind 'pet' — the
              stored word never changed, only the one on the heading), so a
              browser that has none gets them as soon as it is signed in. Saying a thing is
              permanent when it fixes itself in a moment sends somebody off to redraw one. */}
          {names.join(', ')} — added from another browser, and they show here fine. Your own minions
          arrive on this machine once you are signed in.
        </span>
      )}
      <div className="fx-style-row">
        {mine.map((p) => {
          const on = names.includes(p.name)
          const cost = costs.get(p.id) ?? 0
          /**
           * ⚠️ A PET THAT CANNOT BE SAVED CANNOT BE PICKED, which it could be until now. The
           * meter underneath measured this correctly and then said it after the fact — you chose a
           * detailed pet, it went in, and the NEXT save of the whole page was refused, because
           * save_my_profile_blocks rejects the entire payload rather than the block. So one pet
           * too big for a block stopped the profile saving at all until it was taken out again,
           * and the only clue was a message about a block holding too much.
           *
           * Reported exactly this way: one of the pets will not save to a block. Measured, a pet
           * of sixty hand-drawn strokes is over the 16000 a block gets; thirty is 45% of it.
           *
           * ⚠️ Never disabled while it is ON. Whatever is already in the block has to stay
           * removable, and disabling the way out of an over-full block is how you get stuck.
           */
          const wontFit = !on && used + cost > CONFIG_LIMIT
          return (
            <button
              key={p.id}
              className={'fx-style-btn' + (on ? ' is-on' : '')}
              aria-pressed={on}
              disabled={wontFit}
              title={
                wontFit
                  ? `${p.name} is too detailed for a profile block — it needs about ${Math.round(
                      ((used + cost) / CONFIG_LIMIT) * 100,
                    )}% of the room one has. A block holds the whole drawing, so a simpler pet fits.`
                  : on
                    ? `Take ${p.name} off the page`
                    : `Put ${p.name} on the page`
              }
              onClick={() =>
                onChange({
                  ...value,
                  pets: on
                    ? chosen.filter((c) => readPet(c)?.name !== p.name)
                    : [...chosen, packForBlock(p)],
                })
              }
            >
              <span aria-hidden>🐾</span>
              <span className="fx-style-label">{p.name}</span>
            </button>
          )
        })}
      </div>
      <span className="muted" style={{ fontSize: '0.75rem' }}>
        {chosen.length} chosen{' '}
        {used > CONFIG_LIMIT
          ? '— too much for one block, take one out'
          : `· ${Math.round((used / CONFIG_LIMIT) * 100)}% of the room a block has`}
      </span>
      {/* ⚠️ said once, under the list, rather than on each greyed-out one: a title is not
          readable on a phone, and this is the one thing somebody stuck here needs told. */}
      {mine.some(
        (p) => !names.includes(p.name) && used + (costs.get(p.id) ?? 0) > CONFIG_LIMIT,
      ) && (
        <span className="muted" style={{ fontSize: '0.75rem' }}>
          Greyed-out minions have too many strokes to fit in a block.
        </span>
      )}
    </div>
  )
}
