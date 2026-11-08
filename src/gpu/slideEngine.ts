import code from './slide.wgsl?raw'
import { MAX_SIDE, fitBoard } from './slide'

export type SlideView = {
  board(tiles: Float32Array<ArrayBuffer>, w: number, h: number): void
  frame(f: {
    time: number
    /** the puck's centre, in cells, and where the last push began */
    puck: [number, number]
    from: [number, number]
    trail: number
    flash: number
    allCoins: boolean
  }): void
  destroy(): void
}

export async function createSlide(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<SlideView> {
  const module = device.createShaderModule({ label: 'slide', code })
  const F = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'slide',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } },
    ],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'slide',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'board', targets: [{ format }] },
  })
  const uniform = device.createBuffer({
    label: 'slide view',
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const tileBuf = device.createBuffer({
    label: 'slide tiles',
    size: MAX_SIDE * MAX_SIDE * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: tileBuf } },
    ],
  })
  let w = 1
  let h = 1
  const values = new Float32Array(16)
  return {
    board(tiles, bw, bh) {
      w = bw
      h = bh
      device.queue.writeBuffer(tileBuf, 0, tiles.subarray(0, MAX_SIDE * MAX_SIDE))
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const fit = fitBoard([canvas.width, canvas.height], w, h)
      values.set([canvas.width, canvas.height, fit.ox, fit.oy, fit.s, w, h, f.time])
      values.set(
        [f.puck[0], f.puck[1], f.from[0], f.from[1], f.trail, f.flash, f.allCoins ? 1 : 0, 0],
        8,
      )
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'slide' })
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
      tileBuf.destroy()
    },
  }
}
