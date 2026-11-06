import code from './bubbles.wgsl?raw'
import { BUBBLES, BUBBLE_FLOATS, MAX_BUBBLES, packBubbles, packFrame, type Bubble } from './bubbles'

export type BubbleView = { draw(list: readonly Bubble[], time: number): void; destroy(): void }

export async function createBubbles(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<BubbleView> {
  const module = device.createShaderModule({ label: 'bubbles', code })
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
    ],
  })
  const pipes = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const [back, film] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'bubbles backdrop',
      layout: pipes,
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'backdrop', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
    device.createRenderPipelineAsync({
      label: 'bubbles film',
      layout: pipes,
      vertex: { module, entryPoint: 'bubble' },
      fragment: {
        module,
        entryPoint: 'film',
        targets: [
          {
            format,
            // premultiplied "over": each bubble lets through what its film does not reflect
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'bubbles',
    size: BUBBLES.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const list = device.createBuffer({
    label: 'bubbles list',
    size: MAX_BUBBLES * BUBBLE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: list } },
    ],
  })
  const staging = new ArrayBuffer(BUBBLES.bytes)
  return {
    draw(bubbles, time) {
      const n = Math.min(bubbles.length, MAX_BUBBLES)
      device.queue.writeBuffer(uniform, 0, packFrame(canvas.width, canvas.height, n, time, staging))
      device.queue.writeBuffer(list, 0, packBubbles(bubbles))
      const e = device.createCommandEncoder({ label: 'bubbles' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setBindGroup(0, group)
      rp.setPipeline(back)
      rp.draw(3)
      if (n) {
        rp.setPipeline(film)
        rp.draw(n * 6)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      uniform.destroy()
      list.destroy()
    },
  }
}
