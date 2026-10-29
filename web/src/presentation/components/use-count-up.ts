import { useEffect, useRef, useState } from 'react'
import { motionAllowed } from '@/presentation/common/motion'

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

/**
 * Número que "conta" até o alvo: de 0 na 1ª vez e do valor anterior quando o alvo muda (ex.: troca de
 * filtro). Sem animação com "reduzir movimento" e na impressão (`beforeprint` termina a contagem).
 */
export function useCountUp(target: number, duration = 700): number {
  const animate = motionAllowed()
  const [display, setDisplay] = useState(animate ? 0 : target)
  const current = useRef(display)

  useEffect(() => {
    if (!motionAllowed()) {
      current.current = target
      const id = requestAnimationFrame(() => setDisplay(target))
      return () => cancelAnimationFrame(id)
    }
    const origin = current.current
    const startedAt = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      current.current = origin + (target - origin) * easeOutCubic(progress)
      setDisplay(current.current)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const finish = () => {
      cancelAnimationFrame(frame)
      current.current = target
      setDisplay(target)
    }
    window.addEventListener('beforeprint', finish)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('beforeprint', finish)
    }
  }, [target, duration])

  return animate ? display : target
}
