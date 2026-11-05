import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  binCountAll,
  fftSizeAll,
  liveTaps,
  readLevel,
  readSpectrumAll,
  readWaveformAll,
  subscribeTaps,
  tapFormat,
  TAPS,
} from '../audio/audioTap'
import { localMicOn, startLocalMic, stopLocalMic } from '../audio/localMic'
import { playFile, stopMusic } from '../audio/musicSource'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  BANDS,
  BASS_BANDS,
  QUIET,
  WAVE,
  bandEdges,
  beat,
  ease,
  foldBands,
  foldWave,
  type BeatState,
} from './music'
import { createMusicVis, type MusicInput, type MusicVis } from './musicEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** larger than any analyser here (2048-point FFTs); a short buffer is skipped, not an error */
const SCRATCH = 16384

/** the live sources, as a string so a change is a change and a re-render is not */
const tapsKey = () => liveTaps().join(',')

/**
 * The sources making a sound right now.
 *
 * ⚠️ REGISTERED IS NOT PLAYING. The ringtone's analyser is registered for as long as the page is
 * open, so naming every live tap told somebody with nothing playing that the Lab was "Listening to:
 * Ringtone" — over a flat line. Only a source with some signal in it is named.
 */
function audible(scratch: Uint8Array): string {
  return liveTaps()
    .filter((id) => readLevel(id, scratch) > 0.01)
    .map((id) => TAPS.find((t) => t.id === id)?.label ?? id)
    .join(', ')
}

/**
 * The site's live sound — your mic, a file, the instrument, a call — as bars or a ring, drawn by
 * the GPU into a trail that turns and grows. It reads the same analysers the Visualiser does.
 */
