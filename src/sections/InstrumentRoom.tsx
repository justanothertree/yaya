import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  INSTRUMENTS,
  allNotesOff,
  stopLive,
  closeSynth,
  noteOff,
  noteOn,
  type InstrumentId,
  type Knob,
  drumName,
} from '../audio/synth'
import { CHORDS, chordNotes, usesScale, type ChordId } from '../audio/chords'
import { STRUMS, strumDelays, type StrumId } from '../audio/strum'
import { ARPS, arpRunner, type ArpId, type ArpRunner } from '../audio/arp'
import { keyName, keySpeller, nameChord, noteLabel } from '../audio/chordName'
import { pedalBook, type PedalBook } from '../audio/pedal'
import { MAJOR_DEGREES, SCALES, degreesOf } from '../audio/scales'
import { soundingBook, type SoundingBook } from '../audio/sounding'
import { applyFx, captureFx, makeInstKits, type InstKit } from '../audio/instKit'
import { KitBar } from '../ui/KitBar'
import { useMediaQuery } from '../ui/media'
import { useTouchOnly } from '../ui/pointerKind'
import {
  OCTAVE_HIGH,
  OCTAVE_LOW,
  PHONE_KEYBOARD,
  keysToShow,
  shiftOctave,
} from '../audio/keyboardSpan'
import { onMixerChange, setVolume, volume } from '../audio/mixer'
import { PianoRoll } from './PianoRoll'
import { toSong } from '../audio/songFile'
import { soundingAt, toNotes } from '../audio/noteEdit'
import { takeTimeAt } from '../audio/arrange'
import { librarySaved, libraryTrouble, saveToLibrary } from '../audio/library'
import { remember } from '../audio/capture'
import { sharedCtx } from '../audio/context'
import { InstrumentScope } from '../audio/InstrumentScope'
import { lazyRetry } from '../lazyRetry'
import { useVizFloating, vizFloat } from '../audio/floatingViz'

/**
 * ⚠️ THE REAL VISUALISER, not a second one.
 *
 * This room briefly had a hand-rolled panel that built a Frame and called a mode directly. It
 * drew, but it was always going to be the lesser one: mirrors, depth, bloom, spin and sway are
 * not mode code, they are a buffer pipeline inside AudioVisualizer — and those are exactly the
 * dials that make a mode worth watching. Reimplementing them would have duplicated the most
 * performance-sensitive code on the site to produce a worse copy, which is how a site ends up
 * with two visualisers and neither of them good.
 *
 * So this is the same component the Visualiser tab renders, and every control it has works here,
 * because they ARE the same controls: it reads and writes the same localStorage keys, so a look
 * tuned in either place is the look in both.
 *
 * ⚠️ Its source already defaults to "all", which mixes every live tap — so what you play
 * reaches it with no wiring, and a call or a backing track you had going still does too.
 *
 * ⚠️ LAZY, and the toggle is remembered. It is a real chunk, and somebody who came to play
 * the keys on a phone should not download a kaleidoscope to do it.
 */
const EmbeddedVisualizer = lazyRetry(
  () => import('./AudioVisualizer'),
  (m) => m.AudioVisualizer,
)
const SHOW_VIZ_KEY = 'inst_show_viz_v1'
import { Toast } from '../circuit/ui/Toast'
import { AlsoTogether } from '../ui/AlsoTogether'
import { together } from '../party/together'
import { jam } from '../party/jam'
import { hueFor } from '../party/party'
import { useVoiceSession } from '../voice/useVoiceSession'
import { TakesPanel } from '../audio/TakesPanel'
import {
  capture,
  loopOrigin,
  loopState,
  loopLength,
  chordPatternOf,
  takeBars,
  startLoop,
  stopLoop,
  subscribeLoop,
  hushScheduled,
} from '../audio/looper'
import { benchTroubleText, openWorkbench } from '../audio/workbench'
import { SingPanel } from '../audio/SingPanel'
import { redo, startHistory, undo } from '../audio/history'
import { FAMILIES, familyOf, familyVoices } from '../audio/families'
import { AudioHealthStrip } from '../instrument/AudioHealthStrip'
import { fxWord } from '../instrument/fxWord'
import { KnobRow, Why } from '../instrument/rowParts'
import { LayerList } from '../instrument/LayerList'
import { useBacking } from '../instrument/useBacking'
import { BackingPanel } from '../instrument/BackingPanel'
import { SongControls } from '../instrument/SongControls'
import { openEditor } from '../instrument/openEditor'

/**
 * Somewhere to play.
 *
 * Solo for now, and built so that playing together is an addition rather than a rewrite: every
 * press goes through `press`/`lift` with an id and a note, which is exactly the payload a peer
 * would send. When the room arrives, a remote note is the same two calls with a different id
 * prefix — see synth.ts on why events travel and audio does not.
 *
 * ⚠️ THE KEYBOARD IS THE INSTRUMENT, not a decoration on a picture of one. Computer keys, mouse
 * and touch all reach the same two functions, and a key that is held stays held: the common
 * shortcut of firing a fixed-length blip on keydown makes every patch sound identical and makes
 * the pad and the pluck indistinguishable, which is most of what a synth has to offer.
 */

/**
 * The FL Studio typing layout — four rows, two octaves.
 *
 * Two piano keyboards stacked: ZXCVBNM is the lower octave's white keys with SDGHJ as its black
 * ones, and QWERTYU sits an octave above with 234567 above that. Anyone who has used FL, Ableton
 * or a tracker already has this in their fingers, which is worth more than a layout I invent.
 *
 * ⚠️ LETTERS AND DIGITS ONLY, and nothing needing a modifier. Browsers own the modifier
 * combinations — ctrl+W closes the tab and no preventDefault can stop it — so a layout using any
 * of them would be a trap rather than a shortcut. The handler already bails on ctrl, meta and
 * alt. Deliberately no slash or apostrophe either: both open quick-find in Firefox.
 */
const KEY_MAP: Record<string, number> = {
  // lower octave — white keys on the bottom row, black keys on the home row
  z: 0,
  s: 1,
  x: 2,
  d: 3,
  c: 4,
  v: 5,
  g: 6,
  b: 7,
  h: 8,
  n: 9,
  j: 10,
  m: 11,
  ',': 12,
  // upper octave — white keys on the QWERTY row, black keys on the number row
  q: 12,
  '2': 13,
  w: 14,
  '3': 15,
  e: 16,
  r: 17,
  '5': 18,
  t: 19,
  '6': 20,
  y: 21,
  '7': 22,
  u: 23,
  i: 24,
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

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
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)

/**
 * The saved rigs, built with the room's OWN scale list.
 *
 * ⚠️ passed in rather than duplicated inside the audio module. A second copy of SCALES is
 * a copy that goes stale the first time one is added, and a kit naming a scale the check has not
 * heard of quietly becomes Chromatic with nothing said.
 */
const instKits = makeInstKits(SCALES.map(([id]) => id))

const INST_KEY = 'instrument_v1'
const OCT_KEY = 'instrument_octave_v1'
const SCALE_KEY = 'instrument_scale_v1'
const ROOT_KEY = 'instrument_root_v1'
const CHORD_KEY = 'instrument_chord_v1'
const STRUM_KEY = 'instrument_strum_v1'
const ARP_KEY = 'instrument_arp_v1'
const SWING_KEY = 'instrument_swing_v1'
/* whether the More sound fold is open — a per-device convenience, like the others here */
const MORE_KEY = 'instrument_more_sound_v1'
/* every voice the picker offers, for asking families.ts which of a family's members exist here */
const INSTRUMENT_IDS = INSTRUMENTS.map(([id]) => id)

/** Where the instrument menu behaves like a phone's: closes after a pick, starts closed. */
const PHONE_MENU = '(max-width: 40rem)'

/**
 * @param inCanvas true when this is a window on the shared canvas rather than the page.
 *
 * ⚠️ THE EMBEDDED THEATRE STANDS DOWN THERE, and it has to. On the canvas the visualiser is
 * a window in its own right — bigger, movable, and able to stay open while you walk to another
 * tab, which is the whole reason to pop it out. Rendering it again INSIDE this window means two
 * full pipelines drawing at once (measured: two .viz-wrap mounted on one screen), for the second
 * copy of a thing the user has already put somewhere better.
 */
