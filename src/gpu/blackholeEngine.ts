import code from './blackhole.wgsl?raw'
import { HOLE, packHole, type HoleFrame } from './blackhole'

export type BlackHoleView = {
  frame(f: Omit<HoleFrame, 'w' | 'h'>): void
  destroy(): void
}

/** One full-screen pass: every pixel traces its own ray (blackhole.wgsl). */
export async function createBlackHole(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: { width: number; height: number },
): Promise<BlackHoleView> {
  const module = device.createShaderModule({ label: 'black hole', code })
  const pipe = await device.createRenderPipelineAsync({
    label: 'black hole',
    layout: 'auto',
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'show', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const uniform = device.createBuffer({
    label: 'black hole',
    size: HOLE.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  })
  const staging = new ArrayBuffer(HOLE.bytes)
  return {
    frame(f) {
      device.queue.writeBuffer(
        uniform,
        0,
        packHole({ ...f, w: canvas.width, h: canvas.height }, staging),
      )
      const e = device.createCommandEncoder({ label: 'black hole' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(pipe)
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
