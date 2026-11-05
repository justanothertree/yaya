import types from './life-types.wgsl?raw'
import stepCode from './life-step.wgsl?raw'
import drawCode from './life-draw.wgsl?raw'
import {
  LIFE,
  TILE,
  generationsDue,
  packLife,
  patternCells,
  stampRuns,
  type LifeParams,
  type PatternId,
} from './life'

export type LifeInput = {
  /** the press, in cells, or null */
  brush: readonly [number, number] | null
  erase: boolean
  /** generations a second */
  speed: number
}

export type Life = {
  /** Throw the board away and start a fresh one of this size, randomly filled. */
  setGrid(cols: number, rows: number): void
  randomize(): void
  clear(): void
  /** Run exactly one generation on the next frame, running or not. */
  stepOnce(): void
  /** Put a pattern on the board as it stands, centred on cell (cx, cy). */
  stamp(id: PatternId, cx: number, cy: number): void
  frame(dt: number, input: LifeInput): void
  destroy(): void
}

/** the brush, in cells: a small round dab, three or four cells across */
const RADIUS = 1.6

export async function createLife(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
  cols0: number,
  rows0: number,
): Promise<Life> {
  const stepModule = device.createShaderModule({ label: 'life step', code: types + stepCode })
  const drawModule = device.createShaderModule({ label: 'life draw', code: types + drawCode })

  const stepLayout = device.createBindGroupLayout({
    label: 'life step',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  })
  const drawLayout = device.createBindGroupLayout({
    label: 'life draw',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  })
  const stepPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [stepLayout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: stepPipelineLayout,
      compute: { module: stepModule, entryPoint },
    })
  const [generation, paint, scatter, draw] = await Promise.all([
    compute('generation'),
    compute('paint'),
    compute('scatter'),
    device.createRenderPipelineAsync({
      label: 'life',
      layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
      vertex: { module: drawModule, entryPoint: 'cover' },
      fragment: { module: drawModule, entryPoint: 'shade', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])

  const uniform = device.createBuffer({
    label: 'life params',
    size: LIFE.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(LIFE.bytes)

  /* ⚠️ TWO BOARDS, AND THE GENERATION ALWAYS WRITES THE OTHER ONE. A cell's next state depends on
     its neighbours' CURRENT state, so updating in place would let a cell see a neighbour that has
     already moved on. `cur` is the board on screen; each generation reads it, writes the other,
     and swaps. Painting and scattering write `cur` itself — they touch one cell each. */
  let cols = 0
  let rows = 0
  let boards: [GPUBuffer, GPUBuffer] | null = null
  /** forward[i] reads board i and writes the other; it also writes board 1-i in place */
  let forward: [GPUBindGroup, GPUBindGroup] | null = null
  let shows: [GPUBindGroup, GPUBindGroup] | null = null
  let cur = 0
  let carry = 0
  let pendingSteps = 0
  let pendingScatter = false
  let pendingClear = false
  let seed = 1

  function setGrid(c: number, r: number) {
    boards?.forEach((b) => b.destroy())
    cols = c
    rows = r
    const make = (i: number) =>
      device.createBuffer({
        label: `life board ${i}`,
        size: c * r * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      })
    const b: [GPUBuffer, GPUBuffer] = [make(0), make(1)]
    boards = b
    const group = (read: GPUBuffer, write: GPUBuffer) =>
      device.createBindGroup({
        layout: stepLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: read } },
          { binding: 2, resource: { buffer: write } },
        ],
      })
    forward = [group(b[0], b[1]), group(b[1], b[0])]
    const show = (board: GPUBuffer) =>
      device.createBindGroup({
        layout: drawLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: board } },
        ],
      })
    shows = [show(b[0]), show(b[1])]
    cur = 0
    carry = 0
    pendingScatter = true
  }
  setGrid(cols0, rows0)

  function frame(dt: number, input: LifeInput) {
    if (!boards || !forward || !shows || canvas.width === 0 || canvas.height === 0) return
    const due = generationsDue(carry, dt, input.speed)
    carry = due.carry
    const runs = due.run + pendingSteps
    pendingSteps = 0
    if (pendingScatter) seed = (seed + 1) >>> 0

    const params: LifeParams = {
      cols,
      rows,
      brush: input.brush ?? [-1e6, -1e6],
      view: [canvas.width, canvas.height],
      radius: RADIUS,
      paint: input.brush ? (input.erase ? 2 : 1) : 0,
      seed,
    }
    device.queue.writeBuffer(uniform, 0, packLife(params, staging))

    const encoder = device.createCommandEncoder({ label: 'life frame' })
    if (pendingClear) {
      encoder.clearBuffer(boards[cur])
      pendingClear = false
    }
    const gx = Math.ceil(cols / TILE)
    const gy = Math.ceil(rows / TILE)
    const pass = encoder.beginComputePass({ label: 'life' })
    // `forward[1 - cur]` writes board `cur`: that is the group for anything done in place
    if (pendingScatter) {
      pass.setPipeline(scatter)
      pass.setBindGroup(0, forward[1 - cur])
      pass.dispatchWorkgroups(gx, gy)
      pendingScatter = false
    }
    if (input.brush) {
      pass.setPipeline(paint)
      pass.setBindGroup(0, forward[1 - cur])
      pass.dispatchWorkgroups(gx, gy)
    }
    for (let i = 0; i < runs; i++) {
      pass.setPipeline(generation)
      pass.setBindGroup(0, forward[cur])
      pass.dispatchWorkgroups(gx, gy)
      cur = 1 - cur
    }
    pass.end()

    const view = encoder.beginRenderPass({
      label: 'life draw',
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    view.setPipeline(draw)
    view.setBindGroup(0, shows[cur])
    view.draw(3)
    view.end()
    device.queue.submit([encoder.finish()])
  }

  return {
    setGrid,
    randomize: () => {
      pendingScatter = true
    },
    clear: () => {
      pendingClear = true
    },
    stepOnce: () => {
      pendingSteps++
    },
    /* written straight into the board on screen: queued writes land before the next frame's
       commands, which is the frame that will read them */
    stamp: (id, cx, cy) => {
      if (!boards) return
      for (const run of stampRuns(patternCells(id), cols, rows, cx, cy))
        device.queue.writeBuffer(boards[cur], run.at * 4, run.cells as Uint32Array<ArrayBuffer>)
    },
    frame,
    destroy() {
      boards?.forEach((b) => b.destroy())
      uniform.destroy()
      boards = null
      forward = null
      shows = null
    },
  }
}
