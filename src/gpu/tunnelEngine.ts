import code from './tunnel.wgsl?raw'
import { TUNNEL, packTunnel, type Frame } from './tunnel'

export type TunnelView = { draw(frame: Frame): void; destroy(): void }

/** One full-screen pass and one uniform: the whole world is in the fragment shader. */
export async function createTunnel(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<TunnelView> {
  const module = device.createShaderModule({ label: 'tunnel', code })
  const pipe = await device.createRenderPipelineAsync({
    label: 'tunnel',
    layout: 'auto',
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'fly', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const uniform = device.createBuffer({
    label: 'tunnel',
    size: TUNNEL.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  })
  const staging = new ArrayBuffer(TUNNEL.bytes)

  return {
    draw(frame) {
      device.queue.writeBuffer(uniform, 0, packTunnel(frame, staging))
      const encoder = device.createCommandEncoder({ label: 'tunnel' })
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(pipe)
      rp.setBindGroup(0, group)
      rp.draw(3)
      rp.end()
      device.queue.submit([encoder.finish()])
    },
    destroy: () => uniform.destroy(),
  }
}
