import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { AppButton } from './AppButton'
import { AppToolbar } from './AppToolbar'

export interface AppFilterBarProps {
  search?: ReactNode
  filters?: ReactNode
  actions?: ReactNode
  hasActiveFilters?: boolean
  /**
   * Quantos filtros estão ativos: o botão vira "Limpar (3)" e, sem filtro, fica no lugar escondido (a
   * barra não pula). Sem ele, "Limpar filtros" só aparece com filtro ativo.
   */
  activeFilterCount?: number
  onReset?: () => void
}

/**
 * Barra padrão de uma listagem numa linha só: busca e filtros à esquerda; "Limpar" e as ações (colunas e
 * a ação principal) juntos à direita, todos com a mesma altura. Nunca quebra nem troca as coisas de lugar
 * (AppToolbar): a busca encolhe primeiro, os grupos de botões viram seletores e as ações ficam só com o
 * ícone; no celular a linha rola.
 */
export function AppFilterBar({ search, filters, actions, hasActiveFilters, activeFilterCount, onReset }: AppFilterBarProps) {
  const { t } = useTranslation()
  const active = !!hasActiveFilters
  const counted = activeFilterCount !== undefined
  const showReset = !!onReset && (active || counted)
  return (
    // os filtros em botões levam o nome ao lado, na mesma linha (§37); a busca é a primeira a ceder espaço
    <AppToolbar>
      {search && <div className="min-w-[110px] max-w-64 flex-[1_1_150px]">{search}</div>}
      {filters}
      {(showReset || actions) && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {showReset && (
            <AppButton
              variant="ghost"
              leftIcon={<X />}
              onClick={onReset}
              // sem filtro ativo: guarda o lugar, mas fica fora da leitura de tela e do teclado
              aria-hidden={active ? undefined : true}
              tabIndex={active ? undefined : -1}
              aria-label={counted && active ? t('table.clearCountLabel', { count: activeFilterCount }) : undefined}
              title={active ? (counted ? t('table.clearCountLabel', { count: activeFilterCount }) : t('table.clearFilters')) : undefined}
              className={cn('px-2.5 font-semibold text-primary-text hover:bg-primary-soft hover:text-primary-text', !active && 'invisible')}
            >
              <span className="@max-[960px]:hidden">{counted ? t('table.clearCount', { count: activeFilterCount }) : t('table.clearFilters')}</span>
              {counted && (
                <span aria-hidden className="hidden tabular-nums @max-[960px]:inline">
                  {activeFilterCount}
                </span>
              )}
            </AppButton>
          )}
          {actions}
        </div>
      )}
    </AppToolbar>
  )
}
