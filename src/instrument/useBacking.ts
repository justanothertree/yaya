import { useEffect, useRef, useState } from 'react'
import {
  CHORD_PATTERNS,
  basslineEvents,
  progressionEvents,
  revoice,
  type BassStyle,
  type ChordPattern,
  type ChordStyle,
  type Voicing,
} from '../audio/chordPatterns'
import { DRUM_PATTERNS, patternEvents } from '../audio/drumPatterns'
import {
  addPatternLayer,
  bassPatternOf,
  beatPatternOf,
  chordPatternOf,
  loopLength,
  loopState,
  setBpm,
  setLayerEvents,
  setLayerInstrument,
  startLoop,
} from '../audio/looper'
import { MAJOR_DEGREES } from '../audio/scales'
import { starterNow, styleBassVoice, type Starter } from '../audio/starters'
import type { InstrumentId } from '../audio/synth'
import {
  CHORD_SOUND,
  LEAD_KEY,
  VOICED_SCALES,
  ownParts,
  styleOfBass,
  styleOfChord,
  voicingOf,
} from './backing'

/**
 * The backing: the picks the Beats & chords panel remembers, and the calls that lay a beat, a
 * progression and a bassline — moved out of InstrumentRoom.tsx unchanged on 11 Nov 2026.
 *
 * ⚠️ `loop` IS THE ROOM'S RENDER SNAPSHOT, passed in rather than read here, because layChords
 * decides whether to re-lay the bass from `loop.layers` as the room rendered them — exactly
 * what it did inline. Everything that must be current at the moment of a press already reads
 * `loopState()`, as it always has.
 */
