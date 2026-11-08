import code from './epicycles.wgsl?raw'

export type EpicyclesView = {
  /** lines as (x0, y0, x1, y1, r, g, b, half-width px), rings as (cx, cy, r, brightness) */
  frame(lines: Float32Array<ArrayBuffer>, rings: Float32Array<ArrayBuffer>): void
  destroy(): void
}

export const MAX_LINES = 1024
export const MAX_RINGS = 128

export async function createEpicycles(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<EpicyclesView> {
  const module = device.createShaderModule({ label: 'epicycles', code })
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'epicycles',
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: VF, buffer: { type: 'read-only-storage' } },
    ],
  })
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const add: GPUBlendState = {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  }
  const [grid, line, ring] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'epicycles grid',
      layout: pl,
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'grid', targets: [{ format }] },
    }),
    device.createRenderPipelineAsync({
      label: 'epicycles lines',
      layout: pl,
      vertex: { module, entryPoint: 'line_vs' },
      fragment: { module, entryPoint: 'line_fs', targets: [{ format, blend: add }] },
    }),
    device.createRenderPipelineAsync({
      label: 'epicycles rings',
      layout: pl,
      vertex: { module, entryPoint: 'ring_vs' },
      fragment: { module, entryPoint: 'ring_fs', targets: [{ format, blend: add }] },
    }),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const uniform = device.createBuffer({
    label: 'epicycles view',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const lineBuf = device.createBuffer({ label: 'epicycles lines', size: MAX_LINES * 32, usage: S })
  const ringBuf = device.createBuffer({ label: 'epicycles rings', size: MAX_RINGS * 16, usage: S })
  const group = device.createBindGroup({
    layout,
    entries: [uniform, lineBuf, ringBuf].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  })
  const values = new Float32Array(8)
  return {
    frame(lines, rings) {
      if (canvas.width === 0 || canvas.height === 0) return
      const nl = Math.min(lines.length / 8, MAX_LINES)
      const nr = Math.min(rings.length / 4, MAX_RINGS)
      // the drawing is −1..1 each way; it fills the shorter side of the stage, with a margin
      const s = Math.min(canvas.width, canvas.height) / 2.3
      values.set([canvas.width, canvas.height, canvas.width / 2, canvas.height / 2, s, 0, 0, 0])
      device.queue.writeBuffer(uniform, 0, values)
      if (nl) device.queue.writeBuffer(lineBuf, 0, lines.subarray(0, nl * 8))
      if (nr) device.queue.writeBuffer(ringBuf, 0, rings.subarray(0, nr * 4))
      const e = device.createCommandEncoder({ label: 'epicycles' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setBindGroup(0, group)
      rp.setPipeline(grid)
      rp.draw(3)
      if (nr) {
        rp.setPipeline(ring)
        rp.draw(6, nr)
      }
      if (nl) {
        rp.setPipeline(line)
        rp.draw(6, nl)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      for (const b of [uniform, lineBuf, ringBuf]) b.destroy()
    },
  }
}
