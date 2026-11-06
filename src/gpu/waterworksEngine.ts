import sim from './waterworks.wgsl?raw'
import draw from './waterworks-draw.wgsl?raw'
import { MAX_DROPS, NX, NY, TANK, packTank, type Rect, type V2 } from './waterworks'

export type TankFrame = {
  count: number
  tool: number
  toolAt: V2
  toolR: number
  cup: Rect
  time: number
}

export type WaterworksView = {
  /** a fresh tank: the mask, the plates' heat, and the drops it starts with (eight floats each) */
  load(mask: Uint8Array, heat: Float32Array<ArrayBuffer>, drops: readonly number[]): void
  /** the walls changed */
  mask(mask: Uint8Array): void
  /** drops added at slot `from` */
  add(from: number, drops: readonly number[]): void
  /** `steps` substeps of the fluid, then a picture */
  frame(f: TankFrame, steps: number): void
  /** how many water drops are in the cup, read back from the last count; null while one is pending */
  cup(): Promise<number | null>
  readonly buffers: { drops: GPUBuffer; vel: GPUBuffer; div: GPUBuffer }
  resize(): void
  destroy(): void
}

/** each substep's length, and how many Jacobi passes its pressure gets */
export const DT = 1 / 120
export const JACOBI = 40
const FLIP = 0.95

