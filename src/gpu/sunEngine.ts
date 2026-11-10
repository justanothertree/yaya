import code from './sun.wgsl?raw'
import { VIEW, toView, type Sky } from './sun'

export const MAX_PATH = 200

export type SunView = {
  frame(f: {
    time: number
    sun: Sky
    showSun: boolean
    guess: Sky | null
    path: Sky[] | null
  }): void
  destroy(): void
}

export async function createSun(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<SunView> {
  const module = device.createShaderModule({ label: 'sun', code })
  const F = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'sun',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } },
    ],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'sun',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'sky', targets: [{ format }] },
  })
  const uniform = device.createBuffer({ label: 'sun view', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) // prettier-ignore
  const pathBuf = device.createBuffer({ label: 'sun path', size: MAX_PATH * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }) // prettier-ignore
  const group = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: pathBuf } },
    ],
  })
  const values = new Float32Array(16)
  const pts = new Float32Array(MAX_PATH * 2)
  return {
    frame(f) {
      const W = canvas.width
      const H = canvas.height
      if (W === 0 || H === 0) return
      const n = f.path ? Math.min(MAX_PATH, f.path.length) : 0
      for (let i = 0; i < n; i++) pts.set(toView(f.path![i], W, H), i * 2)
      if (n) device.queue.writeBuffer(pathBuf, 0, pts, 0, n * 2)
      const s = toView(f.sun, W, H)
      const g = f.guess ? toView(f.guess, W, H) : [0, 0]
      values.set([W, H, f.time, f.sun.elevation, s[0], s[1], g[0], g[1]])
      values.set([f.showSun ? 1 : 0, f.guess ? 1 : 0, n ? 1 : 0, n, VIEW.up, VIEW.down, f.sun.azimuth, 0], 8) // prettier-ignore
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'sun' })
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
      uniform.destroy()
      pathBuf.destroy()
    },
  }
}
