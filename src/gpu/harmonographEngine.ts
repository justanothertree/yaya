import code from './harmonograph.wgsl?raw'
import { DRAW, packDraw, type DrawFrame } from './harmonograph'

export type HarmonographView = {
  /** a sheet of paper this many pixels, blank */
  paper(size: readonly [number, number]): void
  clear(): void
  /** draw `segments` more segments of the pen's path, then show the paper */
  frame(f: Omit<DrawFrame, 'w' | 'h' | 'paper'>): void
  readonly ink: GPUBuffer
  readonly size: readonly [number, number]
  destroy(): void
}

export async function createHarmonograph(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: { width: number; height: number },
): Promise<HarmonographView> {
  const drawLayout = device.createBindGroupLayout({
    label: 'harmonograph draw',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  })
  const showLayout = device.createBindGroupLayout({
    label: 'harmonograph show',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  })
  const module = device.createShaderModule({ label: 'harmonograph', code })
  const [draw, show] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'harmonograph draw',
      layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
      compute: { module, entryPoint: 'draw' },
    }),
    device.createRenderPipelineAsync({
      label: 'harmonograph show',
      layout: device.createPipelineLayout({ bindGroupLayouts: [showLayout] }),
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'paper', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'harmonograph',
    size: DRAW.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(DRAW.bytes)
  let size: readonly [number, number] = [1, 1]
  let ink!: GPUBuffer
  let drawGroup!: GPUBindGroup
  let showGroup!: GPUBindGroup

  const view: HarmonographView = {
    get ink() {
      return ink
    },
    get size() {
      return size
    },
    paper(next) {
      size = [Math.max(1, Math.round(next[0])), Math.max(1, Math.round(next[1]))]
      ink?.destroy()
      ink = device.createBuffer({
        label: 'harmonograph ink',
        size: size[0] * size[1] * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      })
      drawGroup = device.createBindGroup({
        layout: drawLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: ink } },
        ],
      })
      showGroup = device.createBindGroup({
        layout: showLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 2, resource: { buffer: ink } },
        ],
      })
    },
    clear() {
      const e = device.createCommandEncoder()
      e.clearBuffer(ink)
      device.queue.submit([e.finish()])
    },
    frame(f) {
      device.queue.writeBuffer(
        uniform,
        0,
        packDraw({ ...f, w: canvas.width, h: canvas.height, paper: size }, staging),
      )
      const e = device.createCommandEncoder({ label: 'harmonograph' })
      if (f.segments > 0) {
        const p = e.beginComputePass()
        p.setPipeline(draw)
        p.setBindGroup(0, drawGroup)
        p.dispatchWorkgroups(Math.ceil(f.segments / 64))
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
      ink?.destroy()
      uniform.destroy()
    },
  }
  view.paper([canvas.width, canvas.height])
  return view
}
