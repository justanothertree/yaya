import code from './voiceprint.wgsl?raw'
import {
  COLUMNS,
  COLUMN_SECONDS,
  FFT,
  PRINT,
  ROWS,
  packPrint,
  rowHz,
  type PrintFrame,
} from './voiceprint'

export type BrushDab = { column: number; row: number; strength: number; radius: number }

export type VoiceprintView = {
  /** the newest FFT samples of the microphone become column `head` */
  listen(samples: Float32Array<ArrayBuffer>, head: number, rate: number): void
  /** a whole new picture */
  load(print: Float32Array<ArrayBuffer>): void
  /** the whole picture as sound, made on the GPU: the samples, at `rate` */
  render(rate: number): Promise<Float32Array>
  frame(f: Omit<PrintFrame, 'dabs' | 'from'>, dabs: readonly BrushDab[]): void
  readonly print: GPUBuffer
  destroy(): void
}

/** brush dabs taken a frame */
export const MAX_DABS = 64

export async function createVoiceprint(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
): Promise<VoiceprintView> {
  const C = GPUShaderStage.COMPUTE
  const workLayout = device.createBindGroupLayout({
    label: 'voiceprint work',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'storage' } },
      { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: C, buffer: { type: 'storage' } },
      { binding: 6, visibility: C, buffer: { type: 'read-only-storage' } },
    ],
  })
  const showLayout = device.createBindGroupLayout({
    label: 'voiceprint show',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  })
  const module = device.createShaderModule({ label: 'voiceprint', code })
  const workPipes = device.createPipelineLayout({ bindGroupLayouts: [workLayout] })
  const compute = (entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: workPipes,
      compute: { module, entryPoint },
    })
  const [column, brush, play, show] = await Promise.all([
    compute('column'),
    compute('brush'),
    compute('play'),
    device.createRenderPipelineAsync({
      label: 'voiceprint show',
      layout: device.createPipelineLayout({ bindGroupLayouts: [showLayout] }),
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const buffer = (label: string, size: number, usage: number) =>
    device.createBuffer({ label, size, usage })
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const uniform = buffer(
    'voiceprint',
    PRINT.bytes,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  const print = buffer('voiceprint print', COLUMNS * ROWS * 4, S)
  const wave = buffer('voiceprint wave', FFT * 4, S)
  const dabBuf = buffer('voiceprint dabs', MAX_DABS * 16, S)
  const pitch = buffer('voiceprint pitch', ROWS * 4, S)
  /* the sound buffer is sized for the rate it is asked for; a placeholder until then */
  let sound = buffer('voiceprint sound', 4, S)
  const groupFor = (s: GPUBuffer) =>
    device.createBindGroup({
      layout: workLayout,
      entries: [
        ...[uniform, print, wave, dabBuf, s].map((b, binding) => ({
          binding,
          resource: { buffer: b },
        })),
        { binding: 6, resource: { buffer: pitch } },
      ],
    })
  let work = groupFor(sound)
  const showGroup = device.createBindGroup({
    layout: showLayout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 5, resource: { buffer: print } },
    ],
  })
  const staging = new ArrayBuffer(PRINT.bytes)
  let last: Omit<PrintFrame, 'dabs' | 'from'> = {
    w: 1,
    h: 1,
    head: 0,
    rate: 48000,
    playing: false,
    playhead: 0,
  }
  const write = (f: Omit<PrintFrame, 'dabs' | 'from'>, dabs = 0, from = 0) =>
    device.queue.writeBuffer(uniform, 0, packPrint({ ...f, dabs, from }, staging))

  return {
    print,
    load(p) {
      device.queue.writeBuffer(print, 0, p)
    },
    listen(samples, head, rate) {
      device.queue.writeBuffer(wave, 0, samples)
      write({ ...last, head, rate })
      const e = device.createCommandEncoder({ label: 'voiceprint listen' })
      const p = e.beginComputePass()
      p.setPipeline(column)
      p.setBindGroup(0, work)
      p.dispatchWorkgroups(1)
      p.end()
      device.queue.submit([e.finish()])
    },
    async render(rate) {
      const total = COLUMNS * Math.round(rate * COLUMN_SECONDS)
      if (sound.size !== total * 4) {
        sound.destroy()
        sound = buffer('voiceprint sound', total * 4, S)
        work = groupFor(sound)
      }
      write({ ...last, rate })
      device.queue.writeBuffer(
        pitch,
        0,
        Float32Array.from({ length: ROWS }, (_, r) => rowHz(r) / rate),
      )
      const back = buffer(
        'voiceprint sound back',
        total * 4,
        GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      )
      const e = device.createCommandEncoder({ label: 'voiceprint play' })
      const p = e.beginComputePass()
      p.setPipeline(play)
      p.setBindGroup(0, work)
      p.dispatchWorkgroups(Math.ceil(total / 64))
      p.end()
      e.copyBufferToBuffer(sound, 0, back, 0, total * 4)
      device.queue.submit([e.finish()])
      await back.mapAsync(GPUMapMode.READ)
      const out = new Float32Array(back.getMappedRange().slice(0))
      back.unmap()
      back.destroy()
      return out
    },
    frame(f, dabs) {
      last = f
      const n = Math.min(dabs.length, MAX_DABS)
      write(f, n)
      const e = device.createCommandEncoder({ label: 'voiceprint' })
      if (n) {
        device.queue.writeBuffer(
          dabBuf,
          0,
          new Float32Array(
            dabs.slice(0, n).flatMap((d) => [d.column, d.row, d.strength, d.radius]),
          ),
        )
        const p = e.beginComputePass()
        p.setPipeline(brush)
        p.setBindGroup(0, work)
        p.dispatchWorkgroups(Math.ceil(COLUMNS / 16), Math.ceil(ROWS / 16))
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
      for (const b of [uniform, print, wave, dabBuf, pitch, sound]) b.destroy()
    },
  }
}
