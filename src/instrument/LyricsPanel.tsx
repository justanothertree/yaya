import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  MAX_LAYERS,
  addLayers,
  loopLength,
  moveLyrics,
  setLayerEvents,
  setLayerLyrics,
  toggleMute,
  type Layer,
  type LoopEvent,
  type loopState,
} from '../audio/looper'
import { splitLyrics } from '../audio/lyrics'
import { hasLyrics, linesFor } from '../audio/lyricLines'
import { PRESETS, type PresetId } from '../audio/singer'
import {
  barSays,
  carries,
  fitSongLyrics,
  moreNotesFor,
  moveWords,
  overflow,
  setCarry,
  type Overflow,
} from '../audio/songLyrics'
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
 *
 * ⚠️ AND A LINE THAT DOES NOT FIT SAYS SO, WITH TWO WAYS OUT — Evan, 15 Nov 2026: "show a clear
 * hint when a line has more syllables than notes. Offer to fit them by adding notes or splitting
 * the words." ＋ Add notes writes the notes the voice was already squeezing in into the part
 * (moreNotesFor), so nothing heard moves; ⤵ Move takes the words that have no note of their own
 * to the start of the next bar. Both are one step on the room's undo. And a bar after a sung one
 * can hold that bar's last word on ("let a bar's words carry across a held note into the next
 * bar") — the `_` that always did it, as a button, because nobody would find the `_`.
 */
export function LyricsPanel({
  loop,
  close,
  at,
  on,
  scale,
}: {
  loop: ReturnType<typeof loopState>
  close: () => void
  /** the bar whose words were pressed, if one was */
  at?: number
  /** the part to sing on, when the box was opened from that part's menu */
  on?: string
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
  const [pick, setPick] = useState<string | null>(on ?? null)
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

  /** the whole song's lines, the ones past its end kept — what a change to one bar writes back */
  const allLines = () => (part ? linesFor(part, Math.max(loop.bars, part.lyrics?.length ?? 0)) : [])
  const move = (b: number, o: Overflow) => {
    if (part) setLayerLyrics(part.id, moveWords(allLines(), b, o))
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
                : says /* what did not fit is said by the hint under it */
            /* more syllables than notes: say so, and offer the two ways to fit them */
            const syls = w.trim() ? splitLyrics(w).length : 0
            const over = !!f && syls > f.notes
            const more = over && f.notes ? moreNotesFor(part, loop, b) : null
            const off =
              over && b + 1 < loop.bars
                ? f.notes
                  ? overflow(w, f.notes)
                  : { keep: '', move: w.trim() }
                : null
            /* the word the bar before ends on, when it sings one — what this bar can hold on */
            const last = fit?.bars[b - 1]?.sung.length ? lastWord(lines, b) : null
            const held = carries(w)
            /* offered where it is the whole question — a bar left empty after a sung one — and
               wherever it is already on, so it can be taken off; a bar with its own words can
               still open on `_`, which the note at the top says */
            const offerHold = held || (!!last && !!f?.notes && !w.trim())
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
                    className={'muted inst-lyric-fit' + (w.trim() && !f?.notes ? ' is-short' : '')}
                  >
                    {note}
                  </small>
                )}
                {(over || offerHold) && (
                  <div className="inst-lyric-tools">
                    {over && f.notes > 0 && (
                      <small className={'inst-lyric-hint' + (f.spare ? ' is-short' : ' muted')}>
                        {syls} syllables, {f.notes} note{f.notes === 1 ? '' : 's'}
                        {f.spare
                          ? `: ${f.spare} not sung.`
                          : ', so some notes carry more than one.'}
                      </small>
                    )}
                    {more && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setLayerEvents(part.id, more.events)}
                      >
                        ＋ Add {more.added} note{more.added === 1 ? '' : 's'}
                      </button>
                    )}
                    {off && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`Move “${off.move}” to bar ${b + 2}`}
                        onClick={() => move(b, off)}
                      >
                        ⤵ Move “<span className="inst-lyric-words">{off.move}</span>” to bar{' '}
                        {b + 2}
                      </button>
                    )}
                    {offerHold && (
                      <button
                        type="button"
                        className={'btn' + (held ? '' : ' btn-ghost')}
                        aria-pressed={held}
                        onClick={() => write(b, setCarry(w, !held))}
                      >
                        ⤵ Hold “{last ?? '…'}” into this bar
                      </button>
                    )}
                    {more && more.bars.length > 1 && (
                      <small className="muted inst-lyric-hint">
                        Adding notes changes bars {listBars(more.bars)}, which play the same notes.
                      </small>
                    )}
                  </div>
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

/** bar numbers as people count them: "1, 3 and 5" */
function listBars(bars: readonly number[]): string {
  const n = bars.map((b) => String(b + 1))
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n.join('')
}

/**
 * The word the song is singing as bar `b` begins: the last one typed before it, reaching back over
 * bars that only hold on (`_`), and none across a bar with nothing in it, which is a rest.
 */
function lastWord(lines: readonly string[], b: number): string | null {
  for (let k = b - 1; k >= 0; k--) {
    const words = lines[k].trim().split(/\s+/).filter(Boolean)
    if (!words.length) return null
    const said = words.filter((w) => !/^_+$/.test(w))
    if (said.length) return said[said.length - 1].replace(/-/g, '')
  }
  return null
}
