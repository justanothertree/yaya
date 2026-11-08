import code from './mix.wgsl?raw'
import type { Rgb } from './palette'

export type MixView = {
  frame(f: {
    time: number
    /** seconds since the last drop went in */
    since: number
    target: Rgb
    matched: boolean
    cup: Rgb | null
    before: Rgb | null
    drop: Rgb
  }): void
  destroy(): void
}

export async function createMix(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<MixView> {
  const module = device.createShaderModule({ label: 'mix', code })
  const layout = device.createBindGroupLayout({
    label: 'mix',
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'mix',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'paint', targets: [{ format }] },
  })
  const uniform = device.createBuffer({
    label: 'mix view',
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  })
  const values = new Float32Array(20)
  return {
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const cup = f.cup ?? [0.93, 0.93, 0.93]
      values.set([canvas.width, canvas.height, f.since, f.time])
      values.set([...f.target, f.matched ? 1 : 0], 4)
      values.set([...cup, f.cup ? 0 : 1], 8)
      values.set([...(f.before ?? cup), 0], 12)
      values.set([...f.drop, 0], 16)
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'mix' })
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
