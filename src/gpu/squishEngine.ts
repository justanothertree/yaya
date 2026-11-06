import code from './squish.wgsl?raw'
import {
  GRID,
  MAX_HANDLES,
  SQUISH,
  packHandles,
  packSquish,
  type Handle,
  type Mode,
} from './squish'

export type SquishView = {
  load(source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas, w: number, h: number): void
  frame(f: { w: number; h: number; handles: readonly Handle[]; pins: number; mode: Mode }): void
  readonly image: readonly [number, number]
  /** for the probe: every vertex where it was bent to */
  readonly bent: GPUBuffer
  destroy(): void
}

export async function createSquish(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<SquishView> {
  const C = GPUShaderStage.COMPUTE
  const V = GPUShaderStage.VERTEX
  const Fr = GPUShaderStage.FRAGMENT
  const bendLayout = device.createBindGroupLayout({
    label: 'squish bend',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
    ],
  })
  const drawLayout = device.createBindGroupLayout({
    label: 'squish draw',
    entries: [
      { binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: Fr, texture: { sampleType: 'float' } },
      { binding: 5, visibility: Fr, sampler: { type: 'filtering' } },
    ],
  })
  const module = device.createShaderModule({ label: 'squish', code })
  const drawPipes = device.createPipelineLayout({ bindGroupLayouts: [drawLayout] })
  const over: GPUBlendComponent = {
    srcFactor: 'one',
    dstFactor: 'one-minus-src-alpha',
    operation: 'add',
  }
  const [bend, mesh, marker] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'squish bend',
      layout: device.createPipelineLayout({ bindGroupLayouts: [bendLayout] }),
      compute: { module, entryPoint: 'bend' },
    }),
    device.createRenderPipelineAsync({
      label: 'squish mesh',
      layout: drawPipes,
      vertex: { module, entryPoint: 'mesh' },
      fragment: { module, entryPoint: 'paint', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
    device.createRenderPipelineAsync({
      label: 'squish markers',
      layout: drawPipes,
      vertex: { module, entryPoint: 'marker' },
      fragment: {
        module,
        entryPoint: 'dot_colour',
        targets: [{ format, blend: { color: over, alpha: over } }],
      },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const vertices = GRID[0] * GRID[1]
  const uniform = device.createBuffer({
    label: 'squish',
    size: SQUISH.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const handleBuf = device.createBuffer({
    label: 'squish handles',
    size: MAX_HANDLES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const bent = device.createBuffer({
    label: 'squish bent',
    size: vertices * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const bendGroup = device.createBindGroup({
    layout: bendLayout,
    entries: [uniform, handleBuf, bent].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  })
  let size: [number, number] = [1, 1]
  let picture: GPUTexture | null = null
  let drawGroup: GPUBindGroup | null = null
  const staging = new ArrayBuffer(SQUISH.bytes)

  return {
    get image() {
      return size
    },
    bent,
    load(source, w, h) {
      size = [Math.round(w), Math.round(h)]
      picture?.destroy()
      picture = device.createTexture({
        label: 'squish picture',
        size,
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      device.queue.copyExternalImageToTexture({ source }, { texture: picture }, size)
      drawGroup = device.createBindGroup({
        layout: drawLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: handleBuf } },
          { binding: 3, resource: { buffer: bent } },
          { binding: 4, resource: picture.createView() },
          { binding: 5, resource: sampler },
        ],
      })
    },
    frame({ w, h, handles, pins, mode }) {
      if (!drawGroup) return
      device.queue.writeBuffer(
        uniform,
        0,
        packSquish({ w, h, image: size, handles, pins, mode }, staging),
      )
      device.queue.writeBuffer(handleBuf, 0, packHandles(handles))
      const e = device.createCommandEncoder({ label: 'squish' })
      const p = e.beginComputePass()
      p.setPipeline(bend)
      p.setBindGroup(0, bendGroup)
      p.dispatchWorkgroups(Math.ceil(vertices / 64))
      p.end()
      const rp = e.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: 'clear',
            clearValue: { r: 0.94, g: 0.9, b: 0.96, a: 1 },
            storeOp: 'store',
          },
        ],
      })
      rp.setBindGroup(0, drawGroup)
      rp.setPipeline(mesh)
      rp.draw((GRID[0] - 1) * (GRID[1] - 1) * 6)
      const n = Math.min(handles.length, MAX_HANDLES)
      if (n) {
        rp.setPipeline(marker)
        rp.draw(6, n)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      picture?.destroy()
      for (const b of [uniform, handleBuf, bent]) b.destroy()
    },
  }
}
