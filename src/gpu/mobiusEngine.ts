import code from './mobius.wgsl?raw'
import {
  COURSE,
  MAX_PATH,
  MAX_WALLS,
  packCourse,
  type CourseFrame,
  type V2,
  type Wall,
} from './mobius'

export type MobiusView = {
  /** the hole's walls, at most MAX_WALLS */
  walls(w: readonly Wall[]): void
  /** the trail or the aiming guide, at most MAX_PATH points */
  path(p: readonly V2[]): void
  frame(f: Omit<CourseFrame, 'w' | 'h' | 'walls' | 'path'>): void
  destroy(): void
}

export async function createMobius(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<MobiusView> {
  const module = device.createShaderModule({ label: 'mobius', code })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'mobius',
    layout: 'auto',
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'show', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const uniform = device.createBuffer({
    label: 'mobius course',
    size: COURSE.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const wallBuf = device.createBuffer({
    label: 'mobius walls',
    size: MAX_WALLS * 16,
    usage: storage,
  })
  const pathBuf = device.createBuffer({ label: 'mobius path', size: MAX_PATH * 8, usage: storage })
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [uniform, wallBuf, pathBuf].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  })
  const staging = new ArrayBuffer(COURSE.bytes)
  let walls = 0
  let points = 0
  return {
    walls(w) {
      walls = Math.min(w.length, MAX_WALLS)
      if (walls) device.queue.writeBuffer(wallBuf, 0, Float32Array.from(w.slice(0, walls).flat()))
    },
    path(p) {
      points = Math.min(p.length, MAX_PATH)
      if (points) device.queue.writeBuffer(pathBuf, 0, Float32Array.from(p.slice(0, points).flat()))
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      device.queue.writeBuffer(
        uniform,
        0,
        packCourse({ ...f, w: canvas.width, h: canvas.height, walls, path: points }, staging),
      )
      const e = device.createCommandEncoder({ label: 'mobius' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(pipeline)
      rp.setBindGroup(0, group)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [uniform, wallBuf, pathBuf]) b.destroy()
    },
  }
}
