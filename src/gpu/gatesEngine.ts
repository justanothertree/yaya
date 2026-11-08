import code from './gates.wgsl?raw'
import { FLOATS_PER_SHAPE, MAX_SHAPES, fitBoard } from './gates'

export type GatesView = {
  /** the shapes to draw, and the words they may name */
  scene(data: Float32Array<ArrayBuffer>, count: number, labels: string[]): void
  frame(time: number): void
  destroy(): void
}

/** each label drawn once by the browser's font, in a cell four times wider than tall. ⚠️ Through
 *  a 2D canvas and writeTexture, the route that worked on the Lab's device in Jigsaw. */
function drawLabels(labels: string[], h: number) {
  const w = h * 4
  const c = document.createElement('canvas')
  c.width = Math.max(1, labels.length) * w
  c.height = h
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  labels.forEach((t, i) => {
    let px = Math.round(h * 0.8)
    g.font = `600 ${px}px system-ui, sans-serif`
    // a long name shrinks to fit its cell rather than spilling into the next
    while (px > 6 && g.measureText(t).width > w * 0.94) {
      px--
      g.font = `600 ${px}px system-ui, sans-serif`
    }
    g.fillText(t, i * w + w / 2, h * 0.54)
  })
  return g.getImageData(0, 0, c.width, c.height)
}

export async function createGates(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<GatesView> {
  const module = device.createShaderModule({ label: 'gates', code })
  const F = GPUShaderStage.FRAGMENT
  const V = GPUShaderStage.VERTEX
  const layout = device.createBindGroupLayout({
    label: 'gates',
    entries: [
      { binding: 0, visibility: F | V, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F, texture: {} },
      { binding: 3, visibility: F, sampler: {} },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const [boardPipe, shapePipe] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'gates board',
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'board', targets: [{ format }] },
    }),
    device.createRenderPipelineAsync({
      label: 'gates shapes',
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'shape_vs' },
      fragment: {
        module,
        entryPoint: 'shape_fs',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'gates view',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const shapeBuf = device.createBuffer({
    label: 'gates shapes',
    size: MAX_SHAPES * FLOATS_PER_SHAPE * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  let atlas: GPUTexture | null = null
  let group: GPUBindGroup | null = null
  let words = ''
  let wordsPx = 0
  let labels: string[] = []
  let count = 0
  const atlasFor = (px: number) => {
    const h = Math.max(12, Math.min(96, Math.round(px)))
    const key = labels.join('\u0000')
    if (group && key === words && h === wordsPx) return
    const img = drawLabels(labels, h)
    if (!img) return
    atlas?.destroy()
    atlas = device.createTexture({
      label: 'gates labels',
      size: [img.width, img.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture({ texture: atlas }, img.data, { bytesPerRow: img.width * 4 }, [
      img.width,
      img.height,
    ])
    words = key
    wordsPx = h
    group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: shapeBuf } },
        { binding: 2, resource: atlas.createView() },
        { binding: 3, resource: sampler },
      ],
    })
  }
  const values = new Float32Array(8)
  return {
    scene(data, n, l) {
      count = Math.min(n, MAX_SHAPES)
      labels = l
      if (count) device.queue.writeBuffer(shapeBuf, 0, data.subarray(0, count * FLOATS_PER_SHAPE))
    },
    frame(time) {
      if (canvas.width === 0 || canvas.height === 0) return
      const f = fitBoard([canvas.width, canvas.height])
      // a label is about half a unit tall on screen: draw the atlas at that size
      atlasFor(f.s * 0.55)
      if (!group) return
      values.set([
        canvas.width,
        canvas.height,
        f.ox,
        f.oy,
        f.s,
        time,
        Math.max(1, labels.length),
        0,
      ])
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'gates' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setBindGroup(0, group)
      rp.setPipeline(boardPipe)
      rp.draw(3)
      if (count) {
        rp.setPipeline(shapePipe)
        rp.draw(6, count)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      uniform.destroy()
      shapeBuf.destroy()
      atlas?.destroy()
    },
  }
}
