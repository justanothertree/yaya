import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import {
  addLayers,
  clearLayers,
  loadSong,
  muteTake,
  setLayerGain,
  setTakeGain,
  toggleMute,
  type loopState,
} from '../audio/looper'
import { setSongName } from './songName'
import { ProfileSong } from './ProfileSong'
import { library, removeFromLibrary, subscribeLibrary, type LibraryItem } from '../audio/library'
import { songNotes, songToLayers } from '../audio/songFile'
import { hasLyrics } from '../audio/lyricLines'
import { TakesPanel } from '../audio/TakesPanel'
import { useTakes } from '../audio/useTakes'
import { jam } from '../party/jam'
import { motionReduced } from '../ui/motion'
import { KeysVolume } from './KeysVolume'
import { partLines } from './partName'
import { ExportSong } from './ExportSong'
import {
  setWordsLevel,
  singOneLap,
  singingNow,
  startSinging,
  stopSinging,
  subscribeSinging,
} from './singAlong'

export type Tool = 'beats' | 'mix' | 'voice' | 'songs'

/* ⚠️ 🥁 Beats is a tool without a button here since 15 Nov 2026: its door is under the parts,
   beside ✎ New part (LayerList), and its pane is drawn first, just under that row */
const TOOLS: Array<[Tool, string, string]> = [
  ['mix', '🎚', 'Mix'],
  ['voice', '🎤', 'Voice'],
  ['songs', '📁', 'Songs'],
]

type Loop = ReturnType<typeof loopState>

/**
 * Four tools under the song, one open at a time — the #311 layout, 14 Nov 2026.
 *
 * 🥁 Beats is the beats and chords panel, unchanged. 🎚 Mix is every volume in one place: your
 * keys, each part, and each take on the loop. 🎤 Voice is the recorder and the singer. 📁 Songs is
 * keeping, opening and taking it elsewhere: Keep this song, Stems, Export song, MIDI, the kept
 * songs and Clear all parts.
 *
 * ⚠️ A CLOSED TOOL STAYS MOUNTED, ONLY HIDDEN — the condition Evan approved one-at-a-time on.
 * `useTakes` stops its work when it unmounts, on purpose (a recording is kept and the microphone
 * released), so unmounting Voice to open Mix would end a take mid-recording. Hidden, you can open
 * Mix while a take records or the voice sings, and 🎤 Voice says so with a dot. (The singing is
 * the song's now — singAlong.ts — and outlives every panel; the dot still says it is going.)
 *
 * ⚠️ AND `useTakes` IS CALLED HERE, ONCE, rather than inside TakesPanel, because its Stems moved to
 * 📁 Songs while its takes stayed in 🎤 Voice. Two calls would be two recorders with two lists,
 * each tearing down the other's microphone on its way out.
 */
