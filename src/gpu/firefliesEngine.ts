import types from './fireflies-types.wgsl?raw'
import stepCode from './fireflies-step.wgsl?raw'
import drawCode from './fireflies-draw.wgsl?raw'
import { CELLS, FLIES, ordersOf, packFlies, type FliesFrame } from './fireflies'

export type FirefliesView = {
  /** step every clock by f.dt (0 just draws), then draw the meadow */
  frame(f: FliesFrame): void
  /** a fresh crowd: x, y, phase, pace for each */
  load(flies: Float32Array<ArrayBuffer>): void
  /**
   * How in step the meadow is (`ordersOf`), from the patches' own sums — read back from the GPU,
   * so it is what the fireflies were steering by. Null while an earlier read is in flight.
   */
  order(): Promise<{ near: number; all: number } | null>
  readonly flies: GPUBuffer
  readonly sums: GPUBuffer
  readonly count: number
  destroy(): void
}

const PATCHES = CELLS[0] * CELLS[1]
const SUMS = PATCHES * 3 * 4

export async function createFireflies(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  first: Float32Array<ArrayBuffer>,
): Promise<FirefliesView> {
  const C = GPUShaderStage.COMPUTE
  const V = GPUShaderStage.VERTEX
  const stepLayout = device.createBindGroupLayout({
    label: 'fireflies step',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'storage' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
    ],
  })
  const drawLayout = device.createBindGroupLayout({
    label: 'fireflies draw',
    entries: [
      { binding: 0, visibility: V | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
    ],
  })
  const stepModule = device.createShaderModule({ label: 'fireflies step', code: types + stepCode })
  const drawModule = device.createShaderModule({ label: 'fireflies draw', code: types + drawCode })
  const stepPipes = device.createPipelineLayout({ bindGroupLayouts: [stepLayout] })
  const drawPipes = device.createPipelineLayout({ bindGroupLayouts: [drawLayout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: stepPipes,
      compute: { module: stepModule, entryPoint },
    })
  /* every glow is ADDED to the dark: where a crowd flashes together, the meadow lights up */
  const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
  const [clear, gather, tick, night, fly] = await Promise.all([
    compute('clear'),
    compute('gather'),
    compute('tick'),
    device.createRenderPipelineAsync({
      label: 'fireflies night',
      layout: drawPipes,
      vertex: { module: drawModule, entryPoint: 'cover' },
      fragment: { module: drawModule, entryPoint: 'night', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
    device.createRenderPipelineAsync({
      label: 'fireflies fly',
      layout: drawPipes,
      vertex: { module: drawModule, entryPoint: 'fly' },
      fragment: {
        module: drawModule,
        entryPoint: 'spark',
        targets: [{ format, blend: { color: add, alpha: add } }],
      },
      primitive: { topology: 'triangle-list' },
    }),
  ])

  const uniform = device.createBuffer({
    label: 'fireflies',
    size: FLIES.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const sums = device.createBuffer({
    label: 'fireflies sums',
    size: SUMS,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const readback = device.createBuffer({
    label: 'fireflies readback',
    size: SUMS,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(FLIES.bytes)

  let count = 0
  let flies!: GPUBuffer
  let stepGroup!: GPUBindGroup
  let drawGroup!: GPUBindGroup
  let reading = false
  const load = (data: Float32Array<ArrayBuffer>) => {
    flies?.destroy()
    count = data.length / 4
    flies = device.createBuffer({
      label: 'fireflies flies',
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    device.queue.writeBuffer(flies, 0, data)
    const entries = [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: flies } },
    ]
    stepGroup = device.createBindGroup({
      layout: stepLayout,
      entries: [...entries, { binding: 2, resource: { buffer: sums } }],
    })
    drawGroup = device.createBindGroup({ layout: drawLayout, entries })
  }
  load(first)

  return {
    get flies() {
      return flies
    },
    sums,
    get count() {
      return count
    },
    load,
    async order() {
      if (reading) return null
      reading = true
      const e = device.createCommandEncoder()
      e.copyBufferToBuffer(sums, 0, readback, 0, SUMS)
      device.queue.submit([e.finish()])
      try {
        await readback.mapAsync(GPUMapMode.READ)
        const s = new Int32Array(readback.getMappedRange().slice(0))
        readback.unmap()
        return ordersOf(s)
      } catch {
        /* destroyed mid-read, leaving the toy: there is nobody to tell */
        return null
      } finally {
        reading = false
      }
    },
    frame(f) {
      device.queue.writeBuffer(uniform, 0, packFlies({ ...f, count }, staging))
      const e = device.createCommandEncoder({ label: 'fireflies' })
      /* the sums are always taken, even paused, so the readout and the probe see this crowd */
      const p = e.beginComputePass()
      p.setBindGroup(0, stepGroup)
      p.setPipeline(clear)
      p.dispatchWorkgroups(Math.ceil((PATCHES * 3) / 64))
      p.setPipeline(gather)
      p.dispatchWorkgroups(Math.ceil(count / 64))
      if (f.dt > 0) {
        p.setPipeline(tick)
        p.dispatchWorkgroups(Math.ceil(count / 64))
      }
      p.end()
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setBindGroup(0, drawGroup)
      rp.setPipeline(night)
      rp.draw(3)
      rp.setPipeline(fly)
      rp.draw(count * 6)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      flies.destroy()
      uniform.destroy()
      sums.destroy()
      readback.destroy()
    },
  }
}
