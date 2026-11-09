import code from './nonogram.wgsl?raw'
import { MAX_FLOATS, fitSized, type pack } from './nonogram'

export type NonogramView = {
  board(b: {
    packed: ReturnType<typeof pack>
    w: number
    h: number
    left: number
    top: number
    paper: number
  }): void
  frame(f: {
    time: number
    /** seconds since it was solved, or −1 */
    since: number
    cursor: [number, number] | null
    hint: { axis: 'row' | 'col'; index: number } | null
    maker: boolean
  }): void
  destroy(): void
}

/** the numbers 0 to 20 — the most a line of twenty can hold — one to a square cell */
const NUMBERS = 21

/** the numbers drawn by the browser's own font, at the size a cell is on screen, so they are
 *  neither blurred up nor shimmering down. ⚠️ Through a 2D canvas and writeTexture rather than
 *  copyExternalImageToTexture, which failed on the Lab's device in Jigsaw. */
function drawNumbers(px: number) {
  const c = document.createElement('canvas')
  c.width = NUMBERS * px
  c.height = px
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (let n = 0; n < NUMBERS; n++) {
    g.font = `600 ${Math.round(px * (n < 10 ? 0.62 : 0.56))}px system-ui, sans-serif`
    g.fillText(String(n), n * px + px / 2, px * 0.54)
  }
  return g.getImageData(0, 0, c.width, c.height)
}

export async function createNonogram(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<NonogramView> {
  const module = device.createShaderModule({ label: 'nonogram', code })
  const F = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'nonogram',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F, texture: {} },
      { binding: 3, visibility: F, sampler: {} },
    ],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'nonogram',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'cover' },
    fragment: { module, entryPoint: 'board', targets: [{ format }] },
  })
  const uniform = device.createBuffer({
    label: 'nonogram view',
    size: 96,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const data = device.createBuffer({
    label: 'nonogram board',
    size: MAX_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  let atlas: GPUTexture | null = null
  let atlasPx = 0
  let group: GPUBindGroup | null = null
  const numbersAt = (px: number) => {
    const size = Math.max(12, Math.min(128, Math.round(px)))
    if (size === atlasPx && group) return
    const img = drawNumbers(size)
    if (!img) return
    atlas?.destroy()
    atlas = device.createTexture({
      label: 'nonogram numbers',
      size: [img.width, img.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture({ texture: atlas }, img.data, { bytesPerRow: img.width * 4 }, [
      img.width,
      img.height,
    ])
    atlasPx = size
    group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: data } },
        { binding: 2, resource: atlas.createView() },
        { binding: 3, resource: sampler },
      ],
    })
  }

  let board = {
    w: 5,
    h: 5,
    left: 1,
    top: 1,
    paper: 0xffffff,
    offRows: 0,
    offCols: 0,
    offLines: 0,
    stride: 1,
  }
  const values = new Float32Array(24)
  return {
    board(b) {
      const { data: floats, offRows, offCols, offLines, stride } = b.packed
      board = {
        w: b.w,
        h: b.h,
        left: b.left,
        top: b.top,
        paper: b.paper,
        offRows,
        offCols,
        offLines,
        stride,
      }
      device.queue.writeBuffer(data, 0, floats.subarray(0, MAX_FLOATS))
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const fit = fitSized([canvas.width, canvas.height], board.w, board.h, board)
      numbersAt(fit.s)
      if (!group) return
      values.set([canvas.width, canvas.height, fit.ox, fit.oy], 0)
      values.set([fit.s, board.w, board.h, f.time], 4)
      values.set([board.left, board.top, f.since, f.maker ? 1 : 0], 8)
      values.set(
        [
          f.cursor?.[0] ?? -1,
          f.cursor?.[1] ?? -1,
          f.hint ? (f.hint.axis === 'row' ? 1 : 2) : 0,
          f.hint?.index ?? -1,
        ],
        12,
      )
      values.set([board.offRows, board.offCols, board.offLines, board.stride], 16)
      values.set([board.paper, NUMBERS, 0, 0], 20)
      device.queue.writeBuffer(uniform, 0, values)
      const e = device.createCommandEncoder({ label: 'nonogram' })
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(pipeline)
      rp.setBindGroup(0, group)
      rp.draw(3)
      rp.end()
      device.queue.submit([e.finish()])
    },
    destroy() {
      uniform.destroy()
      data.destroy()
      atlas?.destroy()
    },
  }
}