export function InstrumentRoom({ inCanvas = false }: { inCanvas?: boolean } = {}) {
  const [inst, setInst] = useState<InstrumentId>(() => {
    try {
      const v = localStorage.getItem(INST_KEY)
      return INSTRUMENTS.some(([id]) => id === v) ? (v as InstrumentId) : 'keys'
    } catch {
      return 'keys'
    }
  })
  /**
   * Which family the instrument menu shows: the one the current sound belongs to, unless you
   * have just pressed another family's tab — and that choice lasts until the sound changes, so
   * picking a voice from the family you were browsing lands you on its family by itself.
   */
  const [famPick, setFamPick] = useState<{ forInst: string; fam: string } | null>(null)
  const famShown = famPick && famPick.forInst === inst ? famPick.fam : familyOf(inst)
  const setFamShown = (fam: string) => setFamPick({ forInst: inst, fam })
  const [moreSound, setMoreSound] = useState(() => {
    try {
      return localStorage.getItem(MORE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [octave, setOctave] = useState(() => {
    const v = Number(localStorage.getItem(OCT_KEY))
    return Number.isFinite(v) && v >= 1 && v <= 6 ? v : 4
  })
  /**
   * ⚠️ WHETHER THE KEYS PLAY IS INVISIBLE, AND IT DECIDES WHAT TYPING DOES.
   *
   * Focus is the difference between a letter playing a note and a letter going into a box, and
   * nothing on screen said which was true — so "the keyboard stopped working" was really "focus
   * is somewhere that eats letters", with no way to tell from looking. It is a small light, and
   * it is the whole explanation.
   *
   * Watched on focusin/focusout at the document rather than on each control, because the answer
   * depends on wherever focus happens to be, including controls nobody has written yet.
   */
  const [keysLive, setKeysLive] = useState(true)
  useEffect(() => {
    const look = () => {
      const t = document.activeElement as HTMLElement | null
      const eats =
        !!t &&
        (t.isContentEditable ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          (t.tagName === 'INPUT' &&
            !['range', 'checkbox', 'radio', 'button', 'submit', 'color'].includes(
              (t as HTMLInputElement).type,
            )))
      setKeysLive(!eats)
    }
    look()
    document.addEventListener('focusin', look)
    document.addEventListener('focusout', look)
    return () => {
      document.removeEventListener('focusin', look)
      document.removeEventListener('focusout', look)
    }
  }, [])

  const [scale, setScale] = useState(() => {
    try {
      const v = localStorage.getItem(SCALE_KEY)
      return SCALES.some(([id]) => id === v) ? v! : 'chromatic'
    } catch {
      return 'chromatic'
    }
  })
  const [root, setRoot] = useState(() => {
    const v = Number(localStorage.getItem(ROOT_KEY))
    return Number.isFinite(v) && v >= 0 && v <= 11 ? v : 0
  })
  /* ⚠️ asked of CHORDS rather than cast, so a shape removed from the picker cannot come back
     out of somebody's localStorage as a value nothing handles */
  const [chord, setChord] = useState<ChordId>(() => {
    try {
      const v = localStorage.getItem(CHORD_KEY)
      return CHORDS.some(([id]) => id === v) ? (v as ChordId) : 'off'
    } catch {
      return 'off'
    }
  })
  const [strum, setStrum] = useState<StrumId>(() => {
    try {
      const v = localStorage.getItem(STRUM_KEY)
      return STRUMS.some(([id]) => id === v) ? (v as StrumId) : 'off'
    } catch {
      return 'off'
    }
  })
  /* ⚠️ NOT REMEMBERED ACROSS VISITS, unlike every other control here. Coming back to a room
     where the pedal is silently down means your first chord never stops and nothing on screen
     says why — the one setting whose wrong state is indistinguishable from a broken synth. */
  const [hold, setHold] = useState(false)
  /** whether the pedal currently down was put there by Shift rather than by the button */
  const shiftPedal = useRef(false)
  /* ⚠️ ONLY THE ARPEGGIO SWINGS, so unlike the Arpeggio picker this one genuinely has no
     effect when there is nothing to swing — which is what makes hiding it honest rather than
     the trap the arp picker was. See the note on its own `&&` below. */
  const [swing, setSwing] = useState(() => {
    try {
      return localStorage.getItem(SWING_KEY) === '1'
    } catch {
      return false
    }
  })
  const [arp, setArp] = useState<ArpId>(() => {
    try {
      const v = localStorage.getItem(ARP_KEY)
      return ARPS.some(([id]) => id === v) ? (v as ArpId) : 'off'
    } catch {
      return 'off'
    }
  })
  const [held, setHeld] = useState<number[]>([])
  /**
   * Which of the lit keys a finger is actually on.
   *
   * ⚠️ TWO STATES THAT CANNOT DRIFT, because both are written from the same book in the same
   * statement — `show()` is the only thing that sets either, and it is called from exactly the
   * three places that change what is sounding. Keeping them apart is what lets `held` stay a
   * plain `number[]` for the keyboard and for TakesPanel, which is what it has always been.
   */
  const [lead, setLead] = useState<number[]>([])
  /**
   * ⚠️ OPEN ON A DESKTOP, CLOSED ON A PHONE — Evan's call, 9 Nov 2026. On a phone the open grid
   * covers the page, which is why it closes after a pick there; on a desktop it fits, and seeing
   * the sounds is how somebody new finds out there are two dozen of them. Same query as the
   * close-after-pick below, so the two cannot disagree about which screen this is.
   */
  const [picksOpen, setPicksOpen] = useState(() => !window.matchMedia(PHONE_MENU).matches)
  const loop = useSyncExternalStore(subscribeLoop, loopState, loopState)
  const [vol, setVol] = useState(() => volume('instrument'))
  useEffect(() => onMixerChange(() => setVol(volume('instrument'))), [])

  /**
   * ⚠️ (octave + 1), not octave.
   *
   * MIDI note 60 — middle C — is named C4, and 60/12 is 5. The offset is the standard oddity of
   * the numbering, and getting it wrong is not subtle: the picker said 4 while every key on
   * screen was labelled C3, so the two controls openly disagreed about what octave you were in.
   */
  const base = (octave + 1) * 12

  /**
   * Which note the nth key plays.
   *
   * On Chromatic this is simply the nth semitone. On any other scale the keys become scale
   * DEGREES: key 0 is the root, key 1 the second note of the scale, and the octave rolls over
   * whenever the pattern runs out — so a five-note scale gives you five keys per octave and more
   * range across the same seventeen keys.
   */
  const degrees = degreesOf(scale)
  const noteAt = useCallback(
    (i: number) => {
      if (scale === 'chromatic') return base + i
      const oct = Math.floor(i / degrees.length)
      return base + root + oct * 12 + degrees[i % degrees.length]
    },
    [scale, base, root, degrees],
  )

  /**
   * What one key plays — a note, or a chord built from the scale you chose.
   *
   * ⚠️ DRUMS ARE NOT HARMONY. Stacking two degrees of a twelve-piece kit is a kick with a snare
   * on top, which is a mistake rather than a chord — so the kit ignores the setting rather than
   * the picker having to be hidden and the choice forgotten.
   */
  const notesFor = useCallback(
    (midi: number) => {
      if (chord === 'off' || inst === 'drums') return [midi]
      return scale === 'chromatic'
        ? chordNotes(chord, midi, MAJOR_DEGREES, midi % 12)
        : chordNotes(chord, midi, degrees, root)
    },
    [chord, inst, scale, degrees, root],
  )
  // ⚠️ a ref as well as state: the key handlers are bound once and would otherwise capture the
  // instrument and octave from the render that installed them, so changing either mid-play would
  // be ignored until something else re-rendered
  const live = useRef({ inst, noteAt, notesFor, strum, arp, bpm: loop.bpm, hold, swing })
  live.current = { inst, noteAt, notesFor, strum, arp, bpm: loop.bpm, hold, swing }

  useEffect(() => {
    try {
      localStorage.setItem(INST_KEY, inst)
      localStorage.setItem(OCT_KEY, String(octave))
      localStorage.setItem(SCALE_KEY, scale)
      localStorage.setItem(ROOT_KEY, String(root))
      localStorage.setItem(CHORD_KEY, chord)
      localStorage.setItem(STRUM_KEY, strum)
      localStorage.setItem(ARP_KEY, arp)
      localStorage.setItem(SWING_KEY, swing ? '1' : '0')
      localStorage.setItem(MORE_KEY, moreSound ? '1' : '0')
    } catch {
      /* private mode — it still plays */
    }
  }, [inst, octave, scale, root, chord, strum, arp, swing, moreSound])

  /**
   * Every note goes to the synth AND offers itself to the recorder.
   *
   * capture() is a no-op unless a take is running, so there is no "recording mode" branch here
   * and no way for the two to disagree about what you played — the sound you heard and the
   * events stored are produced by the same call.
   */
  /**
   * Jamming rides the call, so the control only exists while you are in one. Rendering a
   * disabled "Jam" button to someone playing alone would advertise a feature whose entry point
   * is somewhere else entirely — the call button, on another page.
   */
  /* remembered, because whether you want the kaleidoscope up while playing is a preference and
     not a per-visit decision */
  /* if it is floating over the page, that IS the visualiser — a second one in here would be two
     pipelines drawing the same sound, and the floating one is the one they asked for */
  const vizFloating = useVizFloating()
  const [showViz, setShowViz] = useState(() => {
    try {
      return localStorage.getItem(SHOW_VIZ_KEY) !== '0'
    } catch {
      return true
    }
  })
  const call = useVoiceSession()
  const jamming = useSyncExternalStore(jam.subscribe, jam.getState, jam.getState)
  useEffect(() => jam.start(), [])
  /**
   * ⚠️ Leaving the page must not leave your friends holding your notes. allNotesOff() silences
   * the synth locally, which does nothing for the note-ons already sitting in everyone else's
   * browser — those are only released by a message, and unmounting sends none.
   */
  useEffect(() => () => jam.setOn(false), [])
  /**
   * ⚠️ APPLIED ON ARRIVAL AS WELL AS ON CHANGE. Leaving this room switches jamming off — the
   * line above, and it is right, because nobody should keep sharing a room they walked out of.
   * That means "share everything" cannot be a thing you turn on once and forget: it has to be
   * re-applied every time you come back, or it would quietly stop being true the first time you
   * went to look at something else.
   */
  useEffect(() => {
    const apply = () => jam.setOn(together.getState().on)
    apply()
    return together.subscribe(apply)
  }, [])

  /** which layer's notes are open in the editor, if any */
  const [editing, setEditing] = useState<string | null>(null)
  /**
   * The first thing you record opens its own notes.
   *
   * ⚠️ THE FIRST, AND NOT EVERY ONE, because the two situations want opposite things. Somebody
   * who has just recorded their first part does not know the notes are editable at all — the only
   * door is the layer's name in the list, and the report that prompted this says plainly what
   * happens next: they went looking and pressed ✎ New part, which starts a blank one. Somebody on
   * their fourth pass is stacking a loop, and a panel that opened itself every time would be in
   * the way of the thing they are doing.
   *
   * ⚠️ KEYED ON THE ID RATHER THAN ON A COUNT, so it fires once per thing made. `made` keeps its
   * value until the next one, and an effect that re-ran on any state change would reopen the
   * editor somebody had just closed.
   */
  const opened = useRef<string | null>(null)
  useEffect(() => {
    const id = loop.made
    if (!id || opened.current === id) return
    opened.current = id
    if (loop.layers.length === 1) setEditing(id)
  }, [loop.made, loop.layers.length])
  /* ⚠️ an editor for a layer that has gone is not open — see openEditor */
  useEffect(() => {
    const still = openEditor(editing, loop.layers)
    if (still !== editing) setEditing(still)
  }, [editing, loop.layers])
  /* a touch screen gets touch words in the help below — see the note there */
  const touch = useTouchOnly()
  /* must agree with the stylesheet about what a phone is — the query is shared, not retyped */
  const narrowBoard = useMediaQuery(PHONE_KEYBOARD)
  /** what Capture just did, shown briefly — it is otherwise a button with no visible effect */
  const [capMsg, setCapMsg] = useState<string | null>(null)
  /**
   * ⚠️ WHAT YOU WERE WORKING ON SURVIVED WALKING TO ANOTHER ROOM AND NOT A RELOAD, which is
   * exactly what an in-memory module looks like from the outside: this component unmounts and
   * looper.ts does not, so the layers were still there when you came back and gone when the
   * page was made again. The room remembered nine playing settings and your saved rigs across
   * the same reload, which is what made the one thing it forgot read as a fault. See
   * workbench.ts — it is idempotent, so mounting twice costs nothing and restores once.
   */
  useEffect(
    () =>
      openWorkbench((t) => {
        /* ⚠️ said, not swallowed: a recording that would not open, a disk that is full, or a
           saved bench this page will not overwrite — see BenchTrouble */
        setCapMsg(benchTroubleText(t))
        window.setTimeout(() => setCapMsg(null), 9000)
      }),
    [],
  )
  /* ⚠️ AFTER the workbench above, so the bench it puts back is where undo starts rather than a
     step — it also marks that restore as from elsewhere, so the order is belt and braces */
  useEffect(() => startHistory(), [])
  const [libOpen, setLibOpen] = useState(false)

  /**
   * Keeping something.
   *
   * A whole arrangement is a song; one layer is a loop. Same format either way — a loop is a
   * song with one layer — which is what lets a drum pattern you kept last week be dropped under
   * a bassline you are writing now.
   */
  const keep = (kind: 'song' | 'loop', layerId?: string) => {
    /**
     * ⚠️ BEFORE THE PROMPT, NOT AFTER IT. window.prompt blocks this thread while the audio clock
     * runs on, so the loop's scheduler stops extending its look-ahead and every note still
     * waiting for its note-off drones for as long as the box is open. Reported as "when saving a
     * song the currently played notes hang". Letting go first costs the tail of whatever was
     * sounding; not letting go costs a note that never ends. See hushScheduled.
     *
     * ⚠️ AND THE LIVE KEYS TOO, for the older reason the blur handler gives: a dialog takes
     * focus, so a key you were holding when you pressed Keep never delivers its keyup.
     */
    hushScheduled()
    hush()
    const name =
      window.prompt(kind === 'loop' ? 'Name this loop' : 'Name this song', '')?.trim() ?? ''
    if (!name) return
    /**
     * ⚠️ WHICH OF THE THREE, because "Nothing to keep — record something first" was the
     * answer to all of them and is only true for one. A keep can also be refused because the
     * library is full, and it can succeed in memory and not reach the disk — somebody told
     * "Kept" who then loses it on reload has been misled by this line rather than by the
     * storage. Same three answers the paint room gives, for the same reason.
     */
    const item = saveToLibrary(kind, toSong(name, loop.bpm, loop.bars, loop.layers, layerId))
    setCapMsg(
      item
        ? librarySaved()
          ? `Kept “${item.name}”`
          : `“${item.name}” is here for now, but this browser is out of room — delete something to keep it for good.`
        : libraryTrouble() === 'full'
          ? 'Your library is full — delete something to make room for this.'
          : libraryTrouble() === 'too-big'
            ? 'That is too long to keep — try keeping one layer rather than the whole song.'
            : 'Nothing to keep — record something first.',
    )
    window.setTimeout(() => setCapMsg(null), item && librarySaved() ? 4000 : 9000)
    if (item) setLibOpen(true)
  }

  const [beatsOpen, setBeatsOpen] = useState(false)

  /**
   * peer id → their name, so a shared layer can say whose take it is.
   *
   * ⚠️ The name book FIRST, then whoever is playing right now. Reading only `players` meant a
   * take was labelled "Someone" the moment its author stopped playing — or left, while their
   * part carried on in the arrangement. The book remembers; players is only who is at the keys.
   */
  const jamNames: Record<string, string> = { ...jamming.names }
  for (const p of Object.values(jamming.players)) jamNames[p.id] = p.name

  /** midi number → the hue of whoever is holding it, for the keyboard below */
  const theirNotes = new Map<number, number>()
  for (const p of Object.values(jamming.players))
    for (const m of p.held) theirNotes.set(m, hueFor(p.id))

  /**
   * One book of what is sounding, for the whole room.
   *
   * ⚠️ THE LAZY FORM, because `useRef(soundingBook())` builds a book on every render and throws
   * all but the first away — a Map per keystroke, in the room where keystrokes are the point.
   */
  const bookRef = useRef<SoundingBook | null>(null)
  const book = (bookRef.current ??= soundingBook())
  /**
   * What is still ringing with nobody holding it.
   *
   * ⚠️ A SECOND BOOK, DELIBERATELY. `book` answers "what is somebody holding", which the lit
   * keys and `lift` both read; this one answers "what is still making a sound". The pedal
   * exists precisely because those stop being the same question — merging them would leave a
   * key lit after the finger had gone.
   */
  const pedalRef = useRef<PedalBook | null>(null)
  const pedal = (pedalRef.current ??= pedalBook())

  /**
   * A note starting or stopping, told to everything that is not the synth.
   *
   * ⚠️ ONE CALL SITE, WHICH IS THE WHOLE POINT, and it is the shape the old `press` already had
   * spelled out in three comments. capture() is a no-op unless a take is running and jam.play()
   * is a no-op unless you are jamming, so there is no "recording mode" branch anywhere here and
   * no way for what you heard, what your friends heard, what was recorded and what Capture can
   * reach to have been produced by different code.
   */
  const report = useCallback((midi: number, on: boolean, at = sharedCtx().currentTime) => {
    /* ⚠️ `at`, NOT `currentTime`, and all three take it. A rolled chord's notes genuinely sound
       22ms apart, so stamping them all with the instant the key went down would record a roll
       as a block chord and send your friends a block chord — the setting would be audible here
       and nowhere else. jam.play has no time to give, so peers hear the chord together; that is
       a limitation of the wire format rather than a decision, and it is written down in the
       commit rather than papered over here. */
    capture(midi, on, live.current.inst, at)
    jam.play(midi, on, live.current.inst)
    remember(at, midi, on, live.current.inst)
  }, [])

  /**
   * The arpeggiator, one per mount, lazily for the same reason the book is.
   *
   * ⚠️ IT READS `live.current`, NOT THE RENDER'S VALUES. The runner is built once and its
   * `play` closure outlives every render, so capturing `inst` here would freeze the sound at
   * whatever was chosen when the room mounted — the same trap the key handlers have a comment
   * about two screens down.
   */
  const arpRef = useRef<ArpRunner | null>(null)
  const arping = (arpRef.current ??= arpRunner({
    now: () => sharedCtx().currentTime,
    play: (n) => {
      noteOn(n.voice, live.current.inst, n.midi, n.at)
      noteOff(n.voice, n.until)
      report(n.midi, true, n.at)
      report(n.midi, false, n.until)
    },
  }))

  /**
   * The note the arpeggiator is sounding right now, so the keyboard can show the figure.
   *
   * ⚠️ POLLED, NOT PUSHED, and that is the right way round here. The runner commits notes to
   * the audio clock up to 120ms BEFORE they sound — that is what the look-ahead is for — so
   * lighting a key when `play` is called would light it early and out of time with what you
   * hear. Asking "what is sounding now" on a short interval is in step with the ear.
   *
   * 25Hz is a quarter of a step at the fastest tempo the room allows. The state only changes
   * when the answer does, which at an eighth note is five or six times a second — the same rate
   * playing fast by hand already re-renders this room at.
   */
  const [nowNote, setNowNote] = useState<number | null>(null)
  const arpLit = arp !== 'off' && held.length > 0

  /**
   * What the backing is actually sounding RIGHT NOW — the keyboard's live hint, and the words
   * for it.
   *
   * ⚠️ THE BLANK-PAGE PROBLEM ONE FLOOR FURTHER UP, which is the only reason to add a fourth
   * thing a key can look like. Scale lock already means every key you press is a right note, and
   * a progression underneath means some of those right notes are the ones the chord is built
   * from. A person who cannot play has no way to know which — that is the entire skill — and
   * they are the people these three features exist for.
   *
   * ⚠️ IT READS THE LAYER'S OWN NOTES, AND THE FIRST VERSION DID NOT. That one re-derived the
   * chord from the progression's pattern plus the room's CURRENT key and scale, which is right
   * for exactly as long as nobody touches the Key picker. Measured: a progression dropped in C
   * keeps playing C–G–Am–F — it is a take, not a live instrument — and switching the Key to D
   * had the keyboard light up A, C♯ and E and the line read "A major underneath" while the
   * speakers played G major. C♯ is not in the backing's key at all, so the hint was pointing at
   * a clash and naming it confidently.
   *
   * That is §2 about my own work: the hint was true the day it shipped and a neighbouring
   * control made it false. (Since 9 Nov 2026 the Key picker re-voices the backing, but an edited
   * one keeps its old scale through a change of scale, so asking the notes is still the only answer
   * that cannot drift.) Asking the notes instead means a key change, a scale change, and
   * somebody editing the roll by hand all come out right without this knowing any of them
   * happened — the hint cannot drift from the sound because it IS the sound.
   *
   * ⚠️ TILED BY THE LAYER'S OWN LENGTH, like the scheduler does, so a take shorter than the loop
   * is read at the right point in its repetition rather than off its end.
   *
   * ⚠️ AND IT STANDS DOWN FOR AN ARRANGED LAYER. Once somebody puts the bars in an order, which
   * bar sounds in which slot is the scheduler's business and working it out again here would be
   * a second copy of that decision — the exact mistake this rewrite is undoing. Saying nothing
   * beats guessing, and an arrangement is rare enough that nobody loses a feature they were
   * using.
   *
   * ⚠️ NOT ON BY DEFAULT IN ANY MEANINGFUL SENSE. It needs a progression layer AND the transport
   * running, both reached on purpose, so a plain keyboard looks exactly as it always has. When
   * the loop stops the hint goes with it, because a chord highlight frozen on whatever bar you
   * paused in is a lie about the present tense.
   *
   * ⚠️ AND IT HAS TO BE A LAYER YOU CAN ACTUALLY HEAR, which took two more goes to get right.
   * The transport check covers the whole room stopping; it says nothing about this one layer
   * being switched off. Measured: with the chord layer MUTED — row marked `is-muted`, button
   * showing 🔇 — the keys still carried dots and the line still read "G major underneath", about
   * a backing making no sound at all. Same again with the layer's own fader pulled to 0.
   *
   * Both are things somebody does ON PURPOSE to turn the backing off, which makes a hint that
   * keeps describing it the plainest possible contradiction of what the hint is for. The rule
   * this whole feature runs on is that it describes what you HEAR; silence is part of that.
   *
   * `gain` undefined means 1 — see the Layer type — so the test is on the resolved value, not on
   * the field being present.
   */
  const chordLayer =
    loop.layers.find((l) => chordPatternOf(l) !== null && !l.muted && (l.gain ?? 1) > 0) ?? null
  /**
   * ⚠️ NOT `chordNotes` — that name is already an IMPORT from chords.ts that the Chord picker
   * calls at the top of this component. A local const of the same name shadows it for the whole
   * body, so the picker's two calls would have hit the temporal dead zone and thrown
   * `Cannot access 'chordNotes' before initialization` the moment anybody pressed a key with a
   * chord selected. Typecheck caught it only obliquely, as "the import is never read".
   */
  const chordTake = useMemo(
    () => (chordLayer ? toNotes(chordLayer.events, chordLayer.len) : []),
    [chordLayer],
  )
  const backingNow = useMemo(() => {
    if (!chordLayer || !loop.playing) return []
    const len = chordLayer.len
    if (!(len > 0)) return []
    const lap = loopLength()
    const at = loop.position * lap
    /**
     * ⚠️ TWO PATHS, THE SAME TWO THE SCHEDULER HAS, and for the reason its own note gives: a
     * plain take tiles by its own length, which need not be a whole number of bars, while an
     * arranged one is a list of bars. Making one a special case of the other would reinterpret
     * every unarranged take as a whole number of bars, which is exactly what the scheduler
     * refuses to do.
     *
     * ⚠️ THE ARRANGED PATH ASKS `partAt` RATHER THAN WORKING IT OUT. This used to stand down
     * entirely once somebody put the bars in an order — honest, but a gap, and the reason given
     * was that deciding which bar sounds where is the scheduler's business. It still is: that
     * decision lives in `arrange.ts` and both of them ask it, so this cannot drift from what you
     * hear any more than the dots can drift from the pad.
     *
     * Inverting the scheduler's own placement gives the moment inside the take, and that
     * inversion is `takeTimeAt` rather than four lines here — dropping its `src * barLen` term
     * reads the top of the take for every moved bar, which is a plausible chord every time and
     * simply the wrong one. A mistake that silent belongs somewhere a test can put the question.
     */
    if (chordLayer.plan) {
      const tTake = takeTimeAt(
        chordLayer.plan,
        takeBars(chordLayer),
        at,
        lap / Math.max(1, loop.bars),
      )
      return tTake == null ? [] : soundingAt(chordTake, tTake)
    }
    return soundingAt(chordTake, ((at % len) + len) % len)
  }, [chordLayer, chordTake, loop.playing, loop.position, loop.bars])
  const chordTones = useMemo(
    () => [...new Set(backingNow.map((m) => ((m % 12) + 12) % 12))].sort((a, b) => a - b),
    [backingNow],
  )
  /**
   * ⚠️ THE DOTS SAY WHICH KEYS AND THIS SAYS WHAT IT IS, which are different questions and only
   * one of them is answerable by looking at the keyboard. "These three are the good ones" gets
   * somebody playing; "that was A minor" is the thing they can carry to the next song, look up,
   * or ask about. Both come off the same `backingNow`, so they cannot name one chord while the
   * keyboard lights up another.
   */
  /**
   * ⚠️ SPELLED IN THE ROOM'S KEY — B♭ in D minor, not A♯ (Evan, 9 Nov 2026). Both readouts use it,
   * the backing's and the one for what you are holding, and so do the keys' own labels since
   * 10 Nov, so one note never has two names an inch apart. Chromatic has no key and keeps its sharps. See `keySpeller`.
   */
  const spell = useMemo(
    () => (scale === 'chromatic' ? undefined : keySpeller(degrees, root)),
    [scale, degrees, root],
  )
  const backingChord = useMemo(
    () => (backingNow.length ? nameChord(backingNow, spell) : null),
    [backingNow, spell],
  )

  /* the backing's picks and the calls that lay it — see useBacking; drawn by BackingPanel */
  const backing = useBacking({ scale, root, degrees, loop })

  useEffect(() => {
    if (!arpLit) {
      setNowNote(null)
      return
    }
    const h = window.setInterval(() => {
      setNowNote(arping.soundingAt(sharedCtx().currentTime)?.midi ?? null)
    }, 40)
    return () => {
      window.clearInterval(h)
      setNowNote(null)
    }
  }, [arpLit, arping])

  /**
   * The pulse to be in time with, or null when there is nothing to be in time with.
   *
   * ⚠️ `loopState()`, NOT THE `loop` FROM RENDER, for the reason the space-bar handler gives
   * further down: these are read from callbacks that outlive the render that built them, and
   * the store's snapshot is always current where a captured value is whatever was true at the
   * time. Getting it wrong would mean an arpeggio locking to a loop that has since stopped, or
   * free-running over one that has since started.
   */
  const gridNow = useCallback(() => (loopState().playing ? loopOrigin() : null), [])

  /** Show what the book holds. The ONE place either of the two lit-key states is written. */
  const show = useCallback(() => {
    setHeld(book.notes())
    setLead(book.leads())
  }, [book])

  /** A press: several notes, because one key is not always one note. */
  const press = useCallback(
    (id: string, notes: number[]) => {
      const { stop, play } = book.start(id, notes)
      /* a retrigger on a live id — the book hands back what it was holding so none is left open */
      for (const v of stop) {
        noteOff(v.voice)
        report(v.midi, false)
      }
      /**
       * ⚠️ THE PEDAL FORGETS WHAT IS BEING STRUCK AGAIN, and this is the subtle half of the
       * whole feature. `noteOn` retriggers by id, so pressing a key whose last note is still
       * pedalled replaces that voice under the same name. Leaving the stale entry in the pedal
       * means lifting the pedal later sends a note-off to the NEW note — cutting off a key the
       * person is still holding down, from a control they have just released.
       */
      pedal.forget(play.map((v) => v.voice))
      /**
       * ⚠️ DELAYS, NOT A TIMER. Every note is started by this one call with its own `when`, so
       * a rolled chord has no process behind it: nothing to tear down, nothing still firing
       * after you let go, and the book holds every voice from the moment you press — which is
       * what lets `lift` release a chord that has not finished arriving.
       */
      /**
       * ⚠️ WITH AN ARPEGGIO RUNNING, NOTHING IS SOUNDED HERE. The book still records what is
       * HELD — which is what the lit keys and `lift` need — but the notes are handed to the
       * runner, which plays them one at a time. Hence the two branches rather than a flag: a
       * held chord and an arpeggiated one are different things happening, and pretending
       * otherwise is how `press` ends up sounding a chord the runner is also playing.
       */
      if (live.current.arp !== 'off') {
        arping.update(
          book.notes(),
          live.current.arp,
          live.current.bpm,
          gridNow(),
          live.current.swing ? 1 : 0,
        )
        show()
        return
      }
      const now = sharedCtx().currentTime
      const delays = strumDelays(live.current.strum, play.length)
      play.forEach((v, i) => {
        const at = now + delays[i]
        noteOn(v.voice, live.current.inst, v.midi, at)
        report(v.midi, true, at)
      })
      show()
    },
    /* `arping` is one runner per mount, so this stays referentially stable */
    [book, report, show, arping, gridNow, pedal],
  )

  /**
   * ⚠️ A POINTER OWNS EXACTLY ONE NOTE, and re-entering the key it already owns does
   * nothing.
   *
   * pointerenter used to call press() unconditionally whenever a button was down. That is right
   * for a mouse, which stays where you put it, and wrong for a finger, which does not: a fingertip
   * resting on a phone wobbles a pixel or two, and if it is anywhere near a key edge the browser
   * sends leave/enter/leave/enter for as long as you hold. Every one of those enters restarted the
   * voice. A held note was therefore not held at all — it was being retriggered tens of times a
   * second, which is heard as crackling rather than as repeated notes because each restart is only
   * a few milliseconds from the last.
   *
   * Keyed by pointerId rather than by midi, so two fingers on the same key are two voices and
   * neither steals the other's.
   */
  const owned = useRef(new Map<number, number>())
  const setOwned = useCallback(
    (pointerId: number, midi: number | null) => {
      const now = owned.current.get(pointerId)
      if (now === midi) return // the jitter case: same finger, same key, nothing to do
      if (now !== undefined) lift('p:' + pointerId)
      if (midi == null) owned.current.delete(pointerId)
      else {
        owned.current.set(pointerId, midi)
        press('p:' + pointerId, live.current.notesFor(midi))
      }
    },
    // press and lift are stable useCallbacks with no deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /**
   * ⚠️ The end of a press is caught on WINDOW, not on the key.
   *
   * Capture is deliberately released so a press can slide between keys, which also means the
   * pointerup lands on whatever happens to be under the finger — and if that is the gap below the
   * keyboard, the key's own handler never runs and the note sounds forever. Listening at the top
   * means a finger that leaves the keys still ends its note.
   */
  useEffect(() => {
    const end = (e: PointerEvent) => setOwned(e.pointerId, null)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [setOwned])

  /**
   * ⚠️ IT TAKES NO PITCH, AND THAT IS THE FIX.
   *
   * It used to take one, and the keyboard handler supplied it by WORKING IT OUT AGAIN —
   * `lift('k:' + key, live.current.noteAt(off))`, a fresh computation from the octave, scale and
   * key as they stood at release time. Those agree with the press only while nothing moves
   * underneath them, and the octave buttons move one of them: measured in the pane, hold `z`,
   * press Octave up, let go and come back to octave 4, and **C4 is lit with nothing pressed**.
   *
   * The sound was always right, because the synth releases by voice id rather than by pitch —
   * which is precisely what let it go unnoticed. What was wrong were the four things fed from
   * that recomputed pitch: the lit key, the note-off written into a take, the note-off sent to
   * everyone jamming with you, and the rolling history Capture reads. A stuck highlight is the
   * only one of the four you can see.
   *
   * The scale and key pickers had each been given `stopLive(); setHeld([])` to dodge this, which
   * is §4's "a rule only one path keeps is one you get around" wearing a UI hat — two paths
   * patched, one missed, and the patched ones cut your note off to do it. Now nobody computes a
   * pitch twice, so changing the octave mid-hold simply keeps sounding.
   */
  const lift = useCallback(
    (id: string) => {
      const gone = book.end(id)
      if (live.current.hold && live.current.arp === 'off') {
        /* ⚠️ THE NOTE-OFF IS NOT REPORTED EITHER. The note has not stopped, so telling the
           recorder and the jam that it has would write a short note into a take that sounds
           long — the take and the room would disagree about the thing you just played. It is
           reported when the pedal comes up, which is when it actually ends. */
        pedal.hold(gone)
      } else {
        for (const v of gone) {
          /* ⚠️ a no-op while arpeggiating, because these voices were never started — `noteOff`
             returns early for an id the synth does not know. That is what lets one `lift` serve
             both branches instead of growing a mode of its own. */
          noteOff(v.voice)
          report(v.midi, false)
        }
      }
      if (live.current.arp !== 'off')
        arping.update(
          book.notes(),
          live.current.arp,
          live.current.bpm,
          gridNow(),
          live.current.swing ? 1 : 0,
        )
      show()
    },
    /* `arping` is one runner per mount, so this stays referentially stable */
    [book, report, show, arping, gridNow, pedal],
  )

  /**
   * Let go of everything — the panic paths, where no keyup is ever coming.
   *
   * ⚠️ IT REPORTS THE NOTE-OFFS, which the seven `stopLive(); setHeld([])` pairs it replaces did
   * not. Alt-tabbing mid-hold silenced your speakers and left the note open in the take being
   * recorded and open on the screen of everyone jamming with you. The book knows exactly what
   * was sounding, so saying so costs one loop.
   */
  const hush = useCallback(
    (mode: 'live' | 'all' = 'live') => {
      for (const v of book.clear()) report(v.midi, false)
      /* ⚠️ Panic has to reach the pedal or "make it stop" does not. These are `k:`/`p:` ids so
         `stopLive` would catch them anyway, but the recorder and the jam would never hear that
         they ended — and the book would still think they were ringing. */
      for (const v of pedal.release()) {
        noteOff(v.voice)
        report(v.midi, false)
      }
      /* ⚠️ `stopLive()` only kills `k:` and `p:` voices, so it cannot reach an `arp:` one —
         Panic would silence your hands and leave the arpeggio ringing. The runner hands over
         whatever is still sounding so it can be stopped by name. */
      for (const n of arping.stop()) {
        noteOff(n.voice)
        report(n.midi, false)
      }
      if (mode === 'all') allNotesOff()
      else stopLive()
      show()
    },
    /* `arping` and `pedal` are one per mount, so this stays referentially stable */
    [book, report, show, arping, pedal],
  )

  /**
   * Computer keyboard.
   *
   * ⚠️ `repeat` is ignored, or holding a key retriggers it forty times a second — which sounds
   * like a machine gun and steals every other voice. And the listener sits on window rather than
   * on a focused element so you can play while looking at the visualiser, but it bails out the
   * moment focus is in a text field, because otherwise typing your name plays a tune.
   */
  useEffect(() => {
    /**
     * ⚠️ "IS IT AN INPUT" WAS TOO BLUNT A QUESTION, and it cost you the keyboard.
     *
     * A range slider is an <input>, so nudging the volume left the keys dead until you clicked
     * the page again — the guard could not tell "somebody is typing words" from "somebody moved
     * a slider". The thing worth protecting against is TEXT ENTRY: typing your name should not
     * play a tune. A slider, a checkbox and a button take arrow keys and space, never letters,
     * so they can hold focus and let you keep playing.
     *
     * A <select> is listed because it does letter type-ahead of its own: pressing S while one is
     * focused jumps it to the next option starting with S, which is how choosing a key and then
     * playing changed the key underneath you.
     *
     * ⚠️ AND IT WAS UNDONE NINE DAYS LATER BY TWO `onKeyDown={(e) => e.stopPropagation()}`, one
     * on the layer volume and one on the octave slider. This listener is on `window`, and React
     * dispatches from the root container — so stopping propagation there means the event never
     * reaches window at all and the guard above never gets asked. Reported again in the same
     * words as the first time: "changing a layer volume makes you have to click the keys to use
     * your keyboard." Measured before the fix: with the octave slider focused, window saw 0 of
     * 2 keydowns; with nothing focused, 2 of 2. Neither slider needs the stop — a range takes
     * arrows, Home/End and PageUp/Down, none of which are letters and none of which are mapped.
     * If a control here ever does need to swallow a key, swallow THAT key, not all of them.
     */
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return false
      if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true
      if (t.tagName !== 'INPUT') return false
      const kind = (t as HTMLInputElement).type
      return !['range', 'checkbox', 'radio', 'button', 'submit', 'color'].includes(kind)
    }
    /**
     * ⚠️ SPACE STARTS AND STOPS THE LOOP, because that is what it does in every DAW anybody
     * here has used — asked for in those words, "if spacebar could always play/stop thats what
     * im use to from fl studio". It is free to take: space plays no note, so nothing is lost.
     *
     * ⚠️ EXCEPT ON A BUTTON, WHICH IS THE WHOLE CARE THIS NEEDS. Space is how a keyboard
     * presses a focused button, so a global binding would make the transport fire AND re-press
     * whatever you last clicked — pressing space after Keep song would keep it again. A link
     * has the same problem with Enter but not with space; a summary toggles on both. So those
     * three keep their key and the rest of the page gets the transport.
     */
    const spaceIsTheirs = (t: HTMLElement | null) =>
      !!t && (t.tagName === 'BUTTON' || t.tagName === 'SUMMARY' || t.tagName === 'A')

    const down = (e: KeyboardEvent) => {
      /**
       * ⚠️ CTRL+Z AND ITS REDOS, BEFORE THE MODIFIER RETURN BELOW and allowed to repeat, as undo
       * does everywhere. Not while typing — a field has its own undo — and not while the note
       * editor is open, whose own listener takes these keys for its notes (see PianoRoll).
       */
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing(e)) {
        const k = e.key.toLowerCase()
        const back = k === 'z' && !e.shiftKey
        const fwd = (k === 'z' && e.shiftKey) || k === 'y'
        if ((back || fwd) && !document.querySelector('.inst-roll-host')) {
          e.preventDefault()
          if (back) undo()
          else redo()
          return
        }
      }
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return
      if (e.key === ' ') {
        if (spaceIsTheirs(e.target as HTMLElement | null)) return
        e.preventDefault()
        /* ⚠️ loopState(), not the `loop` from render: this listener is bound once and would
           otherwise hold whichever `playing` was true when it was created, so space would
           start the loop forever and never stop it. The store's snapshot is always current. */
        if (loopState().playing) stopLoop()
        else startLoop()
        return
      }
      /**
       * ⚠️ THE OCTAVE AND THE PEDAL BELONG ON THE KEYBOARD, because the keyboard is how most
       * people play this. Everything else in the room grew a control and left the typing rows
       * able to do one thing — sound a note — so playing a line that crosses two octaves, or
       * letting a chord ring while you move your hands, meant reaching for the mouse in the
       * middle of it.
       *
       * `-` and `=` because they sit together, are not in KEY_MAP, and are the pair trackers
       * and DAWs have used for this for thirty years. The shifted `_` and `+` are accepted too,
       * so a caps-lock or a stray thumb does not make the control vanish. NOT the arrow keys:
       * this listener is on `window`, so capturing them would stop the page scrolling for
       * anybody driving the site from the keyboard — a real loss to avoid a small reach.
       */
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setOctave((o) => shiftOctave(o, -1))
        return
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setOctave((o) => shiftOctave(o, 1))
        return
      }
      /**
       * ⚠️ SHIFT IS A MOMENTARY PEDAL, AND IT MUST NOT UNLATCH THE BUTTON. Hold is a latch you
       * can leave on; Shift is a pedal you lean on — a real instrument has both and they do not
       * fight. So Shift only turns Hold on when it was off, and only turns it off again if
       * Shift is what turned it on. Without that, tapping Shift once while the button was
       * latched would silently switch the latch off.
       */
      if (e.key === 'Shift') {
        if (!live.current.hold) {
          shiftPedal.current = true
          setHold(true)
        }
        return
      }
      const off = KEY_MAP[e.key.toLowerCase()]
      if (off === undefined) return
      e.preventDefault()
      press('k:' + e.key.toLowerCase(), live.current.notesFor(live.current.noteAt(off)))
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        /* only if the pedal is the thing that put it down — see the note on the way in */
        if (shiftPedal.current) {
          shiftPedal.current = false
          setHold(false)
          for (const v of pedal.release()) {
            noteOff(v.voice)
            report(v.midi, false)
          }
        }
        return
      }
      const off = KEY_MAP[e.key.toLowerCase()]
      if (off === undefined) return
      lift('k:' + e.key.toLowerCase())
    }
    // a key still down when the window loses focus never gets its keyup — that is the classic
    // stuck note, and it hangs until you press the same key again
    const blur = () => hush()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
    /* all of them are referentially stable — `book`, `pedal` and `arping` are one object per
       mount and `report` has no deps — so this binds once, which is what the comments above
       about a listener capturing a stale `playing` are relying on */
  }, [press, lift, hush, pedal, report])

  // leaving the page must not leave a note ringing forever
  useEffect(
    () => () => {
      /* ⚠️ THE RUNNER FIRST, AND IT IS THE ONLY THING HERE WITH A TIMER IN IT. `closeSynth`
         silences the audio, which is not the same as stopping a `setInterval` that will go on
         committing notes to a context that has gone — the one leak this feature could have,
         and the reason the runner owns a `stop` at all. */
      arping.stop()
      stopLoop()
      closeSynth()
    },
    [arping],
  )

  /**
   * ⚠️ ONE TRUTH FOR "IS THERE A STAGE", because the layout has to agree with the content.
   * Hiding the visuals used to leave the column standing: the head with its Show button still sat
   * in column two, so the grid kept reserving thirty rem for it and the whole instrument stayed
   * shoved to the left of a wide empty gap. Hidden has to mean the room is one column again.
   */
  const visualsShown = showViz && !inCanvas && !vizFloating
  /**
   * ⚠️ ONE OCTAVE ON A PHONE, TWO ON A DESKTOP. At 375 the two-octave row is 1021px inside a
   * 325px window and a finger could not pan it — sixteen keys drawn and untouchable. Drawing
   * what fits is the half of the fix that needs no gesture at all: Major is eight keys and
   * 307px, Pentatonic is six. See keyboardSpan.ts for why it is degrees + 1 rather than
   * degrees, and the stylesheet for the panning half that Chromatic still needs.
   */
  const keys = Array.from({ length: keysToShow(degrees.length, narrowBoard) }, (_, i) => noteAt(i))

  return (
    <section
      className={
        'inst-wrap' + (inCanvas ? ' is-incanvas' : '') + (visualsShown ? ' has-visuals' : '')
      }
    >
      <AudioHealthStrip />
      {/**
       * ⚠️ THE KEYBOARD IS THE FIRST THING IN THE ROOM, because it is what the room is.
       *
       * It used to be last, under the visuals, the toolbar, the instrument and scale pickers,
       * the library, the takes, the transport, the beats, the layer list and the knobs — so the
       * page opened on its settings and you scrolled past all of them to reach the instrument.
       * Everything above it is something you do TO a sound; this is the sound.
       *
       * The scope sits directly underneath, so what you play and the shape of it are one glance
       * apart rather than at opposite ends of the page.
       */}
      {/**
       * ⚠️ Pointer events, not mouse events, and the capture is released immediately.
       *
       * Releasing capture is what lets a press SLIDE from one key to the next — a glissando —
       * because without it the first key keeps receiving every subsequent event and the others
       * never see a pointerenter. touch-action is none in the CSS for the same reason: on a
       * phone the browser would otherwise decide a drag across the keys is a scroll.
       */}
      {/**
       * ⚠️ ON THE KEYBOARD, WHICH IS WHERE IT WAS ASKED FOR AND WHERE I FIRST PUT IT WRONG.
       *
       * It went beside the note editor's key column: a vertical slider next to a grid of rows,
       * which is the pitch axis of the EDITOR. What was wanted was this — a way to run up and
       * down the actual keyboard you play, without pressing − and + and counting. The two look
       * alike described in a sentence and are not the same control at all.
       *
       * Horizontal, because these keys are, and it sits under them so the thing it moves is
       * directly above your hand. A drum kit repeats every octave, so it is pointless there.
       */}
      {inst !== 'drums' && (
        <input
          type="range"
          className="inst-keyslide no-print"
          /* the third place this range lived; now the same constants the buttons and the
             keyboard shortcuts use, so none of them can stop one step short of another */
          min={OCTAVE_LOW}
          max={OCTAVE_HIGH}
          step={1}
          value={octave}
          onChange={(e) => setOctave(Number(e.target.value))}
          aria-label="Slide up and down the keyboard"
          title={`Octave ${octave} — slide to reach higher or lower keys`}
        />
      )}
      <div
        className="inst-keys"
        data-kit={inst === 'drums' ? '1' : undefined}
        role="group"
        aria-label={inst === 'drums' ? 'Drum kit' : 'Keyboard'}
      >
        {keys.map((midi) => (
          <button
            key={midi}
            className={
              'inst-key' +
              // ⚠️ Black keys only on Chromatic. Under a scale the keys are degrees, not
              // semitones, so a "black" one would be a shorter key in an arbitrary place —
              // piano furniture on something that is no longer a piano.
              (scale === 'chromatic' && isBlack(midi) ? ' is-black' : '') +
              /**
               * ⚠️ `&& !held`, AND THAT IS A FIX RATHER THAN A TIDY-UP. `.inst-key.is-root` and
               * `.inst-key.is-held` are both two classes, so they tie on specificity and the
               * later one in the stylesheet wins — which is `.is-root`. Pressing the root of
               * any non-chromatic scale has therefore never shown the held fill at all; it kept
               * its faint root tint, measured at 0.18 alpha against the accent's 1.0.
               *
               * It went unnoticed for as long as every lit key looked the same. Chords made it
               * glaring in the other direction: the notes the chord ADDED render at 0.45, so
               * the key under your finger was the DIMMEST thing on the keyboard.
               *
               * Fixed here rather than in CSS because the two are genuinely exclusive — the
               * root tint means "home is here" and is for finding your place when you are not
               * playing it. Saying so in the markup beats a third rule at a higher specificity,
               * which is the ordering trick the `.is-theirs` comment next door warns against.
               */
              (scale !== 'chromatic' && midi % 12 === root && !held.includes(midi)
                ? ' is-root'
                : '') +
              (held.includes(midi) ? ' is-held' : '') +
              /**
               * ⚠️ ONLY WHERE NOTHING ELSE IS ALREADY SPEAKING, which is what makes this
               * additive rather than a fourth thing competing for the same keys. A finger beats
               * it, and so does the root tint — the root is nearly always a chord tone anyway,
               * so claiming it would repaint a landmark somebody navigates by to say something
               * they could already see. Exclusive in the markup for the reason the two comments
               * above give: `.is-root` and `.is-chord` would tie on specificity and the later
               * rule in the stylesheet would win, which is not a thing anybody should have to
               * know.
               */
              (chordTones.length &&
              !held.includes(midi) &&
              !(scale !== 'chromatic' && midi % 12 === root) &&
              chordTones.includes(((midi % 12) + 12) % 12)
                ? ' is-chord'
                : '') +
              /* ⚠️ A SOFTER FILL FOR A NOTE THE CHORD ADDED, so you can see which key your own
                 finger is on. Four keys lighting identically is what chords did to this row.
                 With Chord off every held note is a lead and this never applies, so a plain
                 keyboard looks exactly as it did. A finger beats a chord tone: a key that is
                 both is drawn as the one you are touching. */
              /* ⚠️ EXCLUSIVE IN THE MARKUP, not by CSS ordering — the same call the root tint
                 above makes. `.is-held.is-added` and `.is-held.is-now` are both three classes,
                 so whichever came later in the stylesheet would win, and which one that is is
                 not something anybody should have to know. */
              (nowNote === midi ? ' is-now' : '') +
              (held.includes(midi) && !lead.includes(midi) && nowNote !== midi ? ' is-added' : '') +
              (theirNotes.has(midi) ? ' is-theirs' : '')
            }
            style={
              theirNotes.has(midi)
                ? ({ ['--party-hue' as string]: theirNotes.get(midi) } as React.CSSProperties)
                : undefined
            }
            aria-label={inst === 'drums' ? drumName(midi) : noteLabel(midi, spell)}
            onPointerDown={(e) => {
              /**
               * ⚠️ SOUND FIRST, then let go of the pointer — and the release is wrapped because
               * it can throw.
               *
               * Releasing the implicit capture is what makes a glissando work: without it the
               * first key you touch keeps every subsequent move event and dragging across the
               * keyboard plays one note. But releasePointerCapture throws NotFoundError for a
               * pointer that was never captured, and it used to be the FIRST statement here — so
               * any case where the browser had not captured (and there are several: a
               * pointercancel that already released it, a synthetic event, some pen and
               * assistive input paths) threw before the note was played. The most important
               * interaction in the room was one exception away from silence, for the sake of a
               * convenience.
               */
              setOwned(e.pointerId, midi)
              try {
                e.currentTarget.releasePointerCapture(e.pointerId)
              } catch {
                /* it was never captured; the glissando just works differently for this pointer */
              }
            }}
            onPointerUp={(e) => setOwned(e.pointerId, null)}
            onPointerEnter={(e) => {
              if (e.buttons > 0) setOwned(e.pointerId, midi)
            }}
          >
            {/* ⚠️ Drums say WHICH DRUM, not which note. A twelve-piece kit laid out as
                C4/C#4/D4 is twelve unlabelled buttons — the note name is true and useless,
                because nobody is playing a kick in the key of C. */}
            <span className="inst-key-name">
              {inst === 'drums' ? drumName(midi) : noteLabel(midi, spell)}
            </span>
          </button>
        ))}
      </div>

      {/**
       * ⚠️ UNDER THE KEYS, where your eyes already are — Evan, 10 Nov 2026. It sat below the whole
       * song, so the name of the chord you were holding appeared a screen away from the hands
       * holding it.
       */}
      {/**
       * What you are holding, named.
       *
       * ⚠️ IT READS `held`, WHICH IS THE BOOK, so it names what is actually SOUNDING rather
       * than what the pickers would produce — a chord clipped at the top of the keyboard, two
       * fingers making something the chord picker never offered, and the note an arpeggio is
       * on are all the same question answered the same way.
       *
       * ⚠️ AND IT GOES QUIET RATHER THAN GUESSING. `nameChord` answers null for a handful of
       * keys that is not a shape worth naming, and a readout inventing something for every
       * cluster would be noise — wrong in a way nobody could check. Blank half the time is
       * honest; confident half the time is not.
       *
       * ⚠️ NOT ON THE DRUM KIT, where a pad is a sound and not a pitch. Naming a kick and a
       * snare "C and its fifth" is true of the MIDI and false about the room.
       */}
      {/**
       * ⚠️ THE LIVE REGION IS THE INNER SPAN NOW, AND THAT IS THE WHOLE REASON FOR THE SPLIT.
       * What you are holding changes when you press a key, so announcing it is answering
       * something you just did. The backing's chord changes once a bar for as long as the loop
       * runs — put that in an `aria-live` region and a screen reader narrates a metronome
       * forever. It is the same call the keyboard's dots made one commit ago, and reusing this
       * element would have silently undone it.
       *
       * The outer <p> keeps its reserved height either way, so the keyboard never jumps.
       */}
      {inst !== 'drums' && (
        <p className="muted inst-note inst-chord-name">
          <span aria-live="polite">{(held.length > 0 && nameChord(held, spell)) || ' '}</span>
          {/* only when your own hands are quiet — what you are playing always wins the line */}
          {held.length === 0 && backingChord && (
            <span className="inst-backing-chord">{backingChord} underneath</span>
          )}
        </p>
      )}

      {/**
       * ⚠️ WHAT YOUR HANDS NEED WHILE THEY ARE ON THE KEYS, DIRECTLY UNDER THEM. Octave, Volume,
       * Hold and Panic sat in a row below the whole song — measured with an arrangement loaded,
       * 1,150px under the keyboard at 1440×900 and 1,350px under it on a phone — so changing
       * octave or catching a chord with Hold meant scrolling away from the thing being played.
       * Evan's note asked for exactly this group. The row moved; nothing in it changed.
       */}
      <div className="inst-row inst-playbar">
        <button
          className="btn inst-pick-open"
          aria-expanded={picksOpen}
          onClick={() => setPicksOpen((v) => !v)}
          title="Choose an instrument"
        >
          <span aria-hidden>{INSTRUMENTS.find(([id]) => id === inst)?.[1]}</span>
          {INSTRUMENTS.find(([id]) => id === inst)?.[2] ?? 'Keys'}
          <span aria-hidden>{picksOpen ? '▴' : '▾'}</span>
        </button>

        <span className="muted inst-oct">
          Octave
          <button
            className="btn"
            onClick={() => setOctave((o) => shiftOctave(o, -1))}
            disabled={octave <= 1}
            aria-label="Octave down"
          >
            −
          </button>
          <strong>{octave}</strong>
          <button
            className="btn"
            onClick={() => setOctave((o) => shiftOctave(o, 1))}
            disabled={octave >= 6}
            aria-label="Octave up"
          >
            +
          </button>
        </span>

        <label className="appearance-slider">
          <span className="muted">Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={vol}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVol(v)
              setVolume('instrument', v)
            }}
          />
          <span className="appearance-slider-val">{Math.round(vol * 100)}%</span>
        </label>
        {/* ⚠️ says what is true rather than what to do: the light is the explanation for why
            typing sometimes plays and sometimes does not */}
        <span
          className={'inst-keylight' + (keysLive ? ' is-live' : '')}
          title={
            keysLive
              ? 'Your computer keyboard plays notes'
              : 'Typing is going into a control — click the page to play with the keys again'
          }
        >
          <span aria-hidden>⌨</span>
          <span className="muted">{keysLive ? 'keys play' : 'keys off'}</span>
        </span>

        {/**
         * A stuck note is the one failure every synth has, and hunting for the key that caused
         * it is miserable. One button, always there.
         *
         * ⚠️ It STOPS THE LOOP as well as silencing the voices. Panic used to leave the
         * transport running, so the loop immediately scheduled the next repetition and whatever
         * you were panicking about came straight back — you had to hit it, then find Stop, and
         * in between the thing was still playing. "Make it stop" has one meaning.
         */}
        {/**
         * The pedal every keyboard has and this one did not.
         *
         * ⚠️ TURNING IT OFF LETS GO OF WHAT IT WAS HOLDING, which is what a pedal does and is
         * the only safe answer anyway: notes ringing with no finger and no pedal would be
         * unreachable by anything except Panic.
         *
         * ⚠️ AND IT IS IGNORED WHILE AN ARPEGGIO RUNS. Arp notes end themselves — each is born
         * with its note-off scheduled — so there is nothing for a pedal to catch, and a pedal
         * that visibly does nothing is worse than one that is not offered. The title says so
         * rather than the button vanishing, which would make the setting hard to find again.
         */}
        <button
          className={'btn' + (hold ? ' is-on' : '')}
          aria-pressed={hold}
          disabled={arp !== 'off'}
          onClick={() => {
            if (hold)
              for (const v of pedal.release()) {
                noteOff(v.voice)
                report(v.midi, false)
              }
            setHold(!hold)
          }}
          title={
            arp !== 'off'
              ? 'An arpeggio ends its own notes, so Hold has nothing to catch'
              : hold
                ? 'Notes keep ringing after you let go — click to let them stop'
                : 'Keep notes ringing after you let go, like a piano pedal'
          }
        >
          🦶 Hold
          <Why>{arp !== 'off' ? 'arpeggio is on' : hold ? 'tap to let go' : 'lets notes ring'}</Why>
        </button>

        {/* ⚠️ SCALE, KEY AND CHORD BESIDE THE OTHER THINGS YOUR HANDS USE, not below the song —
            Evan, 10 Nov 2026. These three decide what every key you press plays. */}
        {/* What the keys mean. Chromatic is a piano; anything else turns the keyboard into scale
          degrees, so there is no wrong note left to press. */}
        <label className="inst-pick">
          <span className="muted">Scale</span>
          <select
            value={scale}
            onChange={(e) => {
              hush()
              setScale(e.target.value)
              e.target.blur()
            }}
          >
            {SCALES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {/* only when it does something — a key picker on Chromatic would be a control that
            visibly changes nothing */}
        {scale !== 'chromatic' && (
          <label className="inst-pick">
            <span className="muted">Key</span>
            <select
              value={root}
              onChange={(e) => {
                hush()
                setRoot(Number(e.target.value))
                /* ⚠️ hand the keyboard back: a focused select eats letters as type-ahead, so
                   staying here would change the key again the moment you played a note */
                e.target.blur()
              }}
            >
              {/* named in the scale's own convention — see keyName */}
              {NAMES.map((nm, i) => (
                <option key={nm} value={i}>
                  {keyName(degrees, i)}
                </option>
              ))}
            </select>
          </label>
        )}

        {/**
         * One key, a chord.
         *
         * ⚠️ NO `hush()` HERE, unlike its two neighbours, and the difference is the point. They
         * cut your notes off because the keys were about to mean something else; changing this
         * does not need to, because the book remembers what each press actually sounded and
         * releases that — so you can widen a chord you are already holding and the note you let
         * go of is the note you played.
         *
         * ⚠️ AND NOT HIDDEN ON THE DRUM KIT. It would be a control appearing and disappearing as
         * you browsed the instruments, and your choice would be silently forgotten; the kit
         * ignores it instead and the hint below says so.
         */}
        <label className="inst-pick">
          <span className="muted">Chord</span>
          <select
            value={chord}
            onChange={(e) => {
              setChord(e.target.value as ChordId)
              /* ⚠️ hand the keyboard back, for the reason the Key picker gives: a focused
                 select eats letters as type-ahead, so staying here would change the chord again
                 the moment you played a note */
              e.target.blur()
            }}
          >
            {CHORDS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button
          className="btn"
          onClick={() => {
            stopLoop()
            hush('all')
          }}
          title="Silence everything and stop the loop"
        >
          ⏹ Panic
        </button>

        {/**
         * ⚠️ THE REST OF THE SOUND, ONE PRESS AWAY — Evan, 10 Nov 2026: "keep common ones up front
         * and advanced ones tucked away". The arpeggio, how a chord arrives, the six effect sliders
         * and saved rigs were always on screen, 1,600px down on a desktop and 1,550 on a phone,
         * under the whole song. Tucked here they sit beside the sound they shape, and the choice
         * to open them is remembered.
         */}
        <button
          className={'btn' + (moreSound ? ' is-on' : ' btn-ghost')}
          aria-expanded={moreSound}
          aria-label="More sound"
          onClick={() => setMoreSound((v) => !v)}
          title="Arpeggio, effects and saved rigs"
        >
          {/* "More" alone on a phone, where the full word costs the bar a fifth line; the name
              a screen reader hears stays whole */}
          ⚙ More<span className="inst-more-word"> sound</span>{' '}
          <span aria-hidden>{moreSound ? '▴' : '▾'}</span>
        </button>
      </div>

      {/**
       * What the two pickers above actually chose, in a sentence.
       *
       * ⚠️ IT IS NOT IN THE OPTION LABELS, and that is a layout decision. A `<select>` is as
       * wide as its longest option and three of them share one row at 375px, so "Harmonic
       * minor — dramatic and a little eastern" in the list is horizontal scroll on a phone.
       * Here it wraps.
       *
       * ⚠️ AND IT IS ONE PARAGRAPH, NOT TWO. Two muted lines stacked under a row of pickers is
       * the "don't make the UI noisy by default" rule broken by exactly the feature that was
       * supposed to make things clearer. Silent on Chromatic + One note, which is where an
       * untouched room starts and needs no explaining.
       */}
      {(scale !== 'chromatic' || chord !== 'off') && (
        <p className="muted inst-note inst-scale-say">
          {[
            scale !== 'chromatic' ? SCALES.find(([id]) => id === scale)?.[3] : null,
            chord === 'off'
              ? null
              : inst === 'drums'
                ? 'The drum kit plays one sound per pad, so chords come back when you pick an instrument'
                : CHORDS.find(([id]) => id === chord)?.[2],
            /* ⚠️ `usesScale`, not `chord !== 'off'`. Fifth is a power chord — no third — so
               telling somebody it comes out major on Chromatic is the opposite of what they can
               hear. Octave is the same. Only the shapes that step through the scale care. */
            scale === 'chromatic' && usesScale(chord)
              ? 'On Chromatic every chord is major, so pick a scale to hear it follow the key'
              : null,
            /* only when it is doing something — "Every note at once" under a chord that arrives
               all at once is a sentence describing the absence of a feature */
            arp !== 'off' && inst !== 'drums' ? ARPS.find(([id]) => id === arp)?.[2] : null,
            arp !== 'off' && swing && inst !== 'drums' ? 'Swung, so the off-beats land late' : null,
            chord !== 'off' && arp === 'off' && strum !== 'off' && inst !== 'drums'
              ? STRUMS.find(([id]) => id === strum)?.[2]
              : null,
          ]
            .filter(Boolean)
            /* ⚠️ TWO SENTENCES, so both start with a capital. Joining them as one clause reads
               "spare and still. three notes from the scale you chose" — which is what the first
               version did, and it looks like a rendering bug rather than a style choice. */
            .join('. ') + '.'}
        </p>
      )}

      {/**
       * ⚠️ A MENU ON A PHONE, exactly like the paint room's brushes and for the same measurement:
       * two dozen instruments in a four-wide grid is six rows and about seven hundred pixels of
       * picker, so the keys are the only thing on screen and everything else — the knobs, the
       * looper, the recorder — is below a wall you have to scroll past to reach.
       *
       * ⚠️ AND NOW A MENU ON A DESKTOP TOO, which this note used to rule out: "the grid is
       * untouched on a desktop, where it fits and browsing it is the point". It fits, at 323px —
       * and those 323px were what kept ▶ Play below the fold at 1440×900 with the keys on
       * screen, the one thing the room's grouping exists to avoid. The button names the sound
       * you have, so the choice is never hidden, and on a desktop the menu stays open while you
       * try sounds, which keeps browsing the point. One list either way: two renderings would
       * drift, and the second would be the one nobody tested.
       *
       * ⚠️ AND ON A DESKTOP IT NOW STARTS OPEN — Evan's call, 9 Nov 2026, made knowing the cost
       * above. Measured on the dev server: at 1440×900 ▶ Play sits at 998–1036px with the grid
       * open and 711–750 closed; at 1920×1080 it ends at 1109. One press of the menu button
       * gives the fold back. A phone still starts closed (375, touch: `display: none`).
       */}
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

      {call.inCall && (
        <div className="inst-row inst-jam">
          <button
            className={'btn' + (jamming.on ? ' is-on' : '')}
            aria-pressed={jamming.on}
            onClick={() => jam.setOn(!jamming.on)}
            title={
              jamming.on
                ? 'Stop sending your notes to the call'
                : 'Play together — everyone in the call hears what you play'
            }
          >
            {jamming.on ? '🎶 Jamming' : '🎶 Jam together'}
          </button>
          {jamming.on &&
            (Object.values(jamming.players).length ? (
              <span className="inst-jam-who">
                {Object.values(jamming.players).map((p) => (
                  <span
                    key={p.id}
                    className="inst-jam-player"
                    style={{ ['--party-hue' as string]: hueFor(p.id) }}
                  >
                    {p.name}
                  </span>
                ))}
              </span>
            ) : (
              <span className="muted">
                Nobody else is playing yet — they need to press Jam too.
              </span>
            ))}
        </div>
      )}

      <SongControls
        loop={loop}
        live={live}
        editing={editing}
        setEditing={setEditing}
        beatsOpen={beatsOpen}
        setBeatsOpen={setBeatsOpen}
        libOpen={libOpen}
        setLibOpen={setLibOpen}
        capMsg={capMsg}
        setCapMsg={setCapMsg}
        keep={keep}
      />
      {beatsOpen && (
        <BackingPanel loop={loop} scale={scale} root={root} degrees={degrees} backing={backing} />
      )}
      <LayerList
        layers={loop.layers}
        replacing={loop.replacing}
        editing={editing}
        setEditing={setEditing}
        jamNames={jamNames}
        onKeep={(id) => keep('loop', id)}
      />

      {/* ⚠️ RECORDING SITS WITH THE SONG IT IS RECORDED INTO. 🎤 Record a take was below the
          sound knobs, the octave row and the scale row — 1,600px down at 1440×900 — while
          everything it is placed into (the transport, the layers) was 500px above it. */}
      {/* ⚠️ THE SINGING PROTOTYPE — phase 0 of docs/2026-11-10-sung-lyrics-plan.md, on a draft for
          Evan to hear. Beside the takes because it, too, is a voice over the song. */}
      <SingPanel
        layers={loop.layers}
        degrees={scale === 'chromatic' ? MAJOR_DEGREES : degrees}
        root={scale === 'chromatic' ? 0 : root}
      />
      <TakesPanel />

      {/* ⚠️ THREE JOBS, THREE HOMES, AND THEY USED TO BE INTERLEAVED. Reported as the room being
          "a little fractured and almost more difficult to smoothly work on making a song", and
          the measurement was the complaint: with a song loaded the keyboard sat at y=263 and
          ▶ Play at y=1500, 1,237px apart in a 900px window, so the two halves of "play a part,
          then listen back" could not be on screen together. Between them were two help
          paragraphs, the scope, the visuals panel, the octave and scale rows and the takes
          panel — none of which you touch while arranging.

          So the order is now what you do, in the order you do it: PLAY (the keys and the
          instrument they play), then THE SONG (transport, library, ruler, layers), then
          everything below here — the explanations and the visuals. Nothing was deleted and no
          control changed; they are grouped.

          ⚠️ REGROUPED AGAIN 10 NOV 2026 (Evan: "group related controls, keep common ones up
          front and advanced ones tucked away"), and the rule above was kept rather than broken.
          The playing detail and sound shaping that lived down here are now part of PLAY: Scale,
          Key and Chord joined the sound bar under the keys, and the arpeggio, the effect
          sliders and rigs went behind ⚙ More sound beside it. What paid for that is the
          instrument menu showing one family at a time — one row instead of five — so at
          1440×900 with the menu open ▶ Play moved UP, 998px → 872px, while Scale came up from
          1,712px to 662px. On a phone Scale came up from 1,844px to 674px and ▶ Play went down
          737px → 816px, which is the cost, named.

          ⚠️ MOVED IN THE MARKUP RATHER THAN WITH `order`, deliberately. The phone breakpoint
          already reorders with two `order` properties, and the note there is right that one
          property beats a second markup path — but that was TWO properties pulling two
          elements up. Sequencing a dozen children by hand would be a second source of truth
          for reading order, and the next child added would land in the middle of it at 0.

          ⚠️ AND THE THEATRE MOVED WITH THEM, WHICH IS FREE. Above the breakpoint it is pinned
          to `grid-column: 2` with `grid-row: 1 / span 200`, so where it sits among its
          siblings has never decided where it draws — see .inst-wrap.has-visuals. Below the
          breakpoint the wrap is a plain flex column, and there it was 593px of visuals
          standing between the picker and ▶ Play. */}

      {/* ⚠️ OUTSIDE THE LIBRARY TOGGLE, not inside it. A take is a thing you kept, so the
          library is where it belongs — but the library row collapses, and a recording you can
          only reach by opening a panel is one nobody finds. It is not in the layer list either,
          on purpose: a take is not a Layer. See TakesPanel. */}

      <p className="muted inst-note">
        {/* ⚠️ A TOUCH SCREEN HAS NO Z, NO SHIFT AND NO MOUSE — item 5 of the 11 Nov 2026 flow
            map. This sentence explained the typing rows and two shortcuts to everybody, so on the
            device most people play this on, the help was about a keyboard they do not have. */}
        {touch ? (
          <>
            Tap the keys, or drag across them to slide
            {scale === 'chromatic' ? '' : ' — every key is in the scale'}.{' '}
          </>
        ) : (
          <>
            Play with the mouse, or four rows of your keyboard — <kbd>Z</kbd> and <kbd>Q</kbd> are
            two octaves of white keys, <kbd>S</kbd> and the number row are the black ones
            {scale === 'chromatic' ? '' : ', and every key is in the scale'}. Drag across the keys
            to slide.{' '}
            {/* ⚠️ A SHORTCUT NOBODY IS TOLD ABOUT IS A SHORTCUT NOBODY HAS. These two are the only
                way to change octave or sustain without reaching for the mouse, and the keyboard is
                how most people play this — so the sentence goes next to the one that already
                explains the typing rows, not into a title attribute that a phone cannot show. */}
            <kbd>−</kbd> and <kbd>=</kbd> move an octave, and holding <kbd>Shift</kbd> lets the
            notes ring.{' '}
          </>
        )}
        {jamming.on
          ? 'While Jam is on, the notes you play are sent to everyone in the call — nothing else is.'
          : 'Nothing is recorded or sent anywhere.'}
      </p>
      {/* ⚠️ ONLY WHEN THE ROOM'S OWN VISUALS ARE NOT SHOWING. This predates the theatre below,
          and told everybody to go to another tab for what was already on the screen; it still
          helps whoever hid them, popped them out or is on the canvas. */}
      {!visualsShown && (
        <p className="muted inst-note">
          Open the <strong>🎚️ Visualiser</strong> and pick <strong>Instrument</strong> to watch
          yourself play.
        </p>
      )}

      {/* ⚠️ Here rather than behind Canvas mode. Seeing what you play used to mean knowing the
          account menu hides a Canvas toggle, turning it on, and opening the visualiser in a
          second window — three steps and a discovery problem, for the most obvious pairing on
          the site. This is not the visualiser and does not try to be: it answers "what does this
          patch actually do", which the decorative modes never could. */}
      {/* ⚠️ THE PAIR, not one or the other. The scope answers "what is this patch doing";
          the visual beside it is the reason people open the visualiser at all. Both want the same
          sound and neither answers the other's question, so they sit side by side rather than
          behind a toggle — and neither needs Canvas mode, which is what made watching your own
          playing a three-step discovery problem in the first place. */}
      <div className="inst-watch">
        <InstrumentScope />
      </div>
      {/* ⚠️ HIDDEN MEANS HIDDEN, INCLUDING ITS OWN HEADING. Switching the visuals off still
          left a full row reading "Visuals / ⧉ Pop out / Show" — three controls and a title
          standing where the thing you just dismissed used to be. Turning something off should
          give the space back, or the switch does not do what it says. Collapsed it is one small
          button; the pop-out moves into the panel it belongs to, which is where it is useful. */}
      <section className={'inst-theatre' + (visualsShown ? '' : ' is-shut')}>
        <div className="inst-theatre-head">
          {visualsShown && <span className="inst-theatre-title">Visuals</span>}
          {(inCanvas || vizFloating) && (
            <span className="muted inst-theatre-note">
              {vizFloating
                ? 'Floating over the page — drag it anywhere.'
                : 'Open as its own window on the canvas.'}
            </span>
          )}
          {/* ⚠️ THE SAME CHOICE THE VISUALISER PAGE OFFERS, offered where you actually want
              it. Popping it out from here means it follows you off this page, which is the point
              of the floating panel — and having to walk to the Visualiser tab to get that is the
              same discovery problem the pop-out was built to end. */}
          {!inCanvas && !vizFloating && visualsShown && (
            <button
              type="button"
              className="btn btn-ghost inst-theatre-toggle"
              onClick={() => vizFloat.open()}
              title="Float it over the page, so it follows you off this one"
            >
              ⧉ Pop out
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost inst-theatre-toggle"
            hidden={inCanvas || vizFloating}
            aria-expanded={showViz}
            onClick={() => {
              setShowViz((v) => {
                try {
                  localStorage.setItem(SHOW_VIZ_KEY, v ? '0' : '1')
                } catch {
                  /* private window */
                }
                return !v
              })
            }}
          >
            {showViz ? 'Hide' : '▸ Visuals'}
          </button>
        </div>
        {visualsShown && (
          <div className="inst-theatre-stage">
            <Suspense fallback={<div className="muted inst-theatre-wait">Loading visuals…</div>}>
              <EmbeddedVisualizer embedded />
            </Suspense>
          </div>
        )}
      </section>
      {!call.inCall && (
        <AlsoTogether id="instrument">
          Everyone in a call hears what you play, on one shared metronome.
        </AlsoTogether>
      )}

      {/**
       * The note editor — AT THE END OF THE ROOM, not inside the layer list.
       *
       * ⚠️ IT SAID "BELOW THE KEYBOARD" AND THE KEYBOARD HAS MOVED TO THE TOP. Still true, and
       * now trivially so: everything is below the keyboard. The reason stands on its own and is
       * the half worth keeping — a piano roll is five hundred pixels, and as an <li> among the
       * layers, every layer you opened pushed the knobs, the keys and everything else down the
       * page by the height of a grid. You pressed one thing and the room moved. Reported as
       * "opening or closing a layer shifts the entire page down".
       *
       * ⚠️ AND TWO SCROLL TRICKS FAILED BEFORE THIS. Pinning the pressed row and scrolling by
       * however far it moved fixes nothing, because the row does NOT move — it is everything
       * below that does — and it measured as a 498px correction for a shift of zero. Scrolling
       * the editor into view instead pushed the row you had just pressed off the top, leaving a
       * grid of notes with nothing naming it. Both were attempts to hide a layout problem with
       * scrolling, and the layout was the thing to change: down here, opening a layer moves
       * nothing at all. The page simply gets longer at the end.
       */}
      {editing &&
        (() => {
          const l = loop.layers.find((x) => x.id === editing)
          if (!l) return null
          return (
            <div className="inst-roll-host">
              <PianoRoll
                layer={l}
                bpm={loop.bpm}
                quantize={loop.quantize}
                position={loop.position}
                loopLen={loopLength()}
                held={held}
                onClose={() => setEditing(null)}
              />
            </div>
          )
        })()}
      {/* ⚠️ The room needs its own, like Circuit and Ratings: showToast has no host of its
          own, so a message sent from here — a take that would not fit — went nowhere at all. */}
      <Toast />
    </section>
  )
}
