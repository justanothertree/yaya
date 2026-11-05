import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { FluidDemo } from '../gpu/FluidDemo'
import { GalaxyDemo } from '../gpu/GalaxyDemo'
import { KaleidoDemo } from '../gpu/KaleidoDemo'
import { LavaDemo } from '../gpu/LavaDemo'
import { LifeDemo } from '../gpu/LifeDemo'
import { MarbleDemo } from '../gpu/MarbleDemo'
import { MusicDemo } from '../gpu/MusicDemo'
import { SwarmDemo } from '../gpu/SwarmDemo'
import { motionReduced, onMotionChange } from '../ui/motion'
import '../gpu/lab.css'

/**
 * The Lab: experiments with WebGPU, one at a time.
 *
 * Each demo owns its controls and builds on LabStage, which owns the device, the canvas and every
 * way of failing. This page only chooses which one is mounted, and says in one line what it is —
 * a demo nobody can name is a pretty picture rather than an experiment.
 */

/** What every demo is handed: whether to move, a way to start or stop it, and somewhere to report
 *  the adapter it was given. */
type DemoProps = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/**
 * ⚠️ THE LIST IS THE ROOM. Each demo is one entry — its id, its name, its one line and its
 * component — and the picker, the dropdown, the stepping buttons and the stage all read it. It
 * used to be a list here AND a hand-written line per demo further down, which is the shape
 * places.ts was written to end: a demo added to one and not the other is half there.
 */
const DEMOS: readonly {
  id: string
  Demo: ComponentType<DemoProps>
  name: string
  line: string
}[] = [
  {
    id: 'swarm',
    Demo: SwarmDemo,
    name: 'Swarm',
    line: 'Up to two million particles in a swirling current — a compute pass moves every one each frame.',
  },
  {
    id: 'life',
    Demo: LifeDemo,
    name: 'Life',
    line: 'Conway’s Game of Life — every cell’s next generation worked out at once, on the GPU.',
  },
  {
    id: 'fluid',
    Demo: FluidDemo,
    name: 'Fluid',
    line: 'Fluid painting — drag to stir colour into a simulated fluid that swirls, spreads and fades.',
  },
  {
    id: 'music',
    Demo: MusicDemo,
    name: 'Music',
    line: 'Music visual — your mic, a file or the instrument as bars or a ring, drawn into a trail.',
  },
  {
    id: 'kaleido',
    Demo: KaleidoDemo,
    name: 'Kaleidoscope',
    line: 'Kaleidoscope — draw, and every stroke repeats and mirrors round the middle as you go.',
  },
  {
    id: 'lava',
    Demo: LavaDemo,
    name: 'Lava lamp',
    line: 'Lava lamp — wax heated by the bulb rises, cools at the top and sinks. Reach in and stir.',
  },
  {
    id: 'galaxy',
    Demo: GalaxyDemo,
    name: 'Galaxy',
    line: 'Galaxy — a spiral of stars that breathes with the music. Drag to turn it and tilt it.',
  },
  {
    id: 'marble',
    Demo: MarbleDemo,
    name: 'Marbling',
    line: 'Marbling — float drops of ink on water, then pull them into feathered patterns with a stylus or comb.',
  },
]

type DemoId = string

const KEY = 'lab_demo_v1'
function storedDemo(): DemoId {
  try {
    const v = localStorage.getItem(KEY)
    return DEMOS.some((d) => d.id === v) ? (v as DemoId) : 'swarm'
  } catch {
    return 'swarm'
  }
}

/** What the adapter says about itself, kept for the "what your GPU reports" fold. */
type Report = {
  vendor: string
  architecture: string
  description: string
  software: boolean
  format: string
  features: string[]
  limits: [string, number][]
}

/** The limits worth showing — the ones that decide what a page like this can do. */
const SHOWN_LIMITS = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupsPerDimension',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupStorageSize',
  'maxTextureDimension2D',
  'maxBindGroups',
] as const

const bytes = (n: number) =>
  n >= 1 << 30 ? `${n / (1 << 30)} GiB` : n >= 1 << 20 ? `${n / (1 << 20)} MiB` : `${n / 1024} KiB`
const shownLimit = (name: string, n: number) => (/Size$/.test(name) ? bytes(n) : n.toLocaleString())

