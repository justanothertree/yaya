import code from './pixelsort.wgsl?raw'
import { AXIS, BY_ID, LINE, SORT, stages, type By, type Direction } from './pixelsort'

export type SortJob = { direction: Direction; lo: number; hi: number; by: By }
export type Dab = { x: number; y: number; r: number }

export type PixelSortView = {
  /** a new photo, at most LINE pixels each way; the brush and any sort in progress are dropped */
  load(source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas, w: number, h: number): void
  /** start sorting what the brush has marked; a sort still running is finished first */
  sort(job: SortJob): void
  /** mark everything, for sorting the whole photo */
  markAll(): void
  /** run up to `stages` stages of any sort in progress, brush the dabs in, and draw */
  frame(f: { w: number; h: number; dabs: readonly Dab[]; stages: number }): void
  readonly sorting: boolean
  readonly image: readonly [number, number]
  /** for the probe: the photo as it stands, the keys, and the brush's mask */
  readonly photo: GPUTexture
  readonly keys: GPUBuffer
  readonly mask: GPUBuffer
  destroy(): void
}

const MAX_DABS = 64
/** the network's stages for a line of LINE keys, each in its own 256-byte uniform slot */
const STAGES = stages(LINE)
const SLOT = 256

export async function createPixelSort(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<PixelSortView> {
  const C = GPUShaderStage.COMPUTE
  const F = GPUShaderStage.FRAGMENT
  const workLayout = device.createBindGroupLayout({
    label: 'pixel sort work',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, texture: { sampleType: 'float' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
      { binding: 3, visibility: C, buffer: { type: 'storage' } },
      { binding: 4, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
    ],
  })
  const stageLayout = device.createBindGroupLayout({
    label: 'pixel sort stage',
    entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true } }],
  })
  const showLayout = device.createBindGroupLayout({
    label: 'pixel sort show',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, texture: { sampleType: 'float' } },
      { binding: 6, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: F, buffer: { type: 'read-only-storage' } },
    ],
  })
  const module = device.createShaderModule({ label: 'pixel sort', code })
  const workPipes = device.createPipelineLayout({ bindGroupLayouts: [workLayout] })
  const swapPipes = device.createPipelineLayout({ bindGroupLayouts: [workLayout, stageLayout] })
  const compute = (entryPoint: string, layout = workPipes) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout,
      compute: { module, entryPoint },
    })
  const [paint, build, swap, bake, show] = await Promise.all([
    compute('paint'),
    compute('build'),
    compute('swap', swapPipes),
    compute('bake'),
    device.createRenderPipelineAsync({
      label: 'pixel sort show',
      layout: device.createPipelineLayout({ bindGroupLayouts: [showLayout] }),
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])

  const uniform = device.createBuffer({
    label: 'pixel sort',
    size: SORT.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const stageBuf = device.createBuffer({
    label: 'pixel sort stages',
    size: STAGES.length * SLOT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  {
    const all = new Uint32Array((STAGES.length * SLOT) / 4)
    STAGES.forEach(([k, j], s) => all.set([k, j], (s * SLOT) / 4))
    device.queue.writeBuffer(stageBuf, 0, all)
  }
  const stageGroup = device.createBindGroup({
    layout: stageLayout,
    entries: [{ binding: 0, resource: { buffer: stageBuf, size: 16 } }],
  })
  const keys = device.createBuffer({
    label: 'pixel sort keys',
    size: LINE * LINE * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  const dabBuf = device.createBuffer({
    label: 'pixel sort dabs',
    size: MAX_DABS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(SORT.bytes)

  let size: [number, number] = [1, 1]
  let pair: [GPUTexture, GPUTexture] | null = null
  let mask: GPUBuffer | null = null
  let groups: { work: GPUBindGroup[]; show: GPUBindGroup[] } = { work: [], show: [] }
  let cur = 0
  /** the sort in progress: its job, and how many of the network's stages have run */
  let job: SortJob | null = null
  let done = 0

  const tex = () =>
    device.createTexture({
      label: 'pixel sort photo',
      size,
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
  const rebuild = () => {
    pair?.forEach((t) => t.destroy())
    mask?.destroy()
    pair = [tex(), tex()]
    mask = device.createBuffer({
      label: 'pixel sort mask',
      size: size[0] * size[1] * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    const p = pair
    const m = mask
    groups = {
      /* work k reads photo k and bakes into the other */
      work: [0, 1].map((k) =>
        device.createBindGroup({
          layout: workLayout,
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: p[k].createView() },
            { binding: 2, resource: { buffer: m } },
            { binding: 3, resource: { buffer: keys } },
            { binding: 4, resource: { buffer: dabBuf } },
            { binding: 5, resource: p[1 - k].createView() },
          ],
        }),
      ),
      show: [0, 1].map((k) =>
        device.createBindGroup({
          layout: showLayout,
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: p[k].createView() },
            { binding: 6, resource: { buffer: keys } },
            { binding: 7, resource: { buffer: m } },
          ],
        }),
      ),
    }
    cur = 0
  }

  const pack = (w: number, h: number, dabs: number, showSort = true) => {
    const u = new Uint32Array(staging)
    const f = new Float32Array(staging)
    const a = AXIS[job?.direction ?? 'right']
    u[0] = w
    u[1] = h
    u[SORT.image / 4] = size[0]
    u[SORT.image / 4 + 1] = size[1]
    u[SORT.lineLen / 4] = LINE
    u[SORT.lines / 4] = a.axis === 0 ? size[1] : size[0]
    u[SORT.axis / 4] = a.axis
    u[SORT.flip / 4] = a.flip ? 1 : 0
    f[SORT.lo / 4] = job?.lo ?? 0
    f[SORT.hi / 4] = job?.hi ?? 1
    u[SORT.by / 4] = BY_ID[job?.by ?? 'light']
    u[SORT.dabs / 4] = dabs
    u[SORT.show / 4] = job && showSort ? 1 : 0
    return staging
  }

  /** run `n` more stages of the sort in progress; at the end, bake it into the photo */
  const advance = (e: GPUCommandEncoder, n: number) => {
    if (!job) return
    const lines = AXIS[job.direction].axis === 0 ? size[1] : size[0]
    const p = e.beginComputePass()
    p.setPipeline(swap)
    p.setBindGroup(0, groups.work[cur])
    for (let k = 0; k < n && done < STAGES.length; k++, done++) {
      p.setBindGroup(1, stageGroup, [done * SLOT])
      p.dispatchWorkgroups(Math.ceil((lines * LINE) / 256))
    }
    if (done === STAGES.length) {
      p.setPipeline(bake)
      p.setBindGroup(0, groups.work[cur])
      p.dispatchWorkgroups(Math.ceil(size[0] / 8), Math.ceil(size[1] / 8))
    }
    p.end()
  }

  const view: PixelSortView = {
    get sorting() {
      return job !== null
    },
    get image() {
      return size
    },
    get photo() {
      return pair![cur]
    },
    keys,
    get mask() {
      return mask!
    },
    load(source, w, h) {
      size = [Math.min(LINE, Math.round(w)), Math.min(LINE, Math.round(h))]
      rebuild()
      device.queue.copyExternalImageToTexture({ source }, { texture: pair![0] }, size)
      job = null
      done = 0
    },
    markAll() {
      device.queue.writeBuffer(mask!, 0, new Uint32Array(size[0] * size[1]).fill(1))
    },
    sort(next) {
      /* a sort still running is finished at once, so the new one starts from its picture */
      if (job) {
        const e = device.createCommandEncoder()
        advance(e, STAGES.length)
        device.queue.submit([e.finish()])
        cur = 1 - cur
      }
      job = next
      done = 0
      device.queue.writeBuffer(uniform, 0, pack(1, 1, 0))
      const e = device.createCommandEncoder({ label: 'pixel sort build' })
      const p = e.beginComputePass()
      p.setPipeline(build)
      p.setBindGroup(0, groups.work[cur])
      p.dispatchWorkgroups(AXIS[next.direction].axis === 0 ? size[1] : size[0])
      p.end()
      device.queue.submit([e.finish()])
    },
    frame({ w, h, dabs, stages: n }) {
      const count = Math.min(dabs.length, MAX_DABS)
      /* ⚠️ whether this frame finishes the sort is decided BEFORE the uniform is written: on the
         frame it bakes, the photo becomes the sorted one, and drawing it through the keys as well
         would sort it twice for a frame */
      const bakes = job !== null && done + n >= STAGES.length
      device.queue.writeBuffer(uniform, 0, pack(w, h, count, !bakes))
      const e = device.createCommandEncoder({ label: 'pixel sort' })
      if (count) {
        device.queue.writeBuffer(
          dabBuf,
          0,
          new Float32Array(dabs.slice(0, count).flatMap((d) => [d.x, d.y, d.r, 0])),
        )
        const p = e.beginComputePass()
        p.setPipeline(paint)
        p.setBindGroup(0, groups.work[cur])
        p.dispatchWorkgroups(Math.ceil(size[0] / 8), Math.ceil(size[1] / 8))
        p.end()
      }
      advance(e, n)
      if (bakes) {
        cur = 1 - cur
        job = null
        done = 0
      }
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
    destroy() {
      pair?.forEach((t) => t.destroy())
      for (const b of [mask, keys, dabBuf, uniform, stageBuf]) b?.destroy()
    },
  }
  return view
}
