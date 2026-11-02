import { cn } from '@/core/utils/cn'

/** Barra de avanço (0–100) com o texto ao lado para quem não enxerga a cor. */
export function ProgressBar({ value, label, tone = 'primary', className }: { value: number; label?: string; tone?: 'primary' | 'warning'; className?: string }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
        <div className={cn('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', tone === 'warning' ? 'bg-warning' : 'bg-primary')} style={{ width: `${percent}%` }} />
      </div>
      {label && <span className="shrink-0 text-xs tabular-nums text-muted">{label}</span>}
    </div>
  )
}
