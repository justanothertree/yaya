import code from './snowflake.wgsl?raw'
import { FLAKE, W, freshLattice, packFlake, type FlakeFrame } from './snowflake'

export type SnowflakeView = {
  /** grow `steps` steps, then draw */
  frame(f: FlakeFrame, steps: number): void
  /** a fresh crystal: one cell of ice in air holding β */
  reset(beta: number): void
  /** for the probe: the lattice as it stands */
  readonly cells: GPUBuffer
  destroy(): void
}

export async function createSnowflake(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<SnowflakeView> {
  const C = GPUShaderStage.COMPUTE
  const growLayout = device.createBindGroupLayout({
    label: 'snowflake grow',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
      { binding: 3, visibility: C, buffer: { type: 'storage' } },
    ],
  })
  const showLayout = device.createBindGroupLayout({
    label: 'snowflake show',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  })
  const module = device.createShaderModule({ label: 'snowflake', code })
  const growPipes = device.createPipelineLayout({ bindGroupLayouts: [growLayout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: growPipes,
      compute: { module, entryPoint },
    })
  const [mark, grow, show] = await Promise.all([
    compute('mark'),
    compute('grow'),
    device.createRenderPipelineAsync({
      label: 'snowflake show',
      layout: device.createPipelineLayout({ bindGroupLayouts: [showLayout] }),
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const lattice = (label: string) =>
    device.createBuffer({
      label,
      size: W * W * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
  const pair = [lattice('snowflake cells'), lattice('snowflake cells 2')]
  const receptive = lattice('snowflake receptive')
  const uniform = device.createBuffer({
    label: 'snowflake',
    size: FLAKE.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const growGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: growLayout,
      entries: [uniform, pair[k], pair[1 - k], receptive].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    }),
  )
  const showGroups = pair.map((b) =>
    device.createBindGroup({
      layout: showLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 4, resource: { buffer: b } },
      ],
    }),
  )
  let cur = 0
  const staging = new ArrayBuffer(FLAKE.bytes)
  const groups = Math.ceil(W / 8)

  return {
    get cells() {
      return pair[cur]
    },
    reset(beta) {
      device.queue.writeBuffer(pair[0], 0, freshLattice(W, beta))
      cur = 0
    },
    frame(f, steps) {
      device.queue.writeBuffer(uniform, 0, packFlake(f, staging))
      const e = device.createCommandEncoder({ label: 'snowflake' })
      if (steps > 0) {
        const p = e.beginComputePass()
        for (let k = 0; k < steps; k++) {
          /* a step reads one half of the pair whole and writes the other */
          p.setBindGroup(0, growGroups[cur])
          p.setPipeline(mark)
          p.dispatchWorkgroups(groups, groups)
          p.setPipeline(grow)
          p.dispatchWorkgroups(groups, groups)
          cur = 1 - cur
        }
        p.end()
      }
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, showGroups[cur])
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [...pair, receptive, uniform]) b.destroy()
    },
  }
}
