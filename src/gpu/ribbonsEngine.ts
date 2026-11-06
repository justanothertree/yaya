import types from './ribbons-types.wgsl?raw'
import move from './ribbons-move.wgsl?raw'
import draw from './ribbons-draw.wgsl?raw'
import { COUNTS, LENGTH, RIBBONS, danceAt, packRibbons, type RibbonFrame } from './ribbons'

const MAX = COUNTS[COUNTS.length - 1]

export type RibbonsView = {
  /** advance by `dt` (0 draws where it stands); the frame's `head` is chosen here */
  frame(dt: number, f: Omit<RibbonFrame, 'head' | 'dt'>): void
  /** each ribbon's colour, linear rgb */
  paint(colours: readonly (readonly [number, number, number])[]): void
  destroy(): void
  /** for the Lab's probes */
  readonly buffers: { trail: GPUBuffer }
  readonly head: number
}

export async function createRibbons(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<RibbonsView> {
  const moveModule = device.createShaderModule({ label: 'ribbons move', code: types + move })
  const drawModule = device.createShaderModule({ label: 'ribbons draw', code: types + draw })
  const [advance, strip] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'ribbons advance',
      layout: 'auto',
      compute: { module: moveModule, entryPoint: 'advance' },
    }),
    device.createRenderPipelineAsync({
      label: 'ribbons',
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'strip' },
      fragment: {
        module: drawModule,
        entryPoint: 'glow',
        targets: [
          {
            format,
            // light adds up: where ribbons cross, they glow
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
  ])

  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const uniform = device.createBuffer({
    label: 'ribbons',
    size: RIBBONS.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const trail = device.createBuffer({ label: 'ribbon trails', size: MAX * LENGTH * 16, usage })
  const colours = device.createBuffer({ label: 'ribbon colours', size: MAX * 16, usage })

  /* every ribbon starts as a trail of one point, where its dance begins: no streak in from 0 */
  const tr = new Float32Array(MAX * LENGTH * 4)
  for (let r = 0; r < MAX; r++) {
    const p = danceAt(r, 0, 'loops')
    for (let s = 0; s < LENGTH; s++) tr.set([...p, 0], (r * LENGTH + s) * 4)
  }
  device.queue.writeBuffer(trail, 0, tr)

  const moveGroup = device.createBindGroup({
    layout: advance.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: trail } },
    ],
  })
  const drawGroup = device.createBindGroup({
    layout: strip.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: trail } },
      { binding: 2, resource: { buffer: colours } },
    ],
  })
  const staging = new ArrayBuffer(RIBBONS.bytes)
  let head = 0

  return {
    buffers: { trail },
    get head() {
      return head
    },
    paint(cs) {
      const c = new Float32Array(MAX * 4)
      for (let r = 0; r < MAX; r++) c.set(cs[r % cs.length], r * 4)
      device.queue.writeBuffer(colours, 0, c)
    },
    frame(dt, f) {
      if (dt > 0) head = (head + 1) % LENGTH
      device.queue.writeBuffer(uniform, 0, packRibbons({ ...f, head, dt }, staging))
      const encoder = device.createCommandEncoder({ label: 'ribbons' })
      if (dt > 0) {
        const pass = encoder.beginComputePass()
        pass.setPipeline(advance)
        pass.setBindGroup(0, moveGroup)
        pass.dispatchWorkgroups(Math.ceil(f.count / 64))
        pass.end()
      }
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.01, g: 0.01, b: 0.03, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      rp.setPipeline(strip)
      rp.setBindGroup(0, drawGroup)
      rp.draw(f.count * (LENGTH - 1) * 6)
      rp.end()
      device.queue.submit([encoder.finish()])
    },
    destroy() {
      for (const b of [uniform, trail, colours]) b.destroy()
    },
  }
}
