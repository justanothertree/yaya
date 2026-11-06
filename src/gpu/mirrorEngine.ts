import types from './mirror-types.wgsl?raw'
import brushCode from './mirror-brush.wgsl?raw'
import showCode from './mirror-show.wgsl?raw'
import { FRAMES, MAX_DABS, MIRROR, packDabs, packMirror, type Dab } from './mirror'

type Source = HTMLCanvasElement | OffscreenCanvas

export type MirrorView = {
  /** `source`, drawn at the history's size, becomes the newest frame (null keeps the ring still) */
  frame(f: { source: Source | null; dabs: readonly Dab[]; tint: boolean }): void
  /** a whole new delay map, the history's size */
  setDelay(d: Float32Array<ArrayBuffer>): void
  /** every layer of the past made the same picture, so a fresh start has no black in it */
  fill(source: Source): void
  /** a new shape of history (texels): the past and the delay map start again */
  resize(size: readonly [number, number]): void
  readonly head: number
  readonly delay: GPUBuffer
  readonly size: readonly [number, number]
  destroy(): void
}

export async function createMirror(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  size0: readonly [number, number],
): Promise<MirrorView> {
  const brushModule = device.createShaderModule({ label: 'mirror brush', code: types + brushCode })
  const showModule = device.createShaderModule({ label: 'mirror show', code: types + showCode })
  const [paint, show] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'mirror brush',
      layout: 'auto',
      compute: { module: brushModule, entryPoint: 'paint' },
    }),
    device.createRenderPipelineAsync({
      label: 'mirror show',
      layout: 'auto',
      vertex: { module: showModule, entryPoint: 'cover' },
      fragment: { module: showModule, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'mirror',
    size: MIRROR.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const dabBuf = device.createBuffer({
    label: 'mirror dabs',
    size: MAX_DABS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const lin = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const staging = new ArrayBuffer(MIRROR.bytes)

  let size: readonly [number, number] = size0
  let head = 0
  let past!: GPUTexture
  let delay!: GPUBuffer
  let brushGroup!: GPUBindGroup
  let showGroup!: GPUBindGroup
  function build() {
    past?.destroy()
    delay?.destroy()
    const [w, h] = size
    /* ⚠️ THE PAST IS A RING: one layer per frame, the newest written over the oldest */
    past = device.createTexture({
      label: 'mirror past',
      size: [w, h, FRAMES],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC,
    })
    delay = device.createBuffer({
      label: 'mirror delay',
      size: w * h * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    brushGroup = device.createBindGroup({
      layout: paint.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: delay } },
        { binding: 2, resource: { buffer: dabBuf } },
      ],
    })
    showGroup = device.createBindGroup({
      layout: show.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: past.createView({ dimension: '2d-array' }) },
        { binding: 2, resource: lin },
        { binding: 3, resource: { buffer: delay } },
      ],
    })
    head = 0
  }
  build()

  const into = (source: Source, layer: number) =>
    device.queue.copyExternalImageToTexture(
      { source },
      { texture: past, origin: { x: 0, y: 0, z: layer } },
      [size[0], size[1]],
    )

  return {
    get head() {
      return head
    },
    get delay() {
      return delay
    },
    get size() {
      return size
    },
    resize(next) {
      size = next
      build()
    },
    setDelay(d) {
      device.queue.writeBuffer(delay, 0, d)
    },
    fill(source) {
      for (let k = 0; k < FRAMES; k++) into(source, k)
    },
    frame({ source, dabs, tint }) {
      /* the newest frame goes over the oldest: nothing in the ring ever moves */
      if (source) {
        head = (head + 1) % FRAMES
        into(source, head)
      }
      const [w, h] = size
      const n = Math.min(dabs.length, MAX_DABS)
      device.queue.writeBuffer(uniform, 0, packMirror({ w, h, head, dabs: n, tint }, staging))
      const e = device.createCommandEncoder({ label: 'mirror' })
      if (n) {
        device.queue.writeBuffer(dabBuf, 0, packDabs(dabs))
        const p = e.beginComputePass()
        p.setPipeline(paint)
        p.setBindGroup(0, brushGroup)
        p.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
        p.end()
      }
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, showGroup)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      past.destroy()
      uniform.destroy()
      delay.destroy()
      dabBuf.destroy()
    },
  }
}
