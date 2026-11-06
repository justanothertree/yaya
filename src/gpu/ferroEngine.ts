import code from './ferro.wgsl?raw'
import { FERRO, N, packFerro, twiddles, type Magnet } from './ferro'

export type FerroView = {
  frame(f: {
    magnets: readonly Magnet[]
    /** steps of the surface this frame, each of `dt` */
    steps: number
    dt: number
    spike: readonly [number, number]
    light: readonly [number, number]
  }): void
  /** a still, flat pool */
  calm(): void
  /** for a probe: the surface, N×N f32, and the FFT's working space, N×N complex */
  readonly buffers: { u: GPUBuffer; work: GPUBuffer }
  destroy(): void
}

export async function createFerro(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<FerroView> {
  const module = device.createShaderModule({ label: 'ferro', code })
  /* 'auto' layouts: each pass names only what it uses, and the FFT's direction is an override
     constant, so one entry point is two pipelines */
  const compute = (entryPoint: string, inverse = false) =>
    device.createComputePipelineAsync({
      label: `${entryPoint}${inverse ? ' inverse' : ''}`,
      layout: 'auto',
      compute: { module, entryPoint, constants: { INVERSE: inverse ? 1 : 0 } },
    })
  const [grow, rows, cols, damp, rowsBack, colsBack, settle, show] = await Promise.all([
    compute('grow'),
    compute('rows'),
    compute('cols'),
    compute('damp'),
    compute('rows', true),
    compute('cols', true),
    compute('settle'),
    device.createRenderPipelineAsync({
      label: 'ferro',
      layout: 'auto',
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const uniform = device.createBuffer({
    label: 'ferro',
    size: FERRO.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const u = device.createBuffer({ label: 'ferro surface', size: N * N * 4, usage: S })
  const work = device.createBuffer({ label: 'ferro work', size: N * N * 8, usage: S })
  const twiddle = device.createBuffer({ label: 'ferro twiddles', size: N * 4, usage: S })
  device.queue.writeBuffer(twiddle, 0, twiddles())
  const res: Record<number, GPUBuffer> = { 0: uniform, 1: u, 2: work, 3: twiddle, 4: u }
  const group = (pipe: GPUComputePipeline | GPURenderPipeline, bindings: number[]) =>
    device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: bindings.map((binding) => ({ binding, resource: { buffer: res[binding] } })),
    })
  const passes: [GPUComputePipeline, GPUBindGroup, number][] = [
    [grow, group(grow, [0, 1, 2]), N / 16],
    [rows, group(rows, [2, 3]), 0],
    [cols, group(cols, [2, 3]), 0],
    [damp, group(damp, [0, 2]), N / 16],
    [rowsBack, group(rowsBack, [2, 3]), 0],
    [colsBack, group(colsBack, [2, 3]), 0],
    [settle, group(settle, [1, 2]), N / 16],
  ]
  const showGroup = group(show, [0, 4])
  const staging = new ArrayBuffer(FERRO.bytes)
  let tick = 0

  return {
    buffers: { u, work },
    calm() {
      device.queue.writeBuffer(u, 0, new Float32Array(N * N))
    },
    frame({ magnets, steps, dt, spike, light }) {
      if (canvas.width === 0 || canvas.height === 0) return
      device.queue.writeBuffer(
        uniform,
        0,
        packFerro(
          { w: canvas.width, h: canvas.height, magnets, dt, spike, light, tick: tick++ },
          staging,
        ),
      )
      const e = device.createCommandEncoder({ label: 'ferro' })
      if (steps > 0) {
        const p = e.beginComputePass()
        for (let s = 0; s < steps; s++)
          for (const [pipe, g, tiles] of passes) {
            p.setPipeline(pipe)
            p.setBindGroup(0, g)
            /* a tiled pass covers the grid 16×16 a group; an FFT pass is a workgroup a line */
            if (tiles) p.dispatchWorkgroups(tiles, tiles)
            else p.dispatchWorkgroups(N)
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
    destroy() {
      for (const b of [uniform, u, work, twiddle]) b.destroy()
    },
  }
}
