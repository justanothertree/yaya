import code from './wallpaper.wgsl?raw'
import { MAX_OPS, packOps, type Group } from './wallpaper'

export type WallpaperView = {
  /** the drawing of one cell, as RGBA pixels of a CELL × CELL square */
  cell(pixels: Uint8ClampedArray<ArrayBuffer>): void
  /** part of the cell: w × h pixels at (x, y) */
  cellRect(pixels: Uint8ClampedArray<ArrayBuffer>, x: number, y: number, w: number, h: number): void
  group(g: Group): void
  frame(f: { cells: number; showCells: boolean; paper: [number, number, number] }): void
  /** the wall drawn at size × size, read back as RGBA rows — what Download saves */
  snapshot(size: number, f: { cells: number; paper: [number, number, number] }): Promise<Uint8Array>
  destroy(): void
}

export const CELL = 1024

export async function createWallpaper(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<WallpaperView> {
  const module = device.createShaderModule({ label: 'wallpaper', code })
  const F = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'wallpaper',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F, texture: {} },
      { binding: 3, visibility: F, sampler: {} },
    ],
  })
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const pipe = (target: GPUTextureFormat) =>
    device.createRenderPipelineAsync({
      label: `wallpaper ${target}`,
      layout: pl,
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'wall', targets: [{ format: target }] },
    })
  const [onScreen, offScreen] = await Promise.all([pipe(format), pipe('rgba8unorm')])
  const uniform = device.createBuffer({
    label: 'wallpaper view',
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const opBuf = device.createBuffer({
    label: 'wallpaper ops',
    size: MAX_OPS * 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const cellTex = device.createTexture({
    label: 'wallpaper cell',
    size: [CELL, CELL],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  // repeat, so a sample at the cell's edge blends with the other edge, which is its neighbour
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  })
  const group = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: opBuf } },
      { binding: 2, resource: cellTex.createView() },
      { binding: 3, resource: sampler },
    ],
  })
  let n = 1
  let hex = 0
  const values = new Float32Array(12)
  const draw = (
    view: GPUTextureView,
    pipeline: GPURenderPipeline,
    w: number,
    h: number,
    cells: number,
    showCells: boolean,
    paper: [number, number, number],
  ) => {
    // `cells` cells fit across the shorter side
    const s = Math.min(w, h) / cells
    values.set([w, h, w / 2, h / 2, s, n, hex, showCells ? 1 : 0, ...paper, 1])
    device.queue.writeBuffer(uniform, 0, values)
    const e = device.createCommandEncoder({ label: 'wallpaper' })
    const rp = e.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }],
    })
    rp.setPipeline(pipeline)
    rp.setBindGroup(0, group)
    rp.draw(3)
    rp.end()
    return e
  }
  return {
    cell(pixels) {
      device.queue.writeTexture({ texture: cellTex }, pixels, { bytesPerRow: CELL * 4 }, [
        CELL,
        CELL,
      ])
    },
    cellRect(pixels, x, y, w, h) {
      device.queue.writeTexture(
        { texture: cellTex, origin: [x, y] },
        pixels,
        { bytesPerRow: w * 4 },
        [w, h],
      )
    },
    group(g) {
      n = g.ops.length
      hex = g.lattice === 'hex' ? 1 : 0
      device.queue.writeBuffer(opBuf, 0, packOps(g))
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const e = draw(
        context.getCurrentTexture().createView(),
        onScreen,
        canvas.width,
        canvas.height,
        f.cells,
        f.showCells,
        f.paper,
      )
      device.queue.submit([e.finish()])
    },
    async snapshot(size, f) {
      const tex = device.createTexture({
        size: [size, size],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      })
      const row = Math.ceil((size * 4) / 256) * 256
      const read = device.createBuffer({
        size: row * size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      try {
        const e = draw(tex.createView(), offScreen, size, size, f.cells, false, f.paper)
        e.copyTextureToBuffer({ texture: tex }, { buffer: read, bytesPerRow: row }, [size, size])
        device.queue.submit([e.finish()])
        await read.mapAsync(GPUMapMode.READ)
        const padded = new Uint8Array(read.getMappedRange())
        const out = new Uint8Array(size * size * 4)
        for (let y = 0; y < size; y++)
          out.set(padded.subarray(y * row, y * row + size * 4), y * size * 4)
        return out
      } finally {
        read.destroy()
        tex.destroy()
      }
    },
    destroy() {
      for (const b of [uniform, opBuf]) b.destroy()
      cellTex.destroy()
    },
  }
}

/** RGBA rows to a PNG file */
export async function encodePng(px: Uint8Array, size: number): Promise<Blob> {
  const c = new OffscreenCanvas(size, size)
  const x = c.getContext('2d')
  if (!x) throw new Error('no 2D canvas')
  x.putImageData(new ImageData(new Uint8ClampedArray(px), size, size), 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}