export function MusicDemo({ running, setRunning, onAdapter }: Props) {
  const visRef = useRef<MusicVis | null>(null)
  const [live, setLive] = useState(false)
  const [mode, setMode] = useState<0 | 1>(0)
  const [spin, setSpin] = useState(0.15)
  const [zoom, setZoom] = useState(0.25)
  const [micOn, setMicOn] = useState(localMicOn)
  const [note, setNote] = useState<string | null>(null)
  const sources = useSyncExternalStore(subscribeTaps, tapsKey, () => '')
  const fileRef = useRef<HTMLInputElement | null>(null)
  /* asked a few times a second rather than every frame: it is a sentence, not a picture */
  const [names, setNames] = useState('')
  useEffect(() => {
    const scratch = new Uint8Array(SCRATCH)
    const id = window.setInterval(() => setNames(audible(scratch)), 400)
    return () => window.clearInterval(id)
  }, [])

  const input = useRef<MusicInput>({
    data: new Float32Array(BANDS + WAVE),
    level: 0,
    mode: 0,
    spin: 0.15,
    zoom: 0.25,
    kick: 0,
  })
  /** whether a beat punches the picture — some music wants it, a slow piano piece does not */
  const [pulse, setPulse] = useState(true)
  const pulseRef = useRef(pulse)
  pulseRef.current = pulse
  input.current.mode = mode
  input.current.spin = spin
  input.current.zoom = zoom

  /* ⚠️ THE MIC GOES WHEN YOU DO, music does not — the same rule the Visualiser keeps. A device
     with a recording light must not stay on because somebody followed a link; a song is meant to
     follow you round the site, which is what the AudioDock is for. */
  useEffect(
    () => () => {
      stopLocalMic()
    },
    [],
  )

  const toggleMic = async () => {
    if (localMicOn()) {
      stopLocalMic()
      setMicOn(false)
      return
    }
    const ok = await startLocalMic()
    setMicOn(ok)
    setNote(ok ? null : 'The microphone was not allowed, or there is not one.')
    if (ok && !running) setRunning(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'm') setMode((m) => (m ? 0 : 1))
    else if (k === 'b') setPulse((v) => !v)
    else if (k === '0') {
      setSpin(0)
      setZoom(0)
    } else return
    e.preventDefault()
  }

  /* a drag steers the trail: across is how fast it turns, up and down how fast it grows */
  const steer = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setSpin(Math.round(((e.clientX - r.left) / r.width - 0.5) * 3 * 100) / 100)
    setZoom(Math.round((0.5 - (e.clientY - r.top) / r.height) * 1.2 * 100) / 100)
  }
  const dragging = useRef(false)

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Music visual">
      <LabStage
        label="The sound playing on this site, drawn as glowing bars or a ring that leaves a turning trail"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const vis = await createMusicVis(device, context, format, canvas)
          visRef.current = vis
          const edges = bandEdges(BANDS)
          const spectrum = new Uint8Array(SCRATCH)
          const waveform = new Uint8Array(SCRATCH)
          const scratch = new Uint8Array(SCRATCH)
          const target = new Float32Array(BANDS)
          const bands = input.current.data.subarray(0, BANDS)
          const wave = input.current.data.subarray(BANDS)
          let beats: BeatState = QUIET
          return {
            frame: (dt) => {
              const bins = binCountAll()
              const fft = fftSizeAll()
              const first = liveTaps()[0]
              const rate = first ? (tapFormat(first)?.rate ?? 48000) : 48000
              if (bins > 0 && readSpectrumAll(spectrum.subarray(0, bins), scratch)) {
                foldBands(spectrum.subarray(0, bins), rate, fft, edges, target)
                readWaveformAll(waveform.subarray(0, fft), scratch)
                foldWave(waveform.subarray(0, fft), WAVE, wave)
              } else {
                target.fill(0)
                wave.fill(0)
              }
              let sum = 0
              for (let i = 0; i < BANDS; i++) {
                bands[i] = ease(bands[i], target[i], dt)
                sum += bands[i]
              }
              input.current.level = sum / BANDS
              /* the beat reads the RAW bass, not the eased bands: easing is what makes the bars
                 look smooth, and it is also a delay a kick drum should not have to wait out */
              if (dt > 0) {
                let bass = 0
                for (let i = 0; i < BASS_BANDS; i++) bass += target[i]
                const b = beat(beats, bass / BASS_BANDS, dt)
                beats = b.state
                input.current.kick =
                  b.hit && pulseRef.current ? 1 : input.current.kick * Math.exp(-dt * 6)
              }
              vis.frame(dt, input.current)
            },
            resize: () => vis.resize(),
            destroy: () => {
              vis.destroy()
              visRef.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          dragging.current = true
          steer(e)
        }}
        onPointerMove={(e) => {
          if (dragging.current) steer(e)
        }}
        onPointerUp={() => {
          dragging.current = false
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" aria-pressed={micOn} onClick={() => void toggleMic()}>
            🎤 {micOn ? 'Mic on' : 'Mic'}
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            🎵 Play a file…
          </button>
          {sources.includes('music') && (
            <button className="btn btn-ghost" onClick={() => stopMusic()}>
              Stop music
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const failed = await playFile(file)
              setNote(failed)
              if (!failed && !running) setRunning(true)
            }}
          />
          <div className="lab-group" role="group" aria-label="Shape">
            <button className="btn btn-ghost" aria-pressed={mode === 0} onClick={() => setMode(0)}>
              Bars
            </button>
            <button className="btn btn-ghost" aria-pressed={mode === 1} onClick={() => setMode(1)}>
              Ring
            </button>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setSpin(0)
              setZoom(0)
            }}
          >
            Hold still
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={pulse}
            onClick={() => setPulse((v) => !v)}
          >
            🥁 Beat
          </button>
        </div>
      )}

      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note ??
            (names
              ? `Listening to: ${names}.`
              : 'Nothing is playing yet — turn the mic on, play a file, or play something on the Instrument and come back.')}{' '}
          Drag on it to steer the trail: across turns it, up and down grows or shrinks it. With Beat
          on, every kick drum punches it outward. A file stays on this device and is never uploaded.
          {!touchOnly() &&
            ' Keys, once it has focus: Space pauses, M switches bars and ring, 0 holds it still, B turns the beat on or off.'}
        </p>
      )}
    </div>
  )
}
