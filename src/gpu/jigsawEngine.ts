import code from './jigsaw.wgsl?raw'
import { MAX_PIECES, PICTURES, packKnobs, packPieces, type Puzzle, type Table } from './jigsaw'

export type JigsawView = {
  /** a new cut: its knobs, and the board's size the picture must fill */
  cut(p: Puzzle): void
  /** paint one of the built-in pictures for the current cut */
  paint(id: (typeof PICTURES)[number]['id']): void
  /** a picture of somebody's own, already cropped to the board's shape */
  photo(bitmap: ImageBitmap): void
  /** where every piece is, and the draw order */
  pieces(p: Puzzle): void
  frame(f: {
    fit: { s: number; ox: number; oy: number }
    table: Table
    time: number
    ghost: number
    held: number
    finished: number
  }): void
  destroy(): void
}

/** the width of a built-in picture's texture; its height follows the board */
const PAINT_WIDTH = 1024

export async function createJigsaw(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<JigsawView> {
  const module = device.createShaderModule({ label: 'jigsaw', code })
  const vf = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'jigsaw',
    entries: [
      { binding: 0, visibility: vf, buffer: { type: 'uniform' } },
      ...[1, 2, 3, 4].map((binding) => ({
        binding,
        visibility: vf,
        buffer: { type: 'read-only-storage' as const },
      })),
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  })
  // the paint pass reads the uniform only, so it gets a layout of its own: it renders INTO the
  // picture, which must not also be bound for reading in the same pass
  const paintLayout = device.createBindGroupLayout({
    label: 'jigsaw paint',
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
  })
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const alpha: GPUBlendState = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  }
  const [table, shade, piece, painter] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'jigsaw table',
      layout: pl,
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'table_fs', targets: [{ format }] },
    }),
    device.createRenderPipelineAsync({
      label: 'jigsaw shadows',
      layout: pl,
      vertex: { module, entryPoint: 'shade_vs' },
      fragment: { module, entryPoint: 'shade_fs', targets: [{ format, blend: alpha }] },
    }),
    device.createRenderPipelineAsync({
      label: 'jigsaw pieces',
      layout: pl,
      vertex: { module, entryPoint: 'piece_vs' },
      fragment: { module, entryPoint: 'piece_fs', targets: [{ format }] },
    }),
    device.createRenderPipelineAsync({
      label: 'jigsaw paint',
      layout: device.createPipelineLayout({ bindGroupLayouts: [paintLayout] }),
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'paint_fs', targets: [{ format: 'rgba8unorm' }] },
    }),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const U = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  const uniform = device.createBuffer({ label: 'jigsaw view', size: 80, usage: U })
  const paintUniform = device.createBuffer({ label: 'jigsaw paint', size: 80, usage: U })
  const acrossBuf = device.createBuffer({ label: 'jigsaw across', size: MAX_PIECES * 16, usage: S })
  const downBuf = device.createBuffer({ label: 'jigsaw down', size: MAX_PIECES * 16, usage: S })
  const pieceBuf = device.createBuffer({ label: 'jigsaw pieces', size: MAX_PIECES * 16, usage: S })
  const orderBuf = device.createBuffer({ label: 'jigsaw order', size: MAX_PIECES * 4, usage: S })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const paintGroup = device.createBindGroup({
    layout: paintLayout,
    entries: [{ binding: 0, resource: { buffer: paintUniform } }],
  })

  let picture: GPUTexture | null = null
  let group: GPUBindGroup | null = null
  let cols = 2
  let rows = 2
  let count = 0
  const values = new Float32Array(20)

  /** a picture texture of this size, and the bind group that reads it */
  const surface = (w: number, h: number) => {
    if (!picture || picture.width !== w || picture.height !== h) {
      picture?.destroy()
      picture = device.createTexture({
        label: 'jigsaw picture',
        size: [w, h],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      group = device.createBindGroup({
        layout,
        entries: [
          ...[uniform, acrossBuf, downBuf, pieceBuf, orderBuf].map((buffer, binding) => ({
            binding,
            resource: { buffer },
          })),
          { binding: 5, resource: picture.createView() },
          { binding: 6, resource: sampler },
        ],
      })
    }
    return picture
  }
  // a blank picture until the first one is painted, so a frame never meets an unbound texture
  surface(4, 3)

  return {
    cut(p) {
      cols = p.cuts.cols
      rows = p.cuts.rows
      const { across, down } = packKnobs(p.cuts)
      device.queue.writeBuffer(acrossBuf, 0, across)
      device.queue.writeBuffer(downBuf, 0, down)
    },
    paint(id) {
      const index = Math.max(
        0,
        PICTURES.findIndex((q) => q.id === id),
      )
      const w = PAINT_WIDTH
      const h = Math.max(1, Math.round((PAINT_WIDTH * rows) / cols))
      const target = surface(w, h)
      const v = new Float32Array(20)
      v.set([index, cols / rows, w, h], 16)
      device.queue.writeBuffer(paintUniform, 0, v)
      const e = device.createCommandEncoder({ label: 'jigsaw paint' })
      const rp = e.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
      })
      rp.setPipeline(painter)
      rp.setBindGroup(0, paintGroup)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    photo(bitmap) {
      /* ⚠️ THROUGH A 2D CANVAS, NOT copyExternalImageToTexture. The direct copy threw "Failed to
         copy content from external image" on this toy's device in the test browser (SwiftShader),
         for every bitmap tried — cropped or not, into a new texture or the old one — while the same
         bitmap copied fine on a second device in the same page and drew fine to a 2D canvas.
         Unexplained, so the toy takes the one path that was seen to work: the pixels are read once
         when the picture is chosen, at most 2048 × 2048 × 4 bytes. */
      const w = bitmap.width
      const h = bitmap.height
      const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
      if (!c) throw new Error('no 2D canvas to read the picture with')
      c.drawImage(bitmap, 0, 0)
      const pixels = c.getImageData(0, 0, w, h).data
      device.queue.writeTexture({ texture: surface(w, h) }, pixels, { bytesPerRow: w * 4 }, [w, h])
    },
    pieces(p) {
      const { pieces, order } = packPieces(p)
      count = Math.min(order.length, MAX_PIECES)
      device.queue.writeBuffer(pieceBuf, 0, pieces)
      device.queue.writeBuffer(orderBuf, 0, order)
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0 || !group) return
      const t = f.table
      values.set([canvas.width, canvas.height, f.fit.ox, f.fit.oy], 0)
      values.set([f.fit.s, cols, rows, count], 4)
      values.set([t.x0, t.y0, t.x1, t.y1], 8)
      values.set([f.time, f.ghost, f.held, f.finished], 12)
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'jigsaw' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setBindGroup(0, group)
      rp.setPipeline(table)
      rp.draw(3)
      if (count) {
        rp.setPipeline(shade)
        rp.draw(6, count)
        rp.setPipeline(piece)
        rp.draw(6, count)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [uniform, paintUniform, acrossBuf, downBuf, pieceBuf, orderBuf]) b.destroy()
      picture?.destroy()
      picture = null
      group = null
    },
  }
}
