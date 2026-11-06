import types from './fractal-types.wgsl?raw'
import iterateCode from './fractal-iterate.wgsl?raw'
import colourCode from './fractal-colour.wgsl?raw'
import {
  FRACTAL,
  MAX_ITER,
  itersFor,
  packFractal,
  referenceOrbit,
  type FractalPalette,
  type View,
} from './fractal'

export type FractalInput = {
  view: View
  /** null for the Mandelbrot set, or the Julia set's c */
  julia: readonly [number, number] | null
  palette: FractalPalette
  time: number
  cycle: number
  /** the view is on the move: work out a quarter of the pixels, and all of them once it stops */
  moving: boolean
}

export type FractalView = {
  frame(input: FractalInput): void
  /** how many times the expensive half has run, for the probes */
  readonly computed: number
  readonly counts: GPUBuffer | null
  destroy(): void
}

export async function createFractal(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<FractalView> {
  const iterateModule = device.createShaderModule({
    label: 'fractal iterate',
    code: types + iterateCode,
  })
  const colourModule = device.createShaderModule({
    label: 'fractal colour',
    code: types + colourCode,
  })
  const [iterate, colour] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'fractal iterate',
      layout: 'auto',
      compute: { module: iterateModule, entryPoint: 'iterate' },
    }),
    device.createRenderPipelineAsync({
      label: 'fractal colour',
      layout: 'auto',
      vertex: { module: colourModule, entryPoint: 'cover' },
      fragment: { module: colourModule, entryPoint: 'colour', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ])
  const uniform = device.createBuffer({
    label: 'fractal',
    size: FRACTAL.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const orbit = device.createBuffer({
    label: 'fractal orbit',
    size: (MAX_ITER + 1) * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  let counts: GPUBuffer | null = null
  let iterateGroup: GPUBindGroup | null = null
  let colourGroup: GPUBindGroup | null = null
  let size = [0, 0]
  /** what the counts were last worked out for: the expensive half runs only when this changes */
  let last = ''
  let lastBlock = 1
  let computed = 0
  const staging = new ArrayBuffer(FRACTAL.bytes)

  function fit() {
    if (size[0] === canvas.width && size[1] === canvas.height && counts) return
    size = [Math.max(1, canvas.width), Math.max(1, canvas.height)]
    counts?.destroy()
    counts = device.createBuffer({
      label: 'fractal counts',
      size: size[0] * size[1] * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    iterateGroup = device.createBindGroup({
      layout: iterate.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: orbit } },
        { binding: 2, resource: { buffer: counts } },
      ],
    })
    colourGroup = device.createBindGroup({
      layout: colour.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: counts } },
      ],
    })
    last = ''
  }

  return {
    get computed() {
      return computed
    },
    get counts() {
      return counts
    },
    frame(input) {
      fit()
      const [w, h] = size
      /* the view is held in the canvas's own pixels, so its scale goes to the shader as it is */
      const v = input.view
      const maxIter = itersFor(v, w)
      const block = input.moving ? 2 : 1
      const key = `${v.cx},${v.cy},${v.scale},${w},${h},${input.julia?.join(',') ?? ''}`
      /* the same view again needs nothing — unless it was last worked out roughly, while moving,
         and has now come to rest */
      const fresh = key !== last || (block === 1 && lastBlock === 2)
      let refLen = 0
      if (fresh) {
        const ref = referenceOrbit(v, maxIter, input.julia)
        refLen = ref.length / 2
        device.queue.writeBuffer(orbit, 0, ref as Float32Array<ArrayBuffer>)
      }
      device.queue.writeBuffer(
        uniform,
        0,
        packFractal(
          {
            w,
            h,
            scale: v.scale,
            maxIter,
            refLen: fresh ? refLen : 0,
            julia: !!input.julia,
            time: input.time,
            palette: input.palette,
            cycle: input.cycle,
            block,
          },
          staging,
        ),
      )
      const encoder = device.createCommandEncoder({ label: 'fractal' })
      if (fresh) {
        const pass = encoder.beginComputePass()
        pass.setPipeline(iterate)
        pass.setBindGroup(0, iterateGroup!)
        pass.dispatchWorkgroups(Math.ceil(w / block / 8), Math.ceil(h / block / 8))
        pass.end()
        last = key
        lastBlock = block
        computed++
      }
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(colour)
      rp.setBindGroup(0, colourGroup!)
      rp.draw(3)
      rp.end()
      device.queue.submit([encoder.finish()])
    },
    destroy() {
      counts?.destroy()
      orbit.destroy()
      uniform.destroy()
    },
  }
}
