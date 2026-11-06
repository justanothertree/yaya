import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { readWaveform, tapFormat } from '../audio/audioTap'
import { sharedCtx } from '../audio/context'
import { localMicOn, startLocalMic, stopLocalMic } from '../audio/localMic'
import { volume } from '../audio/mixer'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { COLUMNS, COLUMN_SECONDS, FFT, ROWS, TOOLS, startingPrint, type Tool } from './voiceprint'
import { MAX_DABS, createVoiceprint, type BrushDab, type VoiceprintView } from './voiceprintEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const TOOL_IDS = Object.keys(TOOLS) as Tool[]

/**
 * A picture of sound. Sing into the microphone and your voice is drawn as it sounds — every pitch
 * a row, every moment a column; paint on it, and play it back.
 */
export function VoiceprintDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [mic, setMic] = useState(localMicOn)
  const [tool, setTool] = useState<Tool>('paint')
  const [playing, setPlaying] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const now = useRef({ mic, tool, playing })
  now.current = { mic, tool, playing }

  const engine = useRef<VoiceprintView | null>(null)
  const head = useRef(0)
  const dabs = useRef<BrushDab[]>([])
  const painting = useRef<{ x: number; y: number } | null>(null)
  /** the sound being played: its source, and when it started on the audio clock */
  const playback = useRef<{ source: AudioBufferSourceNode; start: number } | null>(null)
  const redraw = useRef<() => void>(() => {})

  /** false once the toy has unmounted, so a prompt that resolves late cannot leave the mic on */
  const here = useRef(true)
  const releaseSound = () => {
    const source = playback.current?.source
    playback.current = null
    /* stop() throws once the buffer has already ended, which is also how onended arrives */
    try {
      source?.stop()
    } catch {
      /* already finished */
    }
  }
  /* leaving the toy turns the microphone off and stops the sound */
  useEffect(
    () => () => {
      here.current = false
      stopLocalMic()
      releaseSound()
    },
    [],
  )

  const toggleMic = async () => {
    if (localMicOn()) {
      stopLocalMic()
      setMic(false)
      return
    }
    const ok = await startLocalMic()
    if (!here.current) {
      stopLocalMic()
      return
    }
    setMic(ok)
    setNote(
      ok ? null : 'The microphone was not allowed, or there is not one — painting still works.',
    )
    if (ok && !running) setRunning(true)
  }

  const stop = () => {
    releaseSound()
    setPlaying(false)
  }

  const play = async () => {
    const v = engine.current
    if (!v) return
    stop()
    const ctx = sharedCtx()
    void ctx.resume()
    const samples = await v.render(ctx.sampleRate)
    if (!here.current) return
    /* as loud as it can go without clipping, and no louder than the site's instrument volume */
    let peak = 0
    for (const s of samples) peak = Math.max(peak, Math.abs(s))
    const gain = peak > 0 ? (0.8 / peak) * volume('instrument') : 0
    const audio = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    const data = audio.getChannelData(0)
    for (let i = 0; i < samples.length; i++) data[i] = samples[i] * gain
    const source = ctx.createBufferSource()
    source.buffer = audio
    source.connect(ctx.destination)
    const start = ctx.currentTime + 0.05
    source.start(start)
    source.onended = () => {
      if (playback.current?.source === source) stop()
    }
    playback.current = { source, start }
    setPlaying(true)
    if (!running) setRunning(true)
  }

  const reset = (empty: boolean) => {
    engine.current?.load(empty ? new Float32Array(COLUMNS * ROWS) : startingPrint())
    head.current = 0
    redraw.current()
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === 'l') void toggleMic()
    else if (k === ' ' || k === 'p') void (now.current.playing ? stop() : play())
    else if (k === 'c') reset(true)
    else if (k === 't') reset(false)
    else if (/^[1-2]$/.test(k)) setTool(TOOL_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toCell = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * COLUMNS,
      y: (1 - (e.clientY - r.top) / r.height) * (ROWS - 1),
    }
  }
  const dabAt = (x: number, y: number) =>
    dabs.current.push({
      column: x,
      row: y,
      strength: now.current.tool === 'paint' ? 0.75 : -1,
      radius: now.current.tool === 'paint' ? 1.6 : 6,
    })

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Voiceprint">
      <LabStage
        label="A picture of sound: pitches up the side, time along the bottom, loudness as colour"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const v = await createVoiceprint(device, context, format)
          engine.current = v
          v.load(startingPrint())
          const bytes = new Uint8Array(4096)
          const samples = new Float32Array(FFT)
          const draw = (dt: number) => {
            const n = now.current
            const rate = tapFormat('local')?.rate ?? sharedCtx().sampleRate
            /* listening writes a column a frame, unless the picture is being played */
            if (dt > 0 && n.mic && !n.playing && readWaveform('local', bytes)) {
              const size = Math.min(bytes.length, tapFormat('local')?.fftSize ?? FFT)
              for (let i = 0; i < FFT; i++) samples[i] = (bytes[size - FFT + i] - 128) / 128
              head.current = (head.current + 1) % COLUMNS
              v.listen(samples, head.current, rate)
            }
            const pb = playback.current
            const playhead = pb
              ? Math.max(0, (sharedCtx().currentTime - pb.start) / COLUMN_SECONDS)
              : 0
            v.frame(
              {
                w: canvas.width,
                h: canvas.height,
                head: head.current,
                rate,
                playing: !!pb,
                playhead,
              },
              dabs.current,
            )
            /* the brush takes so many dabs a frame; a quick stroke's others wait for the next, rather
               than leaving gaps */
            dabs.current = dabs.current.slice(MAX_DABS)
          }
          redraw.current = () => draw(0)
          return {
            frame: draw,
            destroy: () => {
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const c = toCell(e)
          painting.current = c
          dabAt(c.x, c.y)
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const from = painting.current
          if (!from) return
          const c = toCell(e)
          /* a dab every half column of the way, so a quick stroke leaves no gaps */
          const steps = Math.max(1, Math.ceil(Math.hypot(c.x - from.x, c.y - from.y) * 2))
          for (let k = 1; k <= steps; k++)
            dabAt(from.x + ((c.x - from.x) * k) / steps, from.y + ((c.y - from.y) * k) / steps)
          painting.current = c
        }}
        onPointerUp={() => {
          painting.current = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => void (playing ? stop() : play())}>
            {playing ? '⏹ Stop' : '▶ Play'}
          </button>
          <button className="btn btn-ghost" aria-pressed={mic} onClick={() => void toggleMic()}>
            🎤 Listen
          </button>
          <div className="lab-group" role="group" aria-label="What a finger does">
            {TOOL_IDS.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
              >
                {TOOLS[t]}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={() => reset(false)}>
            ♪ The tune
          </button>
          <button className="btn btn-ghost" onClick={() => reset(true)}>
            ✕ Clear
          </button>
          {note && <span className="muted">{note}</span>}
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          A picture of sound: pitch goes up the side (each faint line an octave), time along the
          bottom, loudness is colour. ▶ Play turns the picture back into sound — a level stroke is
          a note, a slanting one a glide; draw a melody and hear it. 🎤 Listen writes your voice in
          as you sing or whistle, and played back it comes out as a ghost of itself. Listening, the
          GPU does a Fourier transform of the last 1,024 samples every frame; playing, it adds up a
          sine for every row, for every sample. Nothing is recorded or sent anywhere.
          {!touchOnly() &&
            ' Keys, once it has focus: Space plays, L listens, 1–2 tool, T the tune, C clear.'}
        </p>
      )}
    </div>
  )
}
