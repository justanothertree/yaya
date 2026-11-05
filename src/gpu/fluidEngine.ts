import code from './fluid.wgsl?raw'
import {
  DYE_LONG,
  FLUID,
  SIM_LONG,
  gridSize,
  packFluid,
  splatRadius,
  type FluidParams,
} from './fluid'

export type Splat = {
  /** where, in uv (0..1, y down) */
  point: readonly [number, number]
  /** sim texels per second */
  force: readonly [number, number]
  color: readonly [number, number, number]
  /** how much of the colour covers what is there, 0..1 */
  ink: number
}

export type FluidInput = {
  /** the next splat to apply, taken and cleared by the frame that applies it */
  splat: Splat | null
  swirl: number
  /** how long dye lasts: higher fades faster */
  fade: number
}

export type FluidSim = {
  frame(dt: number, input: FluidInput): void
  clear(): void
  /** The canvas changed shape: rebuild the grids to match, dropping what was on them. */
  resize(): void
  destroy(): void
}

/** Jacobi sweeps per frame. More is a stiffer, less springy fluid; 20 is the usual compromise. */
const PRESSURE_SWEEPS = 20
const FORMAT: GPUTextureFormat = 'rgba16float'

/**
 * Fields that are read and written in the same step come in pairs: a pass reads one and draws
 * into the other, then they swap, because a texture cannot be sampled while it is the target.
 */
type Pair = { read: GPUTexture; write: GPUTexture; swap(): void; destroy(): void }

