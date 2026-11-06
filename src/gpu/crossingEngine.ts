import code from './crossing.wgsl?raw'
import {
  MAX_BUOYS,
  MAX_ROCKS,
  NIGHT,
  packNight,
  type NightFrame,
  type Rock,
  type V2,
} from './crossing'

export type CrossingView = {
  /** a fresh crossing: a memory map this size, all dark */
  start(map: [number, number]): void
  rocks(r: readonly Rock[]): void
  buoys(b: readonly { at: V2; rung: boolean }[]): void
  frame(f: Omit<NightFrame, 'w' | 'h' | 'rocks' | 'buoys'>): void
  /** the memory map, for the probe */
  read(): Promise<Float32Array>
  destroy(): void
}

export async function createCrossing(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<CrossingView> {
  const module = device.createShaderModule({ label: 'crossing', code })
  /* one layout for both passes: the drawing reads the map the remembering writes */
  const layout = device.createBindGroupLayout({
    label: 'crossing',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  })
  /* the drawing reads `seen` read-only, which a fragment stage needs; same buffer, its own layout */
  const drawLayout = device.createBindGroupLayout({
    label: 'crossing draw',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  })
  const drawCode = code.replace(
    'var<storage, read_write> seen: array<f32>;',
    'var<storage, read> seen: array<f32>;',
  )
  const drawModule = device.createShaderModule({
    label: 'crossing draw',
    code: drawCode.replace(/@compute[\s\S]*?\n}\n/, ''),
  })
  const [remember, show] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'crossing remember',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'remember' },
    }),
    device.createRenderPipelineAsync({
      label: 'crossing show',
      layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
      vertex: { module: drawModule, entryPoint: 'cover' },
      fragment: { module: drawModule, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'crossing night',
    size: NIGHT.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const rockBuf = device.createBuffer({
    label: 'crossing rocks',
    size: MAX_ROCKS * 16,
    usage: storage,
  })
  const buoyBuf = device.createBuffer({
    label: 'crossing buoys',
    size: MAX_BUOYS * 16,
    usage: storage,
  })
  let seen: GPUBuffer | null = null
  let groups: { remember: GPUBindGroup; show: GPUBindGroup } | null = null
  let map: [number, number] = [1, 1]
  let rocks = 0
  let buoys = 0
  const staging = new ArrayBuffer(NIGHT.bytes)

  const view: CrossingView = {
    start(m) {
      map = m
      seen?.destroy()
      seen = device.createBuffer({
        label: 'crossing seen',
        size: m[0] * m[1] * 4,
        usage: storage | GPUBufferUsage.COPY_SRC,
      })
      const entries = [uniform, rockBuf, seen, buoyBuf].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      }))
      groups = {
        remember: device.createBindGroup({ layout, entries }),
        show: device.createBindGroup({ layout: drawLayout, entries }),
      }
    },
    rocks(r) {
      rocks = Math.min(r.length, MAX_ROCKS)
      if (rocks)
        device.queue.writeBuffer(
          rockBuf,
          0,
          Float32Array.from(r.slice(0, rocks).flatMap((x) => [...x, 0])),
        )
    },
    buoys(b) {
      buoys = Math.min(b.length, MAX_BUOYS)
      if (buoys)
        device.queue.writeBuffer(
          buoyBuf,
          0,
          Float32Array.from(b.slice(0, buoys).flatMap((x) => [...x.at, x.rung ? 1 : 0, 0])),
        )
    },
    frame(f) {
      if (!groups || canvas.width === 0 || canvas.height === 0) return
      device.queue.writeBuffer(
        uniform,
        0,
        packNight({ ...f, w: canvas.width, h: canvas.height, map, rocks, buoys }, staging),
      )
      const e = device.createCommandEncoder({ label: 'crossing' })
      if (f.rows[1] > 0) {
        const p = e.beginComputePass()
        p.setPipeline(remember)
        p.setBindGroup(0, groups.remember)
        p.dispatchWorkgroups(Math.ceil(map[0] / 8), Math.ceil(f.rows[1] / 8))
        p.end()
      }
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, groups.show)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    async read() {
      if (!seen) return new Float32Array(0)
      const rb = device.createBuffer({
        size: seen.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      })
      const e = device.createCommandEncoder()
      e.copyBufferToBuffer(seen, 0, rb, 0, seen.size)
      device.queue.submit([e.finish()])
      try {
        await rb.mapAsync(GPUMapMode.READ)
        return new Float32Array(rb.getMappedRange().slice(0))
      } finally {
        rb.destroy()
      }
    },
    destroy() {
      for (const b of [uniform, rockBuf, buoyBuf]) b.destroy()
      seen?.destroy()
      groups = null
    },
  }
  return view
}
