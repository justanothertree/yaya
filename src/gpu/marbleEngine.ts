import code from './marble.wgsl?raw'
import { MARBLE, PAPER, packMarble, type MarbleOp } from './marble'

export type Marbling = {
  /** Apply these to the tray — any number, in order — and show it. */
  frame(ops: readonly MarbleOp[]): void
  /** A fresh sheet of plain paper. */
  clear(): void
  resize(): void
  destroy(): void
}

const FORMAT: GPUTextureFormat = 'rgba16float'
/** ops one frame can apply; more wait for the next frame */
export const OPS_PER_FRAME = 32
/** a uniform's dynamic offset must be a multiple of this on every device */
const SLOT = 256

export async function createMarbling(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<Marbling> {
  const module = device.createShaderModule({ label: 'marble', code })
  /* ⚠️ ONE UNIFORM SLOT PER ACTION, with a dynamic offset. A queue.writeBuffer lands before the
     whole command buffer runs, so writing one uniform between passes would have every pass read
     the last value; a drop and the stroke that follows it in the same frame need their own. */
  const groupLayout = device.createBindGroupLayout({
    label: 'marble',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: MARBLE.bytes },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] })
  const pipeline = (entryPoint: string, target: GPUTextureFormat) =>
    device.createRenderPipelineAsync({
      label: entryPoint,
      layout,
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint, targets: [{ format: target }] },
      primitive: { topology: 'triangle-list' },
    })
  const [act, show] = await Promise.all([pipeline('act', FORMAT), pipeline('show', format)])

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const uniform = device.createBuffer({
    label: 'marble ops',
    size: SLOT * (OPS_PER_FRAME + 1),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(SLOT * (OPS_PER_FRAME + 1))

  let read: GPUTexture | null = null
  let write: GPUTexture | null = null
  let fresh = true
  function build() {
    read?.destroy()
    write?.destroy()
    const make = () =>
      device.createTexture({
        size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
        format: FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
    read = make()
    write = make()
    fresh = true
  }
  build()

  const group = (from: GPUTexture) =>
    device.createBindGroup({
      layout: groupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform, size: MARBLE.bytes } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: from.createView() },
      ],
    })

  return {
    frame(ops) {
      if (!read || !write || canvas.width === 0 || canvas.height === 0) return
      const aspect = canvas.width / canvas.height
      const todo = ops.slice(0, OPS_PER_FRAME)
      /* the show pass reads the uniform too (for the aspect); it gets the last slot */
      /* cleared first: a slot past this frame's last op would otherwise still hold the previous
         frame's, which the shader never reads but anybody reading the upload would */
      const bytes = new Uint8Array(staging)
      bytes.fill(0)
      todo.forEach((o, i) => bytes.set(new Uint8Array(packMarble(o, aspect)), i * SLOT))
      bytes.set(
        new Uint8Array(
          packMarble({ op: 'stroke', from: [0, 0], to: [0, 0], sharp: 0, spacing: 0 }, aspect),
        ),
        OPS_PER_FRAME * SLOT,
      )
      device.queue.writeBuffer(uniform, 0, staging)

      const encoder = device.createCommandEncoder({ label: 'marble frame' })
      if (fresh) {
        for (const t of [read, write])
          encoder
            .beginRenderPass({
              colorAttachments: [
                {
                  view: t.createView(),
                  clearValue: { r: PAPER[0], g: PAPER[1], b: PAPER[2], a: 1 },
                  loadOp: 'clear',
                  storeOp: 'store',
                },
              ],
            })
            .end()
        fresh = false
      }
      todo.forEach((_, i) => {
        const rp = encoder.beginRenderPass({
          colorAttachments: [{ view: write!.createView(), loadOp: 'clear', storeOp: 'store' }],
        })
        rp.setPipeline(act)
        rp.setBindGroup(0, group(read!), [i * SLOT])
        rp.draw(3)
        rp.end()
        ;[read, write] = [write, read]
      })
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, group(read), [OPS_PER_FRAME * SLOT])
      rp.draw(3)
      rp.end()
      device.queue.submit([encoder.finish()])
    },
    clear: () => {
      fresh = true
    },
    resize: build,
    destroy() {
      read?.destroy()
      write?.destroy()
      uniform.destroy()
      read = write = null
    },
  }
}
