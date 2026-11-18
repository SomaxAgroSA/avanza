import { cn } from '@/core/utils/cn'

/**
 * Barra de duas partes das tarefas de um projeto (§41): verde = executadas, cinza = faltam; os números ficam
 * dentro de cada parte. Parte sem tarefas não é desenhada.
 */
export function TaskBar({ done, open, size = 'sm' }: { done: number; open: number; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('flex gap-0.5 font-bold tabular-nums', size === 'sm' ? 'h-[15px] text-[10.5px]' : 'h-5 text-[11px]')}>
      {done > 0 && (
        <b className="flex min-w-6 items-center rounded-l bg-primary px-1.5 text-primary-fg" style={{ flex: done }}>
          {done}
        </b>
      )}
      {open > 0 && (
        <i className={cn('flex min-w-6 items-center justify-end bg-border-strong px-1.5 not-italic text-fg', done > 0 ? 'rounded-r' : 'rounded')} style={{ flex: open }}>
          {open}
        </i>
      )}
    </div>
  )
}
