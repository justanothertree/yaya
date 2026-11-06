import code from './strut.wgsl?raw'
import { MAX_BONES, MAX_JOINTS } from './critters'
import { MAX_SPLATS, PAINT, inkSize, packPaint } from './strut'
import type { V2 } from './critters'

export type StrutView = {
  frame(f: {
    cam: V2
    scale: number
    time: number
    /** this frame's blots, eight floats each */
    splats: readonly number[]
    /** per bone (a, b, squeeze 0..1, hue 0..1 or −1 for a plain bone) */
    bones: readonly number[]
    /** per joint (x, y) */
    joints: readonly number[]
  }): void
  /** a clean sheet of paper */
  clear(): void
  /** the whole painting as a PNG */
  print(): Promise<Blob | null>
  readonly paper: GPUTexture[]
  destroy(): void
}

export async function createStrut(
  device: GPUDevice,
  context: Pick<GPUCanvasContext, 'getCurrentTexture'>,
  format: GPUTextureFormat,
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
): Promise<StrutView> {
  const module = device.createShaderModule({ label: 'strut', code })
  const PAPER: GPUTextureFormat = 'rgba16float'
  const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
  const pipe = (
    vertex: string,
    fragment: string,
    target: GPUTextureFormat,
    blend?: GPUBlendState,
  ) =>
    device.createRenderPipelineAsync({
      label: fragment,
      layout: 'auto',
      vertex: { module, entryPoint: vertex },
      fragment: { module, entryPoint: fragment, targets: [{ format: target, blend }] },
      primitive: { topology: 'triangle-list' },
    })
  const [blot, bleed, show, develop, bone, joint] = await Promise.all([
    pipe('blot_vs', 'blot_fs', PAPER, { color: add, alpha: add }),
    pipe('cover', 'bleed', PAPER),
    pipe('cover', 'show', format),
    pipe('cover', 'develop', 'rgba8unorm'),
    pipe('bone_vs', 'bone_fs', format),
    pipe('joint_vs', 'joint_fs', format),
  ])
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const uniform = device.createBuffer({
    label: 'strut',
    size: PAINT.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const splatBuf = device.createBuffer({ label: 'strut splats', size: MAX_SPLATS * 32, usage: S })
  const boneBuf = device.createBuffer({ label: 'strut bones', size: MAX_BONES * 16, usage: S })
  const jointBuf = device.createBuffer({ label: 'strut joints', size: MAX_JOINTS * 16, usage: S })
  const lin = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const [iw, ih] = inkSize()
  const paper = [0, 1].map((k) =>
    device.createTexture({
      label: `strut paper ${k}`,
      size: [iw, ih],
      format: PAPER,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    }),
  )
  const g = (p: GPURenderPipeline, entries: [number, GPUBindingResource][]) =>
    device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: entries.map(([binding, resource]) => ({ binding, resource })),
    })
  const groups = {
    blot: g(blot, [
      [0, { buffer: uniform }],
      [1, { buffer: splatBuf }],
    ]),
    bleed: [0, 1].map((k) =>
      g(bleed, [
        [0, { buffer: uniform }],
        [2, paper[k].createView()],
      ]),
    ),
    show: [0, 1].map((k) =>
      g(show, [
        [0, { buffer: uniform }],
        [2, paper[k].createView()],
        [5, lin],
      ]),
    ),
    develop: [0, 1].map((k) =>
      g(develop, [
        [0, { buffer: uniform }],
        [2, paper[k].createView()],
        [5, lin],
      ]),
    ),
    bone: g(bone, [
      [0, { buffer: uniform }],
      [3, { buffer: boneBuf }],
      [4, { buffer: jointBuf }],
    ]),
    joint: g(joint, [
      [0, { buffer: uniform }],
      [4, { buffer: jointBuf }],
    ]),
  }
  let cur = 0
  let blank = true
  const staging = new ArrayBuffer(PAINT.bytes)
  const clearBoth = (e: GPUCommandEncoder) => {
    for (const t of paper)
      e.beginRenderPass({
        colorAttachments: [
          {
            view: t.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      }).end()
  }

  return {
    paper,
    clear() {
      blank = true
    },
    frame(f) {
      if (canvas.width === 0 || canvas.height === 0) return
      const n = Math.min(MAX_SPLATS, f.splats.length / 8)
      const nb = f.bones.length / 4
      const nj = f.joints.length / 2
      device.queue.writeBuffer(
        uniform,
        0,
        packPaint(
          {
            w: canvas.width,
            h: canvas.height,
            cam: f.cam,
            scale: f.scale,
            splats: n,
            bones: nb,
            joints: nj,
            time: f.time,
          },
          staging,
        ),
      )
      if (n) device.queue.writeBuffer(splatBuf, 0, Float32Array.from(f.splats.slice(0, n * 8)))
      if (nb) device.queue.writeBuffer(boneBuf, 0, Float32Array.from(f.bones))
      if (nj) {
        const j = new Float32Array(nj * 4)
        for (let i = 0; i < nj; i++) j.set([f.joints[i * 2], f.joints[i * 2 + 1], 0, 0], i * 4)
        device.queue.writeBuffer(jointBuf, 0, j)
      }
      const e = device.createCommandEncoder({ label: 'strut' })
      if (blank) {
        clearBoth(e)
        blank = false
      }
      if (n) {
        const bp = e.beginRenderPass({
          colorAttachments: [{ view: paper[cur].createView(), loadOp: 'load', storeOp: 'store' }],
        })
        bp.setPipeline(blot)
        bp.setBindGroup(0, groups.blot)
        bp.draw(n * 6)
        bp.end()
      }
      // the paper bleeds into the other texture, and that one is the paper now
      const lp = e.beginRenderPass({
        colorAttachments: [
          { view: paper[1 - cur].createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      lp.setPipeline(bleed)
      lp.setBindGroup(0, groups.bleed[cur])
      lp.draw(3)
      lp.end()
      cur = 1 - cur
      const rp = e.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      })
      rp.setPipeline(show)
      rp.setBindGroup(0, groups.show[cur])
      rp.draw(3)
      if (nb) {
        rp.setPipeline(bone)
        rp.setBindGroup(0, groups.bone)
        rp.draw(6, nb)
      }
      if (nj) {
        rp.setPipeline(joint)
        rp.setBindGroup(0, groups.joint)
        rp.draw(6, nj)
      }
      rp.end()
      device.queue.submit([e.finish()])
    },
    async print() {
      const tex = device.createTexture({
        size: [iw, ih],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      })
      const row = Math.ceil((iw * 4) / 256) * 256
      const out = device.createBuffer({
        size: row * ih,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const e = device.createCommandEncoder({ label: 'strut print' })
      const rp = e.beginRenderPass({
        colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store' }],
      })
      rp.setPipeline(develop)
      rp.setBindGroup(0, groups.develop[cur])
      rp.draw(3)
      rp.end()
      e.copyTextureToBuffer({ texture: tex }, { buffer: out, bytesPerRow: row }, [iw, ih])
      device.queue.submit([e.finish()])
      try {
        await out.mapAsync(GPUMapMode.READ)
        const src = new Uint8Array(out.getMappedRange())
        const px = new Uint8ClampedArray(iw * ih * 4)
        for (let y = 0; y < ih; y++) px.set(src.subarray(y * row, y * row + iw * 4), y * iw * 4)
        out.unmap()
        const c = new OffscreenCanvas(iw, ih)
        c.getContext('2d')?.putImageData(new ImageData(px, iw, ih), 0, 0)
        return await c.convertToBlob({ type: 'image/png' })
      } catch {
        return null
      } finally {
        out.destroy()
        tex.destroy()
      }
    },
    destroy() {
      for (const t of paper) t.destroy()
      for (const b of [uniform, splatBuf, boneBuf, jointBuf]) b.destroy()
    },
  }
}
