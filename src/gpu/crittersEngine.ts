import code from './critters.wgsl?raw'
import {
  BRAIN_FLOATS,
  MAX_BONES,
  MAX_DEGREE,
  MAX_JOINTS,
  POPULATION,
  RACE,
  packBody,
  packBrains,
  packRace,
  type Body,
  type Brain,
  type V2,
} from './critters'

export type CrittersView = {
  /** the body every copy shares */
  body(b: Body): void
  brains(b: readonly Brain[]): void
  /** every copy back at the start, from these joint positions (x, y, vx, vy each) */
  place(start: Float32Array<ArrayBuffer>, count: number): void
  /** `steps` substeps of the race from time `t`, then a picture */
  frame(f: {
    steps: number
    time: number
    cam: V2
    scale: number
    best: number
    build: boolean
  }): void
  /** every copy's joints, read back */
  read(): Promise<Float32Array | null>
  readonly buffers: { state: GPUBuffer }
  destroy(): void
}

export async function createCritters(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<CrittersView> {
  const module = device.createShaderModule({ label: 'critters', code })
  const blend: GPUBlendState = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  }
  const draw = (vertex: string, fragment: string, blended: boolean) =>
    device.createRenderPipelineAsync({
      label: fragment,
      layout: 'auto',
      vertex: { module, entryPoint: vertex },
      fragment: {
        module,
        entryPoint: fragment,
        targets: [{ format, blend: blended ? blend : undefined }],
      },
      primitive: { topology: 'triangle-list' },
    })
  const [race, ground, bones, joints] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'race',
      layout: 'auto',
      compute: { module, entryPoint: 'race' },
    }),
    draw('cover', 'ground', false),
    draw('bone_vs', 'bone_fs', true),
    draw('joint_vs', 'joint_fs', true),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const buf = (label: string, size: number, usage = S) =>
    device.createBuffer({ label, size, usage })
  const uniform = buf('critters', RACE.bytes, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
  const boneBuf = buf('critters bones', MAX_BONES * 16)
  const adjBuf = buf('critters adjacency', MAX_JOINTS * MAX_DEGREE * 4)
  const brainBuf = buf('critters brains', POPULATION * BRAIN_FLOATS * 4)
  const state = buf('critters state', POPULATION * MAX_JOINTS * 16)
  const readback = buf(
    'critters readback',
    POPULATION * MAX_JOINTS * 16,
    GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  )
  const group = (pipe: GPUComputePipeline | GPURenderPipeline, entries: [number, GPUBuffer][]) =>
    device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
    })
  const groups = {
    race: group(race, [
      [0, uniform],
      [1, boneBuf],
      [2, adjBuf],
      [3, brainBuf],
      [4, state],
    ]),
    ground: group(ground, [[0, uniform]]),
    bones: group(bones, [
      [0, uniform],
      [1, boneBuf],
      [5, state],
    ]),
    joints: group(joints, [
      [0, uniform],
      [5, state],
    ]),
  }
  let jointCount = 0
  let boneCount = 0
  let count = 0
  let reading = false
  const staging = new ArrayBuffer(RACE.bytes)

  return {
    buffers: { state },
    body(b) {
      const p = packBody(b)
      device.queue.writeBuffer(boneBuf, 0, p.bones)
      device.queue.writeBuffer(adjBuf, 0, p.adjacency)
      jointCount = b.joints.length
      boneCount = b.bones.length
    },
    brains(b) {
      device.queue.writeBuffer(brainBuf, 0, packBrains(b))
    },
    place(start, n) {
      device.queue.writeBuffer(state, 0, start)
      count = n
    },
    async read() {
      if (reading) return null
      reading = true
      const e = device.createCommandEncoder()
      e.copyBufferToBuffer(state, 0, readback, 0, state.size)
      device.queue.submit([e.finish()])
      try {
        await readback.mapAsync(GPUMapMode.READ)
        const out = new Float32Array(readback.getMappedRange().slice(0))
        readback.unmap()
        return out
      } catch {
        return null
      } finally {
        reading = false
      }
    },
    frame({ steps, time, cam, scale, best, build }) {
      if (canvas.width === 0 || canvas.height === 0 || !count) return
      device.queue.writeBuffer(
        uniform,
        0,
        packRace(
          {
            w: canvas.width,
            h: canvas.height,
            joints: jointCount,
            bones: boneCount,
            count,
            steps,
            time,
            cam,
            scale,
            best: Math.min(best, count - 1),
            build,
          },
          staging,
        ),
      )
      const e = device.createCommandEncoder({ label: 'critters' })
      if (steps > 0 && jointCount > 1) {
        const p = e.beginComputePass()
        p.setPipeline(race)
        p.setBindGroup(0, groups.race)
        p.dispatchWorkgroups(count)
        p.end()
      }
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(ground)
      rp.setBindGroup(0, groups.ground)
      rp.draw(3)
      if (boneCount) {
        rp.setPipeline(bones)
        rp.setBindGroup(0, groups.bones)
        rp.draw(6, count * boneCount)
      }
      if (jointCount) {
        rp.setPipeline(joints)
        rp.setBindGroup(0, groups.joints)
        rp.draw(6, count * jointCount)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [uniform, boneBuf, adjBuf, brainBuf, state, readback]) b.destroy()
    },
  }
}