export function SongTools({
  tool,
  setTool,
  loop,
  setEditing,
  keep,
  username,
  askName,
  confirmIt,
  beats,
  showLyrics,
}: {
  tool: Tool | null
  setTool: Dispatch<SetStateAction<Tool | null>>
  loop: Loop
  setEditing: Dispatch<SetStateAction<string | null>>
  keep: (kind: 'song' | 'loop', layerId?: string) => void
  /** the member's username, for 🎵 Put it on my profile; null hides it */
  username: string | null
  /** the room's name prompt, which lets go of every sounding note first */
  askName: (question: string, offered?: string) => string
  /** the room's yes-or-no, which does the same */
  confirmIt: (question: string) => boolean
  /** the beats panel, built by the room, which owns the backing's picks */
  beats: ReactNode
  /** open the song's lyrics box */
  showLyrics: () => void
}) {
  const takes = useTakes()
  const singing = useSyncExternalStore(subscribeSinging, singingNow, singingNow)
  const panes = useRef<Partial<Record<Tool, HTMLElement | null>>>({})

  /**
   * ⚠️ A TOOL OPENED BELOW THE SCREEN IS BROUGHT UP TO IT. The beats panel did this for itself on
   * mount, measured 385px lower at 375 than the button that opened it, "so from the bottom half
   * of a phone screen the press looked like it did nothing". Mounted from the start and only
   * hidden now, its mount is long past by the time anybody opens it — so the check moved here,
   * where it runs on every opening, and applies to all four. Only when its top is past the
   * bottom of the screen, so a tool that opened in view never moves the page.
   */
  useEffect(() => {
    if (!tool) return
    const el = panes.current[tool]
    if (!el) return
    const top = el.getBoundingClientRect().top
    if (top < window.innerHeight - 48) return
    /* motionReduced, not the media query: it also honours the site's own reduce-motion switch */
    window.scrollTo({
      top: window.scrollY + top - 72,
      behavior: motionReduced() ? 'auto' : 'smooth',
    })
  }, [tool])

  const busy: Partial<Record<Tool, boolean>> = { voice: !!takes.going || singing }
  const pane = (t: Tool, label: string, body: ReactNode) => (
    <section
      key={t}
      ref={(el) => {
        panes.current[t] = el
      }}
      id={`inst-tool-${t}`}
      className={'inst-tool inst-tool-' + t}
      aria-label={label}
      hidden={tool !== t}
    >
      {body}
    </section>
  )

  return (
    <>
      {pane('beats', 'Beats', beats)}
      <div className="inst-tools" role="group" aria-label="Song tools">
        {TOOLS.map(([t, icon, name]) => (
          <button
            key={t}
            className={'btn inst-tool-open' + (tool === t ? ' is-on' : ' btn-ghost')}
            aria-expanded={tool === t}
            aria-controls={`inst-tool-${t}`}
            onClick={() => setTool((was) => (was === t ? null : t))}
            /* ⚠️ Beats adds parts, so it goes dead at the ceiling — but never while it is open,
               or the one way to close it would be the button that had stopped working */
            title={
              t === 'mix'
                ? 'Every volume in one place'
                : t === 'voice'
                  ? 'Record a take, open a sound file, or have the voice sing'
                  : 'Keep this song, open a kept one, or take its stems'
            }
          >
            <span aria-hidden>{icon}</span> {name}
            {/* ⚠️ A CLOSED TOOL STILL WORKING SAYS SO — a take recording or a line being sung
                carries on behind Mix, and the button you would press to stop it is in here */}
            {busy[t] && tool !== t && (
              <span className="inst-tool-busy" aria-label=", working">
                ●
              </span>
            )}
          </button>
        ))}
      </div>
      {pane('mix', 'Mix', <Mix loop={loop} />)}
      {pane(
        'voice',
        'Voice',
        <>
          <TakesPanel takes={takes} />
          <SingDoor loop={loop} singing={singing} showLyrics={showLyrics} />
        </>,
      )}
      {pane(
        'songs',
        'Songs',
        <Songs
          loop={loop}
          takes={takes}
          keep={keep}
          setEditing={setEditing}
          username={username}
          askName={askName}
          confirmIt={confirmIt}
        />,
      )}
    </>
  )
}

/**
 * Where 🎤 Voice's "Sing lyrics" prototype was — a door to the song's words now.
 *
 * ⚠️ THE WORDS MOVED TO THE SONG, 15 Nov 2026: Evan built a song and could not find where its
 * lyrics went, because they were here, behind a fold, in a box that forgot them with the page.
 * They are a line per bar in the lyrics box now (LyricsPanel), opened from the parts as well as
 * from here, and the voice, Double and Harmony went with them. This keeps the old door working
 * for anybody who learned it.
 */
