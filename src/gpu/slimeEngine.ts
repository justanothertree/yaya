import types from './slime-types.wgsl?raw'
import stepCode from './slime-step.wgsl?raw'
import drawCode from './slime-draw.wgsl?raw'
import {
  MAX_DABS,
  SLIME,
  packDabs,
  packSlime,
  type Dab,
  type Habit,
  type SlimePalette,
} from './slime'

export type SlimeView = {
  /** a fresh grid: agents (x, y, heading, -), and what each cell is */
  load(
    agents: Float32Array<ArrayBuffer>,
    kinds: Uint32Array<ArrayBuffer>,
    w: number,
    h: number,
  ): void
  frame(f: {
    dabs: readonly Dab[]
    steps: number
    habit: Habit
    palette: SlimePalette
    time: number
  }): void
  readonly buffers: { trail: GPUBuffer; deposits: GPUBuffer; agents: GPUBuffer } | null
  destroy(): void
}

export async function createSlime(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<SlimeView> {
  const C = GPUShaderStage.COMPUTE
  const rw = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: C,
    buffer: { type: 'storage' },
  })
  const ro = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: C,
    buffer: { type: 'read-only-storage' },
  })
  const stepLayout = device.createBindGroupLayout({
    label: 'slime step',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      rw(1),
      ro(2),
      rw(3),
      rw(4),
      rw(5),
      ro(6),
    ],
  })
  const stepModule = device.createShaderModule({ label: 'slime step', code: types + stepCode })
  const drawModule = device.createShaderModule({ label: 'slime draw', code: types + drawCode })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [stepLayout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout,
      compute: { module: stepModule, entryPoint },
    })
  const [paint, walk, spread, show] = await Promise.all([
    compute('paint'),
    compute('walk'),
    compute('spread'),
    device.createRenderPipelineAsync({
      label: 'slime show',
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'cover' },
      fragment: { module: drawModule, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'slime',
    size: SLIME.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const dabBuf = device.createBuffer({
    label: 'slime dabs',
    size: MAX_DABS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(SLIME.bytes)

  type Bufs = {
    agents: GPUBuffer
    trail: [GPUBuffer, GPUBuffer]
    deposits: GPUBuffer
    kinds: GPUBuffer
  }
  let b: Bufs | null = null
  let size: [number, number] = [1, 1]
  let count = 0
  let step = 0

  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const groupFor = (from: GPUBuffer, to: GPUBuffer) =>
    device.createBindGroup({
      layout: stepLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: b!.agents } },
        { binding: 2, resource: { buffer: from } },
        { binding: 3, resource: { buffer: to } },
        { binding: 4, resource: { buffer: b!.deposits } },
        { binding: 5, resource: { buffer: b!.kinds } },
        { binding: 6, resource: { buffer: dabBuf } },
      ],
    })

  return {
    get buffers() {
      return b && { trail: b.trail[0], deposits: b.deposits, agents: b.agents }
    },
    load(agents, kinds, w, h) {
      if (b) [b.agents, ...b.trail, b.deposits, b.kinds].forEach((x) => x.destroy())
      size = [w, h]
      count = agents.length / 4
      const make = (label: string, bytes: number) =>
        device.createBuffer({ label, size: bytes, usage })
      b = {
        agents: make('slime agents', agents.byteLength),
        trail: [make('slime trail a', w * h * 4), make('slime trail b', w * h * 4)],
        deposits: make('slime deposits', w * h * 4),
        kinds: make('slime kinds', w * h * 4),
      }
      device.queue.writeBuffer(b.agents, 0, agents)
      device.queue.writeBuffer(b.kinds, 0, kinds)
    },
    frame({ dabs, steps, habit, palette, time }) {
      if (!b) return
      const [w, h] = size
      const put = (n: number) =>
        device.queue.writeBuffer(
          uniform,
          0,
          packSlime({ w, h, agents: count, step, habit, palette, dabs: n, time }, staging),
        )
      const nd = Math.min(dabs.length, MAX_DABS)
      if (nd) device.queue.writeBuffer(dabBuf, 0, packDabs(dabs))
      /* one submission a step, each with its own step number for the dice */
      for (let k = 0; k < Math.max(steps, nd ? 1 : 0); k++) {
        put(k === 0 ? nd : 0)
        const e = device.createCommandEncoder()
        const p = e.beginComputePass()
        const g = groupFor(b.trail[0], b.trail[1])
        if (k === 0 && nd) {
          p.setPipeline(paint)
          p.setBindGroup(0, g)
          p.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
        }
        if (steps > 0) {
          p.setPipeline(walk)
          p.setBindGroup(0, g)
          p.dispatchWorkgroups(Math.ceil(count / 64))
          p.setPipeline(spread)
          p.setBindGroup(0, g)
          p.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
        }
        p.end()
        device.queue.submit([e.finish()])
        if (steps > 0) {
          b.trail = [b.trail[1], b.trail[0]]
          step++
        }
      }
      put(0)
      const e = device.createCommandEncoder({ label: 'slime show' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(
        0,
        device.createBindGroup({
          layout: show.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: { buffer: b.trail[0] } },
            { binding: 2, resource: { buffer: b.kinds } },
          ],
        }),
      )
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      if (b) [b.agents, ...b.trail, b.deposits, b.kinds].forEach((x) => x.destroy())
      uniform.destroy()
      dabBuf.destroy()
    },
  }
}
