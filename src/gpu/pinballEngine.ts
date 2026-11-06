import code from './pinball.wgsl?raw'
import { FIELD, MAX_ITEMS, MAX_SEGS, PIN, TRAIL, packPin, type Flippers, type V2 } from './pinball'

export type PinFrame = {
  ball: V2
  pull: number
  flippers: Flippers
  items: readonly number[]
  trail: readonly V2[]
  time: number
  building: boolean
}

export type PinballView = {
  /** a new table: its segments and parts baked into the field the glow is read from */
  bake(segs: readonly (readonly number[])[], items: readonly number[]): void
  frame(f: PinFrame): void
  /** the baked field, for the probe */
  readonly field: GPUTexture
  destroy(): void
}

export async function createPinball(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<PinballView> {
  const module = device.createShaderModule({ label: 'pinball', code })
  const [bake, show] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'pinball bake',
      layout: 'auto',
      compute: { module, entryPoint: 'bake' },
    }),
    device.createRenderPipelineAsync({
      label: 'pinball show',
      layout: 'auto',
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'pinball table',
    size: PIN.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const segBuf = device.createBuffer({ label: 'pinball segs', size: MAX_SEGS * 16, usage: storage })
  const itemBuf = device.createBuffer({
    label: 'pinball items',
    size: MAX_ITEMS * 16,
    usage: storage,
  })
  const trailBuf = device.createBuffer({ label: 'pinball trail', size: TRAIL * 8, usage: storage })
  const field = device.createTexture({
    label: 'pinball field',
    size: FIELD,
    format: 'rgba16float',
    usage:
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const bakeGroup = device.createBindGroup({
    layout: bake.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: segBuf } },
      { binding: 2, resource: { buffer: itemBuf } },
      { binding: 3, resource: field.createView() },
    ],
  })
  const showGroups = [
    device.createBindGroup({
      layout: show.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 2, resource: { buffer: itemBuf } },
      ],
    }),
    device.createBindGroup({
      layout: show.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: field.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: trailBuf } },
      ],
    }),
  ]
  const staging = new ArrayBuffer(PIN.bytes)
  let segs = 0
  let items = 0
  const uniformFor = (f: PinFrame) =>
    packPin(
      {
        w: canvas.width,
        h: canvas.height,
        ball: f.ball,
        pull: f.pull,
        flippers: f.flippers,
        segs,
        items,
        time: f.time,
        building: f.building,
      },
      staging,
    )

  const view: PinballView = {
    field,
    bake(s, it) {
      segs = Math.min(s.length, MAX_SEGS)
      items = Math.min(it.length / 4, MAX_ITEMS)
      if (segs) device.queue.writeBuffer(segBuf, 0, Float32Array.from(s.slice(0, segs).flat()))
      if (items) device.queue.writeBuffer(itemBuf, 0, Float32Array.from(it.slice(0, items * 4)))
      // the bake reads only the counts and the field's size from the uniform
      const u = new Uint32Array(staging)
      u.set([canvas.width, canvas.height, FIELD[0], FIELD[1]], 0)
      u[PIN.segs / 4] = segs
      u[PIN.items / 4] = items
      device.queue.writeBuffer(uniform, 0, staging)
      const e = device.createCommandEncoder({ label: 'pinball bake' })
      const p = e.beginComputePass()
      p.setPipeline(bake)
      p.setBindGroup(0, bakeGroup)
      p.dispatchWorkgroups(Math.ceil(FIELD[0] / 8), Math.ceil(FIELD[1] / 8))
      p.end()
      device.queue.submit([e.finish()])
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      device.queue.writeBuffer(uniform, 0, uniformFor(f))
      if (f.items.length)
        device.queue.writeBuffer(itemBuf, 0, Float32Array.from(f.items.slice(0, items * 4)))
      const tr = new Float32Array(TRAIL * 2)
      for (let k = 0; k < TRAIL; k++) {
        const q = f.trail[f.trail.length - 1 - k] ?? f.ball
        tr[k * 2] = q[0]
        tr[k * 2 + 1] = q[1]
      }
      device.queue.writeBuffer(trailBuf, 0, tr)
      const e = device.createCommandEncoder({ label: 'pinball' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, showGroups[0])
      rp.setBindGroup(1, showGroups[1])
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [uniform, segBuf, itemBuf, trailBuf]) b.destroy()
      field.destroy()
    },
  }
  return view
}
