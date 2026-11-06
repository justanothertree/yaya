import code from './fold.wgsl?raw'
import {
  LAYER_VEC4S,
  MAX_CREASES,
  MAX_LAYERS,
  PAPER,
  packLayers,
  packPaper,
  type Sheet,
} from './fold'

export type PaperFrame = { colour: number; view: [number, number]; span: number }

export type FoldView = {
  sheet(s: Sheet): void
  /** the target's silhouette, drawn as a ghost under the paper; null for none */
  ghost(s: Sheet | null): void
  /** a picture, redrawn only when something changed since the last */
  frame(f: PaperFrame): void
  /** the folded paper as a square PNG */
  print(f: PaperFrame, size?: number): Promise<Blob | null>
  destroy(): void
}

export async function createFold(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<FoldView> {
  const module = device.createShaderModule({ label: 'fold', code })
  const pipe = (fmt: GPUTextureFormat) =>
    device.createRenderPipelineAsync({
      label: `fold ${fmt}`,
      layout: 'auto',
      vertex: { module, entryPoint: 'cover' },
      fragment: { module, entryPoint: 'show', targets: [{ format: fmt }] },
      primitive: { topology: 'triangle-list' },
    })
  const [pipeline, printPipeline] = await Promise.all([pipe(format), pipe('rgba8unorm')])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const uniform = device.createBuffer({
    label: 'fold paper',
    size: PAPER.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const layerBuf = device.createBuffer({
    label: 'fold layers',
    size: MAX_LAYERS * LAYER_VEC4S * 16,
    usage: S,
  })
  const ghostBuf = device.createBuffer({
    label: 'fold ghost',
    size: MAX_LAYERS * LAYER_VEC4S * 16,
    usage: S,
  })
  const creaseBuf = device.createBuffer({ label: 'fold creases', size: MAX_CREASES * 16, usage: S })
  const groupFor = (p: GPURenderPipeline) =>
    device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: [uniform, layerBuf, ghostBuf, creaseBuf].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    })
  const group = groupFor(pipeline)
  const printGroup = groupFor(printPipeline)
  const staging = new ArrayBuffer(PAPER.bytes)
  let layers = 0
  let creases = 0
  let ghosts = 0
  /** what was last drawn: nothing is redrawn until one of these changes */
  let version = 1
  let drawn = ''

  const draw = (
    view: GPUTextureView,
    p: GPURenderPipeline,
    g: GPUBindGroup,
    w: number,
    h: number,
    f: PaperFrame,
  ) => {
    device.queue.writeBuffer(
      uniform,
      0,
      packPaper(
        { w, h, layers, creases, ghost: ghosts, colour: f.colour, view: f.view, span: f.span },
        staging,
      ),
    )
    const e = device.createCommandEncoder({ label: 'fold' })
    const rp = e.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }],
    })
    rp.setPipeline(p)
    rp.setBindGroup(0, g)
    rp.draw(3)
    rp.end()
    device.queue.submit([e.finish()])
  }

  return {
    sheet(s) {
      layers = Math.min(s.layers.length, MAX_LAYERS)
      device.queue.writeBuffer(layerBuf, 0, packLayers(s))
      creases = Math.min(s.creases.length, MAX_CREASES)
      if (creases)
        device.queue.writeBuffer(
          creaseBuf,
          0,
          Float32Array.from(s.creases.slice(0, creases).flatMap(([a, b]) => [...a, ...b])),
        )
      version++
    },
    ghost(s) {
      ghosts = s ? Math.min(s.layers.length, MAX_LAYERS) : 0
      if (s) device.queue.writeBuffer(ghostBuf, 0, packLayers(s))
      version++
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const key = `${version}:${canvas.width}x${canvas.height}:${f.colour}:${f.view}:${f.span}`
      if (key === drawn) return
      drawn = key
      draw(
        context.getCurrentTexture().createView(),
        pipeline,
        group,
        canvas.width,
        canvas.height,
        f,
      )
    },
    async print(f, size = 1024) {
      const tex = device.createTexture({
        size: [size, size],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      })
      const out = device.createBuffer({
        size: size * size * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      try {
        draw(tex.createView(), printPipeline, printGroup, size, size, f)
        const e = device.createCommandEncoder()
        e.copyTextureToBuffer({ texture: tex }, { buffer: out, bytesPerRow: size * 4 }, [
          size,
          size,
        ])
        device.queue.submit([e.finish()])
        await out.mapAsync(GPUMapMode.READ)
        const px = new Uint8ClampedArray(out.getMappedRange().slice(0))
        out.unmap()
        const c = new OffscreenCanvas(size, size)
        c.getContext('2d')?.putImageData(new ImageData(px, size, size), 0, 0)
        // the screen's own picture is drawn again next frame: the shared uniform was changed
        version++
        return await c.convertToBlob({ type: 'image/png' })
      } catch {
        return null
      } finally {
        tex.destroy()
        out.destroy()
      }
    },
    destroy() {
      for (const b of [uniform, layerBuf, ghostBuf, creaseBuf]) b.destroy()
    },
  }
}
