import types from './neon-types.wgsl?raw'
import floodCode from './neon-flood.wgsl?raw'
import showCode from './neon-show.wgsl?raw'
import { MAX_LETTERS, NEON, jfaSteps, packNeon, type NeonColour, type Style } from './neon'

export type NeonSign = {
  /** the field the text is drawn into, in texels */
  readonly field: readonly [number, number]
  /** the text, drawn as a mask (rgba, letter i in red `letterRed(i)`): seed it and flood */
  setMask(rgba: Uint8ClampedArray, style: Style): void
  draw(time: number, palette: NeonColour, bright: Float32Array, letters: number): void
  /** the canvas changed size; returns the new field, which wants a new mask */
  resize(): readonly [number, number]
  /** for the probe: the flood's answer */
  readonly nearest: GPUTexture
  destroy(): void
}

export async function createNeon(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<NeonSign> {
  const floodModule = device.createShaderModule({ label: 'neon flood', code: types + floodCode })
  const showModule = device.createShaderModule({ label: 'neon show', code: types + showCode })
  const [seed, flood, show] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'neon seed',
      layout: 'auto',
      compute: { module: floodModule, entryPoint: 'seed' },
    }),
    device.createComputePipelineAsync({
      label: 'neon flood',
      layout: 'auto',
      compute: { module: floodModule, entryPoint: 'flood' },
    }),
    device.createRenderPipelineAsync({
      label: 'neon show',
      layout: 'auto',
      vertex: { module: showModule, entryPoint: 'cover' },
      fragment: { module: showModule, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'neon',
    size: NEON.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const brightBuf = device.createBuffer({
    label: 'neon letters',
    size: MAX_LETTERS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(NEON.bytes)

  let field: [number, number] = [1, 1]
  let mask!: GPUTexture
  let pair!: [GPUTexture, GPUTexture]
  let style: Style = 'tube'

  function build() {
    mask?.destroy()
    pair?.forEach((t) => t.destroy())
    field = [Math.max(1, Math.ceil(canvas.width / 2)), Math.max(1, Math.ceil(canvas.height / 2))]
    mask = device.createTexture({
      label: 'neon mask',
      size: field,
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    const make = (label: string) =>
      device.createTexture({
        label,
        size: field,
        format: 'rgba32float',
        usage:
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      })
    pair = [make('neon flood a'), make('neon flood b')]
    return field
  }
  build()

  const uniformFor = (step: number, extra?: Partial<Parameters<typeof packNeon>[0]>) =>
    device.queue.writeBuffer(
      uniform,
      0,
      packNeon(
        {
          w: field[0],
          h: field[1],
          step,
          style,
          time: 0,
          scale: canvas.width / field[0],
          palette: 'pink',
          letters: 0,
          ...extra,
        },
        staging,
      ),
    )

  const pass = (pipe: GPUComputePipeline, from: GPUTexture, to: GPUTexture) => {
    const e = device.createCommandEncoder()
    const p = e.beginComputePass()
    p.setPipeline(pipe)
    p.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: from.createView() },
          { binding: 2, resource: to.createView() },
        ],
      }),
    )
    p.dispatchWorkgroups(Math.ceil(field[0] / 8), Math.ceil(field[1] / 8))
    p.end()
    device.queue.submit([e.finish()])
  }

  return {
    get field() {
      return field
    },
    get nearest() {
      return pair[0]
    },
    setMask(rgba, s) {
      style = s
      device.queue.writeTexture(
        { texture: mask },
        rgba as Uint8ClampedArray<ArrayBuffer>,
        { bytesPerRow: field[0] * 4 },
        field,
      )
      uniformFor(0)
      pass(seed, mask, pair[0])
      /* one submission per pass, each with its own step: the queue keeps them in order */
      for (const step of jfaSteps(field[0], field[1])) {
        uniformFor(step)
        pass(flood, pair[0], pair[1])
        pair = [pair[1], pair[0]]
      }
    },
    draw(time, palette, bright, letters) {
      uniformFor(0, { time, palette, letters })
      device.queue.writeBuffer(brightBuf, 0, bright as Float32Array<ArrayBuffer>)
      const e = device.createCommandEncoder({ label: 'neon show' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(
        0,
        device.createBindGroup({
          layout: show.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: pair[0].createView() },
            { binding: 2, resource: { buffer: brightBuf } },
          ],
        }),
      )
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    resize: build,
    destroy() {
      mask.destroy()
      pair.forEach((t) => t.destroy())
      uniform.destroy()
      brightBuf.destroy()
    },
  }
}
