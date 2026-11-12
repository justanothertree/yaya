import { BASS_VOICES, INSTRUMENTS, type InstrumentId } from '../audio/synth'
import { MAJOR_DEGREES } from '../audio/scales'
import {
  DRUM_FILL,
  DRUM_PATTERNS,
  drumGenres,
  genreShown,
  patternEvents,
} from '../audio/drumPatterns'
import {
  CHORD_PATTERNS,
  leadBackStep,
  leadsBack,
  BASS_STYLES,
  CHORD_STYLES,
} from '../audio/chordPatterns'
import {
  loopState,
  loopLength,
  addPatternLayer,
  MAX_LAYERS,
  beatPatternOf,
  bassPatternOf,
  fillPatternOf,
  chordPatternOf,
  setLayerInstrument,
  setLayerPlan,
  startLoop,
} from '../audio/looper'
import { STARTERS, starterNow } from '../audio/starters'
import { BASS_PRESETS, presetOf } from '../audio/bassPresets'
import { MutedRow, OffScaleRow, Why } from './rowParts'
import { ownParts, styleOfBass, styleOfChord, voicingOf } from './backing'
import { useBacking } from './useBacking'

/**
 * The beat picker.
 *
 * ⚠️ GROUPED BY GENRE AND NAMED BY FEEL, not by tempo or time signature. Somebody who does
 * not play drums cannot choose between "16th hats at 95bpm" and "shuffled 8ths"; they can
 * absolutely choose between Reggae and Metal. The grouping is derived from the patterns
 * themselves so adding one never means editing a second list.
 */
/**
 * Chords to start from, beside the beats, for the reason drumPatterns' header gives:
 * "somebody who does not play an instrument needs a bar of something in front of them".
 * Beats answered that for rhythm; this answers it for harmony, which is the half that
 * makes scale lock worth having — every key is a right note, and now there is something
 * underneath for those right notes to be right ABOUT.
 *
 * ⚠️ IT IS BUILT FROM THE ROOM'S KEY AND SCALE AT THE MOMENT YOU DROP IT, so the
 * progression and the notes you then play are in the same world without anybody being
 * asked a question. Chromatic has no degrees to build on, so it borrows the major ones
 * exactly as the Chord picker does.
 *
 * ⚠️ AND RE-LAID WHEN THE KEY CHANGES — Evan's call, 9 Nov 2026. What lands is an ordinary
 * layer of notes, which is the whole point of these being takes rather than a chord track,
 * so for two months moving the Key picker re-tuned the keyboard and left the backing where
 * it was (measured: a progression dropped in C still read C–G–Am–F after the key went to
 * D). It was left as a question because the layer is editable and re-voicing could
 * silently overwrite what somebody changed in the roll — the shape CLAUDE.md calls "a save
 * that writes every column is a delete for the ones the caller forgot". The answer keeps
 * both: an unedited backing is laid again in the new key, an edited one moves by the same
 * interval, and on a change of scale — which cannot be done to notes moved by hand — keeps
 * its old scale and says so.
 * See the effect beside `layChords`, and `revoice`.
 */
/**
 * The Beats & chords panel: Styles, Chords, Played as, Bass, Beat and Fill — moved out of
 * InstrumentRoom.tsx unchanged on 11 Nov 2026.
 *
 * ⚠️ IT DRAWS THE BACKING AND DOES NOT OWN IT. The picks and the calls that lay a backing live in
 * useBacking, which the room calls whether or not this panel is open: a pick made before closing
 * the panel is still the pick when it opens again, and a change of key must re-voice the backing
 * even while nobody is looking at it.
 */
