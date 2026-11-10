import code from './graph.wgsl?raw'
import { SAMPLES, VIEW } from './graph'

export type GraphView = {
  /** the two curves, as samples across the plane; NaN where undefined */
  curves(target: Float32Array, yours: Float32Array | null): void
  frame(f: { time: number; matched: boolean }): void
  destroy(): void
}

/** NaN and infinities become 1e30: a shader may assume it never sees a NaN */
const safe = (v: number) => (Number.isFinite(v) ? v : 1e30)

export async function createGraph(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<GraphView> {
  const module = device.createShaderModule({ label: 'graph', code })
  const F = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'graph',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } },
    ],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'graph',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'plot', targets: [{ format }] },
  })
  const uniform = device.createBuffer({ label: 'graph view', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) // prettier-ignore
  const data = device.createBuffer({ label: 'graph curves', size: SAMPLES * 2 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }) // prettier-ignore
  const group = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: data } },
    ],
  })
  const ys = new Float32Array(SAMPLES * 2).fill(1e30)
  const values = new Float32Array(8)
  return {
    curves(target, yours) {
      for (let i = 0; i < SAMPLES; i++) {
        ys[i] = safe(target[i])
        ys[SAMPLES + i] = yours ? safe(yours[i]) : 1e30
      }
      device.queue.writeBuffer(data, 0, ys)
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      values.set([
        canvas.width,
        canvas.height,
        f.matched ? 1 : 0,
        f.time,
        VIEW.x0,
        VIEW.x1,
        VIEW.y0,
        VIEW.y1,
      ])
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'graph' })
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
      data.destroy()
    },
  }
}
