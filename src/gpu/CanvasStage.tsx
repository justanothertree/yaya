import { useEffect, useRef, type PointerEventHandler } from 'react'
import { stepSeconds } from './swarm'

/**
 * LabStage without the GPU: a 2D canvas sized to the same stage, a frame loop, and one teardown —
 * for the Lab's board and card games, which are drawn the way Snake is.
 *
 * ⚠️ A PEG BOARD OR A CARD TABLE GAINS NOTHING FROM WEBGPU AND LOSES EVERY MACHINE WITHOUT IT. A
 * GPU toy says "this browser does not offer WebGPU" and stops; these only need a canvas, so they
 * work in every browser the rest of the site works in.
 *
 * ⚠️ IT ALWAYS RUNS. A GPU toy pauses because it simulates for its own sake; a game is waiting on a
 * person, and a game that started paused under reduced motion would look broken. Each game draws
 * only what changed in a frame, which for a still board is nothing much.
 */
export type Running2d = {
  /** advance by `dt` seconds and draw; the canvas's width and height are its backing pixels */
  frame(dt: number): void
  destroy?(): void
}

type Props = {
  make: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => Running2d
  label: string
  className?: string
  onPointerDown?: PointerEventHandler<HTMLCanvasElement>
  onPointerMove?: PointerEventHandler<HTMLCanvasElement>
  onPointerUp?: PointerEventHandler<HTMLCanvasElement>
}

export function CanvasStage({
  make,
  label,
  className,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const makeRef = useRef(make)
  makeRef.current = make

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }
    fit()
    const game = makeRef.current(ctx, canvas)
    const observer = new ResizeObserver(() => {
      fit()
      game.frame(0)
    })
    observer.observe(canvas)
    let raf = 0
    let prev: number | null = null
    const tick = (now: number) => {
      game.frame(stepSeconds(prev, now))
      prev = now
      raf = requestAnimationFrame(tick)
    }
    game.frame(0)
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      game.destroy?.()
    }
  }, [])

  return (
    <div className={`lab-stage${className ? ` ${className}` : ''}`}>
      <canvas
        ref={canvasRef}
        className="lab-canvas"
        role="img"
        aria-label={label}
        onPointerDown={(e) => {
          onPointerDown?.(e)
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* a pointer the browser no longer tracks */
          }
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}
