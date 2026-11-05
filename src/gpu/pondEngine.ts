import types from './pond-types.wgsl?raw'
import stepCode from './pond-step.wgsl?raw'
import surface from './pond-surface.wgsl?raw'
import causticsCode from './pond-caustics.wgsl?raw'
import showCode from './pond-show.wgsl?raw'
import { MAX_DROPS, POND, packDrops, packPond, type Drop, type Floor } from './pond'

export type PondView = {
  /** a still pond of w×h cells */
  fill(w: number, h: number): void
  /** drop the drops, take `steps` steps of the waves, light it and show it */
  frame(f: {
    drops: readonly Drop[]
    steps: number
    floor: Floor
    time: number
    depth: number
  }): void
  readonly water: GPUBuffer | null
  readonly caustics: GPUTexture | null
  /** for the probe: write a state into the water directly */
  set(hv: Float32Array): void
  destroy(): void
}

/** the caustic texture is this many texels a cell each way — mirrored in pond-caustics.wgsl */
const TEXELS = 2

export async function createPond(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<PondView> {
  /* the surface helpers sit after each pass's own `water` binding, which they read */
  const withSurface = (code: string) => code.replace('// pond-surface.wgsl is joined here', surface)
  const stepModule = device.createShaderModule({ label: 'pond step', code: types + stepCode })
  const causticModule = device.createShaderModule({
    label: 'pond caustics',
    code: types + withSurface(causticsCode),
  })
  const showModule = device.createShaderModule({
    label: 'pond show',
    code: types + withSurface(showCode),
  })
  const [wave, mesh, show] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'pond wave',
      layout: 'auto',
      compute: { module: stepModule, entryPoint: 'wave' },
    }),
    device.createRenderPipelineAsync({
      label: 'pond caustics',
      layout: 'auto',
      vertex: { module: causticModule, entryPoint: 'mesh' },
      fragment: {
        module: causticModule,
        entryPoint: 'light',
        targets: [
          {
            format: 'rgba16float',
            // where the mesh folds over itself, both layers' light lands: it adds up
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
    device.createRenderPipelineAsync({
      label: 'pond show',
      layout: 'auto',
      vertex: { module: showModule, entryPoint: 'cover' },
      fragment: { module: showModule, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'pond',
    size: POND.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const dropBuf = device.createBuffer({
    label: 'pond drops',
    size: MAX_DROPS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const lin = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const staging = new ArrayBuffer(POND.bytes)
  let pair: [GPUBuffer, GPUBuffer] | null = null
  let caustics: GPUTexture | null = null
  let size: [number, number] = [2, 2]

  const groupOf = (pipe: GPUComputePipeline | GPURenderPipeline, entries: GPUBindGroupEntry[]) =>
    device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniform } }, ...entries],
    })

  return {
    get water() {
      return pair?.[0] ?? null
    },
    get caustics() {
      return caustics
    },
    fill(w, h) {
      pair?.forEach((b) => b.destroy())
      caustics?.destroy()
      size = [w, h]
      const make = (label: string) =>
        device.createBuffer({
          label,
          size: w * h * 8,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        })
      pair = [make('pond water a'), make('pond water b')]
      caustics = device.createTexture({
        label: 'pond caustics',
        size: [w * TEXELS, h * TEXELS],
        format: 'rgba16float',
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      })
    },
    set(hv) {
      if (pair) device.queue.writeBuffer(pair[0], 0, hv as Float32Array<ArrayBuffer>)
    },
    frame({ drops, steps, floor, time, depth }) {
      if (!pair || !caustics) return
      const [w, h] = size
      const put = (n: number) =>
        device.queue.writeBuffer(
          uniform,
          0,
          packPond({ w, h, drops: n, floor, time, depth }, staging),
        )
      if (drops.length) device.queue.writeBuffer(dropBuf, 0, packDrops(drops))
      /* one submission per step: the drops land on the first, and the queue keeps them in order */
      for (let k = 0; k < steps; k++) {
        put(k === 0 ? Math.min(drops.length, MAX_DROPS) : 0)
        const e = device.createCommandEncoder()
        const p = e.beginComputePass()
        p.setPipeline(wave)
        p.setBindGroup(
          0,
          groupOf(wave, [
            { binding: 1, resource: { buffer: pair[0] } },
            { binding: 2, resource: { buffer: pair[1] } },
            { binding: 3, resource: { buffer: dropBuf } },
          ]),
        )
        p.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
        p.end()
        device.queue.submit([e.finish()])
        pair = [pair[1], pair[0]]
      }
      put(0)
      const e = device.createCommandEncoder({ label: 'pond light' })
      const cp = e.beginRenderPass({
        colorAttachments: [
          {
            view: caustics.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      cp.setPipeline(mesh)
      cp.setBindGroup(0, groupOf(mesh, [{ binding: 1, resource: { buffer: pair[0] } }]))
      cp.draw((w - 1) * (h - 1) * 6)
      cp.end()
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(
        0,
        groupOf(show, [
          { binding: 1, resource: { buffer: pair[0] } },
          { binding: 2, resource: caustics.createView() },
          { binding: 3, resource: lin },
        ]),
      )
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      pair?.forEach((b) => b.destroy())
      caustics?.destroy()
      uniform.destroy()
      dropBuf.destroy()
    },
  }
}
