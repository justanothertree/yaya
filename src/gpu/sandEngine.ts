import types from './sand-types.wgsl?raw'
import stepCode from './sand-step.wgsl?raw'
import drawCode from './sand-draw.wgsl?raw'
import { MAX_DABS, SAND, packDabs, packSand, type Dab } from './sand'

export type SandBox = {
  /** a fresh grid of cells, w×h */
  load(cells: Uint32Array, w: number, h: number): void
  /** pour the dabs, take `steps` steps with gravity `dir`, and show it */
  frame(input: { dabs: readonly Dab[]; steps: number; gravity: number; time: number }): void
  readonly cells: GPUBuffer | null
  readonly step: number
  destroy(): void
}

export async function createSand(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<SandBox> {
  const stepModule = device.createShaderModule({ label: 'sand step', code: types + stepCode })
  const drawModule = device.createShaderModule({ label: 'sand draw', code: types + drawCode })
  const [brush, fall, show] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'sand brush',
      layout: 'auto',
      compute: { module: stepModule, entryPoint: 'brush' },
    }),
    device.createComputePipelineAsync({
      label: 'sand fall',
      layout: 'auto',
      compute: { module: stepModule, entryPoint: 'fall' },
    }),
    device.createRenderPipelineAsync({
      label: 'sand show',
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'cover' },
      fragment: { module: drawModule, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'sand',
    size: SAND.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const dabBuf = device.createBuffer({
    label: 'sand dabs',
    size: MAX_DABS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(SAND.bytes)
  let cells: GPUBuffer | null = null
  let size: [number, number] = [2, 2]
  let step = 0

  const group = (pipe: GPUComputePipeline | GPURenderPipeline, withDabs: boolean) =>
    device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: cells! } },
        ...(withDabs ? [{ binding: 2, resource: { buffer: dabBuf } }] : []),
      ],
    })

  return {
    get cells() {
      return cells
    },
    get step() {
      return step
    },
    load(c, w, h) {
      cells?.destroy()
      size = [w, h]
      cells = device.createBuffer({
        label: 'sand cells',
        size: w * h * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      })
      device.queue.writeBuffer(cells, 0, c as Uint32Array<ArrayBuffer>)
    },
    frame({ dabs, steps, gravity, time }) {
      if (!cells) return
      const [w, h] = size
      /* one submission per step: each has its own step number, and the queue keeps them in order */
      const put = (n: number) =>
        device.queue.writeBuffer(
          uniform,
          0,
          packSand({ w, h, step, gravity, dabs: n, time }, staging),
        )
      if (dabs.length) {
        device.queue.writeBuffer(dabBuf, 0, packDabs(dabs))
        put(Math.min(dabs.length, MAX_DABS))
        const e = device.createCommandEncoder()
        const p = e.beginComputePass()
        p.setPipeline(brush)
        p.setBindGroup(0, group(brush, true))
        p.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
        p.end()
        device.queue.submit([e.finish()])
      }
      for (let k = 0; k < steps; k++) {
        put(0)
        const e = device.createCommandEncoder()
        const p = e.beginComputePass()
        p.setPipeline(fall)
        p.setBindGroup(0, group(fall, false))
        p.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16))
        p.end()
        device.queue.submit([e.finish()])
        step++
      }
      put(0)
      const e = device.createCommandEncoder({ label: 'sand show' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, group(show, false))
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      cells?.destroy()
      uniform.destroy()
      dabBuf.destroy()
    },
  }
}