function SingDoor({
  loop,
  singing,
  showLyrics,
}: {
  loop: Loop
  singing: boolean
  showLyrics: () => void
}) {
  const words = loop.layers.some(hasLyrics)
  return (
    <div className="inst-sing is-inline">
      <h4 className="inst-tool-head">Sing lyrics</h4>
      <p className="muted inst-note">
        {words
          ? 'The song has words. Change them, or hear them sung over the song.'
          : 'Write a line of words for each bar of the song, and a voice sings them on its notes.'}
      </p>
      <div className="inst-row">
        <button className="btn" onClick={showLyrics}>
          🎤 {words ? 'Lyrics' : 'Add lyrics'}
        </button>
        {words && (
          <button
            className={'btn btn-ghost' + (singing ? ' is-on' : '')}
            onClick={() => (singing ? stopSinging() : startSinging())}
          >
            {singing ? '■ Stop singing' : '▶ Sing the song'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * 🎚 Mix: every volume in the room, in one place.
 *
 * ⚠️ THEY WERE IN THREE PLACES: your keys on the play bar, each part on its own row, and the
 * floating player. The play bar's left for this; each part's is here and in its ⋯ (and on its row
 * on a desktop), and the floating player keeps its own, because that one follows you off the page.
 * Every slider here writes the same value the others do, so none of them can disagree.
 *
 * ⚠️ AND EVERY PART OF THE SONG HAS ONE NOW, the takes and the words included (Evan, 21 Nov 2026:
 * "easy volume for every part of a song"). A take had a mute here and "as recorded", because the
 * loop played it at a gain nothing set; the words had no row at all. Both are the same 0–2 fader
 * the parts have, and write the same values as the timeline's rows.
 */
function Mix({ loop }: { loop: Loop }) {
  return (
    <div className="inst-mix">
      <KeysVolume />
      {loop.layers.map((l, i) => {
        const name = partLines(l, i).name
        return (
          <div key={l.id} className={'inst-mix-row' + (l.muted ? ' is-muted' : '')}>
            <span className="inst-mix-name">{name}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={l.gain ?? 1}
              aria-label={`Volume of ${name}`}
              onChange={(e) => setLayerGain(l.id, Number(e.target.value))}
            />
            <span className="muted inst-mix-pct">{Math.round((l.gain ?? 1) * 100)}%</span>
            <button
              className="btn inst-icon"
              onClick={() => toggleMute(l.id)}
              aria-label={`Mute ${name}`}
              aria-pressed={!!l.muted}
              title={l.muted ? 'Muted — click to hear it again' : 'Mute this part'}
            >
              {l.muted ? '🔇' : '🔊'}
            </button>
          </div>
        )
      })}
      {loop.layers.filter(hasLyrics).map((l) => (
        <div key={`${l.id}-words`} className="inst-mix-row">
          <span className="inst-mix-name">🎤 Lyrics</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={l.wordsGain ?? 1}
            aria-label="Volume of the lyrics"
            onChange={(e) => setWordsLevel(l.id, Number(e.target.value))}
          />
          <span className="muted inst-mix-pct">{Math.round((l.wordsGain ?? 1) * 100)}%</span>
          <span className="inst-icon-slot" aria-hidden />
        </div>
      ))}
      {loop.takes.map((t, i) => (
        <div key={t.id} className={'inst-mix-row' + (t.muted ? ' is-muted' : '')}>
          <span className="inst-mix-name">🎤 Take {i + 1}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={t.gain ?? 1}
            aria-label={`Volume of take ${i + 1}`}
            onChange={(e) => setTakeGain(t.id, Number(e.target.value))}
          />
          <span className="muted inst-mix-pct">{Math.round((t.gain ?? 1) * 100)}%</span>
          <button
            className="btn inst-icon"
            onClick={() => muteTake(t.id)}
            aria-label={`Mute take ${i + 1}`}
            aria-pressed={!!t.muted}
            title={t.muted ? 'Muted — click to hear it again' : 'Mute this take'}
          >
            {t.muted ? '🔇' : '🔊'}
          </button>
        </div>
      ))}
      {!loop.layers.length && !loop.takes.length && (
        <p className="muted inst-note">Parts and takes join this list as you make them.</p>
      )}
    </div>
  )
}

/**
 * 📁 Songs: keeping and opening, together.
 *
 * ⚠️ ⬇ Keep song MOVED IN HERE, Evan's call (14 Nov 2026): one more tap to save, beside the songs
 * it joins. Stems came from beside the takes and Clear all from under the parts, so everything
 * that saves, opens, exports or empties the song is in one place.
 */
function Songs({
  loop,
  takes,
  keep,
  setEditing,
  username,
  askName,
  confirmIt,
}: {
  loop: Loop
  takes: ReturnType<typeof useTakes>
  keep: (kind: 'song' | 'loop', layerId?: string) => void
  setEditing: Dispatch<SetStateAction<string | null>>
  username: string | null
  askName: (question: string, offered?: string) => string
  confirmIt: (question: string) => boolean
}) {
  const saved = useSyncExternalStore(subscribeLibrary, library, library)
  const { parts, bouncing, doBounce, stems } = takes
  /* one recording of the song at a time: stems and the export each play it through */
  const [exporting, setExporting] = useState(false)
  /* ⚠️ each stem's address made once and let go — it was a new object URL every render, each
     holding its file in memory for as long as the page lived */
  const stemUrls = useMemo(() => stems.map((st) => URL.createObjectURL(st.blob)), [stems])
  useEffect(() => () => stemUrls.forEach((u) => URL.revokeObjectURL(u)), [stemUrls])
  return (
    <div className="inst-songs">
      <div className="inst-row">
        <button
          className="btn"
          disabled={!loop.layers.length}
          onClick={() => keep('song')}
          title="Keep this whole arrangement"
        >
          ⬇ Keep this song
        </button>
        {/* ⚠️ A FIRST VISIT HAS NOTHING TO BOUNCE, so it is not offered — see `parts` in useTakes */}
        {parts > 0 && (
          <button
            className={'btn btn-ghost' + (bouncing ? ' is-on' : '')}
            disabled={!!bouncing || exporting}
            onClick={() => void doBounce(singOneLap)}
            title="Bounce every part, every take and the sung words to its own WAV, in real time"
          >
            {bouncing
              ? `Bouncing ${bouncing.doing || '…'} (${bouncing.done}/${bouncing.of})`
              : '⬇ Stems'}
          </button>
        )}
      </div>
      <ExportSong loop={loop} busy={!!bouncing} setBusy={setExporting} member={!!username} />
      <ProfileSong loop={loop} username={username} askName={askName} confirmIt={confirmIt} />
      {stems.length > 0 && (
        <div className="inst-row inst-takes-stems">
          {stems.map((st, k) => (
            <a key={st.name} className="btn btn-ghost" href={stemUrls[k]} download={st.name}>
              {st.name}
            </a>
          ))}
        </div>
      )}
      {!saved.length ? (
        <p className="muted inst-note">
          Nothing kept yet. Make something, then <strong>⬇ Keep this song</strong> — or keep one
          part as a loop from its ⋯.
        </p>
      ) : (
        <ul className="inst-lib-list">
          {saved.map((it: LibraryItem) => (
            <li key={it.id}>
              <span className="inst-lib-text">
                <span className="inst-lib-name">
                  {it.kind === 'loop' ? '🔁' : '🎵'} {it.name}
                </span>
                <span className="muted inst-lib-meta">
                  {it.song.layers.length} part{it.song.layers.length === 1 ? '' : 's'} ·{' '}
                  {songNotes(it.song)} notes · {it.song.bpm}bpm
                </span>
              </span>
              {/* Two different verbs, and the distinction is the whole point of the library.
                  Open REPLACES what you have; Add brings this part in alongside it. */}
              <span className="inst-lib-do">
                <button
                  className="btn"
                  onClick={() => {
                    loadSong(it.song.bpm, it.song.bars, songToLayers(it.song))
                    setSongName(it.name)
                    setEditing(null)
                    // ⚠️ offered, not pushed — see jam.offerSong. A no-op when nobody is jamming.
                    jam.offerSong(it.song)
                  }}
                  title="Open this, replacing what you have now"
                >
                  Open
                </button>
                <button
                  className="btn"
                  onClick={() => addLayers(songToLayers(it.song))}
                  title="Add these parts to what you are working on"
                >
                  + Add
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    if (window.confirm(`Delete “${it.name}”?`)) removeFromLibrary(it.id)
                  }}
                  aria-label={`Delete “${it.name}”`}
                  title="Delete this"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* ⚠️ PARTS ONLY, and a recording placed in the loop stays where it is — Evan's call,
          9 Nov 2026. A take has its own controls in 🎤 Voice. Undo, beside the parts, takes it
          back. */}
      {loop.layers.length > 0 && (
        <div className="inst-row">
          <button
            className="btn btn-ghost"
            onClick={clearLayers}
            title="Delete every part — recordings in the loop stay"
          >
            Clear all parts
          </button>
        </div>
      )}
    </div>
  )
}