export async function createWaterworks(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<WaterworksView> {
  const simModule = device.createShaderModule({ label: 'waterworks', code: sim })
  const drawModule = device.createShaderModule({ label: 'waterworks draw', code: draw })
  /* ⚠️ 'AUTO' LAYOUTS, A BIND GROUP PER PASS. Fourteen storage buffers between the two groups and a
     stage may use eight, so no one layout can hold them all; each pass names only what it reads,
     and the lists below say which. A wrong list is a validation error, never a silent one. */
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: 'auto',
      compute: { module: simModule, entryPoint },
    })
  const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
  const [clear, p2g, faces, diverge, jacobi, swap, project, g2p, count, splat, show] =
    await Promise.all([
      compute('clear'),
      compute('p2g'),
      compute('faces'),
      compute('diverge'),
      compute('jacobi'),
      compute('swap'),
      compute('project'),
      compute('g2p'),
      compute('count_cup'),
      device.createRenderPipelineAsync({
        label: 'splat',
        layout: 'auto',
        vertex: { module: drawModule, entryPoint: 'splat_vs' },
        fragment: {
          module: drawModule,
          entryPoint: 'splat_fs',
          targets: [{ format: 'rgba16float', blend: { color: add, alpha: add } }],
        },
        primitive: { topology: 'triangle-list' },
      }),
      device.createRenderPipelineAsync({
        label: 'waterworks',
        layout: 'auto',
        vertex: { module: drawModule, entryPoint: 'cover' },
        fragment: { module: drawModule, entryPoint: 'show', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      }),
    ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const buf = (label: string, size: number) =>
    device.createBuffer({ label, size: Math.max(16, size), usage: S })
  const uniform = device.createBuffer({
    label: 'waterworks',
    size: TANK.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const U = (NX + 1) * NY
  const V = NX * (NY + 1)
  const C = NX * NY
  const drops = buf('waterworks drops', MAX_DROPS * 32)
  const uAcc = buf('waterworks u acc', U * 4)
  const uW = buf('waterworks u weight', U * 4)
  const vAcc = buf('waterworks v acc', V * 4)
  const vW = buf('waterworks v weight', V * 4)
  const cells = buf('waterworks cells', C * 4)
  const maskBuf = buf('waterworks mask', C * 4)
  const vel = buf('waterworks vel', (U + V) * 4)
  const old = buf('waterworks old', (U + V) * 4)
  const pres = buf('waterworks pressure', C * 4)
  const pnext = buf('waterworks pressure next', C * 4)
  const div = buf('waterworks divergence', C * 4)
  const heat = buf('waterworks heat', C * 8)
  const tally = buf('waterworks tally', 4)
  const readback = device.createBuffer({
    label: 'waterworks readback',
    size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })
  const g0: GPUBuffer[] = [uniform, drops, uAcc, uW, vAcc, vW, cells, maskBuf]
  const g1: GPUBuffer[] = [vel, old, pres, pnext, div, heat, tally]
  const groups = (pipe: GPUComputePipeline, a: number[], b: number[]): GPUBindGroup[] => [
    device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: a.map((binding) => ({ binding, resource: { buffer: g0[binding] } })),
    }),
    device.createBindGroup({
      layout: pipe.getBindGroupLayout(1),
      entries: b.map((binding) => ({ binding, resource: { buffer: g1[binding] } })),
    }),
  ]
  const tiles = (n: number) => Math.ceil(n / 256)
  /** each pass: its pipeline, its groups, and how it is dispatched */
  const pass = {
    clear: [clear, groups(clear, [0, 2, 3, 4, 5, 6], []), [tiles(Math.max(U, V))]],
    p2g: [p2g, groups(p2g, [0, 1, 2, 3, 4, 5, 6], []), null],
    faces: [faces, groups(faces, [0, 2, 3, 4, 5, 6, 7], [0, 1]), [tiles(Math.max(U, V))]],
    diverge: [diverge, groups(diverge, [0, 6, 7], [0, 2, 4]), [NX / 16, Math.ceil(NY / 16)]],
    jacobi: [jacobi, groups(jacobi, [0, 6, 7], [2, 3, 4]), [NX / 16, Math.ceil(NY / 16)]],
    swap: [swap, groups(swap, [0], [2, 3]), [tiles(C)]],
    project: [project, groups(project, [0, 6, 7], [0, 2]), [tiles(Math.max(U, V))]],
    g2p: [g2p, groups(g2p, [0, 1, 6, 7], [0, 1, 5]), null],
    count: [count, groups(count, [0, 1], [6]), null],
  } as const
  let splatTex: GPUTexture | null = null
  let drawGroups: { splat: GPUBindGroup; show: GPUBindGroup } | null = null
  const build = () => {
    splatTex?.destroy()
    splatTex = device.createTexture({
      label: 'waterworks splats',
      size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    drawGroups = {
      splat: device.createBindGroup({
        layout: splat.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: drops } },
        ],
      }),
      show: device.createBindGroup({
        layout: show.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 2, resource: { buffer: maskBuf } },
          { binding: 3, resource: { buffer: heat } },
          { binding: 4, resource: splatTex.createView() },
        ],
      }),
    }
  }
  build()
  const staging = new ArrayBuffer(TANK.bytes)
  let live = 0
  let reading = false
  const maskWords = (m: Uint8Array) => Uint32Array.from(m)

  const view: WaterworksView = {
    buffers: { drops, vel, div },
    load(mask, h, start) {
      device.queue.writeBuffer(drops, 0, new Float32Array(MAX_DROPS * 8))
      const keep = start.slice(0, MAX_DROPS * 8)
      if (keep.length) device.queue.writeBuffer(drops, 0, Float32Array.from(keep))
      device.queue.writeBuffer(maskBuf, 0, maskWords(mask))
      device.queue.writeBuffer(heat, 0, h)
      live = keep.length / 8
    },
    mask(mask) {
      device.queue.writeBuffer(maskBuf, 0, maskWords(mask))
    },
    add(from, data) {
      const n = Math.min(data.length / 8, MAX_DROPS - from)
      if (n <= 0) return
      device.queue.writeBuffer(drops, from * 32, Float32Array.from(data.slice(0, n * 8)))
      live = Math.max(live, from + n)
    },
    async cup() {
      if (reading) return null
      reading = true
      try {
        await readback.mapAsync(GPUMapMode.READ)
        const n = new Uint32Array(readback.getMappedRange().slice(0))[0]
        readback.unmap()
        return n
      } catch {
        return null
      } finally {
        reading = false
      }
    },
    frame(f, steps) {
      if (!drawGroups || !splatTex || canvas.width === 0 || canvas.height === 0) return
      device.queue.writeBuffer(
        uniform,
        0,
        packTank(
          { ...f, w: canvas.width, h: canvas.height, count: live, dt: DT, flip: FLIP },
          staging,
        ),
      )
      const e = device.createCommandEncoder({ label: 'waterworks' })
      if (steps > 0 && live > 0) {
        const p = e.beginComputePass()
        const run = (name: keyof typeof pass) => {
          const [pipe, [a, b], size] = pass[name]
          p.setPipeline(pipe)
          p.setBindGroup(0, a)
          p.setBindGroup(1, b)
          if (size) p.dispatchWorkgroups(size[0], size[1] ?? 1)
          else p.dispatchWorkgroups(Math.ceil(live / 64))
        }
        for (let s = 0; s < steps; s++) {
          run('clear')
          run('p2g')
          run('faces')
          run('diverge')
          for (let k = 0; k < JACOBI; k++) {
            run('jacobi')
            run('swap')
          }
          run('project')
          run('g2p')
        }
        p.end()
      }
      // the cup, counted afresh, copied out for whoever asks next
      e.clearBuffer(tally)
      {
        const p = e.beginComputePass()
        const [pipe, [a, b]] = pass.count
        p.setPipeline(pipe)
        p.setBindGroup(0, a)
        p.setBindGroup(1, b)
        p.dispatchWorkgroups(Math.max(1, Math.ceil(live / 64)))
        p.end()
      }
      if (!reading) e.copyBufferToBuffer(tally, 0, readback, 0, 4)
      const sp = e.beginRenderPass({
        colorAttachments: [
          {
            view: splatTex.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      if (live) {
        sp.setPipeline(splat)
        sp.setBindGroup(0, drawGroups.splat)
        sp.draw(live * 6)
      }
      sp.end()
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, drawGroups.show)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    resize: build,
    destroy() {
      splatTex?.destroy()
      for (const b of [uniform, ...g0.slice(1), ...g1, readback]) b.destroy()
      drawGroups = null
    },
  }
  return view
}
