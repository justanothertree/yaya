import code from './kaleido.wgsl?raw'
import { KALEIDO, fadeFor, packKaleido } from './kaleido'

export type KaleidoInput = {
  /** this frame's stroke, from a to b in centred units, taken and cleared by the frame */
  stroke: { a: readonly [number, number]; b: readonly [number, number] } | null
  color: readonly [number, number, number]
  /** the brush's radius, in centred units (a fraction of the screen's height) */
  radius: number
  /** how much of the painting survives a second; 1 keeps it for good */
  keep: number
  n: number
  mirror: boolean
}

export type Kaleido = {
  frame(dt: number, input: KaleidoInput): void
  clear(): void
  resize(): void
  destroy(): void
}

const FORMAT: GPUTextureFormat = 'rgba16float'

export async function createKaleido(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<Kaleido> {
  const module = device.createShaderModule({ label: 'kaleido', code })
  const groupLayout = device.createBindGroupLayout({
    label: 'kaleido',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
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
  const [paint, show] = await Promise.all([pipeline('paint', FORMAT), pipeline('show', format)])

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const uniform = device.createBuffer({
    label: 'kaleido params',
    size: KALEIDO.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(KALEIDO.bytes)

  /* the painting fades by drawing itself into the other texture, so it is two taking turns */
  let read: GPUTexture | null = null
  let write: GPUTexture | null = null
  let needsClear = true
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
    needsClear = true
  }
  build()

  const group = (from: GPUTexture) =>
    device.createBindGroup({
      layout: groupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: from.createView() },
      ],
    })

  function frame(dt: number, input: KaleidoInput) {
    if (!read || !write || canvas.width === 0 || canvas.height === 0) return
    const stroke = input.stroke
    input.stroke = null
    device.queue.writeBuffer(
      uniform,
      0,
      packKaleido(
        {
          a: stroke?.a ?? [0, 0],
          b: stroke?.b ?? [0, 0],
          color: input.color,
          aspect: canvas.width / canvas.height,
          radius: input.radius,
          fade: fadeFor(input.keep, dt),
          n: input.n,
          mirror: input.mirror,
          drawing: stroke !== null,
        },
        staging,
      ),
    )
    const encoder = device.createCommandEncoder({ label: 'kaleido frame' })
    if (needsClear) {
      for (const t of [read, write])
        encoder
          .beginRenderPass({
            colorAttachments: [
              {
                view: t.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          })
          .end()
      needsClear = false
    }
    const pass = (pipe: GPURenderPipeline, target: GPUTextureView, from: GPUTexture) => {
      const rp = encoder.beginRenderPass({
        colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store' }],
      })
      rp.setPipeline(pipe)
      rp.setBindGroup(0, group(from))
      rp.draw(3)
      rp.end()
    }
    pass(paint, write.createView(), read)
    ;[read, write] = [write, read]
    pass(show, context.getCurrentTexture().createView(), read)
    device.queue.submit([encoder.finish()])
  }

  return {
    frame,
    clear: () => {
      needsClear = true
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
