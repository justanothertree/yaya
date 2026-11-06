import code from './seedling.wgsl?raw'
import { CELLS, COLS, GARDEN, ROWS, packGarden, type Rect, type Rule } from './seedling'

export type GardenFrame = {
  patch: Rect
  rule: Rule
  time: number
  phase: number
  planting: boolean
}

export type SeedlingView = {
  /** a garden's stones and lamps (the lamps all unlit), and what is growing in it */
  load(marks: Uint32Array<ArrayBuffer>, cells: Uint8Array): void
  /** one generation under `rule` */
  grow(rule: Rule): void
  frame(f: GardenFrame): void
  /** what is alive and which lamps are lit, as of the last generation */
  read(): Promise<{ cells: Uint32Array; marks: Uint32Array }>
  destroy(): void
}

export async function createSeedling(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<SeedlingView> {
  const module = device.createShaderModule({ label: 'seedling', code })
  const [grow, show] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'seedling grow',
      layout: 'auto',
      compute: { module, entryPoint: 'grow' },
    }),
    device.createRenderPipelineAsync({
      label: 'seedling show',
      layout: 'auto',
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const buf = (label: string) => device.createBuffer({ label, size: CELLS * 4, usage: S })
  const uniform = device.createBuffer({
    label: 'seedling garden',
    size: GARDEN.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  /* ⚠️ `grow` reads the grid's size from the uniform, and `frame` writes it only when it draws: a
     generation run before the first picture saw a 0 × 0 garden and silently did nothing (the GPU
     probe caught a solved level coming out unsolved). The size never changes, so it goes in now. */
  device.queue.writeBuffer(uniform, GARDEN.grid, new Uint32Array([COLS, ROWS]))
  const boards = [buf('seedling cells 0'), buf('seedling cells 1')]
  const marks = buf('seedling marks')
  const glow = buf('seedling glow')
  /* two ways round: generation k reads board k%2 and writes the other; the picture reads the newest */
  const growGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: grow.getBindGroupLayout(0),
      entries: [uniform, boards[k], boards[1 - k], marks, glow].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    }),
  )
  const showUniform = device.createBindGroup({
    layout: show.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  })
  const showGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: show.getBindGroupLayout(1),
      entries: [boards[k], marks, glow].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    }),
  )
  let now = 0
  const staging = new ArrayBuffer(GARDEN.bytes)
  const tiles = [Math.ceil(COLS / 8), Math.ceil(ROWS / 8)] as const
  const copyOut = async (b: GPUBuffer) => {
    const rb = device.createBuffer({
      size: b.size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })
    const e = device.createCommandEncoder()
    e.copyBufferToBuffer(b, 0, rb, 0, b.size)
    device.queue.submit([e.finish()])
    try {
      await rb.mapAsync(GPUMapMode.READ)
      return new Uint32Array(rb.getMappedRange().slice(0))
    } finally {
      rb.destroy()
    }
  }

  return {
    load(m, cells) {
      now = 0
      device.queue.writeBuffer(marks, 0, m)
      device.queue.writeBuffer(boards[0], 0, Uint32Array.from(cells))
      device.queue.writeBuffer(boards[1], 0, new Uint32Array(CELLS))
      device.queue.writeBuffer(glow, 0, Float32Array.from(cells))
    },
    grow(rule) {
      /* the rule is the only part of the uniform `grow` reads; the rest is written each frame */
      device.queue.writeBuffer(uniform, GARDEN.born, new Uint32Array([rule.born, rule.stays]))
      const e = device.createCommandEncoder({ label: 'seedling grow' })
      const p = e.beginComputePass()
      p.setPipeline(grow)
      p.setBindGroup(0, growGroups[now])
      p.dispatchWorkgroups(tiles[0], tiles[1])
      p.end()
      device.queue.submit([e.finish()])
      now = 1 - now
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      device.queue.writeBuffer(
        uniform,
        0,
        packGarden({ w: canvas.width, h: canvas.height, ...f }, staging),
      )
      const e = device.createCommandEncoder({ label: 'seedling' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, showUniform)
      rp.setBindGroup(1, showGroups[now])
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    async read() {
      return { cells: await copyOut(boards[now]), marks: await copyOut(marks) }
    },
    destroy() {
      for (const b of [uniform, ...boards, marks, glow]) b.destroy()
    },
  }
}