function reportOf(adapter: GPUAdapter, format: string): Report {
  const info = adapter.info
  return {
    vendor: info.vendor || 'not said',
    architecture: info.architecture || 'not said',
    description: info.description,
    software: info.isFallbackAdapter ?? false,
    format,
    features: [...adapter.features].sort(),
    limits: SHOWN_LIMITS.map((k) => [k, adapter.limits[k]]),
  }
}

export function GpuLab() {
  const [demo, setDemo] = useState<DemoId>(storedDemo)
  const [report, setReport] = useState<Report | null>(null)
  /* ⚠️ STILL UNTIL ASKED, under reduced motion. Every demo here is motion, so none can simply
     paint once and stop the way the backdrop does — the picture would be all there is. Each draws
     its first frame still, and Run is somebody choosing to watch it move. */
  const [running, setRunning] = useState(() => !motionReduced())
  useEffect(() => onMotionChange(() => motionReduced() && setRunning(false)), [])

  const pick = (id: DemoId) => {
    setDemo(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* private mode: it applies for this visit */
    }
  }
  const onAdapter = (adapter: GPUAdapter, format: GPUTextureFormat) =>
    setReport(reportOf(adapter, format))
  const props = { running, setRunning, onAdapter }
  const at = Math.max(
    0,
    DEMOS.findIndex((d) => d.id === demo),
  )
  const current = DEMOS[at]
  /** the next or previous demo, round the end — browsing toys should not hit a wall */
  const step = (by: number) => pick(DEMOS[(at + by + DEMOS.length) % DEMOS.length].id)

  return (
    <div className="lab">
      {/* ⚠️ TWO PICKERS, ONE SHOWN. A row of buttons is right while it fits on one line; on a
          phone seven were already two rows and pushed the canvas half off the first screen, and
          every new toy made it worse. Below 640px it is a native dropdown — the phone's own
          wheel — with buttons either side to step through, which is how people actually browse
          toys. A width query, not a pointer one: the problem is room, not fingers. */}
      <div className="lab-step">
        <button className="btn btn-ghost" onClick={() => step(-1)} aria-label="Previous experiment">
          ‹
        </button>
        <label className="lab-select">
          <span className="sr-only">Which experiment</span>
          <select value={current.id} onChange={(e) => pick(e.target.value)}>
            {DEMOS.map((d, i) => (
              <option key={d.id} value={d.id}>
                {i + 1}. {d.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-ghost" onClick={() => step(1)} aria-label="Next experiment">
          ›
        </button>
      </div>
      <div className="lab-picker" role="group" aria-label="Which experiment">
        {DEMOS.map((d) => (
          <button
            key={d.id}
            className="btn btn-ghost"
            aria-pressed={demo === d.id}
            onClick={() => pick(d.id)}
          >
            {d.name}
          </button>
        ))}
      </div>
      <p className="lab-line">{current.line}</p>

      {/* keyed, so a switch is a whole new device rather than one demo inheriting another's */}
      <current.Demo key={current.id} {...props} />

      {report && <GpuReport report={report} />}
    </div>
  )
}

/** label and value for each row of the report, in the order they read best */
function facts(report: Report): [string, ReactNode][] {
  return [
    ['Vendor', report.vendor],
    ['Architecture', report.architecture],
    ...(report.description ? [['Description', report.description] as [string, ReactNode]] : []),
    ['Canvas format', <code>{report.format}</code>],
    ...report.limits.map(([name, n]): [string, ReactNode] => [name, shownLimit(name, n)]),
  ]
}

function GpuReport({ report }: { report: Report }) {
  return (
    <details className="lab-report">
      <summary>What your GPU reports</summary>
      {report.software && (
        <p className="lab-warn">
          This is a software renderer — the browser is imitating a GPU on the processor, so expect
          it to be slow. A real graphics card is usually being withheld for a driver reason.
        </p>
      )}
      <dl className="lab-facts">
        {facts(report).map(([name, value]) => (
          <div key={name} className="lab-fact">
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted lab-features-head">Optional features: {report.features.length}</p>
      {report.features.length > 0 ? (
        <ul className="lab-features">
          {report.features.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None beyond the core set.</p>
      )}
    </details>
  )
}