export async function createFluid(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<FluidSim> {
  const module = device.createShaderModule({ label: 'fluid', code })
  /* ⚠️ ONE EXPLICIT LAYOUT FOR EVERY PASS, not `layout: 'auto'`. An auto layout leaves out any
     binding its entry point never reads — `show` never reads the uniform, half the passes never
     read `b` — so one list of entries would fit some pipelines and be refused by the rest. */
  const groupLayout = device.createBindGroupLayout({
    label: 'fluid',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] })
  const pipeline = (entryPoint: string, target: GPUTextureFormat) =>
    device.createRenderPipelineAsync({
      label: entryPoint,
      layout,
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint, targets: [{ format: target }] },
      primitive: { topology: 'triangle-list' },
    })
  const names = [
    'splat_velocity',
    'splat_dye',
    'curl',
    'vorticity',
    'divergence',
    'pressure',
    'project',
    'advect_velocity',
    'advect_dye',
  ] as const
  const built = await Promise.all([
    ...names.map((n) => pipeline(n, FORMAT)),
    pipeline('show', format),
  ])
  const P = Object.fromEntries(names.map((n, i) => [n, built[i]])) as Record<
    (typeof names)[number],
    GPURenderPipeline
  >
  const show = built[names.length]

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  const uniform = device.createBuffer({
    label: 'fluid params',
    size: FLUID.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(FLUID.bytes)

  const texture = (w: number, h: number, label: string) =>
    device.createTexture({
      label,
      size: [w, h],
      format: FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
  const pair = (w: number, h: number, label: string): Pair => {
    const p = {
      read: texture(w, h, `${label} a`),
      write: texture(w, h, `${label} b`),
      swap() {
        ;[p.read, p.write] = [p.write, p.read]
      },
      destroy() {
        p.read.destroy()
        p.write.destroy()
      },
    }
    return p
  }

  let sim = { w: 1, h: 1 }
  let dyeSize = { w: 1, h: 1 }
  let velocity: Pair | null = null
  let pressure: Pair | null = null
  let dye: Pair | null = null
  let curlTex: GPUTexture | null = null
  let divTex: GPUTexture | null = null
  let needsClear = true

  function build() {
    ;[velocity, pressure, dye].forEach((p) => p?.destroy())
    curlTex?.destroy()
    divTex?.destroy()
    sim = gridSize(canvas.width, canvas.height, SIM_LONG)
    dyeSize = gridSize(canvas.width, canvas.height, DYE_LONG)
    velocity = pair(sim.w, sim.h, 'velocity')
    pressure = pair(sim.w, sim.h, 'pressure')
    dye = pair(dyeSize.w, dyeSize.h, 'dye')
    curlTex = texture(sim.w, sim.h, 'curl')
    divTex = texture(sim.w, sim.h, 'divergence')
    needsClear = true
  }
  build()

  /** One full-screen pass: draw `pipe` into `target`, reading `a` (and `b`, when it uses one —
   *  a pass that does not is handed `a` twice, which it never looks at). */
  function pass(
    encoder: GPUCommandEncoder,
    pipe: GPURenderPipeline,
    target: GPUTextureView,
    a: GPUTexture,
    b: GPUTexture = a,
  ) {
    const group = device.createBindGroup({
      layout: groupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: a.createView() },
        { binding: 3, resource: b.createView() },
      ],
    })
    const rp = encoder.beginRenderPass({
      colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store' }],
    })
    rp.setPipeline(pipe)
    rp.setBindGroup(0, group)
    rp.draw(3)
    rp.end()
  }

  function clearAll(encoder: GPUCommandEncoder) {
    for (const t of [velocity!.read, velocity!.write, pressure!.read, pressure!.write, dye!.read])
      encoder
        .beginRenderPass({
          colorAttachments: [
            {
              view: t.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        .end()
  }

  function frame(dt: number, input: FluidInput) {
    if (!velocity || !pressure || !dye || !curlTex || !divTex) return
    if (canvas.width === 0 || canvas.height === 0) return
    const splat = input.splat
    input.splat = null
    const params: FluidParams = {
      texel: [1 / sim.w, 1 / sim.h],
      dyeTexel: [1 / dyeSize.w, 1 / dyeSize.h],
      point: splat?.point ?? [-10, -10],
      force: splat?.force ?? [0, 0],
      color: splat?.color ?? [0, 0, 0],
      ink: splat?.ink ?? 0,
      aspect: canvas.width / canvas.height,
      radius: splatRadius(0.035),
      dt,
      swirl: input.swirl,
      velDecay: 0.2,
      dyeDecay: input.fade,
    }
    device.queue.writeBuffer(uniform, 0, packFluid(params, staging))

    const encoder = device.createCommandEncoder({ label: 'fluid frame' })
    if (needsClear) {
      clearAll(encoder)
      needsClear = false
    }
    const v = velocity
    const pr = pressure
    const dy = dye

    if (splat) {
      pass(encoder, P.splat_velocity, v.write.createView(), v.read)
      v.swap()
      pass(encoder, P.splat_dye, dy.write.createView(), dy.read)
      dy.swap()
    }
    if (dt > 0) {
      pass(encoder, P.curl, curlTex.createView(), v.read)
      pass(encoder, P.vorticity, v.write.createView(), v.read, curlTex)
      v.swap()
      pass(encoder, P.divergence, divTex.createView(), v.read)
      for (let i = 0; i < PRESSURE_SWEEPS; i++) {
        pass(encoder, P.pressure, pr.write.createView(), pr.read, divTex)
        pr.swap()
      }
      pass(encoder, P.project, v.write.createView(), v.read, pr.read)
      v.swap()
      pass(encoder, P.advect_velocity, v.write.createView(), v.read)
      v.swap()
      pass(encoder, P.advect_dye, dy.write.createView(), dy.read, v.read)
      dy.swap()
    }
    pass(encoder, show, context.getCurrentTexture().createView(), dy.read)
    device.queue.submit([encoder.finish()])
  }

  return {
    frame,
    clear: () => {
      needsClear = true
    },
    resize: build,
    destroy() {
      ;[velocity, pressure, dye].forEach((p) => p?.destroy())
      curlTex?.destroy()
      divTex?.destroy()
      uniform.destroy()
      velocity = pressure = dye = null
      curlTex = divTex = null
    },
  }
}
