import { INSTRUMENTS, type InstrumentId, type Knob } from '../audio/synth'
import { type ChordId } from '../audio/chords'
import { STRUMS, type StrumId } from '../audio/strum'
import { ARPS, type ArpId } from '../audio/arp'
import { SCALES } from '../audio/scales'
import { applyFx, captureFx, makeInstKits, type InstKit } from '../audio/instKit'
import { KitBar } from '../ui/KitBar'
import { FAMILIES, familyVoices } from '../audio/families'
import { fxWord } from './fxWord'
import { KnobRow } from './rowParts'
import type { Dispatch, SetStateAction } from 'react'

/** The five things you can bend about the sound, as sliders rather than a patch editor. */
const KNOBS: Array<[Knob, string, string]> = [
  ['echo', 'Echo', 'How much of the note comes back'],
  ['echoTime', 'Echo time', 'How long before it does'],
  ['space', 'Space', 'The size of the room it is played in'],
  ['vibrato', 'Vibrato', 'A wobble in the pitch, like a singer'],
  /* the only one that is about PLAYING rather than about the sound, and it applies to all of
     them — see Fx.glide for why it lives with the effects rather than with the instruments */
  ['glide', 'Glide', 'Each note slides from the one before it'],
  /* ⚠️ THE ONE WHOSE MIDDLE IS "OFF". The other five add something and read 0 when they are
     doing nothing; this one shapes what is already there, so the preset as written sits at the
     halfway mark and the slider has somewhere to go both ways. The hint says so, because a
     slider resting at 50 with no explanation looks like a setting somebody left on. */
  ['tone', 'Tone', 'Darker to the left, brighter to the right — the middle is the sound as it is'],
]

/**
 * The saved rigs, built with the room's OWN scale list.
 *
 * ⚠️ passed in rather than duplicated inside the audio module. A second copy of SCALES is
 * a copy that goes stale the first time one is added, and a kit naming a scale the check has not
 * heard of quietly becomes Chromatic with nothing said.
 */
const instKits = makeInstKits(SCALES.map(([id]) => id))

/* every voice the picker offers, for asking families.ts which of a family's members exist here */
const INSTRUMENT_IDS = INSTRUMENTS.map(([id]) => id)

/** Where the instrument menu behaves like a phone's: closes after a pick, starts closed. */
export const PHONE_MENU = '(max-width: 40rem)'

/** The room's sound settings, as the room holds them — this panel reads and changes them. */
export type SoundSettings = {
  inst: InstrumentId
  setInst: Dispatch<SetStateAction<InstrumentId>>
  octave: number
  setOctave: Dispatch<SetStateAction<number>>
  scale: string
  setScale: Dispatch<SetStateAction<string>>
  root: number
  setRoot: Dispatch<SetStateAction<number>>
  chord: ChordId
  setChord: Dispatch<SetStateAction<ChordId>>
  strum: StrumId
  setStrum: Dispatch<SetStateAction<StrumId>>
  arp: ArpId
  setArp: Dispatch<SetStateAction<ArpId>>
  swing: boolean
  setSwing: Dispatch<SetStateAction<boolean>>
  moreSound: boolean
  picksOpen: boolean
  setPicksOpen: Dispatch<SetStateAction<boolean>>
  famShown: string
  setFamShown: (fam: string) => void
  hush: (mode?: 'live' | 'all') => void
}

/**
 * The instrument menu (one family at a time) and ⚙ More sound (arpeggio, strum, swing, the effect
 * sliders and the saved rigs) — moved out of InstrumentRoom.tsx unchanged on 11 Nov 2026.
 *
 * ⚠️ THE SETTINGS STAY IN THE ROOM. The keyboard plays with every one of them, and the room
 * remembers them across visits, so this panel is handed them rather than owning them.
 */
