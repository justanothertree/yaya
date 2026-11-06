import code from './harp.wgsl?raw'
import {
  HARP,
  MAX_STRINGS,
  STRING_FLOATS,
  packHarp,
  packStrings,
  type HarpString,
  type Pluck,
} from './harp'

export type HarpView = {
  draw(f: {
    strings: readonly HarpString[]
    plucks: readonly Pluck[]
    time: number
    width: number
  }): void
  destroy(): void
}

/** the vertex shader's segments per string, mirrored from harp.wgsl */
const SEGMENTS = 96

export async function createHarp(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<HarpView> {
  const module = device.createShaderModule({ label: 'harp', code })
  const pipe = await device.createRenderPipelineAsync({
    label: 'harp',
    layout: 'auto',
    vertex: { module, entryPoint: 'string' },
    fragment: {
      module,
      entryPoint: 'glow',
      targets: [
        {
          format,
          // light adds up, so a string's halo brightens whatever is under it
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  })
  const uniform = device.createBuffer({
    label: 'harp',
    size: HARP.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const stringsBuf = device.createBuffer({
    label: 'harp strings',
    size: MAX_STRINGS * STRING_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: stringsBuf } },
    ],
  })
  const staging = new ArrayBuffer(HARP.bytes)

  return {
    draw({ strings, plucks, time, width }) {
      const count = Math.min(strings.length, MAX_STRINGS)
      device.queue.writeBuffer(
        uniform,
        0,
        packHarp({ w: canvas.width, h: canvas.height, time, count, width }, staging),
      )
      device.queue.writeBuffer(stringsBuf, 0, packStrings(strings, plucks))
      const encoder = device.createCommandEncoder({ label: 'harp' })
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.02, g: 0.015, b: 0.04, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      rp.setPipeline(pipe)
      rp.setBindGroup(0, group)
      rp.draw(count * SEGMENTS * 6)
      rp.end()
      device.queue.submit([encoder.finish()])
    },
    destroy() {
      uniform.destroy()
      stringsBuf.destroy()
    },
  }
}
