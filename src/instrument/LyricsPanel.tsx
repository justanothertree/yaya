import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  MAX_LAYERS,
  addLayers,
  loopLength,
  moveLyrics,
  setLayerLyrics,
  toggleMute,
  type Layer,
  type LoopEvent,
  type loopState,
} from '../audio/looper'
import { hasLyrics, linesFor } from '../audio/lyricLines'
import { PRESETS, type PresetId } from '../audio/singer'
import { barSays, fitSongLyrics } from '../audio/songLyrics'
import { fxSnapshot } from '../audio/synth'
import { Panel } from './Panel'
import { partLines } from './partName'
import {
  DOUBLED,
  setVoice,
  singView,
  startSinging,
  stopSinging,
  subscribeSinging,
  type Harmony,
} from './singAlong'

const PRESET_IDS = Object.keys(PRESETS) as PresetId[]
const ABOUT: Record<PresetId, string> = {
  clean: 'A plain voice with a light vibrato on long notes.',
  breathy: 'Soft and airy, with a wider vibrato.',
  glitchy: 'Hard tune, a light stutter and a little grit.',
}
/* none, a third above, or a third above and a quiet copy an octave below — a choice Evan wanted to
   keep rather than have made for him (14 Nov 2026) */
const HARMONIES: [Harmony, string][] = [
  ['off', 'Off'],
  ['third', 'Third'],
  ['octave', 'Third + octave'],
]

/* the sample: a two-bar line in the room's key, four notes a bar, and words that fit it */
const SAMPLE = ['glit-ter in the', 'dark _ to-night']
const SAMPLE_STEPS = [0, 2, 4, 4, 5, 4, 2, 0]

/**
 * The song's words — Evan, 15 Nov 2026: an "Add lyrics" on a song he has already built, "a lyrics
 * box that lines words up to the song's bars, and a play-through so I hear the singer on my
 * existing song".
 *
 * ⚠️ ONE BOX PER BAR OF THE SONG, numbered as the ruler numbers them, and under each one what it
 * will actually sing on that bar's notes — the syllables, `~` for a held vowel, and what did not
 * fit. A bar with no words is not sung. That is the whole timing model, and the boxes are how it
 * is explained: nobody has to be told that words go on notes in order when they can see it.
 *
 * ⚠️ IT REPLACES 🎤 VOICE'S "SING LYRICS" PROTOTYPE AND KEEPS ALL OF IT — which part's notes,
 * the words with `-` and `_`, the sample line, the three voices, Double and Harmony, and ▶ Sing.
 * What it adds is that the words are KEPT: they live on the part (Layer.lyrics), so undo, a
 * reload, a kept song and a jam all have them, where the prototype's box forgot them with the page.
 *
 * ⚠️ PASTING A VERSE SPREADS IT, one line to a bar, from the bar you pasted into — the way people
 * already have lyrics, in a note on their phone.
 */
