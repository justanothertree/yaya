import types from './swarm-types.wgsl?raw'
import stepCode from './swarm-step.wgsl?raw'
import drawCode from './swarm-draw.wgsl?raw'
import {
  PARAMS,
  PARTICLE_BYTES,
  dotPixels,
  dotSize,
  glowFor,
  packParams,
  workgroupsFor,
  type Params,
} from './swarm'

/** What the page tells the swarm each frame. */
export type SwarmInput = {
  /** where the press is, in world units, or null when nothing is pressed */
  pointer: readonly [number, number] | null
  /** +1 pulls toward the press, -1 pushes away */
  direction: 1 | -1
  /** how hard the current carries, 0–2 */
  flow: number
}

export type Swarm = {
  /** Throw the particles away and scatter `count` fresh ones on the next frame. */
  setCount(count: number): void
  /** Scatter the same particles afresh on the next frame. */
  scatter(): void
  /** Draw one frame, advancing the simulation by `dt` seconds (0 draws it where it stands). */
  frame(dt: number, input: SwarmInput): void
  destroy(): void
}

/** a press pulls with this much; the shader softens it near the centre */
const PULL = 1.6
/** the current's base speed, which the flow slider scales */
const FLOW = 0.3

/**
 * Build the swarm on a device that is already configured for `context`.
 *
 * ⚠️ THE PIPELINES ARE BUILT WITH THE ASYNC CALLS ON PURPOSE. A shader that does not compile, or
 * a layout that does not match it, rejects the promise with a GPUPipelineError that says which —
 * where the sync versions hand back an invalid pipeline and report the reason later, as an
 * uncaptured error, on a frame that has nothing to do with it.
 */
export async function createSwarm(
  device: GPUDevice,
  /* only what the swarm touches, so it can also draw into a plain texture — which is how it was
     checked on a machine whose browser could not present a WebGPU canvas */
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
  initialCount: number,
): Promise<Swarm> {
  const stepModule = device.createShaderModule({ label: 'swarm step', code: types + stepCode })
  const drawModule = device.createShaderModule({ label: 'swarm draw', code: types + drawCode })

  const computeLayout = device.createBindGroupLayout({
    label: 'swarm compute',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  })
  const drawLayout = device.createBindGroupLayout({
    label: 'swarm draw',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  })
  const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] })

  const [advance, scatter, draw] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'advance',
      layout: computePipelineLayout,
      compute: { module: stepModule, entryPoint: 'advance' },
    }),
    device.createComputePipelineAsync({
      label: 'scatter',
      layout: computePipelineLayout,
      compute: { module: stepModule, entryPoint: 'scatter' },
    }),
    device.createRenderPipelineAsync({
      label: 'dots',
      layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
      /* no vertex buffers: the shader pulls each dot out of the particle buffer itself — see
         the note at the top of swarm-draw.wgsl for why this is not instanced */
      vertex: { module: drawModule, entryPoint: 'dot_vertex' },
      fragment: {
        module: drawModule,
        entryPoint: 'dot_fragment',
        targets: [
          {
            format,
            // additive: where dots cross, the light adds up, which is what makes the streams read
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    }),
  ])

  const uniform = device.createBuffer({
    label: 'swarm params',
    size: PARAMS.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  let count = 0
  let particles: GPUBuffer | null = null
  let computeGroup: GPUBindGroup | null = null
  let drawGroup: GPUBindGroup | null = null
  let needsScatter = false
  let time = 0
  const staging = new ArrayBuffer(PARAMS.bytes)

  function setCount(next: number) {
    particles?.destroy()
    count = next
    particles = device.createBuffer({
      label: `particles ×${next}`,
      size: next * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE,
    })
    computeGroup = device.createBindGroup({
      layout: computeLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: particles } },
      ],
    })
    drawGroup = device.createBindGroup({
      layout: drawLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: particles } },
      ],
    })
    needsScatter = true
  }
  setCount(initialCount)

  function frame(dt: number, input: SwarmInput) {
    if (!particles || !computeGroup || !drawGroup || canvas.width === 0 || canvas.height === 0)
      return
    time += dt
    const px = dotPixels(window.devicePixelRatio || 1)
    const params: Params = {
      pointer: input.pointer ?? [0, 0],
      aspect: canvas.width / canvas.height,
      dt,
      time,
      flow: input.flow * FLOW,
      pull: input.pointer ? input.direction * PULL : 0,
      size: dotSize(px, canvas.height),
      glow: glowFor(count, px, canvas.width * canvas.height),
      count,
    }
    device.queue.writeBuffer(uniform, 0, packParams(params, staging))

    const encoder = device.createCommandEncoder({ label: 'swarm frame' })
    const groups = workgroupsFor(count)
    if (needsScatter || dt > 0) {
      const pass = encoder.beginComputePass({ label: 'step' })
      pass.setBindGroup(0, computeGroup)
      if (needsScatter) {
        pass.setPipeline(scatter)
        pass.dispatchWorkgroups(groups)
        needsScatter = false
      }
      if (dt > 0) {
        pass.setPipeline(advance)
        pass.dispatchWorkgroups(groups)
      }
      pass.end()
    }
    const pass = encoder.beginRenderPass({
      label: 'dots',
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(draw)
    pass.setBindGroup(0, drawGroup)
    pass.draw(6 * count)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  return {
    setCount,
    scatter() {
      needsScatter = true
    },
    frame,
    destroy() {
      particles?.destroy()
      uniform.destroy()
      particles = null
      computeGroup = null
      drawGroup = null
    },
  }
}
