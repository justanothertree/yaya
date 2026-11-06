import code from './studio.wgsl?raw'
import { MAX_PRIMS, SHOT, packPrims, packShot, primitives, type Scene } from './studio'

export type StudioView = {
  /** a changed scene: the picture starts again */
  scene(s: Scene): void
  /** trace `spp` more paths a pixel (0 to just show), then show the picture so far */
  frame(spp: number): void
  /** paths traced a pixel so far */
  readonly samples: number
  /** the picture as it stands, as a PNG */
  shoot(): Promise<Blob | null>
  /** for a probe: what each pixel's centre saw first */
  readonly buffers: { ids: GPUBuffer; sum: GPUBuffer }
  resize(): void
  destroy(): void
}

export async function createStudio(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<StudioView> {
  const module = device.createShaderModule({ label: 'studio', code })
  const develop = (target: GPUTextureFormat) =>
    device.createRenderPipelineAsync({
      label: `develop ${target}`,
      layout: 'auto',
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'develop', targets: [{ format: target }] },
      primitive: { topology: 'triangle-list' },
    })
  const [render, show, print] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'studio',
      layout: 'auto',
      compute: { module, entryPoint: 'render' },
    }),
    develop(format),
    develop('rgba8unorm'),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const uniform = device.createBuffer({
    label: 'studio',
    size: SHOT.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const prims = device.createBuffer({ label: 'studio prims', size: MAX_PRIMS * 64, usage: S })
  let sum: GPUBuffer | null = null
  let ids: GPUBuffer | null = null
  let groups: { render: GPUBindGroup; show: GPUBindGroup; print: GPUBindGroup } | null = null
  let current: Scene | null = null
  let count = 0
  let frame = 0
  let w = 1
  let h = 1
  const staging = new ArrayBuffer(SHOT.bytes)

  const build = () => {
    w = Math.max(1, canvas.width)
    h = Math.max(1, canvas.height)
    sum?.destroy()
    ids?.destroy()
    sum = device.createBuffer({ label: 'studio sum', size: w * h * 16, usage: S })
    ids = device.createBuffer({ label: 'studio ids', size: w * h * 4, usage: S })
    const g = (pipe: GPUComputePipeline | GPURenderPipeline, entries: [number, GPUBuffer][]) =>
      device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
      })
    groups = {
      render: g(render, [
        [0, uniform],
        [1, prims],
        [2, sum],
        [3, ids],
      ]),
      show: g(show, [
        [0, uniform],
        [4, sum],
      ]),
      print: g(print, [
        [0, uniform],
        [4, sum],
      ]),
    }
    frame = 0
  }
  build()

  const upload = (spp: number) => {
    if (!current) return
    device.queue.writeBuffer(
      uniform,
      0,
      packShot(current, { w, h, frame, spp, prims: count }, staging),
    )
  }

  const view: StudioView = {
    get samples() {
      return frame === 0 ? 0 : frame
    },
    get buffers() {
      return { ids: ids!, sum: sum! }
    },
    scene(s) {
      current = s
      const p = primitives(s)
      count = p.length
      device.queue.writeBuffer(prims, 0, packPrims(p))
      frame = 0
    },
    frame(spp) {
      if (!groups || !current || canvas.width === 0 || canvas.height === 0) return
      const e = device.createCommandEncoder({ label: 'studio' })
      if (spp > 0) {
        upload(spp)
        const p = e.beginComputePass()
        p.setPipeline(render)
        p.setBindGroup(0, groups.render)
        p.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
        p.end()
        // the count of paths a pixel lives in the sum's alpha; `frame` counts passes for the seed
        frame += spp
      } else upload(0)
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, groups.show)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    async shoot() {
      if (!groups) return null
      const tex = device.createTexture({
        size: [w, h],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      })
      const row = Math.ceil((w * 4) / 256) * 256
      const out = device.createBuffer({
        size: row * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const e = device.createCommandEncoder({ label: 'studio print' })
      const rp = e.beginRenderPass({
        colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store' }],
      })
      rp.setPipeline(print)
      rp.setBindGroup(0, groups.print)
      rp.draw(3)
      rp.end()
      e.copyTextureToBuffer({ texture: tex }, { buffer: out, bytesPerRow: row }, [w, h])
      device.queue.submit([e.finish()])
      try {
        await out.mapAsync(GPUMapMode.READ)
        const src = new Uint8Array(out.getMappedRange())
        const px = new Uint8ClampedArray(w * h * 4)
        for (let y = 0; y < h; y++) px.set(src.subarray(y * row, y * row + w * 4), y * w * 4)
        out.unmap()
        const c = new OffscreenCanvas(w, h)
        c.getContext('2d')?.putImageData(new ImageData(px, w, h), 0, 0)
        return await c.convertToBlob({ type: 'image/png' })
      } catch {
        return null
      } finally {
        out.destroy()
        tex.destroy()
      }
    },
    resize: build,
    destroy() {
      for (const b of [uniform, prims, sum, ids]) b?.destroy()
      groups = null
    },
  }
  return view
}
