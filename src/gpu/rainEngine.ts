import code from './rain.wgsl?raw'
import { MAX_DROPS, PANE, packPane, type PaneParams, type Wipe } from './rain'

export type RainView = {
  /** the picture behind the glass, and the same picture out of focus */
  street(sharp: OffscreenCanvas, blurred: OffscreenCanvas): void
  /** mist the whole window over to this much (0..1) */
  fogAll(level: number): void
  frame(
    drops: Float32Array<ArrayBuffer>,
    count: number,
    wipes: readonly Wipe[],
    p: Omit<PaneParams, 'w' | 'h' | 'drops' | 'wipes'>,
  ): void
  resize(): void
  /** for a probe: the water's field, and the mist this frame drew into */
  readonly textures: { field: GPUTexture; mist: GPUTexture }
  destroy(): void
}

export const MAX_WIPES = 64
const FIELD: GPUTextureFormat = 'rg16float'
const MIST: GPUTextureFormat = 'r8unorm'

export async function createRain(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<RainView> {
  const module = device.createShaderModule({ label: 'rain', code })
  /* 'auto' layouts, one per pipeline, because the field is DRAWN INTO by one pass and READ by the
     next two: a single layout naming it would bind it as a texture in the very pass rendering to
     it, which WebGPU refuses as a usage conflict. An auto layout holds only what its entry uses */
  const fullscreen = (fragment: string, target: GPUTextureFormat) =>
    device.createRenderPipelineAsync({
      label: fragment,
      layout: 'auto',
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: fragment, targets: [{ format: target }] },
      primitive: { topology: 'triangle-list' },
    })
  const add: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' }
  const [splat, fog, show] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'splat',
      layout: 'auto',
      vertex: { module, entryPoint: 'drop_quad' },
      fragment: {
        module,
        entryPoint: 'splat',
        targets: [{ format: FIELD, blend: { color: add, alpha: add } }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    fullscreen('fog', MIST),
    fullscreen('show', format),
  ])

  const uniform = device.createBuffer({
    label: 'rain pane',
    size: PANE.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const dropBuf = device.createBuffer({ label: 'rain drops', size: MAX_DROPS * 16, usage: S })
  const wipeBuf = device.createBuffer({ label: 'rain wipes', size: MAX_WIPES * 16, usage: S })
  const lin = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const staging = new ArrayBuffer(PANE.bytes)

  const T = GPUTextureUsage
  const tex = (label: string, w: number, h: number, f: GPUTextureFormat, extra = 0) =>
    device.createTexture({
      label,
      size: [Math.max(1, w), Math.max(1, h)],
      format: f,
      usage: T.TEXTURE_BINDING | T.RENDER_ATTACHMENT | T.COPY_SRC | extra,
    })
  let field!: GPUTexture
  let mist: GPUTexture[] = []
  let sharp = tex('rain street', 1, 1, 'rgba8unorm', T.COPY_DST)
  let blurred = tex('rain street blurred', 1, 1, 'rgba8unorm', T.COPY_DST)
  let cur = 0
  let fogTo: number | null = 0.85
  let groups: { splat: GPUBindGroup; fog: GPUBindGroup[]; show: GPUBindGroup[] } | null = null

  const regroup = () => {
    const g = (pipe: GPURenderPipeline, entries: [number, GPUBindingResource][]) =>
      device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: entries.map(([binding, resource]) => ({ binding, resource })),
      })
    groups = {
      splat: g(splat, [
        [0, { buffer: uniform }],
        [1, { buffer: dropBuf }],
      ]),
      /* fog[k] reads mist k and is drawn into mist 1-k; show[k] shows mist k */
      fog: [0, 1].map((k) =>
        g(fog, [
          [0, { buffer: uniform }],
          [2, { buffer: wipeBuf }],
          [3, field.createView()],
          [4, mist[k].createView()],
        ]),
      ),
      show: [0, 1].map((k) =>
        g(show, [
          [0, { buffer: uniform }],
          [3, field.createView()],
          [4, mist[k].createView()],
          [5, sharp.createView()],
          [6, blurred.createView()],
          [7, lin],
        ]),
      ),
    }
  }

  const build = () => {
    field?.destroy()
    for (const m of mist) m.destroy()
    field = tex('rain field', canvas.width, canvas.height, FIELD)
    mist = [0, 1].map((k) => tex(`rain mist ${k}`, canvas.width, canvas.height, MIST))
    fogTo ??= 0.85
    regroup()
  }
  build()

  const view: RainView = {
    get textures() {
      return { field, mist: mist[cur] }
    },
    street(a, b) {
      sharp.destroy()
      blurred.destroy()
      sharp = tex('rain street', a.width, a.height, 'rgba8unorm', T.COPY_DST)
      blurred = tex('rain street blurred', b.width, b.height, 'rgba8unorm', T.COPY_DST)
      device.queue.copyExternalImageToTexture({ source: a }, { texture: sharp }, [
        a.width,
        a.height,
      ])
      device.queue.copyExternalImageToTexture({ source: b }, { texture: blurred }, [
        b.width,
        b.height,
      ])
      regroup()
    },
    fogAll(level) {
      fogTo = level
    },
    frame(drops, count, wipes, p) {
      if (!groups || canvas.width === 0 || canvas.height === 0) return
      const n = Math.min(count, MAX_DROPS)
      const nw = Math.min(wipes.length, MAX_WIPES)
      device.queue.writeBuffer(
        uniform,
        0,
        packPane({ ...p, w: canvas.width, h: canvas.height, drops: n, wipes: nw }, staging),
      )
      if (n) device.queue.writeBuffer(dropBuf, 0, drops, 0, n * 4)
      if (nw) device.queue.writeBuffer(wipeBuf, 0, new Float32Array(wipes.slice(0, nw).flat()))
      const e = device.createCommandEncoder({ label: 'rain' })
      if (fogTo !== null) {
        const v = fogTo
        e.beginRenderPass({
          colorAttachments: [
            {
              view: mist[cur].createView(),
              clearValue: { r: v, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        }).end()
        fogTo = null
      }
      const sp = e.beginRenderPass({
        colorAttachments: [
          {
            view: field.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      if (n) {
        sp.setPipeline(splat)
        sp.setBindGroup(0, groups.splat)
        sp.draw(n * 6)
      }
      sp.end()
      const fp = e.beginRenderPass({
        colorAttachments: [{ view: mist[1 - cur].createView(), loadOp: 'clear', storeOp: 'store' }],
      })
      fp.setPipeline(fog)
      fp.setBindGroup(0, groups.fog[cur])
      fp.draw(3)
      fp.end()
      cur = 1 - cur
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, groups.show[cur])
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    resize: build,
    destroy() {
      for (const t of [field, ...mist, sharp, blurred]) t.destroy()
      for (const b of [uniform, dropBuf, wipeBuf]) b.destroy()
      groups = null
    },
  }
  return view
}
