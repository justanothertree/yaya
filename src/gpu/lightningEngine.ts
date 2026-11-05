import code from './lightning.wgsl?raw'
import { BOLT, RELAX, freshField, packBolt, type BoltFrame } from './lightning'

export type LightningView = {
  /** a fresh sky of `grid` cells with these cells made rod, and a new bolt ready to grow */
  reset(grid: readonly [number, number], rods: readonly (readonly [number, number])[]): void
  /** grow `steps` cells of the leader, then draw */
  frame(f: Omit<BoltFrame, 'step'>, steps: number): void
  /** where the leader is: how many cells it has grown, and whether it has reached the ground */
  status(): Promise<{ steps: number; arrived: boolean } | null>
  readonly buffers: { kind: GPUBuffer; race: GPUBuffer; phi: GPUBuffer }
  destroy(): void
}

const NONE = 0xffffffff

export async function createLightning(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<LightningView> {
  const C = GPUShaderStage.COMPUTE
  const rw = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: C,
    buffer: { type: 'storage' },
  })
  const workLayout = device.createBindGroupLayout({
    label: 'lightning work',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      rw(2),
      rw(3),
      rw(4),
      rw(5),
    ],
  })
  const F = GPUShaderStage.FRAGMENT
  const showLayout = device.createBindGroupLayout({
    label: 'lightning show',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 6, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: F, buffer: { type: 'read-only-storage' } },
    ],
  })
  const module = device.createShaderModule({ label: 'lightning', code })
  const workPipes = device.createPipelineLayout({ bindGroupLayouts: [workLayout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: workPipes,
      compute: { module, entryPoint },
    })
  const [relax, enter, claim, grow, show] = await Promise.all([
    compute('relax'),
    compute('enter'),
    compute('claim'),
    compute('grow'),
    device.createRenderPipelineAsync({
      label: 'lightning show',
      layout: device.createPipelineLayout({ bindGroupLayouts: [showLayout] }),
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'lightning',
    size: BOLT.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const race = device.createBuffer({
    label: 'lightning race',
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const readback = device.createBuffer({
    label: 'lightning readback',
    size: 16,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(BOLT.bytes)

  let grid: readonly [number, number] = [1, 1]
  let phi: GPUBuffer[] = []
  let kind!: GPUBuffer
  let parent!: GPUBuffer
  let work: GPUBindGroup[] = []
  let showGroup!: GPUBindGroup
  let reading = false
  const storage = (label: string, size: number) =>
    device.createBuffer({
      label,
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })

  const view: LightningView = {
    get buffers() {
      return { kind, race, phi: phi[0] }
    },
    reset(next, rods) {
      const cells = next[0] * next[1]
      if (next[0] !== grid[0] || next[1] !== grid[1] || !kind) {
        for (const b of [...phi, kind, parent]) b?.destroy()
        grid = next
        phi = [storage('lightning phi', cells * 4), storage('lightning phi 2', cells * 4)]
        kind = storage('lightning kind', cells * 4)
        parent = storage('lightning parent', cells * 4)
        /* group k reads phi k and writes the other; relaxing an even number of times ends in phi 0,
           which group 1 writes — so the race reads the latest field through group 1 */
        work = [0, 1].map((k) =>
          device.createBindGroup({
            layout: workLayout,
            entries: [uniform, phi[k], phi[1 - k], kind, parent, race].map((buffer, binding) => ({
              binding,
              resource: { buffer },
            })),
          }),
        )
        showGroup = device.createBindGroup({
          layout: showLayout,
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 6, resource: { buffer: kind } },
            { binding: 7, resource: { buffer: race } },
          ],
        })
      }
      const f = freshField(grid[0], grid[1], rods)
      device.queue.writeBuffer(phi[0], 0, f.phi)
      device.queue.writeBuffer(phi[1], 0, f.phi)
      device.queue.writeBuffer(kind, 0, Uint32Array.from(f.kind))
      device.queue.writeBuffer(parent, 0, new Int32Array(cells).fill(-1))
      device.queue.writeBuffer(race, 0, new Uint32Array([NONE, NONE, 0, 0]))
    },
    frame(f, steps) {
      device.queue.writeBuffer(uniform, 0, packBolt({ ...f, step: 0 }, staging))
      const e = device.createCommandEncoder({ label: 'lightning' })
      const gx = Math.ceil(grid[0] / 8)
      const gy = Math.ceil(grid[1] / 8)
      if (steps > 0) {
        const p = e.beginComputePass()
        for (let s = 0; s < steps; s++) {
          p.setPipeline(relax)
          for (let k = 0; k < RELAX; k++) {
            p.setBindGroup(0, work[k % 2])
            p.dispatchWorkgroups(gx, gy)
          }
          p.setBindGroup(0, work[1])
          p.setPipeline(enter)
          p.dispatchWorkgroups(gx, gy)
          p.setPipeline(claim)
          p.dispatchWorkgroups(gx, gy)
          p.setPipeline(grow)
          p.dispatchWorkgroups(1)
        }
        p.end()
      }
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
    async status() {
      if (reading) return null
      reading = true
      const e = device.createCommandEncoder()
      e.copyBufferToBuffer(race, 0, readback, 0, 16)
      device.queue.submit([e.finish()])
      try {
        await readback.mapAsync(GPUMapMode.READ)
        const r = new Uint32Array(readback.getMappedRange().slice(0))
        readback.unmap()
        return { steps: r[3], arrived: r[2] !== 0 }
      } catch {
        /* destroyed mid-read: nobody is waiting for the answer */
        return null
      } finally {
        reading = false
      }
    },
    destroy() {
      for (const b of [...phi, kind, parent, race, readback, uniform]) b?.destroy()
    },
  }
  return view
}
