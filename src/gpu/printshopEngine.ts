import code from './printshop.wgsl?raw'
import {
  BH,
  BW,
  INKS,
  MAX_POINTS,
  PAPER,
  SHOP,
  cutBox,
  packShop,
  type Cut,
  type Gouge,
  type Pull,
  type Step,
} from './printshop'

export type Shop = {
  /** take the block back to uncut lino and the paper back to blank */
  reset(): void
  /** carve a cut (or the new part of one being drawn: carving is a minimum, so pieces add up) */
  carve(c: Cut): void
  /** ink the block and pull a print onto the paper */
  pull(p: Pull): void
  /** start again from blank and carve and print every step: Undo, and opening a file */
  replay(steps: readonly Step[]): void
  frame(): void
  /** the print as a PNG, at the block's size */
  png(): Promise<Blob | null>
  /** read the block's heights or the paper's colours back, for the probes */
  read(which: 'height' | 'paper'): Promise<Float32Array>
  destroy(): void
}

export async function createShop(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<Shop> {
  const module = device.createShaderModule({ label: 'printshop', code })
  const C = GPUShaderStage.COMPUTE
  const F = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'printshop',
    entries: [
      { binding: 0, visibility: C | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C | F, buffer: { type: 'storage' } },
      { binding: 2, visibility: C | F, buffer: { type: 'storage' } },
      { binding: 3, visibility: C, buffer: { type: 'read-only-storage' } },
    ],
  })
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: `printshop ${entryPoint}`,
      layout: pl,
      compute: { module, entryPoint },
    })
  const [carvePipe, pressPipe, showPipe] = await Promise.all([
    compute('carve'),
    compute('press'),
    device.createRenderPipelineAsync({
      label: 'printshop show',
      layout: pl,
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const uniform = device.createBuffer({
    label: 'printshop shop',
    size: SHOP.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const height = device.createBuffer({ label: 'printshop block', size: BW * BH * 4, usage: S })
  const paper = device.createBuffer({ label: 'printshop paper', size: BW * BH * 16, usage: S })
  const points = device.createBuffer({
    label: 'printshop cut',
    size: MAX_POINTS * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout,
    entries: [uniform, height, paper, points].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  })
  const staging = new ArrayBuffer(SHOP.bytes)
  /** the uncut block and the blank sheet, kept to put back on a reset */
  const blankBlock = new Float32Array(BW * BH).fill(1)
  const blankPaper = new Float32Array(BW * BH * 4)
  for (let i = 0; i < BW * BH; i++) blankPaper.set([...PAPER, 1], i * 4)
  /** the last ink pulled: a film of it is left on what still stands on the block */
  let last: [number, number, number, number] = [0, 0, 0, 0]
  let version = 1
  let drawn = ''

  const uniforms = (
    o: Partial<{ box: [number, number, number, number]; points: number; gouge: Gouge } & Pull>,
  ) =>
    device.queue.writeBuffer(
      uniform,
      0,
      packShop(
        {
          w: canvas.width,
          h: canvas.height,
          box: o.box ?? [0, 0, 0, 0],
          points: o.points ?? 0,
          gouge: o.gouge ?? 'v',
          pressure: o.pressure ?? 1,
          seed: o.seed ?? 0,
          ink: INKS[o.ink ?? 0].rgb,
          last,
        },
        staging,
      ),
    )
  const dispatch = (pipe: GPUComputePipeline, x: number, y: number) => {
    const e = device.createCommandEncoder({ label: pipe.label })
    const p = e.beginComputePass()
    p.setPipeline(pipe)
    p.setBindGroup(0, group)
    p.dispatchWorkgroups(Math.ceil(x / 8), Math.ceil(y / 8))
    p.end()
    device.queue.submit([e.finish()])
  }

  const shop: Shop = {
    reset() {
      device.queue.writeBuffer(height, 0, blankBlock)
      device.queue.writeBuffer(paper, 0, blankPaper)
      last = [0, 0, 0, 0]
      version++
    },
    carve(c) {
      const box = cutBox(c.pts, c.g)
      if (!box) return
      const pts = c.pts.slice(0, MAX_POINTS)
      device.queue.writeBuffer(points, 0, Float32Array.from(pts.flat()))
      uniforms({ box, points: pts.length, gouge: c.g })
      dispatch(carvePipe, box[2] - box[0] + 1, box[3] - box[1] + 1)
      version++
    },
    pull(p) {
      uniforms(p)
      dispatch(pressPipe, BW, BH)
      last = [...INKS[p.ink].rgb, 1]
      version++
    },
    replay(steps) {
      shop.reset()
      for (const s of steps)
        if ('cut' in s) shop.carve(s.cut)
        else shop.pull(s.pull)
    },
    frame() {
      if (canvas.width === 0 || canvas.height === 0) return
      const key = `${version}:${canvas.width}x${canvas.height}`
      if (key === drawn) return
      drawn = key
      uniforms({})
      const e = device.createCommandEncoder({ label: 'printshop show' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: 'clear',
            clearValue: [0.2, 0.18, 0.17, 1],
            storeOp: 'store',
          },
        ],
      })
      rp.setPipeline(showPipe)
      rp.setBindGroup(0, group)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    async read(which) {
      const src = which === 'height' ? height : paper
      const out = device.createBuffer({
        size: src.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      try {
        const e = device.createCommandEncoder()
        e.copyBufferToBuffer(src, 0, out, 0, src.size)
        device.queue.submit([e.finish()])
        await out.mapAsync(GPUMapMode.READ)
        return new Float32Array(out.getMappedRange().slice(0))
      } finally {
        out.destroy()
      }
    },
    async png() {
      try {
        const f = await shop.read('paper')
        const px = new Uint8ClampedArray(BW * BH * 4)
        for (let i = 0; i < f.length; i++) px[i] = (i & 3) === 3 ? 255 : Math.round(f[i] * 255)
        const c = new OffscreenCanvas(BW, BH)
        c.getContext('2d')?.putImageData(new ImageData(px, BW, BH), 0, 0)
        return await c.convertToBlob({ type: 'image/png' })
      } catch {
        return null
      }
    },
    destroy() {
      for (const b of [uniform, height, paper, points]) b.destroy()
    },
  }
  shop.reset()
  return shop
}
