import { useEffect, useRef } from 'react'

type Rgb = [number, number, number]

/** Cor de um token CSS em RGB: desenha um pixel com ela (vale para oklch, color-mix…) e lê de volta. */
function tokenRgb(name: string, scope: Element): Rgb | null {
  const value = getComputedStyle(scope).getPropertyValue(name).trim()
  const probe = document.createElement('canvas')
  probe.width = probe.height = 1
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  if (!value || !ctx) return null
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

const mix = (a: Rgb, b: Rgb, t: number) => `rgb(${a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * t)).join(',')})`

/**
 * "Campo que responde" (Modelo G de assets/novo_login/referencia-montaje.html): uma plantação de brotos
 * que cresce e ganha folhas onde o cursor passa — sem cursor, um "vento" passeia sozinho pelo campo. Vai do
 * verde da marca ao lima e some à esquerda, onde fica o texto. Decorativo (fora da leitura de tela); com
 * "reduzir movimento" fica parado e só redesenha quando o cursor mexe.
 */
export function GrowingField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const box = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !box || !ctx) return
    const leaf = tokenRgb('--kb-brand-accent', box)
    const stem = tokenRgb('--kb-brand-primary', box)
    if (!stem || !leaf) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const started = performance.now()
    let width = 0
    let height = 0
    let pointer: [number, number] | null = null
    let frame = 0
    let stopped = false

    const size = () => {
      const rect = box.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      width = rect.width
      height = rect.height
      canvas.width = width * ratio
      canvas.height = height * ratio
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const draw = (now: number) => {
      if (stopped) return
      const t = (now - started) / 1000
      ctx.clearRect(0, 0, width, height)
      const step = width / 30
      const reach = width * 0.22
      const [px, py] = pointer ?? [width * (0.72 + 0.18 * Math.sin(t * 0.6)), height * (0.55 + 0.25 * Math.sin(t * 0.9))]
      ctx.lineCap = 'round'
      ctx.lineWidth = step * 0.17
      for (let y = height * 0.14; y < height * 0.97; y += step) {
        for (let x = step * 0.5; x < width; x += step) {
          const k = Math.max(0, 1 - Math.hypot(x - px, y - py) / reach) ** 2
          const fade = Math.min(1, Math.max(0.12, (x / width - 0.3) / 0.3))
          const length = step * 0.16 + k * step * 1.5
          const sway = Math.sin(t * 2 + y * 0.05) * k * step * 0.25
          ctx.globalAlpha = fade * (0.35 + 0.65 * k)
          ctx.strokeStyle = mix(stem, leaf, k)
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.quadraticCurveTo(x, y - length * 0.6, x + sway, y - length)
          ctx.stroke()
          if (k > 0.45) {
            ctx.fillStyle = mix(leaf, leaf, 0)
            ctx.beginPath()
            ctx.ellipse(x + sway + step * 0.12, y - length, step * 0.17 * k, step * 0.08 * k, -0.6, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      ctx.globalAlpha = 1
      if (!reduced) frame = requestAnimationFrame(draw)
    }

    const redraw = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(draw)
    }
    const move = (event: PointerEvent) => {
      const rect = box.getBoundingClientRect()
      pointer = [event.clientX - rect.left, event.clientY - rect.top]
      if (reduced) redraw()
    }
    const leave = () => {
      pointer = null
      if (reduced) redraw()
    }

    size()
    const observer = new ResizeObserver(() => {
      size()
      if (reduced) redraw()
    })
    observer.observe(box)
    box.addEventListener('pointermove', move)
    box.addEventListener('pointerleave', leave)
    frame = requestAnimationFrame(draw)

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      box.removeEventListener('pointermove', move)
      box.removeEventListener('pointerleave', leave)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
}
