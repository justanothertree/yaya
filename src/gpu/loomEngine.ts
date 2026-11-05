import code from './loom.wgsl?raw'
import { AT, LOOM, packDraft, packLoom, type Draft, type LoomParams } from './loom'

export type LoomView = {
  /** a new or edited draft, uploaded once rather than every frame */
  draft(d: Draft): void
  frame(p: Omit<LoomParams, 'w' | 'h'>): void
  destroy(): void
}

export async function createLoom(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<LoomView> {
  const module = device.createShaderModule({ label: 'loom', code })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'loom',
    layout: 'auto',
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'show', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const uniform = device.createBuffer({
    label: 'loom',
    size: LOOM.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const draftBuf = device.createBuffer({
    label: 'loom draft',
    size: AT.words * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: draftBuf } },
    ],
  })
  const staging = new ArrayBuffer(LOOM.bytes)
  return {
    draft(d) {
      device.queue.writeBuffer(draftBuf, 0, packDraft(d))
    },
    frame(p) {
      if (canvas.width === 0 || canvas.height === 0) return
      device.queue.writeBuffer(
        uniform,
        0,
        packLoom({ ...p, w: canvas.width, h: canvas.height }, staging),
      )
      const e = device.createCommandEncoder({ label: 'loom' })
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
      draftBuf.destroy()
    },
  }
}
