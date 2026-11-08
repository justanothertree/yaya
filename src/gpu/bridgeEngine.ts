import code from './bridge.wgsl?raw'
import { MAX_MEMBERS, fitScene, type Level, type V2 } from './bridge'

export type BridgeView = {
  members(packed: Float32Array<ArrayBuffer>): void
  joints(p: readonly V2[], fixed: readonly boolean[], selected: number): void
  frame(f: {
    level: Level
    cart: V2
    time: number
    building: boolean
    ghost: [number, number, number, number] | null
  }): void
  destroy(): void
}

const MAX_JOINTS = 256

export async function createBridge(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<BridgeView> {
  const module = device.createShaderModule({ label: 'bridge', code })
  const F = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'bridge',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F, buffer: { type: 'read-only-storage' } },
    ],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'bridge',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'scene', targets: [{ format }] },
  })
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const uniform = device.createBuffer({
    label: 'bridge view',
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const memberBuf = device.createBuffer({
    label: 'bridge members',
    size: MAX_MEMBERS * 32,
    usage: S,
  })
  const jointBuf = device.createBuffer({ label: 'bridge joints', size: MAX_JOINTS * 16, usage: S })
  const group = device.createBindGroup({
    layout,
    entries: [uniform, memberBuf, jointBuf].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  })
  let nm = 0
  let nj = 0
  const values = new Float32Array(16)
  const jointData = new Float32Array(MAX_JOINTS * 4)
  return {
    members(packed) {
      nm = Math.min(packed.length / 8, MAX_MEMBERS)
      if (nm) device.queue.writeBuffer(memberBuf, 0, packed.subarray(0, nm * 8))
    },
    joints(p, fixed, selected) {
      nj = Math.min(p.length, MAX_JOINTS)
      for (let i = 0; i < nj; i++)
        jointData.set([p[i][0], p[i][1], fixed[i] ? 1 : 0, i === selected ? 1 : 0], i * 4)
      if (nj) device.queue.writeBuffer(jointBuf, 0, jointData.subarray(0, nj * 4))
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const fit = fitScene(f.level, [canvas.width, canvas.height])
      values.set([fit.s, fit.ox, fit.oy, 0], 0)
      values.set([f.level.span, f.level.water, nm, nj], 4)
      values.set([f.cart[0], f.cart[1], f.time, f.building ? 1 : 0], 8)
      values.set(f.ghost ?? [-999, 0, 0, 0], 12)
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'bridge' })
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
      for (const b of [uniform, memberBuf, jointBuf]) b.destroy()
    },
  }
}
