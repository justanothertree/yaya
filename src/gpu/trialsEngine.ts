import code from './trials.wgsl?raw'
import {
  MAX_DUST,
  TRIAL,
  fieldFor,
  packSegments,
  packTrial,
  spawn,
  type Course,
  type Frame,
} from './trials'

export type TrialsView = {
  /** bake a course into the field: once per course */
  course(c: Course): void
  /** mud thrown this frame, eight floats a particle, into the ring */
  spray(data: readonly number[]): void
  /** draw, after `steps` 60ths of a second of the mud flying (0 when paused) */
  frame(f: Omit<Frame, 'w' | 'h' | 'dust'>, steps: number): void
  /** for a probe: the baked field and the mud */
  readonly buffers: { field: GPUBuffer; dust: GPUBuffer }
  destroy(): void
}

export async function createTrials(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<TrialsView> {
  const module = device.createShaderModule({ label: 'trials', code })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: 'auto',
      compute: { module, entryPoint },
    })
  const alpha: GPUBlendState = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  }
  const [bake, fly, show, mud] = await Promise.all([
    compute('bake'),
    compute('fly'),
    device.createRenderPipelineAsync({
      label: 'trials',
      layout: 'auto',
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
    device.createRenderPipelineAsync({
      label: 'mud',
      layout: 'auto',
      vertex: { module, entryPoint: 'mote' },
      fragment: { module, entryPoint: 'mud', targets: [{ format, blend: alpha }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const uniform = device.createBuffer({
    label: 'trials',
    size: TRIAL.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const dust = device.createBuffer({ label: 'trials dust', size: MAX_DUST * 32, usage: S })
  let segs: GPUBuffer | null = null
  let field: GPUBuffer | null = null
  let segments = 0
  let current: Course | null = null
  let groups: {
    bake: GPUBindGroup
    fly: GPUBindGroup
    show: GPUBindGroup
    mud: GPUBindGroup
  } | null = null
  let cursor = 0
  let live = 0
  const staging = new ArrayBuffer(TRIAL.bytes)
  const group = (pipe: GPUComputePipeline | GPURenderPipeline, entries: [number, GPUBuffer][]) =>
    device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
    })

  const view: TrialsView = {
    get buffers() {
      return { field: field!, dust }
    },
    course(c) {
      current = c
      segs?.destroy()
      field?.destroy()
      const data = packSegments(c)
      segments = data.length / 4
      segs = device.createBuffer({ label: 'trials segments', size: data.byteLength, usage: S })
      device.queue.writeBuffer(segs, 0, data)
      const { grid } = fieldFor(c)
      field = device.createBuffer({ label: 'trials field', size: grid[0] * grid[1] * 4, usage: S })
      device.queue.writeBuffer(dust, 0, new Float32Array(MAX_DUST * 8))
      cursor = 0
      live = 0
      groups = {
        bake: group(bake, [
          [0, uniform],
          [1, segs],
          [2, field],
        ]),
        fly: group(fly, [
          [0, uniform],
          [2, field],
          [3, dust],
        ]),
        show: group(show, [
          [0, uniform],
          [4, field],
        ]),
        mud: group(mud, [
          [0, uniform],
          [5, dust],
        ]),
      }
      // the bake needs the uniform's grid and origin: a frame's worth with the bike anywhere
      const e = device.createCommandEncoder({ label: 'trials bake' })
      device.queue.writeBuffer(
        uniform,
        0,
        packTrial(
          {
            w: 1,
            h: 1,
            cam: c.start,
            scale: 1,
            time: 0,
            bike: spawn(c.start),
            lean: 0,
            course: c,
            passed: -1,
            dust: 0,
          },
          segments,
          staging,
        ),
      )
      const p = e.beginComputePass()
      p.setPipeline(bake)
      p.setBindGroup(0, groups.bake)
      p.dispatchWorkgroups(Math.ceil(grid[0] / 16), Math.ceil(grid[1] / 16))
      p.end()
      device.queue.submit([e.finish()])
    },
    spray(data) {
      let n = data.length / 8
      let from = 0
      while (n > 0) {
        const room = Math.min(n, MAX_DUST - cursor)
        device.queue.writeBuffer(
          dust,
          cursor * 32,
          Float32Array.from(data.slice(from * 8, (from + room) * 8)),
        )
        cursor = (cursor + room) % MAX_DUST
        live = Math.min(MAX_DUST, live + room)
        from += room
        n -= room
      }
    },
    frame(f, steps) {
      if (!groups || !current || canvas.width === 0 || canvas.height === 0) return
      device.queue.writeBuffer(
        uniform,
        0,
        packTrial({ ...f, w: canvas.width, h: canvas.height, dust: live }, segments, staging),
      )
      const e = device.createCommandEncoder({ label: 'trials' })
      if (steps > 0 && live) {
        const p = e.beginComputePass()
        p.setPipeline(fly)
        p.setBindGroup(0, groups.fly)
        for (let k = 0; k < steps; k++) p.dispatchWorkgroups(Math.ceil(live / 64))
        p.end()
      }
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, groups.show)
      rp.draw(3)
      if (live) {
        rp.setPipeline(mud)
        rp.setBindGroup(0, groups.mud)
        rp.draw(live * 6)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [uniform, dust, segs, field]) b?.destroy()
      groups = null
    },
  }
  return view
}
