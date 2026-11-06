import code from './marbles.wgsl?raw'
import { DMAX, HASH, MAX_MARBLES, MAZE, STEPS } from './marbles'

export type Dab = { x: number; y: number; kind: number }

export type MarblesView = {
  /** a new board: every cell's kind, and no marbles */
  load(board: readonly [number, number], kind: Uint8Array): void
  /** marbles dropped at these places, into the next free slots */
  pour(at: readonly (readonly [number, number])[]): void
  frame(f: {
    w: number
    h: number
    gravity: readonly [number, number]
    dabs: readonly Dab[]
    radius: number
    dt: number
  }): void
  /** how many marbles have fallen into holes, and how many there are */
  score(): Promise<{ fell: number; count: number } | null>
  readonly buffers: {
    marble: GPUBuffer
    kind: GPUBuffer
    dist: GPUBuffer
    order: GPUBuffer
    start: GPUBuffer
  }
  destroy(): void
}

const MAX_DABS = 64

export async function createMarbles(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<MarblesView> {
  const C = GPUShaderStage.COMPUTE
  const V = GPUShaderStage.VERTEX
  const F = GPUShaderStage.FRAGMENT
  const rw = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: C,
    buffer: { type: 'storage' },
  })
  /* ⚠️ TWO LAYOUTS, BECAUSE A STAGE MAY USE ONLY 8 STORAGE BUFFERS (WebGPU's default limit, and the
     one phones have). One layout for everything was 10, and the pipeline was refused. The board's
     passes need the board; the marbles' passes need the board's kind and field and their own six */
  const boardLayout = device.createBindGroupLayout({
    label: 'marbles board',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      rw(1),
      rw(2),
      rw(3),
      { binding: 4, visibility: C, buffer: { type: 'read-only-storage' } },
    ],
  })
  const physLayout = device.createBindGroupLayout({
    label: 'marbles physics',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      rw(1),
      rw(2),
      ...[5, 6, 7, 8, 9, 10].map(rw),
    ],
  })
  const ro = (binding: number, visibility: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility,
    buffer: { type: 'read-only-storage' },
  })
  const showLayout = device.createBindGroupLayout({
    label: 'marbles show',
    entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      ro(11, V),
      ro(12, F),
      ro(13, F),
    ],
  })
  const module = device.createShaderModule({ label: 'marbles', code })
  const boardPipes = device.createPipelineLayout({ bindGroupLayouts: [boardLayout] })
  const physPipes = device.createPipelineLayout({ bindGroupLayouts: [physLayout] })
  const showPipes = device.createPipelineLayout({ bindGroupLayouts: [showLayout] })
  const compute = (entryPoint: string, layout: GPUPipelineLayout) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout,
      compute: { module, entryPoint },
    })
  const render = (vertex: string, fragment: string) =>
    device.createRenderPipelineAsync({
      label: fragment,
      layout: showPipes,
      vertex: { module, entryPoint: vertex },
      fragment: { module, entryPoint: fragment, targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
  const [paint, seed, spread, clear, predict, scan, scatter, settle, board, balls] =
    await Promise.all([
      compute('paint', boardPipes),
      compute('seed_field', boardPipes),
      compute('spread', boardPipes),
      compute('clear', physPipes),
      compute('predict', physPipes),
      compute('scan', physPipes),
      compute('scatter', physPipes),
      compute('settle', physPipes),
      render('cover', 'board'),
      render('ball', 'shine'),
    ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const buf = (label: string, size: number, usage = S) =>
    device.createBuffer({ label, size: Math.max(16, size), usage })
  const uniform = buf('marbles', MAZE.bytes, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
  const dabBuf = buf('marbles dabs', MAX_DABS * 16)
  const marble = buf('marbles marble', MAX_MARBLES * 16)
  const guess = buf('marbles guess', MAX_MARBLES * 8)
  const order = buf('marbles order', MAX_MARBLES * 4)
  const fell = buf('marbles fell', 4)
  const readback = buf('marbles readback', 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST)
  const staging = new ArrayBuffer(MAZE.bytes)

  let size: readonly [number, number] = [1, 1]
  let cells: [number, number] = [1, 1]
  let kind!: GPUBuffer
  let dist: GPUBuffer[] = []
  let counts!: GPUBuffer
  let start!: GPUBuffer
  let work: GPUBindGroup[] = []
  let phys!: GPUBindGroup
  let show!: GPUBindGroup
  let count = 0
  let reading = false
  let fieldStale = true

  const pack = (
    w: number,
    h: number,
    gravity: readonly [number, number],
    dabs: number,
    radius: number,
    dt: number,
  ) => {
    const u = new Uint32Array(staging)
    const f = new Float32Array(staging)
    u.set([w, h, size[0], size[1], cells[0], cells[1]], 0)
    f.set(gravity, MAZE.gravity / 4)
    u[MAZE.count / 4] = count
    f[MAZE.dt / 4] = dt
    f[MAZE.radius / 4] = radius
    u[MAZE.dabs / 4] = dabs
    return staging
  }

  const view: MarblesView = {
    get buffers() {
      return { marble, kind, dist: dist[0], order, start }
    },
    load(next, k) {
      size = next
      cells = [Math.ceil(next[0] / HASH), Math.ceil(next[1] / HASH)]
      for (const b of [kind, ...dist, counts, start]) b?.destroy()
      const n = next[0] * next[1]
      kind = buf('marbles kind', n * 4)
      dist = [buf('marbles dist', n * 8), buf('marbles dist 2', n * 8)]
      counts = buf('marbles counts', cells[0] * cells[1] * 4)
      start = buf('marbles start', (cells[0] * cells[1] + 1) * 4)
      /* group k has the field's pair one way round or the other: `spread` reads binding 2 and writes 3 */
      work = [0, 1].map((k) =>
        device.createBindGroup({
          layout: boardLayout,
          entries: [uniform, kind, dist[k], dist[1 - k], dabBuf].map((buffer, binding) => ({
            binding,
            resource: { buffer },
          })),
        }),
      )
      phys = device.createBindGroup({
        layout: physLayout,
        entries: [
          ...[uniform, kind, dist[0]].map((buffer, binding) => ({ binding, resource: { buffer } })),
          ...[marble, guess, counts, start, order, fell].map((buffer, k) => ({
            binding: 5 + k,
            resource: { buffer },
          })),
        ],
      })
      show = device.createBindGroup({
        layout: showLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 11, resource: { buffer: marble } },
          { binding: 12, resource: { buffer: kind } },
          { binding: 13, resource: { buffer: dist[0] } },
        ],
      })
      device.queue.writeBuffer(kind, 0, Uint32Array.from(k))
      device.queue.writeBuffer(fell, 0, new Uint32Array(1))
      count = 0
      fieldStale = true
    },
    pour(at) {
      const room = Math.min(at.length, MAX_MARBLES - count)
      if (room <= 0) return
      const data = new Float32Array(room * 4)
      at.slice(0, room).forEach(([x, y], i) => data.set([x, y, 0, 0], i * 4))
      device.queue.writeBuffer(marble, count * 16, data)
      count += room
    },
    async score() {
      if (reading) return null
      reading = true
      const e = device.createCommandEncoder()
      e.copyBufferToBuffer(fell, 0, readback, 0, 4)
      device.queue.submit([e.finish()])
      try {
        await readback.mapAsync(GPUMapMode.READ)
        const n = new Uint32Array(readback.getMappedRange().slice(0))[0]
        readback.unmap()
        return { fell: n, count }
      } catch {
        return null
      } finally {
        reading = false
      }
    },
    frame({ w, h, gravity, dabs, radius, dt }) {
      const n = Math.min(dabs.length, MAX_DABS)
      device.queue.writeBuffer(uniform, 0, pack(w, h, gravity, n, radius, dt / STEPS))
      const e = device.createCommandEncoder({ label: 'marbles' })
      const p = e.beginComputePass()
      const gx = Math.ceil(size[0] / 8)
      const gy = Math.ceil(size[1] / 8)
      if (n) {
        device.queue.writeBuffer(
          dabBuf,
          0,
          new Float32Array(dabs.slice(0, n).flatMap((d) => [d.x, d.y, d.kind, 0])),
        )
        p.setPipeline(paint)
        p.setBindGroup(0, work[0])
        p.dispatchWorkgroups(gx, gy)
        fieldStale = true
      }
      if (fieldStale) {
        /* the walls moved: the distance field again, DMAX chamfer passes, ending back in dist 0 */
        p.setPipeline(seed)
        p.setBindGroup(0, work[0])
        p.dispatchWorkgroups(gx, gy)
        p.setPipeline(spread)
        for (let k = 0; k < DMAX; k++) {
          p.setBindGroup(0, work[k % 2])
          p.dispatchWorkgroups(gx, gy)
        }
        fieldStale = false
      }
      if (dt > 0 && count > 0) {
        const mg = Math.ceil(count / 64)
        p.setBindGroup(0, phys)
        for (let s = 0; s < STEPS; s++) {
          p.setPipeline(clear)
          p.dispatchWorkgroups(Math.ceil((cells[0] * cells[1]) / 64))
          p.setPipeline(predict)
          p.dispatchWorkgroups(mg)
          p.setPipeline(scan)
          p.dispatchWorkgroups(1)
          p.setPipeline(scatter)
          p.dispatchWorkgroups(mg)
          p.setPipeline(settle)
          p.dispatchWorkgroups(mg)
        }
      }
      p.end()
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setBindGroup(0, show)
      rp.setPipeline(board)
      rp.draw(3)
      if (count) {
        rp.setPipeline(balls)
        rp.draw(count * 6)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [
        uniform,
        dabBuf,
        marble,
        guess,
        order,
        fell,
        readback,
        kind,
        ...dist,
        counts,
        start,
      ])
        b?.destroy()
    },
  }
  return view
}
