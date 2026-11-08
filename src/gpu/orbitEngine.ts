import code from './orbit.wgsl?raw'
import { fitOrbit, type Level } from './orbit'

export type OrbitView = {
  frame(f: { level: Level; lines: Float32Array<ArrayBuffer>; time: number; met: boolean }): void
  destroy(): void
}

export const MAX_LINES = 1200

export async function createOrbit(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<OrbitView> {
  const module = device.createShaderModule({ label: 'orbit', code })
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'orbit',
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },
    ],
  })
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const add: GPUBlendState = {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  }
  const [space, line] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'orbit space',
      layout: pl,
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'space', targets: [{ format }] },
    }),
    device.createRenderPipelineAsync({
      label: 'orbit lines',
      layout: pl,
      vertex: { module, entryPoint: 'line_vs' },
      fragment: { module, entryPoint: 'line_fs', targets: [{ format, blend: add }] },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'orbit view',
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const lineBuf = device.createBuffer({
    label: 'orbit lines',
    size: MAX_LINES * 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout,
    entries: [uniform, lineBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
  })
  const values = new Float32Array(12)
  return {
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const fit = fitOrbit(f.level, [canvas.width, canvas.height])
      const g = f.level.goal
      const bands =
        g.kind === 'ring'
          ? [g.r, 0, g.tol, 0]
          : g.kind === 'ellipse'
            ? [g.peri, g.apo, g.tol, g.tol]
            : [0, 0, 0, 0]
      values.set([canvas.width, canvas.height, fit.ox, fit.oy], 0)
      values.set([fit.s, f.time, bands[0], bands[1]], 4)
      values.set([bands[2], bands[3], f.met ? 1 : 0, g.kind === 'escape' ? 1 : 0], 8)
      device.queue.writeBuffer(uniform, 0, values)
      const n = Math.min(f.lines.length / 8, MAX_LINES)
      if (n) device.queue.writeBuffer(lineBuf, 0, f.lines.subarray(0, n * 8))
      const e = device.createCommandEncoder({ label: 'orbit' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setBindGroup(0, group)
      rp.setPipeline(space)
      rp.draw(3)
      if (n) {
        rp.setPipeline(line)
        rp.draw(6, n)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      uniform.destroy()
      lineBuf.destroy()
    },
  }
}
