import paintCode from './jigsaw.wgsl?raw'
import code from './vision.wgsl?raw'
import { PICTURES, type PictureId } from './jigsaw'
import { fitImage } from './palette'
import type { M3 } from './vision'

export type VisionView = {
  /** paint one of Jigsaw's pictures into the picture, and hand back its pixels (RGBA, row by row) */
  paint(id: PictureId, w: number, h: number): Promise<Uint8Array>
  /** a picture from elsewhere — your own, or the chart — as RGBA pixels */
  photo(pixels: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): void
  frame(f: {
    matrix: M3
    split: number
    divider: boolean
    marks: [[number, number] | null, [number, number] | null]
  }): void
  /** the picture's size, for turning a press on the stage into a picture pixel */
  size(): [number, number]
  destroy(): void
}

/** each row of a texture read back is padded to this many bytes */
const ROW = 256

export async function createVision(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<VisionView> {
  const module = device.createShaderModule({ label: 'vision', code })
  // the pictures are Jigsaw's, painted by Jigsaw's own shader, as Palette does
  const paintModule = device.createShaderModule({ label: 'vision paint', code: paintCode })
  const F = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'vision',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, texture: {} },
      { binding: 2, visibility: F, sampler: {} },
    ],
  })
  const paintLayout = device.createBindGroupLayout({
    label: 'vision paint',
    entries: [{ binding: 0, visibility: F, buffer: { type: 'uniform' } }],
  })
  const [view, painter] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'vision view',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'view', targets: [{ format }] },
    }),
    device.createRenderPipelineAsync({
      label: 'vision paint',
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
  const uniform = device.createBuffer({ label: 'vision view', size: 96, usage: U })
  const paintUniform = device.createBuffer({ label: 'vision paint', size: 80, usage: U })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const paintGroup = device.createBindGroup({
    layout: paintLayout,
    entries: [{ binding: 0, resource: { buffer: paintUniform } }],
  })
  let picture: GPUTexture | null = null
  let group: GPUBindGroup | null = null
  const values = new Float32Array(24)

  const surface = (w: number, h: number) => {
    if (!picture || picture.width !== w || picture.height !== h) {
      picture?.destroy()
      picture = device.createTexture({
        label: 'vision picture',
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
          { binding: 1, resource: picture.createView() },
          { binding: 2, resource: sampler },
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
        label: 'vision readback',
        size: bytes * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const e = device.createCommandEncoder({ label: 'vision paint' })
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
      device.queue.writeTexture({ texture: surface(w, h) }, pixels, { bytesPerRow: w * 4 }, [w, h])
    },
    size: () => [picture?.width ?? 1, picture?.height ?? 1],
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0 || !group || !picture) return
      const fit = fitImage([canvas.width, canvas.height], [picture.width, picture.height])
      const m = f.matrix
      values.set([fit.s, 0, fit.ox, fit.oy], 0)
      values.set([picture.width, picture.height, f.split, f.divider ? 1 : 0], 4)
      values.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 8)
      const [a, b] = f.marks
      values.set([a?.[0] ?? -1, a?.[1] ?? -1, b?.[0] ?? -1, b?.[1] ?? -1], 20)
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'vision' })
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
      uniform.destroy()
      paintUniform.destroy()
      picture?.destroy()
      picture = null
      group = null
    },
  }
}