export function LyricsPanel({
  loop,
  close,
  at,
  scale,
}: {
  loop: ReturnType<typeof loopState>
  close: () => void
  /** the bar whose words were pressed, if one was */
  at?: number
  /** the room's scale, for the sample line */
  scale: { degrees: readonly number[]; root: number }
}) {
  const view = useSyncExternalStore(subscribeSinging, singView, singView)
  const { preset, double, harmony } = view.voice
  /* the parts that could sing: anything with notes that is not the drum kit — plus whichever
     already has the words, whatever it is */
  const candidates = loop.layers.filter(
    (l) => hasLyrics(l) || (l.instrument !== 'drums' && l.events.some((e) => e.on)),
  )
  const worded = loop.layers.find(hasLyrics) ?? null
  const [pick, setPick] = useState<string | null>(null)
  const part: Layer | null =
    worded ?? candidates.find((l) => l.id === pick) ?? candidates[candidates.length - 1] ?? null
  const lines = part ? linesFor(part, loop.bars) : []
  const fit = useMemo(
    () => (part ? fitSongLyrics(part, loop) : null),
    // the fit depends on the part, the tempo, the length and the snap — not on the playhead
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [part, loop.bpm, loop.bars, loop.quantize],
  )

  const boxes = useRef<Array<HTMLInputElement | null>>([])
  /* the bar that was pressed, or the first one with no words yet — where typing starts */
  useEffect(() => {
    if (!part) return
    const first =
      at ??
      Math.max(
        0,
        lines.findIndex((w) => !w.trim()),
      )
    boxes.current[Math.min(first, loop.bars - 1)]?.focus({ preventScroll: false })
    // once, on opening — not every time a word changes the lines
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])

  const write = (b: number, text: string) => {
    if (!part) return
    const next = [...linesFor(part, Math.max(loop.bars, part.lyrics?.length ?? 0))]
    next[b] = text
    setLayerLyrics(part.id, next)
  }
  /** a pasted verse, one line to a bar from this one on */
  const spread = (b: number, text: string) => {
    if (!part) return
    const rows = text.split(/\r?\n/).map((r) => r.trim())
    while (rows.length && !rows[rows.length - 1]) rows.pop()
    const next = [...linesFor(part, Math.max(loop.bars, part.lyrics?.length ?? 0))]
    rows.forEach((r, k) => {
      if (b + k < loop.bars) next[b + k] = r
    })
    setLayerLyrics(part.id, next)
    boxes.current[Math.min(loop.bars - 1, b + rows.length - 1)]?.focus()
  }

  /** a short melody in the room's key, as a muted part, with words on it, so there is something to hear */
  const sample = () => {
    const bar = loopLength() / loop.bars
    const slot = bar / 4
    const base = 72 + (scale.root > 5 ? scale.root - 12 : scale.root)
    const L = scale.degrees.length
    const events: LoopEvent[] = []
    SAMPLE_STEPS.forEach((step, i) => {
      const midi = base + Math.floor(step / L) * 12 + scale.degrees[step % L]
      events.push({ t: i * slot, midi, on: true })
      events.push({ t: i * slot + slot * 0.9, midi, on: false })
    })
    const id = `${Date.now()}-sing-line`
    addLayers([
      {
        id,
        instrument: 'keys',
        muted: true,
        len: bar * 2,
        fx: fxSnapshot(),
        events,
        gain: 0.8,
        lyrics: SAMPLE,
      },
    ])
    setPick(id)
  }

  const singing = view.singing
  const sungBars = fit ? fit.bars.filter((x) => x.sung.length).length : 0
  return (
    <Panel
      title="🎤 Lyrics"
      detail={part ? `Sung on ${partLines(part, loop.layers.indexOf(part)).name}` : undefined}
      onClose={close}
      className="inst-lyrics-panel"
    >
      <p className="muted inst-note">
        A line of words for each bar, sung on that bar&rsquo;s notes. Split a word with <kbd>-</kbd>
        , hold a sound across the next note with <kbd>_</kbd>. A bar with no words is not sung.
      </p>
      {candidates.length > 0 && part ? (
        <div className="inst-row">
          <label className="inst-pick">
            <span className="muted">Sung on</span>
            <select
              value={part.id}
              onChange={(e) => {
                const to = e.target.value
                /* ⚠️ the words go with the choice, in one step that one undo takes back */
                if (worded) moveLyrics(worded.id, to)
                setPick(to)
              }}
            >
              {candidates.map((l) => (
                <option key={l.id} value={l.id}>
                  {partLines(l, loop.layers.indexOf(l)).name}
                  {l.muted ? ' (muted)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-ghost"
            onClick={() => toggleMute(part.id)}
            aria-pressed={!part.muted}
            title={
              part.muted
                ? 'Only the voice sings these notes — press to hear the part play them too'
                : 'The part plays its notes under the voice — press to leave the voice on its own'
            }
          >
            {part.muted ? '🔇 Voice only' : '🔊 Voice and part'}
          </button>
        </div>
      ) : (
        <div className="inst-row">
          <p className="muted inst-note">
            Record or draw a melody first, or start from a sample line.
          </p>
          <button
            className="btn btn-ghost"
            onClick={sample}
            disabled={loop.layers.length >= MAX_LAYERS}
          >
            ✎ Try a sample line
          </button>
        </div>
      )}
      {part && (
        <ol className="inst-lyric-bars">
          {lines.map((w, b) => {
            const f = fit?.bars[b]
            const says = barSays(f)
            const note = !w.trim()
              ? f?.notes
                ? `${f.notes} note${f.notes === 1 ? '' : 's'}, not sung`
                : ''
              : !f?.notes
                ? 'No notes in this bar — these words are not sung'
                : f.spare
                  ? `${says} — ${f.spare} left over`
                  : says
            return (
              <li key={b} className="inst-lyric-bar">
                <label>
                  <span className="inst-lyric-num" aria-hidden>
                    {b + 1}
                  </span>
                  <input
                    ref={(el) => {
                      boxes.current[b] = el
                    }}
                    type="text"
                    value={w}
                    maxLength={120}
                    aria-label={`Words for bar ${b + 1}`}
                    placeholder={b === 0 && !hasLyrics(part) ? SAMPLE[0] : ''}
                    onChange={(e) => write(b, e.target.value)}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData('text')
                      if (!/\n/.test(text.trim())) return
                      e.preventDefault()
                      spread(b, text)
                    }}
                    onKeyDown={(e) => {
                      /* Enter moves on a bar, the way a new line would in a text box */
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        boxes.current[b + 1]?.focus()
                      }
                    }}
                    enterKeyHint={b + 1 < lines.length ? 'next' : 'done'}
                    autoComplete="off"
                    spellCheck
                  />
                </label>
                {note && (
                  <small
                    className={
                      'muted inst-lyric-fit' +
                      (w.trim() && (!f?.notes || f.spare) ? ' is-short' : '')
                    }
                  >
                    {note}
                  </small>
                )}
              </li>
            )
          })}
        </ol>
      )}
      <div className="inst-beats-row">
        <span className="muted inst-beats-genre">Voice</span>
        {PRESET_IDS.map((id) => (
          <button
            key={id}
            className={'btn' + (preset === id ? '' : ' btn-ghost')}
            aria-pressed={preset === id}
            onClick={() => setVoice({ preset: id, double: DOUBLED[id] })}
          >
            {PRESETS[id].name}
          </button>
        ))}
      </div>
      <div className="inst-beats-row">
        <span className="muted inst-beats-genre">Add</span>
        <button
          className={'btn' + (double ? '' : ' btn-ghost')}
          aria-pressed={double}
          onClick={() => setVoice({ double: !double })}
        >
          Double
        </button>
      </div>
      <div className="inst-beats-row">
        <span className="muted inst-beats-genre">Harmony</span>
        {HARMONIES.map(([id, label]) => (
          <button
            key={id}
            className={'btn' + (harmony === id ? '' : ' btn-ghost')}
            aria-pressed={harmony === id}
            onClick={() => setVoice({ harmony: id })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted inst-note">
        {ABOUT[preset]}
        {double ? ' Double sings it twice, slightly apart.' : ''}
        {harmony === 'third' ? ' Harmony adds a third above.' : ''}
        {harmony === 'octave' ? ' Harmony adds a third above and a quiet octave below.' : ''}
      </p>
      <div className="inst-row">
        <button
          className={'btn' + (singing ? ' is-on' : '')}
          onClick={singing ? stopSinging : startSinging}
          disabled={!singing && !sungBars}
          title={
            singing
              ? 'Stop the voice — the song keeps playing'
              : 'Play the song from the top with the words sung, round and round'
          }
        >
          {singing ? '■ Stop singing' : '▶ Sing the song'}
        </button>
        {!singing && part && !sungBars && (
          <span className="muted inst-note">Type some words above to hear them.</span>
        )}
      </div>
    </Panel>
  )
}
