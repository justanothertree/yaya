import code from './glide.wgsl?raw'
import type { Task } from './glide'

export type GlideFrame = {
  task: Task
  glider: { x: number; h: number; circling: boolean }
  /** the flown path, oldest first: course x and height */
  trail: readonly [number, number][]
  time: number
}

export type GlideView = {
  frame(f: GlideFrame): void
  destroy(): void
}

const THERMALS = 16
export const TRAIL = 48
/** how much course the stage shows across, m */
export const ACROSS = 4000

/** where the view sits: the glider a third of the way across, never before the start */
export const cameraFor = (x: number) => Math.max(-ACROSS * 0.1, x - ACROSS / 3)

export async function createGlide(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<GlideView> {
  const module = device.createShaderModule({ label: 'glide', code })
  const layout = device.createBindGroupLayout({
    label: 'glide',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'glide scene',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'scene', targets: [{ format }] },
  })
  const uniform = device.createBuffer({
    label: 'glide view',
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const store = device.createBuffer({
    label: 'glide data',
    size: (THERMALS + TRAIL) * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout,
    entries: [uniform, store].map((buffer, binding) => ({ binding, resource: { buffer } })),
  })
  const values = new Float32Array(16)
  const list = new Float32Array((THERMALS + TRAIL) * 4)
  return {
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const t = f.task
      const n = Math.min(THERMALS, t.thermals.length)
      for (let i = 0; i < n; i++)
        list.set([t.thermals[i].x, t.thermals[i].r, t.thermals[i].lift, 0], i * 4)
      const segs = Math.min(TRAIL, Math.max(0, f.trail.length - 1))
      const from = f.trail.length - 1 - segs
      for (let i = 0; i < segs; i++) {
        const [a, b] = [f.trail[from + i], f.trail[from + i + 1]]
        list.set([a[0], a[1], b[0], b[1]], (THERMALS + i) * 4)
      }
      device.queue.writeBuffer(store, 0, list)
      // heights: cloudbase plus room for the clouds fills the space above the ground
      const yScale = (canvas.height * 0.86) / (t.base + 380)
      values.set([canvas.width, canvas.height, cameraFor(f.glider.x), canvas.width / ACROSS], 0)
      values.set([yScale, t.base, t.finish, f.time], 4)
      values.set([f.glider.x, f.glider.h, f.glider.circling ? 1 : 0, n], 8)
      values.set([t.clouds ? 1 : 0, segs, 0, 0], 12)
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'glide' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setBindGroup(0, group)
      rp.setPipeline(pipeline)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      uniform.destroy()
      store.destroy()
    },
  }
}
