import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  CATEGORIES,
  FILTER_KEY,
  META,
  entries,
  listed,
  readFilter,
  readFlags,
  type Category,
  type Flags,
} from '../lab/catalog'
import { labApi, noLabYet } from '../lab/feedback'
import { LabFeedback, type Viewer } from '../lab/LabFeedback'
import '../lab/lab-catalog.css'
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
import { JigsawDemo } from '../gpu/JigsawDemo'
import { PaletteDemo } from '../gpu/PaletteDemo'
import { BeamsDemo } from '../gpu/BeamsDemo'
import { BridgeDemo } from '../gpu/BridgeDemo'
import { EpicyclesDemo } from '../gpu/EpicyclesDemo'
import { OrbitDemo } from '../gpu/OrbitDemo'
import { WallpaperDemo } from '../gpu/WallpaperDemo'
import { NonogramDemo } from '../gpu/NonogramDemo'
import { GatesDemo } from '../gpu/GatesDemo'
import { SlideDemo } from '../gpu/SlideDemo'
import { MixDemo } from '../gpu/MixDemo'
import { IntervalsDemo } from '../gpu/IntervalsDemo'
import { GraphDemo } from '../gpu/GraphDemo'
import { SunDemo } from '../gpu/SunDemo'
import { SkipDemo } from '../gpu/SkipDemo'
import { VisionDemo } from '../gpu/VisionDemo'
import { GlideDemo } from '../gpu/GlideDemo'
import { PegDropDemo } from '../gpu/PegDropDemo'
import { StackDemo } from '../gpu/StackDemo'
import { RpsDemo } from '../gpu/RpsDemo'
import { DiceDemo } from '../gpu/DiceDemo'
import { PokerDemo } from '../gpu/PokerDemo'
import { PrintshopDemo } from '../gpu/PrintshopDemo'
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
  {
    id: 'printshop',
    name: 'Print shop',
    line: 'Print shop — carve a lino block with a gouge and pull prints from it, ink over ink: a reduction linocut, cut and printed on the GPU.',
    Demo: PrintshopDemo,
  },
  // after the catalog: registered in the database by the admin's next visit, not by the draft
  {
    id: 'jigsaw',
    name: 'Jigsaw',
    line: 'Jigsaw — six painted pictures or a photo of your own, cut into 12 to 154 pieces: drag them together on the felt, and they snap when they fit.',
    Demo: JigsawDemo,
  },
  {
    id: 'palette',
    name: 'Palette',
    line: 'Palette — pull a colour palette out of a picture or a photo of your own, lock what you like and re-roll the rest, see it redrawn in just those colours, and check which pairs read as text.',
    Demo: PaletteDemo,
  },
  {
    id: 'beams',
    name: 'Beams',
    line: 'Beams — place mirrors, splitters and colour filters to bring red, green and blue lasers to every target. Colours add: red and green make yellow.',
    Demo: BeamsDemo,
  },
  {
    id: 'bridge',
    name: 'Bridge',
    line: 'Bridge — build a bridge from road, timber and steel on a budget, then drive a cart across and watch every member strain, bend and snap.',
    Demo: BridgeDemo,
  },
  {
    id: 'epicycles',
    name: 'Epicycles',
    line: 'Epicycles — draw any shape and watch a chain of spinning arms redraw it: its Fourier series. Slide from one arm to a hundred and see the corners come in.',
    Demo: EpicyclesDemo,
  },
  {
    id: 'orbit',
    name: 'Orbit',
    line: 'Orbit — fly a probe round a planet with two buttons: speed up, slow down. Raise, lower and stretch the orbit onto the target, and escape — on as little fuel as the textbook says.',
    Demo: OrbitDemo,
  },
  {
    id: 'wallpaper',
    name: 'Wallpaper',
    line: 'Wallpaper — draw, and every stroke repeats across the wall by one of the seventeen ways a pattern can: turns, mirrors and glides. Then guess which group a pattern is.',
    Demo: WallpaperDemo,
  },
  {
    id: 'nonogram',
    name: 'Nonogram',
    line: 'Nonogram — fill the squares so every row and column matches its numbers, and a picture appears. Then draw your own: it tells you whether logic alone can solve it.',
    Demo: NonogramDemo,
  },
  {
    id: 'gates',
    name: 'Logic gates',
    line: 'Logic gates — wire switches to lamps through NAND and the gates you build from it, until the truth table is all ticks: NOT, AND, XOR, then adders that really add.',
    Demo: GatesDemo,
  },
  {
    id: 'slide',
    name: 'Slide',
    line: 'Slide — an ice puzzle: the puck slides until something stops it. Take every coin and come to rest on the goal in as few pushes as the solver did; then endless boards, each solved before you see it.',
    Demo: SlideDemo,
  },
  {
    id: 'mix',
    name: 'Paint mixer',
    line: 'Paint mixer — drop five paints into a cup to match a colour. They mix like real paint, light absorbed wavelength by wavelength, so yellow and blue make green; or mix freely and copy the colour.',
    Demo: MixDemo,
  },
  {
    id: 'intervals',
    name: 'Intervals',
    line: 'Intervals — two notes play: name the distance between them, from an octave to a semitone. Six stages, each opened by eight of ten, and the ones you miss come back more often.',
    Demo: IntervalsDemo,
  },
  {
    id: 'graph',
    name: 'Graph match',
    line: 'Graph match — type an equation and lay its curve on the dashed one: lines, parabolas, V shapes, waves. Or graph anything, with sliders a, b and c to see what each number does.',
    Demo: GraphDemo,
  },
  {
    id: 'sun',
    name: 'Sun path',
    line: 'Sun path — where the sun is for any place, day and hour: its path across the sky, sunrise, sunset, day length and a shadow. Then guess where the sun stands over Tromsø in March.',
    Demo: SunDemo,
  },
  {
    id: 'skip',
    name: 'Skipping stones',
    line: 'Skipping stones — drag back, let go while the stone is nearly flat, and count the skips. Six challenges, from three skips to twenty and under a bridge.',
    Demo: SkipDemo,
  },
  {
    id: 'vision',
    name: 'Colour sight',
    line: 'Colour sight — see a chart, a painting or your own picture as people with colour blindness do, and check whether two colours stay apart for everyone.',
    Demo: VisionDemo,
  },
  {
    id: 'glide',
    name: 'Soaring',
    line: 'Soaring — race a glider across country on thermals: set your airspeed, circle under clouds to climb, and get home faster than par. The real gliding rule, in five tasks.',
    Demo: GlideDemo,
  },
  {
    id: 'pegdrop',
    name: 'Peg drop',
    line: 'Peg drop — drop balls through twelve rows of pegs into slots that pay up to 170 times the drop. Pick your risk; every peg is a fair coin, and the odds are printed.',
    Demo: PegDropDemo,
  },
  {
    id: 'stack',
    name: 'Stackfall',
    line: 'Stackfall — falling blocks that get faster the longer you last. Survive alone, or race the computer or a friend on the same keyboard: clear rows to send junk up their well.',
    Demo: StackDemo,
  },
  {
    id: 'rps',
    name: 'Rock, paper, scissors',
    line: 'Rock, paper, scissors — against a mind-reader that hunts for your habits and tells you what it spotted, or a friend on the same keyboard. And a coin to call: how long a run can you get?',
    Demo: RpsDemo,
  },
  {
    id: 'dice',
    name: 'Ten thousand',
    line: 'Ten thousand — the push-your-luck dice game: keep what scores, then bank it or roll the rest and risk the lot. First to 10,000, against the computer or a friend, with the odds of every roll shown.',
    Demo: DiceDemo,
  },
  {
    id: 'poker',
    name: 'Hold’em',
    line: 'Hold’em — Texas hold’em for play chips against three computer players who each play their own way. They work out their odds by dealing the unseen cards hundreds of times. Last one with chips wins.',
    Demo: PokerDemo,
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

const GUEST: Viewer = { authed: false, suspended: false, isAdmin: false }
const KNOWN = new Set(DEMOS.map((d) => d.id))

function storedFilter(): Category | 'all' {
  try {
    return readFilter(localStorage.getItem(FILTER_KEY))
  } catch {
    return 'all'
  }
}

export function GpuLab({ viewer = GUEST }: { viewer?: Viewer }) {
  const [demo, setDemo] = useState<DemoId>(storedDemo)
  const [report, setReport] = useState<Report | null>(null)
  /* ⚠️ STILL UNTIL ASKED, under reduced motion. Every demo here is motion, so none can simply
     paint once and stop the way the backdrop does — the picture would be all there is. Each draws
     its first frame still, and Run is somebody choosing to watch it move. */
  const [running, setRunning] = useState(() => !motionReduced())
  useEffect(() => onMotionChange(() => motionReduced() && setRunning(false)), [])

  /* ── the catalog: the owner's flags, the vote totals a member may see, this browser's favourites.
     ⚠️ NONE OF IT IS NEEDED TO PLAY. Without a backend, offline, or before the answer arrives,
     every experiment is listed exactly as it always was; the server can only take away what the
     owner hid, and add what a signed-in member may be shown. */
  const api = useMemo(() => labApi(), [])
  const [flags, setFlags] = useState<Map<string, Flags>>(() => new Map())
  /** the ids the database's catalog lists — null until it has answered, and if it never does */
  const [inCatalog, setInCatalog] = useState<Set<string> | null>(null)
  /* ⚠️ EVERY TOY SHOWN, AND THE FILTER ONLY FADES (Evan, 9 Nov). A dropdown and a separate catalog
     with search, Recent, New and Highly rated replaced the row of names on 8 Nov; played with,
     the row was missed — seeing everything at once is the point of a lab. So all of them are
     buttons again, and choosing a kind fades the rest rather than hiding them: still one press
     away, just quieter. All is the default, and the choice is kept in this browser. */
  const [filter, setFilter] = useState<Category | 'all'>(storedFilter)
  const chooseFilter = (f: Category | 'all') => {
    setFilter(f)
    try {
      localStorage.setItem(FILTER_KEY, f)
    } catch {
      /* private mode: kept for this visit */
    }
  }
  /* ⚠️ THE FRONTEND CAN REACH PRODUCTION BEFORE ITS SQL DOES. Measured with every lab_* call
     answering as PostgREST does for a function that does not exist: a member was offered 👍 👎 and
     a note form, and a vote came back "Couldn't reach the server". So a catalog that is MISSING —
     not one that failed to arrive — closes feedback the way a build with no backend already does. */
  const [noFeedback, setNoFeedback] = useState(false)
  useEffect(() => {
    if (!api) return
    let live = true
    api
      .catalog()
      .then(async (raw) => {
        if (!live) return
        const ids = (r: unknown) =>
          new Set(
            Array.isArray(r)
              ? r.flatMap((x) => {
                  const id = (x as { id?: unknown })?.id
                  return typeof id === 'string' ? [id] : []
                })
              : [],
          )
        setFlags(readFlags(raw, KNOWN))
        const seen = ids(raw)
        // the owner's own Lab registers an experiment the database has not met yet
        const fresh = DEMOS.map((d) => d.id).filter((id) => !seen.has(id))
        if (viewer.isAdmin && fresh.length && (await api.register(fresh)) > 0 && live) {
          const again = await api.catalog()
          if (!live) return
          setFlags(readFlags(again, KNOWN))
          return setInCatalog(ids(again))
        }
        // only an answer that is a list says what is missing from it
        if (Array.isArray(raw)) setInCatalog(seen)
      })
      .catch((e: unknown) => {
        /* no catalog: every experiment stays listed, nothing counted — the Lab still plays */
        if (live && noLabYet(e)) setNoFeedback(true)
      })
    return () => {
      live = false
    }
  }, [api, viewer.authed, viewer.isAdmin])
  const all = useMemo(() => entries(DEMOS, flags), [flags])
  const visible = useMemo(() => all.filter((e) => listed(e, viewer.isAdmin)), [all, viewer.isAdmin])
  const shownDemos = useMemo(() => {
    const ids = new Set(visible.map((e) => e.id))
    return DEMOS.filter((d) => ids.has(d.id))
  }, [visible])

  const pick = (id: DemoId) => {
    setDemo(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* private mode: it applies for this visit */
    }
  }
  const patchFlags = (id: string, patch: Partial<Flags>) =>
    setFlags((was) => {
      const next = new Map(was)
      next.set(id, {
        ...(was.get(id) ?? { featured: false, experiment: false, hidden: false }),
        ...patch,
      })
      return next
    })
  const onAdapter = (adapter: GPUAdapter, format: GPUTextureFormat) =>
    setReport(reportOf(adapter, format))
  const props = { running, setRunning, onAdapter }
  // a demo the owner hid is not offered; somebody who had it open lands on the first one listed
  const at = Math.max(
    0,
    shownDemos.findIndex((d) => d.id === demo),
  )
  const current = shownDemos[at] ?? DEMOS[0]
  const currentFlags = flags.get(current.id)

  const counts = useMemo(() => {
    const n = new Map<Category, number>()
    for (const d of shownDemos) {
      const c = META[d.id]?.category
      if (c) n.set(c, (n.get(c) ?? 0) + 1)
    }
    return n
  }, [shownDemos])
  return (
    <div className="lab">
      <div className="lab-filter" role="group" aria-label="Show which kind">
        <button
          className="btn btn-ghost"
          aria-pressed={filter === 'all'}
          onClick={() => chooseFilter('all')}
        >
          All {shownDemos.length}
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className="btn btn-ghost"
            aria-pressed={filter === c.id}
            onClick={() => chooseFilter(filter === c.id ? 'all' : c.id)}
          >
            {c.label.split(' — ')[0]} {counts.get(c.id) ?? 0}
          </button>
        ))}
      </div>
      <div className="lab-picker" role="group" aria-label="Which experiment">
        {shownDemos.map((d) => {
          const other = filter !== 'all' && META[d.id]?.category !== filter
          return (
            <button
              key={d.id}
              className={`btn btn-ghost${other ? ' lab-other' : ''}`}
              aria-pressed={current.id === d.id}
              onClick={() => pick(d.id)}
            >
              {d.name}
            </button>
          )
        })}
      </div>

      <p className="lab-line">
        {currentFlags?.featured && <span className="lab-badge">⭐ Featured</span>}
        {currentFlags?.experiment && <span className="lab-badge">🧪 Rough edges</span>}
        {viewer.isAdmin && currentFlags?.hidden && (
          <span className="lab-badge lab-badge-off">🙈 Hidden</span>
        )}
        {current.line}
      </p>

      {/* keyed, so a switch is a whole new device rather than one demo inheriting another's */}
      <current.Demo key={current.id} {...props} />

      <LabFeedback
        api={noFeedback ? null : api}
        demo={current.id}
        name={current.name}
        flags={currentFlags}
        viewer={viewer}
        onFlags={patchFlags}
        listed={inCatalog ? inCatalog.has(current.id) : undefined}
      />

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
