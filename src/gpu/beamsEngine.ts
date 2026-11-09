import code from './beams.wgsl?raw'
import { MAX_CELLS, MAX_SEGMENTS, fitBoard } from './beams'

export type BeamsView = {
  board(cells: Float32Array<ArrayBuffer>, w: number, h: number): void
  beams(segments: Float32Array<ArrayBuffer>): void
  frame(f: { time: number; flash: number; hover: [number, number] | null }): void
  destroy(): void
}

export async function createBeams(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<BeamsView> {
  const module = device.createShaderModule({ label: 'beams', code })
  const F = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'beams',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F, buffer: { type: 'read-only-storage' } },
    ],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'beams',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'board', targets: [{ format }] },
  })
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const uniform = device.createBuffer({
    label: 'beams view',
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const cellBuf = device.createBuffer({ label: 'beams cells', size: MAX_CELLS * 16, usage: S })
  const beamBuf = device.createBuffer({ label: 'beams beams', size: MAX_SEGMENTS * 32, usage: S })
  const group = device.createBindGroup({
    layout,
    entries: [uniform, cellBuf, beamBuf].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  })
  let w = 1
  let h = 1
  let count = 0
  const values = new Float32Array(12)
  return {
    board(cells, cw, ch) {
      w = cw
      h = ch
      device.queue.writeBuffer(cellBuf, 0, cells.subarray(0, MAX_CELLS * 4))
    },
    beams(segments) {
      count = Math.min(segments.length / 8, MAX_SEGMENTS)
      if (count) device.queue.writeBuffer(beamBuf, 0, segments.subarray(0, count * 8))
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const fit = fitBoard([canvas.width, canvas.height], w, h)
      values.set([canvas.width, canvas.height, fit.ox, fit.oy], 0)
      values.set([fit.s, w, h, count], 4)
      values.set([f.time, f.flash, f.hover?.[0] ?? -1, f.hover?.[1] ?? -1], 8)
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'beams' })
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
      for (const b of [uniform, cellBuf, beamBuf]) b.destroy()
    },
  }
}
