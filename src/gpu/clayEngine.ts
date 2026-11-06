import types from './clay-types.wgsl?raw'
import sculptCode from './clay-sculpt.wgsl?raw'
import showCode from './clay-show.wgsl?raw'
import { CLAY, N, packClay, type ClayFrame } from './clay'

export type ClayView = {
  /** sculpt with the frame's ray if it has one, then draw */
  frame(f: ClayFrame): void
  /** a fresh lump */
  reset(): void
  /** for the probe: the volume as it stands, and where the last ray met it */
  readonly volume: GPUTexture
  readonly hit: GPUBuffer
  destroy(): void
}

export async function createClay(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<ClayView> {
  const C = GPUShaderStage.COMPUTE
  const sculptLayout = device.createBindGroupLayout({
    label: 'clay sculpt',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
      {
        binding: 2,
        visibility: C,
        storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' },
      },
      { binding: 3, visibility: C, sampler: { type: 'filtering' } },
      { binding: 4, visibility: C, buffer: { type: 'storage' } },
    ],
  })
  const sculptModule = device.createShaderModule({ label: 'clay sculpt', code: types + sculptCode })
  const showModule = device.createShaderModule({ label: 'clay show', code: types + showCode })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [sculptLayout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout,
      compute: { module: sculptModule, entryPoint },
    })
  const [start, pick, edit, show] = await Promise.all([
    compute('start'),
    compute('pick'),
    compute('edit'),
    device.createRenderPipelineAsync({
      label: 'clay show',
      layout: 'auto',
      vertex: { module: showModule, entryPoint: 'cover' },
      fragment: { module: showModule, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const vol = () =>
    device.createTexture({
      label: 'clay volume',
      size: [N, N, N],
      dimension: '3d',
      format: 'rgba16float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    })
  /* two volumes: each edit reads one whole and writes the other, then they swap */
  let pair: [GPUTexture, GPUTexture] = [vol(), vol()]
  const uniform = device.createBuffer({
    label: 'clay',
    size: CLAY.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const hit = device.createBuffer({
    label: 'clay hit',
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const lin = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const staging = new ArrayBuffer(CLAY.bytes)

  const groupFor = (from: GPUTexture, to: GPUTexture) =>
    device.createBindGroup({
      layout: sculptLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: from.createView() },
        { binding: 2, resource: to.createView() },
        { binding: 3, resource: lin },
        { binding: 4, resource: { buffer: hit } },
      ],
    })
  const groups = Math.ceil(N / 4)

  const reset = () => {
    /* ⚠️ the volume's size first: `start` skips every voxel past C.n, and before the first frame
       has written the uniform C.n is 0 — the first lump was never drawn, and the clay only
       appeared once something else had filled the uniform in */
    device.queue.writeBuffer(uniform, CLAY.n, new Uint32Array([N]))
    const e = device.createCommandEncoder()
    const p = e.beginComputePass()
    p.setPipeline(start)
    p.setBindGroup(0, groupFor(pair[1], pair[0]))
    p.dispatchWorkgroups(groups, groups, groups)
    p.end()
    device.queue.submit([e.finish()])
  }
  reset()

  return {
    get volume() {
      return pair[0]
    },
    hit,
    reset,
    frame(f) {
      device.queue.writeBuffer(uniform, 0, packClay(f, staging))
      const e = device.createCommandEncoder({ label: 'clay' })
      if (f.ray && f.tool !== 'turn') {
        /* find where the finger meets the clay, then fold the brush in there — both on the GPU,
           one after the other, so the edit never waits for the CPU to learn where */
        const p = e.beginComputePass()
        const g = groupFor(pair[0], pair[1])
        p.setPipeline(pick)
        p.setBindGroup(0, g)
        p.dispatchWorkgroups(1)
        p.setPipeline(edit)
        p.setBindGroup(0, g)
        p.dispatchWorkgroups(groups, groups, groups)
        p.end()
        pair = [pair[1], pair[0]]
      }
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(
        0,
        device.createBindGroup({
          layout: show.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: pair[0].createView() },
            { binding: 2, resource: lin },
          ],
        }),
      )
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      pair.forEach((t) => t.destroy())
      uniform.destroy()
      hit.destroy()
    },
  }
}
