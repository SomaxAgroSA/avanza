import { cn } from '@/core/utils/cn'
import { useCountUp } from './use-count-up'

export interface AppAnimatedNumberProps {
  value: number
  /** Texto do número (padrão: inteiro). Recebe os valores intermediários da contagem. */
  format?: (value: number) => string
  /** Duração da contagem em ms. */
  duration?: number
  className?: string
}

/** Número de destaque que conta até o valor (algarismos tabulares para não "dançar" durante a contagem). */
export function AppAnimatedNumber({ value, format = (n) => String(Math.round(n)), duration, className }: AppAnimatedNumberProps) {
  const display = useCountUp(value, duration)
  return <span className={cn('tabular-nums', className)}>{format(display)}</span>
}
