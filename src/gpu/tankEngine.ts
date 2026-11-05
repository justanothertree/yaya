import types from './tank-types.wgsl?raw'
import stepCode from './tank-step.wgsl?raw'
import drawCode from './tank-draw.wgsl?raw'
import { MAX_PELLETS, TANK, packPellets, packTank, seedFish, type Pellet } from './tank'

export type TankInput = {
  /** the finger that is the shark, in tank units, or null */
  shark: readonly [number, number] | null
  pellets: readonly Pellet[]
}

export type Aquarium = {
  frame(dt: number, input: TankInput): void
  /** A fresh tank of this many fish. */
  restock(count: number): void
  destroy(): void
}

/** the fish's length on screen, in tank units (the tank is two units tall) */
const SIZE = 0.06

export async function createAquarium(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
  count0: number,
): Promise<Aquarium> {
  const stepModule = device.createShaderModule({ label: 'tank step', code: types + stepCode })
  const drawModule = device.createShaderModule({ label: 'tank draw', code: types + drawCode })
  const [swim, water, fishes] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'swim',
      layout: 'auto',
      compute: { module: stepModule, entryPoint: 'swim' },
    }),
    device.createRenderPipelineAsync({
      label: 'water',
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'water_vertex' },
      fragment: { module: drawModule, entryPoint: 'water', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
    device.createRenderPipelineAsync({
      label: 'fish',
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'fish_vertex' },
      fragment: { module: drawModule, entryPoint: 'fin', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'tank params',
    size: TANK.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const food = device.createBuffer({
    label: 'pellets',
    size: MAX_PELLETS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(TANK.bytes)
  const foodData = new Float32Array(MAX_PELLETS * 4)

  let count = 0
  let cur = 0
  let schools: GPUBuffer[] = []
  let swims: GPUBindGroup[] = []
  let draws: GPUBindGroup[] = []
  let waterGroup: GPUBindGroup | null = null
  let time = 0

  function restock(n: number) {
    schools.forEach((b) => b.destroy())
    count = n
    schools = [0, 1].map((i) =>
      device.createBuffer({
        label: `school ${i}`,
        size: n * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    )
    device.queue.writeBuffer(
      schools[0],
      0,
      seedFish(n, canvas.width / Math.max(1, canvas.height)) as Float32Array<ArrayBuffer>,
    )
    swims = [0, 1].map((i) =>
      device.createBindGroup({
        layout: swim.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: schools[i] } },
          { binding: 2, resource: { buffer: schools[1 - i] } },
          { binding: 3, resource: { buffer: food } },
        ],
      }),
    )
    draws = [0, 1].map((i) =>
      device.createBindGroup({
        layout: fishes.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: schools[i] } },
        ],
      }),
    )
    waterGroup = device.createBindGroup({
      layout: water.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 2, resource: { buffer: food } },
      ],
    })
    cur = 0
  }
  restock(count0)

  return {
    restock,
    frame(dt, input) {
      if (!waterGroup || canvas.width === 0 || canvas.height === 0) return
      time += dt
      const pellets = input.pellets.slice(0, MAX_PELLETS)
      device.queue.writeBuffer(food, 0, packPellets(pellets, foodData))
      device.queue.writeBuffer(
        uniform,
        0,
        packTank(
          {
            aspect: canvas.width / canvas.height,
            dt,
            time,
            count,
            shark: input.shark ?? [0, 0],
            hunting: input.shark !== null,
            food: pellets.length,
            size: SIZE,
          },
          staging,
        ),
      )
      const encoder = device.createCommandEncoder({ label: 'tank frame' })
      if (dt > 0) {
        const pass = encoder.beginComputePass({ label: 'swim' })
        pass.setPipeline(swim)
        pass.setBindGroup(0, swims[cur])
        pass.dispatchWorkgroups(Math.ceil(count / 64))
        pass.end()
        cur = 1 - cur
      }
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(water)
      rp.setBindGroup(0, waterGroup)
      rp.draw(3)
      rp.setPipeline(fishes)
      rp.setBindGroup(0, draws[cur])
      rp.draw(9 * count)
      rp.end()
      device.queue.submit([encoder.finish()])
    },
    destroy() {
      schools.forEach((b) => b.destroy())
      uniform.destroy()
      food.destroy()
    },
  }
}