export function useBacking({
  scale,
  root,
  degrees,
  loop,
}: {
  scale: string
  root: number
  degrees: readonly number[]
  loop: ReturnType<typeof loopState>
}) {
  /* a style chosen before there is a backing to play it — see chordStyleNow */
  const [chordStylePick, setChordStylePick] = useState<ChordStyle>('pad')
  const [bassStylePick, setBassStylePick] = useState<BassStyle>('rootfifth')
  /* the voice the next bassline is laid on — see the Bass row's Sound picker */
  const [bassSoundPick, setBassSoundPick] = useState<InstrumentId>('bass')
  /* the genre the Beat row is browsing, and which beat was loaded when it was picked — genreShown */
  const [beatGenrePick, setBeatGenrePick] = useState<{
    forBeat: string | null
    genre: string
  } | null>(null)
  /**
   * Whether a dropped progression ends with the chord that leans back to the top.
   *
   * ⚠️ OFF BY DEFAULT, and that is a decision rather than caution. A turnaround is a strong
   * flavour: it is what makes four chords sound like a song rather than a loop, and it is also
   * the thing somebody writing a calm two-chord bed does not want pulling at them every lap. The
   * progressions are what they say on the tin until you ask for more.
   *
   * Remembered like every other playing setting here, so asking once is asking for good.
   */
  const [leadBack, setLeadBack] = useState(() => {
    try {
      return localStorage.getItem(LEAD_KEY) === '1'
    } catch {
      return false
    }
  })
  /* remembered on its own now that it lives here; the room still remembers the rest together */
  useEffect(() => {
    try {
      localStorage.setItem(LEAD_KEY, leadBack ? '1' : '0')
    } catch {
      /* private mode — it still plays */
    }
  }, [leadBack])

  /**
   * The style the backing is in: the loaded layer's when there is one — what you are hearing —
   * and otherwise the one last chosen, so a style can be picked before the chords are.
   */
  const chordStyleNow = (): ChordStyle => {
    const l = loopState().layers.find((x) => chordPatternOf(x) !== null)
    return l ? styleOfChord(l) : chordStylePick
  }
  const bassStyleNow = (): BassStyle => {
    const l = loopState().layers.find((x) => bassPatternOf(x) !== null)
    return l ? styleOfBass(l) : bassStylePick
  }

  /**
   * Lay down the bassline for a progression, replacing whatever bass is there.
   *
   * ⚠️ ONE BUILDER, BECAUSE TWO THINGS NEED TO DO THIS AND THEY MUST DO IT IDENTICALLY. The
   * Bass button calls it, and so does the chord picker when it swaps a progression out from
   * under an existing bass. A second copy of these five arguments is exactly the shape
   * `triadAt` exists to prevent, one level up: the pad and the bass agreeing about a chord is
   * worth nothing if the room can hand them different progressions.
   */
  const layBass = (p: ChordPattern, lead = leadBack, style: BassStyle = bassStyleNow()) => {
    const { events, len } = basslineEvents(
      p,
      loopLength(),
      scale === 'chromatic' ? MAJOR_DEGREES : degrees,
      scale === 'chromatic' ? 0 : root,
      lead,
      style,
      60 / loopState().bpm,
    )
    /* the original style keeps the original tag, so a song saved before styles reads the same */
    const tag = style === 'rootfifth' ? p.id : `${p.id}-${style}`
    /* a swap keeps the row's own sound; a new row is laid on the voice picked in the Bass row */
    return addPatternLayer(events, len, tag, {
      mark: '-bass:',
      instrument: bassSoundPick,
      gain: 0.5,
    })
  }

  /**
   * Lay down a progression, with or without the chord that leans back to the top.
   *
   * ⚠️ IT LAYS THE BASS TOO, AND THAT USED TO BE THE CALLER'S JOB. Swapping a progression
   * replaces the layer marked `-chords:` and leaves `-bass:` where it was, so with both loaded
   * the pad moved and the bass kept playing the old one — measured in the piano roll as
   * `C2 G1 G2 D2 A2 E2 F2 C2` before and byte for byte the same after, under chords that had
   * become Am–F–C–G. A bass on one progression under a pad on another is the single most
   * audible wrong thing a backing can do.
   *
   * It was fixed at the call site first, which worked and was one call site away from breaking
   * again: the turnaround added a SECOND setting the two halves could disagree about, and a
   * lead-back on the pad but not under it changes chord half a bar apart. Both now come from
   * here, so there is no version of this a caller can get half right.
   */
  const layChords = (p: ChordPattern, lead = leadBack, style: ChordStyle = chordStyleNow()) => {
    const { events, len } = progressionEvents(
      p,
      loopLength(),
      scale === 'chromatic' ? MAJOR_DEGREES : degrees,
      scale === 'chromatic' ? 0 : root,
      lead,
      style,
      60 / loopState().bpm,
    )
    const was = loopState().layers.find((l) => chordPatternOf(l) !== null) ?? null
    const id = addPatternLayer(events, len, style === 'pad' ? p.id : `${p.id}-${style}`, {
      mark: '-chords:',
      instrument: CHORD_SOUND[style],
      gain: 0.42,
    })
    /**
     * ⚠️ A STAB ON A PAD SOUND IS BARELY THERE — the pad swells in, and a note a quarter of a beat
     * long ends before it has. So a change of style brings the style's own sound with it, but
     * ONLY if the layer still has the sound the old style gave it: somebody who put their chords
     * on a harp chose that, and a style button is not theirs to overrule it.
     */
    if (id && was && was.instrument === CHORD_SOUND[styleOfChord(was)])
      setLayerInstrument(id, CHORD_SOUND[style])
    if (id && loop.layers.some((l) => bassPatternOf(l) !== null)) layBass(p, lead)
    return id
  }

  /**
   * A whole backing from one press — see starters.ts.
   *
   * ⚠️ THE SAME CALLS THE PANEL'S OWN BUTTONS MAKE, in the order a person would press them: the
   * beat, then the chords in their style, then the bass under them. Each swaps its own row, so a
   * second starter replaces the first rather than stacking a second backing on it, and every row
   * afterwards shows exactly what was picked.
   *
   * ⚠️ IT SETS THE TEMPO ONLY ON A SONG WITH NOTHING OF YOURS IN IT. A change of tempo rescales
   * every layer, and a part you played is not a starter's to speed up — so with one of those in
   * the song the beat, chords and bass arrive at the tempo you already have.
   */
  const applyStarter = (s: Starter) => {
    const p = CHORD_PATTERNS.find((x) => x.id === s.chords)
    const d = DRUM_PATTERNS.find((x) => x.id === s.beat)
    if (!p || !d) return
    /* what the bass is on and which style the backing is, BEFORE this press — see styleBassVoice */
    const before = loopState().layers
    const bassWas = before.find((l) => bassPatternOf(l) !== null) ?? null
    const chordWas = before.find((l) => chordPatternOf(l) !== null) ?? null
    const prev = starterNow({
      beat: before.map((l) => beatPatternOf(l)).find((x) => x) ?? null,
      chords: chordWas ? chordPatternOf(chordWas) : null,
      chordStyle: chordWas ? styleOfChord(chordWas) : null,
      bass: bassWas ? styleOfBass(bassWas) : null,
    })
    if (!ownParts(loopState().layers)) setBpm(s.bpm)
    const beat = patternEvents(d, loopState().bpm)
    if (!addPatternLayer(beat.events, beat.len, d.id)) return
    setChordStylePick(s.chordStyle)
    setBassStylePick(s.bass)
    if (!layChords(p, leadBack, s.chordStyle)) return
    const bassId = layBass(p, leadBack, s.bass)
    const voice = styleBassVoice(bassWas?.instrument ?? null, prev, s)
    if (bassId && voice) {
      setLayerInstrument(bassId, voice)
      setBassSoundPick(voice)
    }
    if (!loopState().playing) startLoop()
  }

  /**
   * ⚠️ THE BACKING FOLLOWS THE KEY — Evan's call, 9 Nov 2026. A change of Scale or Key re-lays
   * the chords and the bass in the new key, at their own length and in their own style, keeping
   * their sound, level, mute and arrangement; an edited one moves by the same interval, and on a
   * change of scale keeps its old scale, which its row then says. The rules are `revoice`'s, in
   * chordPatterns.ts.
   *
   * ⚠️ AN EFFECT ON THE VOICING, NOT A CALL IN EACH PICKER, because three things change it — the
   * Scale picker, the Key picker and a rig — and the one that forgot would leave a backing in the
   * old key under a keyboard in the new one, which is the clash this exists to end. Chromatic
   * moving its hidden root changes no voicing and so re-lays nothing.
   *
   * ⚠️ NOT ON MOUNT AND NOT ON A LOAD. The ref starts at the voicing the room opened in, and
   * opening a song changes no Scale or Key, so nothing anybody kept is rewritten by being opened.
   */
  const voiced = useRef<Voicing>(voicingOf(scale, root))
  useEffect(() => {
    const from = voiced.current
    const to = voicingOf(scale, root)
    voiced.current = to
    if (from.root === to.root && from.degrees.join() === to.degrees.join()) return
    const s = loopState()
    const beat = 60 / s.bpm
    for (const l of s.layers) {
      const chords = chordPatternOf(l)
      const p = CHORD_PATTERNS.find((x) => x.id === (chords ?? bassPatternOf(l)))
      if (!p) continue
      const lay = (d: readonly number[], r: number, lead: boolean) =>
        chords !== null
          ? progressionEvents(p, l.len, d, r, lead, styleOfChord(l), beat).events
          : basslineEvents(p, l.len, d, r, lead, styleOfBass(l), beat).events
      const next = revoice(l.events, lay, from, to, VOICED_SCALES)
      /* an edited backing under a change of scale alone moves by nothing — leave it sounding */
      if (JSON.stringify(next) !== JSON.stringify(l.events)) setLayerEvents(l.id, next)
    }
  }, [scale, root])

  return {
    chordStylePick,
    setChordStylePick,
    bassStylePick,
    setBassStylePick,
    bassSoundPick,
    setBassSoundPick,
    beatGenrePick,
    setBeatGenrePick,
    leadBack,
    setLeadBack,
    layBass,
    layChords,
    applyStarter,
  }
}
