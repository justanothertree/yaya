import code from './galaxy.wgsl?raw'
import { GALAXY, packGalaxy } from './galaxy'
import { dotPixels, dotSize, glowFor } from './swarm'

export type GalaxyInput = {
  count: number
  /** how fast the stars go round, 0..3; 0 holds it still */
  spin: number
  twist: number
  tilt: number
  turn: number
  /** the music's loudness, 0..1 */
  pulse: number
  /** 1 on a beat, falling away */
  kick: number
}

export type Galaxy = { frame(dt: number, input: GalaxyInput): void; destroy(): void }

export async function createGalaxy(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<Galaxy> {
  const module = device.createShaderModule({ label: 'galaxy', code })
  const pipe = await device.createRenderPipelineAsync({
    label: 'galaxy',
    layout: 'auto',
    vertex: { module, entryPoint: 'star' },
    fragment: {
      module,
      entryPoint: 'glow',
      targets: [
        {
          format,
          // additive, as the swarm: where stars crowd — the arms, the core — the light adds up
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
    label: 'galaxy params',
    size: GALAXY.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const group = device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  })
  const staging = new ArrayBuffer(GALAXY.bytes)
  let time = 0

  return {
    frame(dt, input) {
      if (canvas.width === 0 || canvas.height === 0) return
      time += dt * input.spin
      const px = dotPixels(window.devicePixelRatio || 1)
      device.queue.writeBuffer(
        uniform,
        0,
        packGalaxy(
          {
            aspect: canvas.width / canvas.height,
            time,
            twist: input.twist,
            tilt: input.tilt,
            turn: input.turn,
            size: dotSize(px, canvas.height),
            /* the galaxy gathers its stars into the middle of the screen rather than spreading
               them over all of it, so each must be dimmer than a swarm's — a quarter, judged by eye */
            glow: Math.min(1, glowFor(input.count, px, canvas.width * canvas.height) * 0.25),
            pulse: input.pulse,
            kick: input.kick,
            count: input.count,
          },
          staging,
        ),
      )
      const encoder = device.createCommandEncoder({ label: 'galaxy frame' })
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.01, g: 0.01, b: 0.03, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      rp.setPipeline(pipe)
      rp.setBindGroup(0, group)
      rp.draw(6 * input.count)
      rp.end()
      device.queue.submit([encoder.finish()])
    },
    destroy() {
      uniform.destroy()
    },
  }
}
