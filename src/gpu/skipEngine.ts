import code from './skip.wgsl?raw'
import type { Course } from './skip'

export type SkipFrame = {
  time: number
  /** metres at the left edge of the view */
  camera: number
  stone: { x: number; y: number; tilt: number } | null
  aim: { speed: number; angle: number; tilt: number } | null
  course: Course
  buoy: number | null
  /** every touch so far: x, and the time it happened */
  touches: readonly { x: number; t: number }[]
}

export type SkipView = {
  frame(f: SkipFrame): void
  /** pixels per metre at the current size, so the page can place the camera */
  scale(): number
  destroy(): void
}

export const MAX_TOUCHES = 64
/** how much of the canvas, from the bottom, is lake under the water line: enough that about five
 *  metres of sky show above it — room for the highest throw — and never less than a third */
export const waterLine = (h: number, scale: number) =>
  Math.max(0.32, Math.min(0.55, 1 - (5 * scale) / h))

export async function createSkip(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<SkipView> {
  const module = device.createShaderModule({ label: 'skip', code })
  const layout = device.createBindGroupLayout({
    label: 'skip',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'skip scene',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'scene', targets: [{ format }] },
  })
  const uniform = device.createBuffer({
    label: 'skip view',
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const touchBuf = device.createBuffer({
    label: 'skip touches',
    size: MAX_TOUCHES * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout,
    entries: [uniform, touchBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
  })
  const values = new Float32Array(20)
  const list = new Float32Array(MAX_TOUCHES * 2)
  // about fourteen metres across a wide stage, and never fewer than five metres of height
  const scale = () => Math.min(canvas.width / 14, canvas.height / 5)
  return {
    scale,
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const n = Math.min(f.touches.length, MAX_TOUCHES)
      for (let i = 0; i < n; i++) {
        list[i * 2] = f.touches[i].x
        list[i * 2 + 1] = f.touches[i].t
      }
      if (n) device.queue.writeBuffer(touchBuf, 0, list.subarray(0, n * 2))
      const b = f.course.bridge
      values.set([canvas.width, canvas.height, f.camera, scale()], 0)
      values.set(f.stone ? [f.stone.x, f.stone.y, f.stone.tilt, 1] : [0, 0, 0, 0], 4)
      values.set(f.aim ? [f.aim.speed, f.aim.angle, 1, f.time] : [0, 0, 0, f.time], 8)
      values.set([f.course.shore, b?.at ?? 0, b?.width ?? 0, b?.clear ?? 0], 12)
      values.set([f.buoy ?? 0, n, waterLine(canvas.height, scale()), f.aim?.tilt ?? 0], 16)
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'skip' })
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
      touchBuf.destroy()
    },
  }
}
