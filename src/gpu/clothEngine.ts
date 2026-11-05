import types from './cloth-types.wgsl?raw'
import sim from './cloth-sim.wgsl?raw'
import draw from './cloth-draw.wgsl?raw'
import {
  CLOTH,
  ITERS,
  PHASES,
  STEP,
  edgeCounts,
  gridFor,
  packCloth,
  seedCloth,
  type Fabric,
  type Finger,
  type Grid,
  type Pins,
  type Tool,
} from './cloth'

export type ClothInput = {
  fingers: readonly Finger[]
  tool: Tool
  wind: number
  fabric: Fabric
}

export type ClothSim = {
  frame(dt: number, input: ClothInput): void
  /** a fresh cloth, hung by `pins` */
  hang(pins: Pins): void
  resize(): void
  destroy(): void
  /** for the Lab's probes: the buffers as they stand */
  readonly grid: Grid
  readonly buffers: { pos: GPUBuffer; broken: GPUBuffer }
}

/** a uniform's dynamic offset must be a multiple of this on every device */
const SLOT = 256
/** at most this many steps a frame: a slow frame runs slow rather than exploding */
const MAX_STEPS = 3
/** slots: one per step's integrate, one per phase, one for the cut and the drawing */
const RELAX0 = MAX_STEPS
const LAST = MAX_STEPS + PHASES
const SLOTS = LAST + 1

