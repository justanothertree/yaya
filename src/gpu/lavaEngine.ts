import code from './lava.wgsl?raw'
import { LAVA, MAX_BLOBS, packBlobs, packLava, type Blob } from './lava'

export type LavaLamp = {
  /** Draw the blobs as they are now, in the given colour scheme. */
  draw(blobs: readonly Blob[], time: number, scheme: number): void
  destroy(): void
}

/** The lamp's drawing. Its physics is lava.ts, run on the CPU: there are only a handful of blobs. */
export async function createLavaLamp(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<LavaLamp> {
  const module = device.createShaderModule({ label: 'lava', code })
  const pipe = await device.createRenderPipelineAsync({
    label: 'lava',
    layout: 'auto',
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'shade', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const uniform = device.createBuffer({
    label: 'lava params',
    size: LAVA.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const store = device.createBuffer({
    label: 'lava blobs',
    size: MAX_BLOBS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: store } },
    ],
  })
  const staging = new ArrayBuffer(LAVA.bytes)
  const packed = new Float32Array(MAX_BLOBS * 4)

  return {
    draw(blobs, time, scheme) {
      if (canvas.width === 0 || canvas.height === 0) return
      const count = Math.min(blobs.length, MAX_BLOBS)
      device.queue.writeBuffer(
        uniform,
        0,
        packLava({ aspect: canvas.width / canvas.height, count, time, scheme }, staging),
      )
      device.queue.writeBuffer(store, 0, packBlobs(blobs, packed))
      const encoder = device.createCommandEncoder({ label: 'lava frame' })
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
    destroy() {
      uniform.destroy()
      store.destroy()
    },
  }
}