export function SoundPanel({ sound }: { sound: SoundSettings }) {
  const {
    inst,
    setInst,
    octave,
    setOctave,
    scale,
    setScale,
    root,
    setRoot,
    chord,
    setChord,
    strum,
    setStrum,
    arp,
    setArp,
    swing,
    setSwing,
    moreSound,
    picksOpen,
    setPicksOpen,
    famShown,
    setFamShown,
    hush,
  } = sound
  return (
    <>
      <div className="inst-bar">
        {/**
         * ⚠️ ONE FAMILY AT A TIME — Evan, 10 Nov 2026: "group related controls". The flat grid was
         * every voice at once, four or five rows, and with the menu open on a desktop (his call)
         * that put ▶ Play below the fold. A family is one row; the family the current sound
         * belongs to is the one shown, so opening the menu still lands on what you are playing.
         * See families.ts.
         */}
        {picksOpen && (
          <div className="inst-families" role="group" aria-label="Kinds of instrument">
            {FAMILIES.filter((f) => familyVoices(f.id, INSTRUMENT_IDS).length).map((f) => (
              <button
                key={f.id}
                className={'btn' + (famShown === f.id ? ' is-on' : ' btn-ghost')}
                aria-pressed={famShown === f.id}
                onClick={() => setFamShown(f.id)}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
        <div className={'fx-style-row inst-picks' + (picksOpen ? ' is-open' : '')}>
          {familyVoices(famShown, INSTRUMENT_IDS).map((id) => {
            const [, icon, name] = INSTRUMENTS.find(([x]) => x === id)!
            return (
              <button
                key={id}
                className={'fx-style-btn' + (inst === id ? ' is-on' : '')}
                aria-pressed={inst === id}
                onClick={() => {
                  // ⚠️ stopLive, not allNotesOff: your held keys must let go of the old sound, but
                  // a loop playing underneath is not yours to interrupt
                  hush()
                  setInst(id)
                  /* closes on a phone, where it covers the page; stays open on a desktop, where
                   trying three sounds in a row is the point of opening it */
                  if (window.matchMedia(PHONE_MENU).matches) setPicksOpen(false)
                }}
              >
                <span aria-hidden>{icon}</span>
                <span className="fx-style-label">{name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {moreSound && (
        <div className="inst-more card">
          <div className="inst-row">
            {/**
             * One key, a part.
             *
             * ⚠️ THIS ONE DOES `hush()`, UNLIKE Chord and Arrives, and the asymmetry is the point.
             * Those two change what the NEXT press will do and leave what is sounding alone, which
             * the book makes safe. This changes who is playing: switching it on mid-hold would
             * leave the sustained chord ringing underneath the arpeggio it just started, and
             * switching it off would strand the runner's last note. Dropping what you are holding
             * is the honest answer, and it is the same one the Scale picker gives.
             */}
            {/**
             * ⚠️ ALWAYS SHOWN, AND IT USED TO BE GATED ON `chord !== 'off'`. That hid the control
             * without stopping the thing it controls, which is the worst of both: the setting is
             * remembered across visits, so anybody who tried an arpeggio once and then put Chord
             * back to One note came back to a keyboard where HOLDING A KEY REPEATS IT FOR EVER and
             * nothing on screen said why or offered a way out. Measured before the fix — one key
             * held for 1.5s gave six notes, all C4, 313ms apart, with the picker not rendered.
             *
             * Showing it is the right fix rather than suppressing the arp without a chord, because
             * arpeggiating notes you are holding YOURSELF is the normal use of one: hold C and E
             * and it alternates them. A single held key repeating is what every arpeggiator does;
             * it is only alarming when you cannot see that one is switched on.
             *
             * `Arrives` stays hidden without a chord, and that is not the same call — a roll across
             * one note genuinely does nothing, so it is a control with no effect rather than an
             * effect with no control.
             */}
            <label className="inst-pick">
              <span className="muted">Arpeggio</span>
              <select
                value={arp}
                onChange={(e) => {
                  hush()
                  setArp(e.target.value as ArpId)
                  e.target.blur()
                }}
              >
                {ARPS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {/**
             * How the chord arrives: together, or one note at a time like a hand does it.
             *
             * ⚠️ ONLY ONCE A CHORD IS CHOSEN, the same rule the Key picker follows on Chromatic. A
             * single note cannot be rolled, so on an untouched room this would be a control that
             * visibly does nothing — and the row already carries three.
             *
             * ⚠️ AND NO `hush()`: like the Chord picker, it can be changed under your fingers,
             * because the book releases what was actually sounded rather than recomputing it.
             */}
            {/**
             * ⚠️ HIDDEN WHEN THERE IS NO ARPEGGIO, AND THAT IS NOT THE TRAP THE ARPEGGIO PICKER
             * WAS. Swing displaces arpeggio STEPS and nothing else — with no figure running there
             * is nothing for it to move, so this is a control with no effect rather than an effect
             * with no control. The arp picker was the other way round, which is why it is always
             * shown now.
             */}
            {arp !== 'off' && (
              <label className="inst-pick">
                <span className="muted">Feel</span>
                <select
                  value={swing ? 'swing' : 'straight'}
                  onChange={(e) => {
                    setSwing(e.target.value === 'swing')
                    e.target.blur()
                  }}
                >
                  <option value="straight">Straight</option>
                  <option value="swing">Swing</option>
                </select>
              </label>
            )}

            {chord !== 'off' && arp === 'off' && (
              <label className="inst-pick">
                <span className="muted">Arrives</span>
                <select
                  value={strum}
                  onChange={(e) => {
                    setStrum(e.target.value as StrumId)
                    e.target.blur()
                  }}
                >
                  {STRUMS.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="inst-row inst-knobs">
            {KNOBS.map(([k, label, hint]) => (
              <KnobRow key={k} k={k} label={label} hint={hint} />
            ))}
          </div>
          {/* ⚠️ NINE SETTINGS, of which the four that were already remembered are the four
              that matter least. The effects decide what an instrument SOUNDS like far more than the
              octave does, and they were the ones thrown away on every visit. A rig keeps all nine,
              so "keys, dry" and "keys, drenched in echo" become two things you can switch between
              rather than one thing you rebuild. */}
          <KitBar
            store={instKits}
            placeholder="Name this rig"
            capture={(name) => ({
              name,
              inst,
              octave,
              scale,
              root,
              fx: captureFx(),
              /* ⚠️ HOW IT IS PLAYED, NOT ONLY WHAT IT SOUNDS LIKE. A rig that remembered the
                 reverb and forgot the arpeggio did not reproduce the thing you kept. */
              chord,
              strum,
              arp,
              swing,
            })}
            apply={(k: InstKit) => {
              hush()
              setInst(k.inst)
              setOctave(k.octave)
              setScale(k.scale)
              setRoot(k.root)
              applyFx(k.fx)
              setChord(k.chord)
              setStrum(k.strum)
              setArp(k.arp)
              setSwing(k.swing)
            }}
            /**
             * ⚠️ THREE SEGMENTS, AND I BRIEFLY MADE IT FIVE. Adding the chord and the arpeggio
             * here looked free — the rig had just learned to save them — and it overflowed the
             * chip: `.kitbar-desc` is 158px wide and the text became 266px, so the audit found a
             * clipped element and what a phone actually showed was "Rhodes · Harmonic minor ·
             * Seve…". The two things I had added were the exact part that never appeared.
             *
             * The clamp is not the problem and must not be lifted: its own comment says a long
             * name would otherwise make one chip twice the height of its neighbours and break
             * the row. At 0.68rem in 158px there is room for about twenty-six characters, which
             * three segments already spend.
             *
             * So the rig still SAVES the chord and the arpeggio — that was the fix — and the
             * place to tell two rigs apart is the name on the line above, which the person wrote
             * themselves and which is as long as they want it.
             */
            describe={(k) =>
              [
                INSTRUMENTS.find(([id]) => id === k.inst)?.[2] ?? k.inst,
                SCALES.find(([id]) => id === k.scale)?.[1] ?? k.scale,
                fxWord(k.fx),
              ].join(' · ')
            }
          />
        </div>
      )}
    </>
  )
}
