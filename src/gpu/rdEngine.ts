import types from './rd-types.wgsl?raw'
import stepCode from './rd-step.wgsl?raw'
import drawCode from './rd-draw.wgsl?raw'
import { DA, DB, MAX_BRUSHES, RD, packRD, seededGrid } from './rd'
import { TILE } from './life'

export type Dab = { x: number; y: number; r: number; seed: boolean }

export type RDInput = {
  feed: number
  kill: number
  map: boolean
  palette: number
  /** steps a frame: how fast it grows */
  steps: number
  /** dabs to apply on the next step, in cells; taken and cleared by the frame */
  dabs: Dab[]
}

export type ReactionDiffusion = {
  /** Start again from a bare grid with a few seeds of B. */
  reseed(): void
  frame(running: boolean, input: RDInput): void
  /** the grid's size in cells, for turning a press into a dab */
  readonly grid: { cols: number; rows: number }
  destroy(): void
}

export async function createRD(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
  cols: number,
  rows: number,
): Promise<ReactionDiffusion> {
  const stepModule = device.createShaderModule({ label: 'rd step', code: types + stepCode })
  const drawModule = device.createShaderModule({ label: 'rd draw', code: types + drawCode })
  const [react, draw] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'react',
      layout: 'auto',
      compute: { module: stepModule, entryPoint: 'react' },
    }),
    device.createRenderPipelineAsync({
      label: 'rd draw',
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'cover' },
      fragment: { module: drawModule, entryPoint: 'shade', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'rd params',
    size: RD.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  /* the brush only counts on the first step of a frame; later steps see a uniform saying none */
  const quiet = device.createBuffer({
    label: 'rd params, no brush',
    size: RD.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const brushes = device.createBuffer({
    label: 'rd brushes',
    size: MAX_BRUSHES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const make = (i: number) =>
    device.createBuffer({
      label: `rd grid ${i}`,
      size: cols * rows * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  const grids = [make(0), make(1)]
  const step = (u: GPUBuffer, from: GPUBuffer, to: GPUBuffer) =>
    device.createBindGroup({
      layout: react.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: u } },
        { binding: 1, resource: { buffer: from } },
        { binding: 2, resource: { buffer: to } },
        { binding: 3, resource: { buffer: brushes } },
      ],
    })
  /* forward[u][i]: read grid i, write the other, under uniform u (0 with brush, 1 without) */
  const forward = [uniform, quiet].map((u) => [
    step(u, grids[0], grids[1]),
    step(u, grids[1], grids[0]),
  ])
  const shows = grids.map((g) =>
    device.createBindGroup({
      layout: draw.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: g } },
      ],
    }),
  )
  let cur = 0
  const staging = new ArrayBuffer(RD.bytes)
  const quietStaging = new ArrayBuffer(RD.bytes)
  const dabData = new Float32Array(MAX_BRUSHES * 4)

  const reseed = () => {
    /* a ring and a scatter of spots, so every preset has edges to grow from at once */
    const seeds: [number, number, number][] = [[cols / 2, rows / 2, Math.min(cols, rows) * 0.08]]
    for (let i = 0; i < 9; i++)
      seeds.push([Math.random() * cols, Math.random() * rows, 2 + Math.random() * 3])
    device.queue.writeBuffer(
      grids[cur],
      0,
      seededGrid(cols, rows, seeds) as Float32Array<ArrayBuffer>,
    )
  }
  reseed()

  return {
    grid: { cols, rows },
    reseed,
    frame(running, input) {
      if (canvas.width === 0 || canvas.height === 0) return
      const dabs = input.dabs.splice(0, MAX_BRUSHES)
      dabData.fill(0)
      dabs.forEach((d, i) => dabData.set([d.x, d.y, d.r, d.seed ? 1 : 0], i * 4))
      device.queue.writeBuffer(brushes, 0, dabData)
      const params = {
        cols,
        rows,
        feed: input.feed,
        kill: input.kill,
        da: DA,
        db: DB,
        brushes: dabs.length,
        map: input.map,
        view: [canvas.width, canvas.height] as const,
        palette: input.palette,
        light: 1,
      }
      device.queue.writeBuffer(uniform, 0, packRD(params, staging))
      device.queue.writeBuffer(quiet, 0, packRD({ ...params, brushes: 0 }, quietStaging))

      const encoder = device.createCommandEncoder({ label: 'rd frame' })
      /* paused, a dab still has to show: the brush is applied as a step writes, so a paused
         frame with a dab in it runs exactly one step — too little reaction to see, enough to
         paint — and a paused frame without one runs none */
      const steps = running ? input.steps : dabs.length ? 1 : 0
      if (steps > 0) {
        const pass = encoder.beginComputePass({ label: 'react' })
        pass.setPipeline(react)
        for (let s = 0; s < steps; s++) {
          pass.setBindGroup(0, forward[s === 0 ? 0 : 1][cur])
          pass.dispatchWorkgroups(Math.ceil(cols / TILE), Math.ceil(rows / TILE))
          cur = 1 - cur
        }
        pass.end()
      }
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(draw)
      rp.setBindGroup(0, shows[cur])
      rp.draw(3)
      rp.end()
      device.queue.submit([encoder.finish()])
    },
    destroy() {
      grids.forEach((g) => g.destroy())
      uniform.destroy()
      quiet.destroy()
      brushes.destroy()
    },
  }
}
