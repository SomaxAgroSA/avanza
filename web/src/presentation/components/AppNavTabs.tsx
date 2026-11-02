import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/core/utils/cn'

export interface AppNavTabItem {
  key: string
  to: string
  label: ReactNode
  icon?: ReactNode
  /** Seção aberta agora (quem chama decide: caminho, `?view=`…). */
  active: boolean
}

export interface AppNavTabsProps {
  items: AppNavTabItem[]
  /** Nome acessível da navegação (ex.: o nome do projeto, "Visões do quadro"). */
  'aria-label': string
  /**
   * `line`: abas sublinhadas (seções de uma página, como as do AppTabs);
   * `pill`: visões lado a lado num trilho (sub-navegação dentro de uma aba).
   */
  variant?: 'line' | 'pill'
  /** Troca a entrada do histórico em vez de empilhar (visões da mesma tela). */
  replace?: boolean
  className?: string
}

/**
 * Abas que são endereços (cada uma com a sua rota): links com `aria-current="page"` — recarregar ou
 * compartilhar o link abre a mesma aba. Para abas só da tela (sem rota), use o AppTabs.
 */
export function AppNavTabs({ items, variant = 'line', replace, className, ...rest }: AppNavTabsProps) {
  const line = variant === 'line'
  return (
    <nav aria-label={rest['aria-label']} className={cn(line ? 'border-b border-border' : '-mx-1 px-1', 'overflow-x-auto', className)}>
      <ul className={cn('flex w-max gap-1', !line && 'rounded-xl border border-border bg-surface-2 p-1')}>
        {items.map((item) => (
          <li key={item.key} className="flex">
            <Link
              to={item.to}
              replace={replace}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors [&_svg]:size-4',
                'focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none',
                line
                  ? cn('-mb-px border-b-2 px-3 py-2', item.active ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg')
                  : cn('rounded-lg px-3 py-1.5', item.active ? 'bg-surface text-fg shadow-xs' : 'text-muted hover:bg-surface-3 hover:text-fg'),
              )}
            >
              {item.icon && (
                <span aria-hidden className="flex">
                  {item.icon}
                </span>
              )}
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
