import code from './topple.wgsl?raw'
import {
  MARKS,
  MAX_DOMINOES,
  MAX_PREVIEW,
  TABLE,
  packDominoes,
  packMarks,
  packTable,
  type Bell,
  type Cascade,
  type Layout,
  type V2,
  type Wall,
} from './topple'

export type ToppleView = {
  /** the dominoes, and how each falls (null: all standing) */
  dominoes(l: Layout, c: Cascade | null): void
  marks(
    start: { x: number; z: number; toward: number } | null,
    bells: readonly Bell[],
    walls: readonly Wall[],
  ): void
  /** the line being drawn, at most MAX_PREVIEW points */
  preview(line: readonly V2[]): void
  frame(f: { time: number; rung: number }): void
  destroy(): void
}

export async function createTopple(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<ToppleView> {
  const module = device.createShaderModule({ label: 'topple', code })
  /* one layout for all three passes: the uniform and the three lists, read in vertex and fragment */
  const vf = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'topple',
    entries: [
      { binding: 0, visibility: vf, buffer: { type: 'uniform' } },
      ...[1, 2, 3].map((binding) => ({
        binding,
        visibility: vf,
        buffer: { type: 'read-only-storage' as const },
      })),
    ],
  })
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const depthFormat: GPUTextureFormat = 'depth24plus'
  const alpha: GPUBlendState = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  }
  const [ground, shade, box] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'topple ground',
      layout: pl,
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'ground', targets: [{ format }] },
      depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
    }),
    device.createRenderPipelineAsync({
      label: 'topple shadows',
      layout: pl,
      vertex: { module, entryPoint: 'shade_vs' },
      fragment: { module, entryPoint: 'shade_fs', targets: [{ format, blend: alpha }] },
      depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
    }),
    device.createRenderPipelineAsync({
      label: 'topple dominoes',
      layout: pl,
      vertex: { module, entryPoint: 'box_vs' },
      fragment: { module, entryPoint: 'box_fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
    }),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const uniform = device.createBuffer({
    label: 'topple table',
    size: TABLE.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const dominoBuf = device.createBuffer({
    label: 'topple dominoes',
    size: MAX_DOMINOES * 32,
    usage: S,
  })
  const markBuf = device.createBuffer({ label: 'topple marks', size: MARKS * 16, usage: S })
  const previewBuf = device.createBuffer({
    label: 'topple preview',
    size: MAX_PREVIEW * 8,
    usage: S,
  })
  const group = device.createBindGroup({
    layout,
    entries: [uniform, dominoBuf, markBuf, previewBuf].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  })
  let depth: GPUTexture | null = null
  let count = 0
  let bells = 0
  let walls = 0
  let points = 0
  const staging = new ArrayBuffer(TABLE.bytes)
  return {
    dominoes(l, c) {
      count = Math.min(l.dominoes.length, MAX_DOMINOES)
      device.queue.writeBuffer(dominoBuf, 0, packDominoes(l, c))
    },
    marks(start, b, w) {
      bells = Math.min(b.length, 12)
      walls = Math.min(w.length, 8)
      device.queue.writeBuffer(markBuf, 0, packMarks(start, b, w))
    },
    preview(line) {
      points = Math.min(line.length, MAX_PREVIEW)
      if (points)
        device.queue.writeBuffer(previewBuf, 0, Float32Array.from(line.slice(0, points).flat()))
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      if (!depth || depth.width !== canvas.width || depth.height !== canvas.height) {
        depth?.destroy()
        depth = device.createTexture({
          size: [canvas.width, canvas.height],
          format: depthFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        })
      }
      device.queue.writeBuffer(
        uniform,
        0,
        packTable(
          {
            w: canvas.width,
            h: canvas.height,
            count,
            bells,
            time: f.time,
            walls,
            rung: f.rung,
            preview: points,
          },
          staging,
        ),
      )
      const e = device.createCommandEncoder({ label: 'topple' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      })
      rp.setBindGroup(0, group)
      rp.setPipeline(ground)
      rp.draw(3)
      if (count) {
        rp.setPipeline(shade)
        rp.draw(6, count)
        rp.setPipeline(box)
        rp.draw(36, count)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [uniform, dominoBuf, markBuf, previewBuf]) b.destroy()
      depth?.destroy()
    },
  }
}
