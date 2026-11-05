import code from './music.wgsl?raw'
import { BANDS, MUSIC, WAVE, packMusic } from './music'

export type MusicInput = {
  /** BANDS band levels (0..1) followed by WAVE waveform samples (-1..1) */
  data: Float32Array
  /** overall loudness, 0..1 */
  level: number
  mode: 0 | 1
  /** radians a second the trail turns */
  spin: number
  /** how fast the trail grows outward, per second; 0 holds it still */
  zoom: number
}

export type MusicVis = {
  frame(dt: number, input: MusicInput): void
  resize(): void
  destroy(): void
}

const FORMAT: GPUTextureFormat = 'rgba16float'
/** what fraction of the trail is left after one second */
const TRAIL_PER_SECOND = 0.04

export async function createMusicVis(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<MusicVis> {
  const module = device.createShaderModule({ label: 'music', code })
  /* one explicit layout for both passes — `show` reads neither the uniform nor the data, and an
     auto layout would leave them out (see the same note in fluidEngine.ts) */
  const groupLayout = device.createBindGroupLayout({
    label: 'music',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
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
  const [trail, show] = await Promise.all([pipeline('trail', FORMAT), pipeline('show', format)])

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  const uniform = device.createBuffer({
    label: 'music params',
    size: MUSIC.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const data = device.createBuffer({
    label: 'music data',
    size: (BANDS + WAVE) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const staging = new ArrayBuffer(MUSIC.bytes)

  /* the trail is drawn from itself, so it is two textures taking turns */
  let read: GPUTexture | null = null
  let write: GPUTexture | null = null
  function build() {
    read?.destroy()
    write?.destroy()
    const make = (label: string) =>
      device.createTexture({
        label,
        size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
        format: FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
    read = make('trail a')
    write = make('trail b')
  }
  build()
  let time = 0

  const group = (from: GPUTexture) =>
    device.createBindGroup({
      layout: groupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: from.createView() },
        { binding: 3, resource: { buffer: data } },
      ],
    })

  function frame(dt: number, input: MusicInput) {
    if (!read || !write || canvas.width === 0 || canvas.height === 0) return
    time += dt
    device.queue.writeBuffer(
      uniform,
      0,
      packMusic(
        {
          aspect: canvas.width / canvas.height,
          spin: input.spin * dt,
          zoom: 1 + input.zoom * dt,
          decay: TRAIL_PER_SECOND ** dt,
          time,
          level: input.level,
          mode: input.mode,
          bands: BANDS,
          wave: WAVE,
        },
        staging,
      ),
    )
    device.queue.writeBuffer(data, 0, input.data as Float32Array<ArrayBuffer>)

    const encoder = device.createCommandEncoder({ label: 'music frame' })
    const draw = (pipe: GPURenderPipeline, target: GPUTextureView, from: GPUTexture) => {
      const rp = encoder.beginRenderPass({
        colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store' }],
      })
      rp.setPipeline(pipe)
      rp.setBindGroup(0, group(from))
      rp.draw(3)
      rp.end()
    }
    draw(trail, write.createView(), read)
    ;[read, write] = [write, read]
    draw(show, context.getCurrentTexture().createView(), read)
    device.queue.submit([encoder.finish()])
  }

  return {
    frame,
    resize: build,
    destroy() {
      read?.destroy()
      write?.destroy()
      uniform.destroy()
      data.destroy()
      read = write = null
    },
  }
}