export async function createCloth(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
  touch: boolean,
  pins0: Pins,
): Promise<ClothSim> {
  const simModule = device.createShaderModule({ label: 'cloth sim', code: types + sim })
  const drawModule = device.createShaderModule({ label: 'cloth draw', code: types + draw })
  const C = GPUShaderStage.COMPUTE
  const uniformEntry = (visibility: number): GPUBindGroupLayoutEntry => ({
    binding: 0,
    visibility,
    buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: CLOTH.bytes },
  })
  const simLayout = device.createBindGroupLayout({
    label: 'cloth sim',
    entries: [
      uniformEntry(C),
      ...[1, 2, 3, 4].map((binding) => ({
        binding,
        visibility: C,
        buffer: { type: 'storage' as const },
      })),
    ],
  })
  const V = GPUShaderStage.VERTEX
  const drawLayout = device.createBindGroupLayout({
    label: 'cloth draw',
    entries: [
      uniformEntry(V | GPUShaderStage.FRAGMENT),
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
    ],
  })
  const simPipes = device.createPipelineLayout({ bindGroupLayouts: [simLayout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: simPipes,
      compute: { module: simModule, entryPoint },
    })
  const [integrate, relax, cut, sheet] = await Promise.all([
    compute('integrate'),
    compute('relax'),
    compute('cut'),
    device.createRenderPipelineAsync({
      label: 'cloth',
      layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
      vertex: { module: drawModule, entryPoint: 'sheet' },
      fragment: { module: drawModule, entryPoint: 'weave', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    }),
  ])

  const uniform = device.createBuffer({
    label: 'cloth',
    size: SLOT * SLOTS,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(SLOT * SLOTS)

  type Bufs = { pos: GPUBuffer; prev: GPUBuffer; grab: GPUBuffer; broken: GPUBuffer }
  let g: Grid = gridFor(1, touch)
  let bufs: Bufs | null = null
  let simGroup: GPUBindGroup | null = null
  let drawGroup: GPUBindGroup | null = null
  let edges = 0
  let pins = pins0
  let time = 0

  function hang(p: Pins) {
    pins = p
    const aspect = canvas.width / Math.max(1, canvas.height)
    g = gridFor(aspect, touch)
    const n = g.cols * g.rows
    edges = edgeCounts(g).reduce((a, b) => a + b, 0)
    if (bufs) for (const b of Object.values(bufs)) b.destroy()
    const make = (label: string, size: number) =>
      device.createBuffer({
        label,
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      })
    bufs = {
      pos: make('cloth pos', n * 16),
      prev: make('cloth prev', n * 16),
      grab: make('cloth grab', n * 16),
      broken: make('cloth broken', edges * 4),
    }
    const seed = seedCloth(g, pins)
    device.queue.writeBuffer(bufs.pos, 0, seed.pos as Float32Array<ArrayBuffer>)
    device.queue.writeBuffer(bufs.prev, 0, seed.prev as Float32Array<ArrayBuffer>)
    const b = bufs
    simGroup = device.createBindGroup({
      layout: simLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform, size: CLOTH.bytes } },
        { binding: 1, resource: { buffer: b.pos } },
        { binding: 2, resource: { buffer: b.prev } },
        { binding: 3, resource: { buffer: b.grab } },
        { binding: 4, resource: { buffer: b.broken } },
      ],
    })
    drawGroup = device.createBindGroup({
      layout: drawLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform, size: CLOTH.bytes } },
        { binding: 1, resource: { buffer: b.pos } },
        { binding: 2, resource: { buffer: b.broken } },
      ],
    })
  }

  let depth: GPUTexture | null = null
  function resize() {
    depth?.destroy()
    depth = device.createTexture({
      size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    /* a cloth cut to fit one shape of screen does not fit another: hang a fresh one */
    hang(pins)
  }
  resize()

  const groups = (n: number) => Math.ceil(n / 64)

  return {
    get grid() {
      return g
    },
    get buffers() {
      return { pos: bufs!.pos, broken: bufs!.broken }
    },
    frame(dt, input) {
      if (!bufs || !simGroup || !drawGroup || !depth) return
      const aspect = canvas.width / Math.max(1, canvas.height)
      const steps = dt > 0 ? Math.max(1, Math.min(MAX_STEPS, Math.round(dt / STEP))) : 0
      const bytes = new Uint8Array(staging)
      const put = (slot: number, step: number, phase: number, pressed: boolean) =>
        bytes.set(
          new Uint8Array(
            packCloth({
              g,
              fingers: input.fingers.map((f) => ({ ...f, pressed: f.pressed && pressed })),
              phase,
              tool: input.tool,
              time: time + step * STEP,
              wind: input.wind,
              aspect,
              fabric: input.fabric,
              step,
              steps: Math.max(1, steps),
            }),
          ),
          slot * SLOT,
        )
      for (let k = 0; k < MAX_STEPS; k++) put(k, k, 0, k === 0)
      for (let p = 0; p < PHASES; p++) put(RELAX0 + p, 0, p, false)
      put(LAST, 0, 0, false)
      device.queue.writeBuffer(uniform, 0, staging)
      time += steps * STEP

      const encoder = device.createCommandEncoder({ label: 'cloth frame' })
      if (steps > 0) {
        const n = g.cols * g.rows
        const counts = edgeCounts(g)
        const pass = encoder.beginComputePass({ label: 'cloth' })
        if (input.tool === 'cut' && input.fingers.some((f) => f.down)) {
          pass.setPipeline(cut)
          pass.setBindGroup(0, simGroup, [LAST * SLOT])
          pass.dispatchWorkgroups(groups(edges))
        }
        for (let k = 0; k < steps; k++) {
          pass.setPipeline(integrate)
          pass.setBindGroup(0, simGroup, [k * SLOT])
          pass.dispatchWorkgroups(groups(n))
          pass.setPipeline(relax)
          for (let it = 0; it < ITERS; it++)
            for (let p = 0; p < PHASES; p++) {
              pass.setBindGroup(0, simGroup, [(RELAX0 + p) * SLOT])
              pass.dispatchWorkgroups(groups(counts[p >> 1]))
            }
        }
        pass.end()
      }
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.06, g: 0.07, b: 0.1, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        },
      })
      rp.setPipeline(sheet)
      rp.setBindGroup(0, drawGroup, [LAST * SLOT])
      rp.draw((g.cols - 1) * (g.rows - 1) * 6)
      rp.end()
      device.queue.submit([encoder.finish()])
    },
    hang,
    resize,
    destroy() {
      if (bufs) for (const b of Object.values(bufs)) b.destroy()
      depth?.destroy()
      uniform.destroy()
      bufs = null
    },
  }
}
