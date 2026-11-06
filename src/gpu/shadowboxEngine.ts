import code from './shadowbox.wgsl?raw'
import { BOX, CELLS, packBox, type Build, type Show } from './shadowbox'

export type BoxFrame = { show: Show; mine: boolean; hidden: boolean; time: number; yaw: number }

export type ShadowboxView = {
  /** the hidden build (whose shadows are the clue) and the player's (drawn, its shadows over them) */
  builds(hidden: Build, mine: Build): void
  frame(f: BoxFrame): void
  destroy(): void
}

export async function createShadowbox(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<ShadowboxView> {
  const module = device.createShaderModule({ label: 'shadowbox', code })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'shadowbox',
    layout: 'auto',
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'show', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const uniform = device.createBuffer({
    label: 'shadowbox box',
    size: BOX.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const heights = device.createBuffer({
    label: 'shadowbox heights',
    size: CELLS * 2 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: heights } },
    ],
  })
  const staging = new ArrayBuffer(BOX.bytes)
  return {
    builds(hidden, mine) {
      device.queue.writeBuffer(heights, 0, Uint32Array.from([...hidden, ...mine]))
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      device.queue.writeBuffer(
        uniform,
        0,
        packBox({ ...f, w: canvas.width, h: canvas.height }, staging),
      )
      const e = device.createCommandEncoder({ label: 'shadowbox' })
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
      heights.destroy()
    },
  }
}
