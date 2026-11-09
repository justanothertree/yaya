import code from './intervals.wgsl?raw'
import { LOW } from './intervals'

export type IntervalsView = {
  frame(f: {
    time: number
    /** the two notes, as MIDI numbers */
    first: number
    second: number
    /** seconds since each sounded; negative before it has */
    sinceFirst: number
    sinceSecond: number
    /** null until answered */
    right: boolean | null
  }): void
  destroy(): void
}

export async function createIntervals(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<IntervalsView> {
  const module = device.createShaderModule({ label: 'intervals', code })
  const layout = device.createBindGroupLayout({
    label: 'intervals',
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'intervals',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'spiral', targets: [{ format }] },
  })
  const uniform = device.createBuffer({
    label: 'intervals view',
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  })
  const values = new Float32Array(12)
  return {
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      values.set([canvas.width, canvas.height, f.time, f.right === null ? 0 : 1])
      values.set([f.first - LOW, f.second - LOW, f.sinceFirst, f.sinceSecond], 4)
      values.set([f.right === null ? 0 : f.right ? 1 : 2, 0, 0, 0], 8)
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'intervals' })
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
    },
  }
}
