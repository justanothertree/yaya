import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { AquariumDemo } from '../gpu/AquariumDemo'
import { BlackHoleDemo } from '../gpu/BlackHoleDemo'
import { BubblesDemo } from '../gpu/BubblesDemo'
import { ClayDemo } from '../gpu/ClayDemo'
import { ClothDemo } from '../gpu/ClothDemo'
import { CrittersDemo } from '../gpu/CrittersDemo'
import { ErosionDemo } from '../gpu/ErosionDemo'
import { FerroDemo } from '../gpu/FerroDemo'
import { FirefliesDemo } from '../gpu/FirefliesDemo'
import { FluidDemo } from '../gpu/FluidDemo'
import { FractalDemo } from '../gpu/FractalDemo'
import { GalaxyDemo } from '../gpu/GalaxyDemo'
import { GlassDemo } from '../gpu/GlassDemo'
import { GrowthDemo } from '../gpu/GrowthDemo'
import { HarmonographDemo } from '../gpu/HarmonographDemo'
import { HarpDemo } from '../gpu/HarpDemo'
import { KaleidoDemo } from '../gpu/KaleidoDemo'
import { LavaDemo } from '../gpu/LavaDemo'
import { LifeDemo } from '../gpu/LifeDemo'
import { LightDemo } from '../gpu/LightDemo'
import { LightningDemo } from '../gpu/LightningDemo'
import { LoomDemo } from '../gpu/LoomDemo'
import { MarbleDemo } from '../gpu/MarbleDemo'
import { MarblesDemo } from '../gpu/MarblesDemo'
import { MirrorDemo } from '../gpu/MirrorDemo'
import { MusicDemo } from '../gpu/MusicDemo'
import { NeonDemo } from '../gpu/NeonDemo'
import { PixelSortDemo } from '../gpu/PixelSortDemo'
import { PondDemo } from '../gpu/PondDemo'
import { RainDemo } from '../gpu/RainDemo'
import { RibbonsDemo } from '../gpu/RibbonsDemo'
import { SandDemo } from '../gpu/SandDemo'
import { SlimeDemo } from '../gpu/SlimeDemo'
import { SnowflakeDemo } from '../gpu/SnowflakeDemo'
import { SquishDemo } from '../gpu/SquishDemo'
import { StrutDemo } from '../gpu/StrutDemo'
import { GustDemo } from '../gpu/GustDemo'
import { SeedlingDemo } from '../gpu/SeedlingDemo'
import { MobiusDemo } from '../gpu/MobiusDemo'
import { PinballDemo } from '../gpu/PinballDemo'
import { CrossingDemo } from '../gpu/CrossingDemo'
import { ShadowboxDemo } from '../gpu/ShadowboxDemo'
import { FoldDemo } from '../gpu/FoldDemo'
import { ToppleDemo } from '../gpu/ToppleDemo'
import { StudioDemo } from '../gpu/StudioDemo'
import { SwarmDemo } from '../gpu/SwarmDemo'
import { TrialsDemo } from '../gpu/TrialsDemo'
import { TunnelDemo } from '../gpu/TunnelDemo'
import { VoiceprintDemo } from '../gpu/VoiceprintDemo'
import { WaterworksDemo } from '../gpu/WaterworksDemo'
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
  {
    id: 'growth',
    Demo: GrowthDemo,
    name: 'Growth',
    line: 'Growth — two chemicals reacting on a grid grow coral, dividing cells, worms or mazes. Seed it and watch.',
  },
  {
    id: 'aquarium',
    Demo: AquariumDemo,
    name: 'Aquarium',
    line: 'Aquarium — fish that school with their own kind. Tap to feed them; drag and you are the shark.',
  },
  {
    id: 'tunnel',
    Demo: TunnelDemo,
    name: 'Tunnel',
    line: 'Tunnel — fly down an endless tunnel and catch the orbs. Drag to steer, or tilt the phone.',
  },
  {
    id: 'cloth',
    Demo: ClothDemo,
    name: 'Cloth',
    line: 'Cloth — grab it, pull it, tear it, cut it. Let go mid-swing and it flies.',
  },
  {
    id: 'ribbons',
    Demo: RibbonsDemo,
    name: 'Ribbons',
    line: 'Ribbons — light that dances by itself. Lead it with a finger, or let the music move it.',
  },
  {
    id: 'fractal',
    Demo: FractalDemo,
    name: 'Fractal',
    line: 'Fractal — pinch into the Mandelbrot set, or let it dive, a hundred million times deeper than the GPU’s own numbers reach.',
  },
  {
    id: 'light',
    Demo: LightDemo,
    name: 'Light',
    line: 'Light — move lamps, pillars and walls round a dark room; the soft shadows and mixed colours work themselves out.',
  },
  {
    id: 'harp',
    Demo: HarpDemo,
    name: 'Harp',
    line: 'Harp — strum the strings with as many fingers as you like; they swing and sing.',
  },
  {
    id: 'neon',
    Demo: NeonDemo,
    name: 'Neon',
    line: 'Neon — type a word and it becomes a neon sign. Letters stutter on; tap it to knock it.',
  },
  {
    id: 'sand',
    Demo: SandDemo,
    name: 'Sand',
    line: 'Sand — pour sand and water, wall it in, and turn the box over (or tilt the phone).',
  },
  {
    id: 'pond',
    Demo: PondDemo,
    name: 'Pond',
    line: 'Pond — touch the water and watch the ripples bend the light on the floor beneath.',
  },

  {
    id: 'slime',
    name: 'Slime',
    line: 'Slime — lay food and a slime mould grows a glowing network to it, routing round your walls.',
    Demo: SlimeDemo,
  },
  {
    id: 'mirror',
    name: 'Mirror',
    line: 'Mirror — your camera, with time you can paint: brush part of the picture and it lags behind.',
    Demo: MirrorDemo,
  },
  {
    id: 'bubbles',
    name: 'Bubbles',
    line: 'Bubbles — hold to blow a soap bubble, let go to send it off, tap one to pop it.',
    Demo: BubblesDemo,
  },
  {
    id: 'clay',
    name: 'Clay',
    line: 'Clay — sculpt a lump of clay in 3D: add, carve and smooth with a finger, and turn it round.',
    Demo: ClayDemo,
  },
  {
    id: 'fireflies',
    name: 'Fireflies',
    line: 'Fireflies — a night meadow that falls into flashing together. Tap a rhythm and it follows.',
    Demo: FirefliesDemo,
  },
  {
    id: 'blackhole',
    name: 'Black hole',
    line: 'Black hole — drag one across the sky and throw it; every pixel bends its light round it.',
    Demo: BlackHoleDemo,
  },

  {
    id: 'erosion',
    name: 'Erosion',
    line: 'Erosion — rain on a landscape and watch it carve valleys, rivers and lakes. Raise and dig to steer it.',
    Demo: ErosionDemo,
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    line: 'Snowflake — a crystal of ice grows six arms in damp air. Blow on the microphone, or breathe on it with a finger.',
    Demo: SnowflakeDemo,
  },
  {
    id: 'pixelsort',
    name: 'Pixel sort',
    line: 'Pixel sort — swipe across a picture and its pixels sort themselves that way, melting into streaks.',
    Demo: PixelSortDemo,
  },
  {
    id: 'squish',
    name: 'Squish',
    line: 'Squish — a picture made of jelly. Grab it with as many fingers as you like, pin it, let go and it wobbles.',
    Demo: SquishDemo,
  },
  {
    id: 'lightning',
    name: 'Lightning',
    line: 'Lightning — tap the sky to plant a lightning rod and call a bolt down to it, thunder and all.',
    Demo: LightningDemo,
  },
  {
    id: 'voiceprint',
    name: 'Voiceprint',
    line: 'Voiceprint — a picture of sound. Sing into it, paint on it, and play it back.',
    Demo: VoiceprintDemo,
  },

  {
    id: 'marbles',
    name: 'Marble maze',
    line: 'Marble maze — tilt a wooden maze full of marbles; draw walls, dig holes, pour in more.',
    Demo: MarblesDemo,
  },
  {
    id: 'glass',
    name: 'Stained glass',
    line: 'Stained glass — draw lead, tap panes to glaze them, and move the sun to throw the colours across the floor.',
    Demo: GlassDemo,
  },
  {
    id: 'harmonograph',
    name: 'Harmonograph',
    line: 'Harmonograph — flick the paper to swing the pendulums, and the pen draws their figure as they slow.',
    Demo: HarmonographDemo,
  },
  {
    id: 'rain',
    name: 'Rain on glass',
    line: 'Rain on glass — write in the mist, breathe it back, and tilt the window to make the rain run.',
    Demo: RainDemo,
  },
  {
    id: 'loom',
    name: 'Loom',
    line: 'Loom — thread the warp, tie up the treadles, treadle a tune, and watch the cloth weave.',
    Demo: LoomDemo,
  },
  {
    id: 'ferro',
    name: 'Ferrofluid',
    line: 'Ferrofluid — press and hold under a dish of black liquid and it bristles into spikes; or let it dance to the music.',
    Demo: FerroDemo,
  },
  /* batch 8 — games and builders */
  {
    id: 'trials',
    name: 'Bike trials',
    line: 'Bike trials — throttle, brake and lean a dirt bike over a quarry course against the clock.',
    Demo: TrialsDemo,
  },
  {
    id: 'waterworks',
    name: 'Waterworks',
    line: 'Waterworks — get the water into the cup: route it with walls, freeze it into bridges, boil it over the top.',
    Demo: WaterworksDemo,
  },
  {
    id: 'studio',
    name: 'Film studio',
    line: 'Film studio — pose actors, place props and lamps, frame it with a real lens, and shoot a path-traced picture to keep.',
    Demo: StudioDemo,
  },
  {
    id: 'critters',
    name: 'Critters',
    line: 'Critters — build a creature from joints, bones and muscles, then race 256 copies and watch them learn to walk.',
    Demo: CrittersDemo,
  },
  /* batch 9 — remixes and new things to make */
  {
    id: 'strut',
    name: 'Strut',
    line: 'Strut — a creature whose step sequencer is its gait and its song: find a groove that walks it to the flag.',
    Demo: StrutDemo,
  },
  {
    id: 'gust',
    name: 'Gust',
    line: 'Gust — air hockey with no mallets: steer a fan, blow real wind through the rink and let the air carry the puck. Against the computer or a friend.',
    Demo: GustDemo,
  },
  {
    id: 'seedling',
    name: 'Seedling',
    line: 'Seedling — Life as a puzzle: plant a few seed cells so what grows lights every lamp in the garden. Then make gardens of your own, rule and all.',
    Demo: SeedlingDemo,
  },
  // batch 10 — new territory
  {
    id: 'mobius',
    name: 'Möbius golf',
    line: 'Möbius golf — glue the green’s edges into a cylinder, a Möbius band, a torus or a Klein bottle, and play the hole through them.',
    Demo: MobiusDemo,
  },
  {
    id: 'pinball',
    name: 'Pinball workshop',
    line: 'Pinball workshop — draw your own pinball table, walls, bumpers and targets, then play it with the flippers.',
    Demo: PinballDemo,
  },
  {
    id: 'crossing',
    name: 'Night crossing',
    line: 'Night crossing — a boat through a rocky channel in the dark, for two: one steers, one aims the searchlight. Only what the beam lights can be seen.',
    Demo: CrossingDemo,
  },
  // batch 11
  {
    id: 'shadowbox',
    name: 'Shadow box',
    line: 'Shadow box — rebuild a hidden stack of blocks from the shadows it throws. Puzzles with par, or pass and play: one hides, one rebuilds.',
    Demo: ShadowboxDemo,
  },
  {
    id: 'fold',
    name: 'Fold',
    line: 'Fold — pick up a point of a square of paper and lay it down: fold it into the shape asked for, in as few folds as you can, or make your own.',
    Demo: FoldDemo,
  },
  // batch 12
  {
    id: 'topple',
    name: 'Topple',
    line: 'Topple — draw lines of dominoes, paint their faces and push one: a picture appears as they fall. Puzzles ring bells with one push.',
    Demo: ToppleDemo,
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