export function BackingPanel({
  loop,
  scale,
  root,
  degrees,
  backing,
}: {
  loop: ReturnType<typeof loopState>
  scale: string
  root: number
  degrees: readonly number[]
  backing: ReturnType<typeof useBacking>
}) {
  const {
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
  } = backing
  return (
    <div className="inst-beats card">
      {/**
       * ⚠️ FIRST, BECAUSE IT IS THE WHOLE PANEL IN ONE PRESS — Evan, 10 Nov 2026: "one-press
       * genre starters". The rows below are the same choices one at a time; a style makes them
       * all and the rows then show what it made, so a starter is somewhere to begin rather
       * than a mode you are stuck in. Pressed only while every part still matches it.
       */}
      {(() => {
        const beatNow = loop.layers.map((l) => beatPatternOf(l)).find((x) => x) ?? null
        const chordLayer = loop.layers.find((l) => chordPatternOf(l) !== null) ?? null
        const bassLayer = loop.layers.find((l) => bassPatternOf(l) !== null) ?? null
        const now = starterNow({
          beat: beatNow,
          chords: chordLayer ? chordPatternOf(chordLayer) : null,
          chordStyle: chordLayer ? styleOfChord(chordLayer) : null,
          bass: bassLayer ? styleOfBass(bassLayer) : null,
        })
        /* a starter can need three new rows; say so rather than lay two of them */
        const needs = [!beatNow, !chordLayer, !bassLayer].filter(Boolean).length
        const full = loop.layers.length + needs > MAX_LAYERS
        const keepsTempo = ownParts(loop.layers)
        return (
          <div className="inst-beats-row">
            <span className="muted inst-beats-genre">Styles</span>
            {STARTERS.map((s) => (
              <button
                key={s.id}
                className={'btn' + (now?.id === s.id ? '' : ' btn-ghost')}
                aria-pressed={now?.id === s.id}
                disabled={full}
                onClick={() => applyStarter(s)}
                title={`${s.name} — ${s.hint}${keepsTempo ? ', at your tempo' : `, at ${s.bpm} bpm`}`}
              >
                {s.name}
              </button>
            ))}
            {full && <span className="muted inst-beats-why">no room for three layers</span>}
          </div>
        )
      })()}
      <div className="inst-beats-row">
        <span className="muted inst-beats-genre">Chords</span>
        {CHORD_PATTERNS.map((p) => {
          const on = loop.layers.some((l) => chordPatternOf(l) === p.id)
          return (
            <button
              key={p.id}
              className={'btn' + (on ? '' : ' btn-ghost')}
              aria-pressed={on}
              onClick={() => {
                /* lays the bass with it when there is one — see layChords */
                if (!layChords(p)) return
                if (!loop.playing) startLoop()
              }}
              disabled={
                loop.layers.length >= MAX_LAYERS &&
                !loop.layers.some((l) => chordPatternOf(l) !== null)
              }
              title={`${p.name} — ${p.hint}`}
            >
              {p.name}
            </button>
          )
        })}
        {/**
         * ⚠️ IN THE CHORDS ROW, NOT A ROW OF ITS OWN. It is a property OF the progression —
         * what its last bar does — and a room that already carries thirty-odd controls does
         * not need a fourth line to say one word. The patterns and this sit together
         * because you choose them in one breath.
         *
         * ⚠️ AND IT REBUILDS WHAT IS ALREADY DOWN. A toggle that only affected the NEXT
         * progression you picked would be a setting that silently disagrees with what you
         * are hearing — the shape this room has already been bitten by twice. Pressing it
         * re-lays the loaded progression, and `layChords` brings the bass with it.
         */}
        {(() => {
          const live = loop.layers.map((l) => chordPatternOf(l)).find((x) => x) ?? null
          const p = CHORD_PATTERNS.find((x) => x.id === live) ?? null
          /* null means this progression already ends on its lead-back — see leadBackStep */
          const adds = p
            ? leadBackStep(p, scale === 'chromatic' ? MAJOR_DEGREES.length : degrees.length)
            : null
          const pointless = !!p && adds === null
          /**
           * ⚠️ WHAT THE LAYER HAS, NOT WHAT THE SETTING REMEMBERS, whenever there IS a
           * layer. The first version showed the preference, which reads correctly until a
           * song is loaded: open one built with a turnaround while the preference is off
           * and this said "no lead-back" an inch from a Four chords button correctly
           * showing pressed, about a pad whose roll plainly ended on G. Measured — 15
           * notes, ending G3 B3 D4, toggle reading false.
           *
           * The chord buttons beside it have always answered "what is loaded". Two
           * controls in one row cannot mean two different things.
           */
          const loaded = loop.layers.find((l) => chordPatternOf(l) !== null) ?? null
          const shown = p && loaded ? leadsBack(loaded.events, p, loaded.len) : leadBack
          return (
            <button
              className={'btn' + (shown ? '' : ' btn-ghost')}
              aria-pressed={shown}
              disabled={pointless}
              onClick={() => {
                /* toggling what you can SEE — with a song loaded that is the layer's
                   state, not whatever this browser last remembered */
                const next = !shown
                setLeadBack(next)
                if (p) layChords(p, next)
              }}
              title={
                pointless
                  ? `${p.name} already ends on the chord that leans home — there is nothing to add`
                  : 'End the last bar on the chord that leans back to the top'
              }
            >
              ↩ Lead back
              <Why>{pointless ? 'already ends there' : 'last bar leads home'}</Why>
            </button>
          )
        })()}
        <MutedRow layer={loop.layers.find((l) => chordPatternOf(l) !== null)} />
        <OffScaleRow
          layer={loop.layers.find((l) => chordPatternOf(l) !== null)}
          voicing={scale === 'chromatic' ? null : voicingOf(scale, root)}
        />
        {/**
         * ⚠️ A PROGRESSION IS NOT RE-LAID WHEN THE LOOP SHRINKS — Evan's call, 9 Nov 2026 — so
         * say when the loop is cutting it. It was laid for the loop's length when it was
         * picked; shorten the loop and the bars past the end, lead-back included, simply stop
         * being heard while every button here still reads pressed. Picking it again lays it
         * at the length the loop is now, which is the re-lay, on purpose. Growing the loop
         * repeats the progression and needs no word.
         */}
        {(() => {
          const loaded = loop.layers.find((l) => chordPatternOf(l) !== null)
          /* a hair of slack: len and the loop are both seconds derived from the same tempo */
          return loaded && loaded.len > loopLength() + 0.001 ? (
            <span className="muted inst-beats-why">cut short — pick it again to fit</span>
          ) : null
        })()}
      </div>
      {/**
       * ⚠️ HOW THE CHORDS ARE PLAYED, BESIDE WHICH ONES — the choice the Beat row below has
       * always offered and the backing never did. Picking one re-lays what is loaded in that
       * style; with nothing loaded it is remembered for the next progression you pick.
       */}
      <div className="inst-beats-row">
        <span className="muted inst-beats-genre">Played as</span>
        {(() => {
          const loaded = loop.layers.find((l) => chordPatternOf(l) !== null) ?? null
          const p = loaded ? CHORD_PATTERNS.find((x) => x.id === chordPatternOf(loaded)) : null
          const shown = loaded ? styleOfChord(loaded) : chordStylePick
          return CHORD_STYLES.map((st) => (
            <button
              key={st.id}
              className={'btn' + (shown === st.id ? '' : ' btn-ghost')}
              aria-pressed={shown === st.id}
              onClick={() => {
                setChordStylePick(st.id)
                if (!p || !loaded) return
                layChords(p, leadsBack(loaded.events, p, loaded.len), st.id)
                if (!loop.playing) startLoop()
              }}
              title={st.hint}
            >
              {st.name}
            </button>
          ))
        })()}
      </div>
      {/**
       * ⚠️ ONE BUTTON THAT FOLLOWS, NOT A SECOND PICKER. A bassline has to play the same
       * progression as the pad above it — a bass on Fifties under chords on Wistful is a
       * backing track at war with itself, and nothing on screen would explain why it
       * sounded wrong. So this reads whichever progression is loaded rather than offering
       * a choice that could disagree, and it has nothing to follow until there is one.
       */}
      <div className="inst-beats-row">
        <span className="muted inst-beats-genre">Bass</span>
        {(() => {
          const live = loop.layers.map((l) => chordPatternOf(l)).find((x) => x) ?? null
          const p = CHORD_PATTERNS.find((x) => x.id === live)
          const bass = loop.layers.find((l) => bassPatternOf(l) !== null) ?? null
          const chords = loop.layers.find((l) => chordPatternOf(l) !== null) ?? null
          const full = loop.layers.length >= MAX_LAYERS && !bass
          const shown = bass ? styleOfBass(bass) : null
          /**
           * ⚠️ A PRESET IS THE LINE AND THE VOICE TOGETHER — Evan, 10 Nov 2026: "bass presets".
           * It sets the two controls beside it rather than being a third thing, so what it
           * picks stays editable right here, and it READS them: a bass whose line and voice
           * match a preset shows that preset, and changing either one shows "No preset". With no
           * bass loaded it shows the pair that will be laid next, the way Sound does.
           */
          const presetNow = bass
            ? presetOf(styleOfBass(bass), bass.instrument)
            : presetOf(bassStylePick, bassSoundPick)
          return (
            <>
              <label className="inst-pick">
                <span className="muted">Preset</span>
                <select
                  value={presetNow?.id ?? ''}
                  disabled={full}
                  onChange={(e) => {
                    const pr = BASS_PRESETS.find((x) => x.id === e.target.value)
                    e.target.blur()
                    if (!pr) return
                    setBassStylePick(pr.style)
                    setBassSoundPick(pr.voice)
                    if (!p) return
                    const lead = chords ? leadsBack(chords.events, p, chords.len) : leadBack
                    const id = layBass(p, lead, pr.style)
                    if (!id) return
                    /* a new row is laid on the voice picked BEFORE this press — set it now */
                    setLayerInstrument(id, pr.voice)
                    if (!loop.playing) startLoop()
                  }}
                >
                  <option value="">{bass ? 'No preset' : 'Choose one'}</option>
                  {BASS_PRESETS.map((pr) => (
                    <option key={pr.id} value={pr.id} title={pr.hint}>
                      {`${pr.name} · ${INSTRUMENTS.find(([x]) => x === pr.voice)?.[2] ?? pr.voice}`}
                    </option>
                  ))}
                </select>
              </label>
              {BASS_STYLES.map((st) => (
                <button
                  key={st.id}
                  className={'btn' + (shown === st.id ? '' : ' btn-ghost')}
                  aria-pressed={shown === st.id}
                  disabled={!p || full}
                  onClick={() => {
                    if (!p) return
                    setBassStylePick(st.id)
                    /* the lead-back the chords HAVE, so the bass turns when they do */
                    const lead = chords ? leadsBack(chords.events, p, chords.len) : leadBack
                    if (!layBass(p, lead, st.id)) return
                    if (!loop.playing) startLoop()
                  }}
                  title={p ? `${st.name} — ${st.hint}, under ${p.name}` : st.hint}
                >
                  {st.name}
                </button>
              ))}
              {/* ⚠️ ONE REASON FOR THE ROW, not one per button — four disabled buttons each
                  saying "pick chords first" is the clutter the captions were meant to avoid */}
              {(!p || full) && (
                <span className="muted inst-beats-why">
                  {!p ? 'follows the chords — pick some first' : 'no layer free'}
                </span>
              )}
              {/**
               * ⚠️ THE BASS'S VOICE, IN THE BASS ROW — Evan, 10 Nov 2026: "several distinct
               * bass voices … usable from the backing". The layer's own sound menu could
               * always change it, among every instrument; this offers only the basses
               * (BASS_VOICES — ten since Pick, Fretless and Acid), where a bassline is chosen. It changes the loaded bass at once, and
               * with none loaded it is remembered for the next one — the same rule the
               * Played as row has. A sound the layer was given that is not a bass is shown
               * rather than silently relabelled.
               */}
              {(() => {
                const shownSound = bass ? bass.instrument : bassSoundPick
                const voices = BASS_VOICES.includes(shownSound)
                  ? BASS_VOICES
                  : [shownSound, ...BASS_VOICES]
                return (
                  <label className="inst-pick">
                    <span className="muted">Sound</span>
                    <select
                      value={shownSound}
                      onChange={(e) => {
                        const v = e.target.value as InstrumentId
                        setBassSoundPick(v)
                        if (bass) setLayerInstrument(bass.id, v)
                        e.target.blur()
                      }}
                    >
                      {voices.map((id) => (
                        <option key={id} value={id}>
                          {INSTRUMENTS.find(([x]) => x === id)?.[2] ?? id}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })()}
              <MutedRow layer={bass ?? undefined} />
              <OffScaleRow
                layer={bass ?? undefined}
                voicing={scale === 'chromatic' ? null : voicingOf(scale, root)}
              />
            </>
          )
        })()}
      </div>
      {/**
       * ⚠️ ONE BEAT ROW, NOT ONE PER GENRE — Evan, 10 Nov 2026: "an easier, cleaner UI for all
       * the controls". There were ten rows here, Rock to Metal, and every one of them drove
       * the SAME slot: a beat from any row swaps the beat from every other. So ten labels and
       * nineteen buttons, the longest stretch of the panel, said less than one row does — a
       * genre to browse and that genre's beats. It shows the genre of the beat you are hearing,
       * so opening the panel still lands on it. See genreShown.
       */}
      {(() => {
        const loadedBeat = loop.layers.map((l) => beatPatternOf(l)).find((x) => x) ?? null
        const genre = genreShown(loadedBeat, beatGenrePick)
        return (
          <div className="inst-beats-row">
            <span className="muted inst-beats-genre">Beat</span>
            <label className="inst-pick">
              <span className="muted">Genre</span>
              <select
                value={genre}
                onChange={(e) => {
                  setBeatGenrePick({ forBeat: loadedBeat, genre: e.target.value })
                  e.target.blur()
                }}
              >
                {drumGenres().map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            {DRUM_PATTERNS.filter((p) => p.genre === genre).map((p) => (
              <button
                key={p.id}
                className={
                  'btn' + (loop.layers.some((l) => beatPatternOf(l) === p.id) ? '' : ' btn-ghost')
                }
                aria-pressed={loop.layers.some((l) => beatPatternOf(l) === p.id)}
                onClick={() => {
                  const { events, len } = patternEvents(p, loop.bpm)
                  if (!addPatternLayer(events, len, p.id)) return
                  if (!loop.playing) startLoop()
                }}
                disabled={
                  loop.layers.length >= MAX_LAYERS &&
                  !loop.layers.some((l) => beatPatternOf(l) !== null)
                }
                title={`${p.name} — ${Object.keys(p.grid).join(', ')}`}
              >
                {p.name}
              </button>
            ))}
            <MutedRow layer={loop.layers.find((l) => beatPatternOf(l) !== null)} />
          </div>
        )
      })()}
      {/**
       * ⚠️ A LAYER ARRANGED ONTO THE LAST BAR, NOT A CHANGE TO THE BEAT. Making the beat's
       * own last bar different was the other design and it is worse: `patternEvents`
       * returns a ONE-BAR take on purpose, so "the same pattern works in a two-bar sketch
       * and a sixteen-bar arrangement", and varying its end would tie every beat to the
       * current bar count. Instead this is an ordinary layer with a `plan` of nulls and one
       * slot — machinery that already exists, that the bar strip already draws, and that
       * can be dragged elsewhere if somebody wants the fill in the middle.
       *
       * ⚠️ IT NEEDS MORE THAN ONE BAR TO MEAN ANYTHING. On a one-bar loop "the last bar" is
       * every bar, so the fill would replace the groove rather than end a phrase. The
       * button says so rather than doing something silly.
       */}
      <div className="inst-beats-row">
        <span className="muted inst-beats-genre">Fill</span>
        {(() => {
          const on = loop.layers.some((l) => fillPatternOf(l) !== null)
          const room = loop.bars > 1
          return (
            <button
              className={'btn' + (on ? '' : ' btn-ghost')}
              aria-pressed={on}
              disabled={!room || (loop.layers.length >= MAX_LAYERS && !on)}
              onClick={() => {
                const { events, len } = patternEvents(DRUM_FILL, loop.bpm)
                const id = addPatternLayer(events, len, DRUM_FILL.id, {
                  mark: '-fill:',
                  instrument: 'drums',
                })
                if (!id) return
                /* silent everywhere but the last bar — the arrangement, not a second beat */
                setLayerPlan(
                  id,
                  Array.from({ length: loop.bars }, (_, i) => (i === loop.bars - 1 ? 0 : null)),
                )
                if (!loop.playing) startLoop()
              }}
              title={
                !room
                  ? 'A fill needs more than one bar — on a one-bar loop every bar is the last one'
                  : loop.layers.length >= MAX_LAYERS && !on
                    ? `All ${MAX_LAYERS} layers are in use — delete one to add a fill`
                    : 'A tom roll on the last bar, to end the phrase — it follows the last bar if the length changes'
              }
            >
              On the last bar
              <Why>
                {!room
                  ? 'needs 2+ bars'
                  : loop.layers.length >= MAX_LAYERS && !on
                    ? 'no layer free'
                    : 'tom roll to end'}
              </Why>
            </button>
          )
        })()}
        <MutedRow layer={loop.layers.find((l) => fillPatternOf(l) !== null)} />
      </div>
      <p className="muted inst-beats-lede">
        {/* ⚠️ THE LEDE HAD TO CHANGE WITH THE PANEL, and then the panel changed twice
            more in a day without it. It first said "picking one swaps the beat", which was
            the whole truth while a beat was all this held; it then said "chords and a beat
            play together", which was true of a two-row panel and became a half-truth the
            morning Bass, Fill and Lead back arrived. A sentence that names two of five
            things reads as a complete list, which is worse than naming none.

            So it states the RULE rather than the inventory — each row owns one slot, and
            the rows play together — which stays true however many rows there are. The
            inventory belongs in the row labels, where it cannot go stale. */}
        Picking one swaps that row rather than adding a second — every row plays at once. Change any
        of it afterwards.
      </p>
    </div>
  )
}
