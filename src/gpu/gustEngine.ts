import code from './gust.wgsl?raw'
import { H, RINK, W, packRink, type Fan, type Puck } from './gust'

export type RinkFrame = { fans: [Fan, Fan]; time: number; pause: boolean }
/** what the GPU says the puck did: where it is, and which goal it went into (−1 none, 0 left, 1 right) */
export type PuckNews = { puck: Puck; into: number; air: [number, number] }

export type GustView = {
  /** put the puck somewhere, still or moving; any goal not yet read back is forgotten */
  place(p: Puck): void
  /** `steps` substeps of the air and the puck, then a picture */
  frame(f: RinkFrame, steps: number): void
  /** the puck as of the last frame copied out; null while a read is pending or stale */
  puck(): Promise<PuckNews | null>
  /** clear the air and the dye */
  calm(): void
  readonly buffers: { vel: GPUBuffer; dye: GPUBuffer; puck: GPUBuffer }
  destroy(): void
}

/** each substep's length, and how many red-black Gauss-Seidel sweeps its pressure gets */
export const DT = 1 / 60
export const SWEEPS = 24

export async function createGust(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<GustView> {
  const module = device.createShaderModule({ label: 'gust', code })
  /* one layout for every compute pass: the uniform and seven storage buffers, under the eight a
     stage may use, so each pass shares one bind group rather than an 'auto' one apiece */
  const layout = device.createBindGroupLayout({
    label: 'gust',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ...[1, 2, 3, 4, 5, 6, 7].map((binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' as const },
      })),
    ],
  })
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: `gust ${entryPoint}`,
      layout: pl,
      compute: { module, entryPoint },
    })
  const [force, advect, walls, diverge, red, black, project, stepPuck, show] = await Promise.all([
    compute('force'),
    compute('advect'),
    compute('walls'),
    compute('diverge'),
    compute('red'),
    compute('black'),
    compute('project'),
    compute('step_puck'),
    device.createRenderPipelineAsync({
      label: 'gust show',
      layout: 'auto',
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const buf = (label: string, size: number) => device.createBuffer({ label, size, usage: S })
  const C = W * H
  const uniform = device.createBuffer({
    label: 'gust rink',
    size: RINK.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const vel = buf('gust vel', C * 8)
  const velNext = buf('gust vel next', C * 8)
  const dye = buf('gust dye', C * 8)
  const dyeNext = buf('gust dye next', C * 8)
  const pres = buf('gust pressure', C * 4)
  const div = buf('gust divergence', C * 4)
  /** [x, y, vx, vy], then [goal flag, air x, air y, serial] */
  const puckBuf = buf('gust puck', 32)
  const readback = device.createBuffer({
    label: 'gust readback',
    size: 32,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })
  const all = [uniform, vel, velNext, dye, dyeNext, pres, div, puckBuf]
  const group = device.createBindGroup({
    layout,
    entries: all.map((buffer, binding) => ({ binding, resource: { buffer } })),
  })
  const drawGroups = [
    device.createBindGroup({
      layout: show.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniform } }],
    }),
    device.createBindGroup({
      layout: show.getBindGroupLayout(1),
      entries: [dye, vel, puckBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
    }),
  ]
  const staging = new ArrayBuffer(RINK.bytes)
  /* ⚠️ A READ IS A FRAME OR TWO OLD, so a goal can be read back after the puck has already been put
     back on the spot — and counted twice. Each placing bumps a serial the GPU carries untouched, and
     a reading from before the latest placing is thrown away. */
  let serial = 0
  let reading = false
  const tiles = [Math.ceil(W / 16), Math.ceil(H / 16)] as const

  const view: GustView = {
    buffers: { vel, dye, puck: puckBuf },
    place(p) {
      serial++
      device.queue.writeBuffer(
        puckBuf,
        0,
        new Float32Array([p.x, p.y, p.vx, p.vy, 0, 0, 0, serial]),
      )
    },
    calm() {
      for (const b of [vel, velNext, dye, dyeNext, pres, div])
        device.queue.writeBuffer(b, 0, new Float32Array(b.size / 4))
    },
    async puck() {
      if (reading) return null
      reading = true
      try {
        await readback.mapAsync(GPUMapMode.READ)
        const f = new Float32Array(readback.getMappedRange().slice(0))
        readback.unmap()
        if (f[7] !== serial) return null
        return {
          puck: { x: f[0], y: f[1], vx: f[2], vy: f[3] },
          into: f[4] === 1 ? 0 : f[4] === 2 ? 1 : -1,
          air: [f[5], f[6]],
        }
      } catch {
        return null
      } finally {
        reading = false
      }
    },
    frame(f, steps) {
      if (canvas.width === 0 || canvas.height === 0) return
      device.queue.writeBuffer(
        uniform,
        0,
        packRink({ w: canvas.width, h: canvas.height, ...f, dt: DT }, staging),
      )
      const e = device.createCommandEncoder({ label: 'gust' })
      if (steps > 0) {
        const p = e.beginComputePass()
        p.setBindGroup(0, group)
        const run = (pipe: GPUComputePipeline) => {
          p.setPipeline(pipe)
          p.dispatchWorkgroups(tiles[0], tiles[1])
        }
        for (let s = 0; s < steps; s++) {
          run(force)
          run(advect)
          run(walls)
          run(diverge)
          for (let k = 0; k < SWEEPS; k++) {
            run(red)
            run(black)
          }
          run(project)
          p.setPipeline(stepPuck)
          p.dispatchWorkgroups(1)
        }
        p.end()
      }
      if (!reading) e.copyBufferToBuffer(puckBuf, 0, readback, 0, 32)
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, drawGroups[0])
      rp.setBindGroup(1, drawGroups[1])
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [...all, readback]) b.destroy()
    },
  }
  view.calm()
  return view
}
