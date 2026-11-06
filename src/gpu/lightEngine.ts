import types from './light-types.wgsl?raw'
import bakeCode from './light-bake.wgsl?raw'
import traceCode from './light-trace.wgsl?raw'
import showCode from './light-show.wgsl?raw'
import {
  LIGHT,
  MAX_SHAPES,
  SHAPE_FLOATS,
  blendFor,
  packLight,
  packShapes,
  type Shape,
} from './light'

export type LightRoom = {
  /** the room changed: bake it again, and start gathering light from nothing */
  set(shapes: readonly Shape[], moving: boolean): void
  /** gather `passes` frames of light (0 shows what there is) and show it */
  draw(passes: number, exposure: number): void
  /** frames gathered since the room last changed */
  readonly frame: number
  readonly textures: { field: GPUTexture; picture: () => GPUTexture }
  resize(): void
  destroy(): void
}

const RAYS = 16
const FORMAT: GPUTextureFormat = 'rgba16float'

export async function createLight(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<LightRoom> {
  const mod = (label: string, code: string) =>
    device.createShaderModule({ label, code: types + code })
  const [bake, trace, show] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'light bake',
      layout: 'auto',
      compute: { module: mod('light bake', bakeCode), entryPoint: 'bake' },
    }),
    device.createComputePipelineAsync({
      label: 'light trace',
      layout: 'auto',
      compute: { module: mod('light trace', traceCode), entryPoint: 'trace' },
    }),
    (() => {
      const m = mod('light show', showCode)
      return device.createRenderPipelineAsync({
        label: 'light show',
        layout: 'auto',
        vertex: { module: m, entryPoint: 'cover' },
        fragment: { module: m, entryPoint: 'show', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      })
    })(),
  ])
  const uniform = device.createBuffer({
    label: 'light',
    size: LIGHT.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const shapesBuf = device.createBuffer({
    label: 'light shapes',
    size: MAX_SHAPES * SHAPE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const lin = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })

  let size = [1, 1]
  let field!: GPUTexture
  let pics!: [GPUTexture, GPUTexture]
  let count = 0
  let frame = 0
  let moving = false
  let dirty = true
  const staging = new ArrayBuffer(LIGHT.bytes)

  function build() {
    field?.destroy()
    pics?.forEach((t) => t.destroy())
    size = [Math.max(1, Math.ceil(canvas.width / 2)), Math.max(1, Math.ceil(canvas.height / 2))]
    const make = (label: string) =>
      device.createTexture({
        label,
        size,
        format: FORMAT,
        usage:
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      })
    field = make('light field')
    pics = [make('light picture a'), make('light picture b')]
    frame = 0
    dirty = true
  }
  build()

  const uniformFor = (blend: number, exposure: number) =>
    device.queue.writeBuffer(
      uniform,
      0,
      packLight({ w: size[0], h: size[1], count, frame, rays: RAYS, exposure, blend }, staging),
    )

  return {
    get frame() {
      return frame
    },
    get textures() {
      return { field, picture: () => pics[0] }
    },
    set(shapes, m) {
      device.queue.writeBuffer(shapesBuf, 0, packShapes(shapes))
      count = Math.min(shapes.length, MAX_SHAPES)
      moving = m
      dirty = true
      /* a still room starts its average again; a moving one keeps a fading memory of the last */
      if (!m) frame = 0
    },
    draw(passes, exposure) {
      if (dirty) {
        uniformFor(1, exposure)
        const e = device.createCommandEncoder({ label: 'light bake' })
        const p = e.beginComputePass()
        p.setPipeline(bake)
        p.setBindGroup(
          0,
          device.createBindGroup({
            layout: bake.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: uniform } },
              { binding: 1, resource: { buffer: shapesBuf } },
              { binding: 2, resource: field.createView() },
            ],
          }),
        )
        p.dispatchWorkgroups(Math.ceil(size[0] / 8), Math.ceil(size[1] / 8))
        p.end()
        device.queue.submit([e.finish()])
        dirty = false
      }
      /* one submission per frame of light, each with its own blend: a queue keeps them in order */
      for (let i = 0; i < passes; i++) {
        uniformFor(blendFor(frame, moving), exposure)
        const e = device.createCommandEncoder({ label: 'light trace' })
        const p = e.beginComputePass()
        p.setPipeline(trace)
        p.setBindGroup(
          0,
          device.createBindGroup({
            layout: trace.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: uniform } },
              { binding: 1, resource: field.createView() },
              { binding: 2, resource: lin },
              { binding: 3, resource: pics[0].createView() },
              { binding: 4, resource: pics[1].createView() },
            ],
          }),
        )
        p.dispatchWorkgroups(Math.ceil(size[0] / 8), Math.ceil(size[1] / 8))
        p.end()
        device.queue.submit([e.finish()])
        pics = [pics[1], pics[0]]
        frame++
      }
      uniformFor(0, exposure)
      const e = device.createCommandEncoder({ label: 'light show' })
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
            { binding: 1, resource: field.createView() },
            { binding: 2, resource: lin },
            { binding: 3, resource: pics[0].createView() },
          ],
        }),
      )
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    resize: build,
    destroy() {
      field.destroy()
      pics.forEach((t) => t.destroy())
      uniform.destroy()
      shapesBuf.destroy()
    },
  }
}
