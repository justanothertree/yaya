import types from './erosion-types.wgsl?raw'
import stepCode from './erosion-step.wgsl?raw'
import drawCode from './erosion-draw.wgsl?raw'
import { LAND, N, packLand, type LandFrame } from './erosion'

export type ErosionView = {
  /** run `steps` steps of the simulation, then draw; the frame's `step` is the first one's number */
  frame(f: LandFrame, steps: number): void
  /** fresh land: heights for every cell, no water */
  load(ground: Float32Array): void
  /** for the probe: the cells as they stand (b, d, s, b0), and where the last ray met the land */
  readonly cells: GPUBuffer
  readonly hit: GPUBuffer
  readonly flux: GPUBuffer
  destroy(): void
}

const CELLS = N * N

export async function createErosion(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<ErosionView> {
  const C = GPUShaderStage.COMPUTE
  const rw = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: C,
    buffer: { type: 'storage' },
  })
  const stepLayout = device.createBindGroupLayout({
    label: 'erosion step',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      rw(1),
      rw(2),
      rw(3),
      rw(4),
      rw(5),
    ],
  })
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const drawLayout = device.createBindGroupLayout({
    label: 'erosion draw',
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  })
  const stepModule = device.createShaderModule({ label: 'erosion step', code: types + stepCode })
  const drawModule = device.createShaderModule({ label: 'erosion draw', code: types + drawCode })
  const stepPipes = device.createPipelineLayout({ bindGroupLayouts: [stepLayout] })
  const drawPipes = device.createPipelineLayout({ bindGroupLayouts: [drawLayout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: stepPipes,
      compute: { module: stepModule, entryPoint },
    })
  const depthFormat: GPUTextureFormat = 'depth24plus'
  const mesh = (vx: string, fs: string, blend?: GPUBlendState, write = true) =>
    device.createRenderPipelineAsync({
      label: fs,
      layout: drawPipes,
      vertex: { module: drawModule, entryPoint: vx },
      fragment: { module: drawModule, entryPoint: fs, targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: depthFormat, depthWriteEnabled: write, depthCompare: 'less' },
    })
  /* water over land: premultiplied, and it does not hide what is behind it from later water */
  const over: GPUBlendComponent = {
    srcFactor: 'one',
    dstFactor: 'one-minus-src-alpha',
    operation: 'add',
  }
  const [pick, paint, flow, water, erode, settle, groundPipe, waterPipe] = await Promise.all([
    compute('pick'),
    compute('paint'),
    compute('flow'),
    compute('water'),
    compute('erode'),
    compute('settle'),
    mesh('ground_vx', 'ground'),
    mesh('water_vx', 'water', { color: over, alpha: over }, false),
  ])

  const storage = (label: string, size: number) =>
    device.createBuffer({
      label,
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
  /* a pair of cell buffers: each step reads one and ends in the other */
  const pair = [storage('erosion cells', CELLS * 16), storage('erosion cells 2', CELLS * 16)]
  const flux = storage('erosion flux', CELLS * 16)
  const vel = storage('erosion velocity', CELLS * 8)
  const hit = storage('erosion hit', 16)
  const uniform = device.createBuffer({
    label: 'erosion',
    size: LAND.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const groupOf = (x: GPUBuffer, y: GPUBuffer) =>
    device.createBindGroup({
      layout: stepLayout,
      entries: [uniform, x, y, flux, vel, hit].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    })
  const stepGroups = [groupOf(pair[0], pair[1]), groupOf(pair[1], pair[0])]
  const drawGroups = pair.map((b) =>
    device.createBindGroup({
      layout: drawLayout,
      entries: [uniform, b, vel].map((buffer, binding) => ({ binding, resource: { buffer } })),
    }),
  )
  let cur = 0
  let depth: GPUTexture | null = null
  const staging = new ArrayBuffer(LAND.bytes)
  const groups = Math.ceil(N / 8)

  return {
    get cells() {
      return pair[cur]
    },
    hit,
    flux,
    load(ground) {
      const cells = new Float32Array(CELLS * 4)
      for (let i = 0; i < CELLS; i++) {
        cells[i * 4] = ground[i]
        cells[i * 4 + 3] = ground[i]
      }
      device.queue.writeBuffer(pair[0], 0, cells)
      device.queue.writeBuffer(flux, 0, new Float32Array(CELLS * 4))
      device.queue.writeBuffer(vel, 0, new Float32Array(CELLS * 2))
      cur = 0
    },
    frame(f, steps) {
      /* ⚠️ ONE SUBMIT PER STEP: each step's rain falls on cells chosen by the step's number, and a
         uniform can only change between submissions, so the steps cannot share one encoder */
      for (let k = 0; k < Math.max(1, steps); k++) {
        device.queue.writeBuffer(uniform, 0, packLand({ ...f, step: f.step + k }, staging))
        if (steps === 0) break
        const e = device.createCommandEncoder({ label: 'erosion step' })
        const p = e.beginComputePass()
        /* each step runs a → b in water and settle, b → a in erode: the pair ends swapped */
        p.setBindGroup(0, stepGroups[cur])
        if (k === 0) {
          p.setPipeline(pick)
          p.dispatchWorkgroups(1)
        }
        for (const pipe of [paint, flow, water, erode, settle]) {
          p.setPipeline(pipe)
          p.dispatchWorkgroups(groups, groups)
        }
        p.end()
        device.queue.submit([e.finish()])
        cur = 1 - cur
      }
      const target = context.getCurrentTexture()
      if (!depth || depth.width !== target.width || depth.height !== target.height) {
        depth?.destroy()
        depth = device.createTexture({
          size: [target.width, target.height],
          format: depthFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        })
      }
      const e = device.createCommandEncoder({ label: 'erosion draw' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          {
            view: target.createView(),
            loadOp: 'clear',
            clearValue: { r: 0.62, g: 0.72, b: 0.85, a: 1 },
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthLoadOp: 'clear',
          depthClearValue: 1,
          depthStoreOp: 'store',
        },
      })
      rp.setBindGroup(0, drawGroups[cur])
      const vertices = (N - 1) * (N - 1) * 6
      rp.setPipeline(groundPipe)
      rp.draw(vertices)
      rp.setPipeline(waterPipe)
      rp.draw(vertices)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [...pair, flux, vel, hit, uniform]) b.destroy()
      depth?.destroy()
    },
  }
}
