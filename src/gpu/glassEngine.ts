import code from './glass.wgsl?raw'
import { GLASS, PASSES, packGlass, type GlassFrame, type Rgb } from './glass'

export type GlassDab = { x: number; y: number; lay: boolean }

export type GlassView = {
  /** a new window: its lead, and panes to glaze once they are found (a cell in each, and a colour) */
  load(
    grid: readonly [number, number],
    lead: Uint8Array,
    glazed: readonly (readonly [number, number, Rgb])[],
  ): void
  frame(
    f: Omit<GlassFrame, 'dabs' | 'tap' | 'colour'>,
    dabs: readonly GlassDab[],
    tap: { at: readonly [number, number]; colour: Rgb } | null,
  ): void
  readonly buffers: { lead: GPUBuffer; labels: GPUBuffer; colour: GPUBuffer }
  destroy(): void
}

const MAX_DABS = 64
/** frames to keep finding panes after the lead has moved: 8 × PASSES is enough for a long spiral */
const SETTLE_FRAMES = 8

export async function createGlass(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<GlassView> {
  const C = GPUShaderStage.COMPUTE
  const F = GPUShaderStage.FRAGMENT
  const workLayout = device.createBindGroupLayout({
    label: 'glass work',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'storage' } },
      { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: C, buffer: { type: 'storage' } },
      { binding: 4, visibility: C, buffer: { type: 'storage' } },
      { binding: 5, visibility: C, buffer: { type: 'read-only-storage' } },
    ],
  })
  const showLayout = device.createBindGroupLayout({
    label: 'glass show',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 6, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: F, buffer: { type: 'read-only-storage' } },
    ],
  })
  const module = device.createShaderModule({ label: 'glass', code })
  const workPipes = device.createPipelineLayout({ bindGroupLayouts: [workLayout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: workPipes,
      compute: { module, entryPoint },
    })
  const [paint, seed, label, fill, show] = await Promise.all([
    compute('paint'),
    compute('seed'),
    compute('label'),
    compute('fill'),
    device.createRenderPipelineAsync({
      label: 'glass show',
      layout: device.createPipelineLayout({ bindGroupLayouts: [showLayout] }),
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const uniform = device.createBuffer({
    label: 'glass',
    size: GLASS.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const dabBuf = device.createBuffer({ label: 'glass dabs', size: MAX_DABS * 16, usage: S })
  const staging = new ArrayBuffer(GLASS.bytes)

  let grid: readonly [number, number] = [1, 1]
  let lead!: GPUBuffer
  let labels: GPUBuffer[] = []
  let colour!: GPUBuffer
  let work: GPUBindGroup[] = []
  let showGroup!: GPUBindGroup
  /** which of the two label buffers holds the labels as they stand */
  let cur = 0
  let settling = 0
  let last: Omit<GlassFrame, 'dabs' | 'tap' | 'colour'> = {
    w: 1,
    h: 1,
    grid: [1, 1],
    sun: [0, 0.5],
    brush: 2,
    floor: 0.35,
  }

  const groups = () => [Math.ceil(grid[0] / 8), Math.ceil(grid[1] / 8)] as const
  /* group k reads labels k and writes the other: every seed and every pass flips which is current */
  const run = (p: GPUComputePassEncoder, pipe: GPUComputePipeline, flips: boolean) => {
    p.setPipeline(pipe)
    p.setBindGroup(0, work[cur])
    p.dispatchWorkgroups(...groups())
    if (flips) cur = 1 - cur
  }
  const passes = (p: GPUComputePassEncoder, n: number) => {
    for (let k = 0; k < n; k++) run(p, label, true)
  }
  const write = (dabs: number, tap: readonly [number, number] | null, c: Rgb) =>
    device.queue.writeBuffer(uniform, 0, packGlass({ ...last, dabs, tap, colour: c }, staging))

  const view: GlassView = {
    get buffers() {
      return { lead, labels: labels[cur], colour }
    },
    load(next, l, glazed) {
      grid = next
      for (const b of [lead, ...labels, colour]) b?.destroy()
      const n = next[0] * next[1]
      lead = device.createBuffer({ label: 'glass lead', size: n * 4, usage: S })
      labels = [
        device.createBuffer({ label: 'glass labels', size: n * 4, usage: S }),
        device.createBuffer({ label: 'glass labels 2', size: n * 4, usage: S }),
      ]
      colour = device.createBuffer({ label: 'glass colour', size: n * 16, usage: S })
      work = [0, 1].map((k) =>
        device.createBindGroup({
          layout: workLayout,
          entries: [uniform, lead, labels[k], labels[1 - k], colour, dabBuf].map(
            (buffer, binding) => ({ binding, resource: { buffer } }),
          ),
        }),
      )
      showGroup = device.createBindGroup({
        layout: showLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 6, resource: { buffer: lead } },
          { binding: 7, resource: { buffer: colour } },
        ],
      })
      device.queue.writeBuffer(lead, 0, Uint32Array.from(l))
      cur = 0
      last = { ...last, grid: next }
      /* find the panes, all the way, then glaze the ones asked for — one submission each, as each
         needs its own tap and colour in the uniform */
      write(0, null, [0, 0, 0])
      {
        const e = device.createCommandEncoder()
        const p = e.beginComputePass()
        run(p, paint, false)
        run(p, seed, true)
        passes(p, PASSES * SETTLE_FRAMES)
        p.end()
        device.queue.submit([e.finish()])
      }
      for (const [x, y, c] of glazed) {
        write(0, [x, y], c)
        const e = device.createCommandEncoder()
        const p = e.beginComputePass()
        run(p, fill, false)
        p.end()
        device.queue.submit([e.finish()])
      }
      settling = 0
    },
    frame(f, dabs, tap) {
      last = f
      const n = Math.min(dabs.length, MAX_DABS)
      if (n)
        device.queue.writeBuffer(
          dabBuf,
          0,
          new Float32Array(dabs.slice(0, n).flatMap((d) => [d.x, d.y, d.lay ? 1 : 0, 0])),
        )
      write(n, tap?.at ?? null, tap?.colour ?? [0, 0, 0])
      const e = device.createCommandEncoder({ label: 'glass' })
      const p = e.beginComputePass()
      if (n) {
        /* the lead moved: the panes are found again from scratch */
        run(p, paint, false)
        run(p, seed, true)
        settling = SETTLE_FRAMES
      }
      if (tap && settling > 0) {
        /* a tap must fill the pane as it is: finish finding it first */
        passes(p, PASSES * settling)
        settling = 0
      } else if (settling > 0) {
        passes(p, PASSES)
        settling--
      }
      if (tap) run(p, fill, false)
      p.end()
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, showGroup)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [uniform, dabBuf, lead, ...labels, colour]) b?.destroy()
    },
  }
  return view
}
