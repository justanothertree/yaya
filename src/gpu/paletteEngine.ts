import paintCode from './jigsaw.wgsl?raw'
import code from './palette.wgsl?raw'
import { PICTURES, type PictureId } from './jigsaw'
import { fitImage, packPalette, type Lab } from './palette'

export type PaletteView = {
  /** paint one of Jigsaw's pictures into the picture, and hand back its pixels (RGBA, row by row) */
  paint(id: PictureId, w: number, h: number): Promise<Uint8Array>
  /** a picture of somebody's own, as RGBA pixels */
  photo(pixels: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): void
  colours(c: readonly Lab[], highlight: number): void
  frame(f: { mode: number; split: number }): void
  destroy(): void
}

/** each row of a texture read back is padded to this many bytes */
const ROW = 256

export async function createPalette(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<PaletteView> {
  const module = device.createShaderModule({ label: 'palette', code })
  // the pictures are Jigsaw's, painted by Jigsaw's own shader: one source for the six of them
  const paintModule = device.createShaderModule({ label: 'palette paint', code: paintCode })
  const F = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'palette',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F, texture: {} },
      { binding: 3, visibility: F, sampler: {} },
    ],
  })
  const paintLayout = device.createBindGroupLayout({
    label: 'palette paint',
    entries: [{ binding: 0, visibility: F, buffer: { type: 'uniform' } }],
  })
  const [view, painter] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'palette view',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'view', targets: [{ format }] },
    }),
    device.createRenderPipelineAsync({
      label: 'palette paint',
      layout: device.createPipelineLayout({ bindGroupLayouts: [paintLayout] }),
      vertex: { module: paintModule, entryPoint: 'cover' },
      fragment: {
        module: paintModule,
        entryPoint: 'paint_fs',
        targets: [{ format: 'rgba8unorm' }],
      },
    }),
  ])
  const U = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  const uniform = device.createBuffer({ label: 'palette view', size: 48, usage: U })
  const paintUniform = device.createBuffer({ label: 'palette paint', size: 80, usage: U })
  const palBuf = device.createBuffer({
    label: 'palette colours',
    size: 10 * 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'linear' })
  const paintGroup = device.createBindGroup({
    layout: paintLayout,
    entries: [{ binding: 0, resource: { buffer: paintUniform } }],
  })
  let picture: GPUTexture | null = null
  let group: GPUBindGroup | null = null
  let count = 0
  let highlight = -1
  const values = new Float32Array(12)

  const surface = (w: number, h: number) => {
    if (!picture || picture.width !== w || picture.height !== h) {
      picture?.destroy()
      picture = device.createTexture({
        label: 'palette picture',
        size: [w, h],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: palBuf } },
          { binding: 2, resource: picture.createView() },
          { binding: 3, resource: sampler },
        ],
      })
    }
    return picture
  }
  surface(4, 3)

  return {
    async paint(id, w, h) {
      const target = surface(w, h)
      const v = new Float32Array(20)
      v.set(
        [
          Math.max(
            0,
            PICTURES.findIndex((q) => q.id === id),
          ),
          w / h,
          w,
          h,
        ],
        16,
      )
      device.queue.writeBuffer(paintUniform, 0, v)
      const bytes = Math.ceil((w * 4) / ROW) * ROW
      const read = device.createBuffer({
        label: 'palette readback',
        size: bytes * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const e = device.createCommandEncoder({ label: 'palette paint' })
      const rp = e.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
      })
      rp.setPipeline(painter)
      rp.setBindGroup(0, paintGroup)
      rp.draw(3)
      rp.end()
      e.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow: bytes }, [w, h])
      device.queue.submit([e.finish()])
      try {
        await read.mapAsync(GPUMapMode.READ)
        const padded = new Uint8Array(read.getMappedRange())
        const out = new Uint8Array(w * h * 4)
        for (let y = 0; y < h; y++)
          out.set(padded.subarray(y * bytes, y * bytes + w * 4), y * w * 4)
        return out
      } finally {
        read.destroy()
      }
    },
    photo(pixels, w, h) {
      // through writeTexture, as Jigsaw does: see jigsawEngine.ts for why not copyExternalImage
      device.queue.writeTexture({ texture: surface(w, h) }, pixels, { bytesPerRow: w * 4 }, [w, h])
    },
    colours(c, h) {
      count = Math.min(c.length, 10)
      highlight = h
      device.queue.writeBuffer(palBuf, 0, packPalette(c, h))
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0 || !group || !picture) return
      const fit = fitImage([canvas.width, canvas.height], [picture.width, picture.height])
      values.set([fit.s, 0, fit.ox, fit.oy], 0)
      values.set([picture.width, picture.height, count, highlight], 4)
      values.set([f.mode, f.split, 0, 0], 8)
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'palette' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(view)
      rp.setBindGroup(0, group)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [uniform, paintUniform, palBuf]) b.destroy()
      picture?.destroy()
      picture = null
      group = null
    },
  }
}
