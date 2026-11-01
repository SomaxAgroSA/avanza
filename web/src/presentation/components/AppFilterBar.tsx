import type { ReactNode } from 'react'
import { FilterX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppButton } from './AppButton'

export interface AppFilterBarProps {
  search?: ReactNode
  filters?: ReactNode
  actions?: ReactNode
  /** Linha de baixo (ex.: fichas dos filtros ativos); some quando vazia. */
  below?: ReactNode
  hasActiveFilters?: boolean
  onReset?: () => void
}

/**
 * Barra padrão de uma listagem numa linha só: busca e filtros à esquerda, ações (colunas e a ação
 * principal) à direita. Em telas estreitas a linha quebra, com as ações sempre juntas.
 */
export function AppFilterBar({ search, filters, actions, below, hasActiveFilters, onReset }: AppFilterBarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {search && <div className="w-full sm:w-64">{search}</div>}
        {filters}
        {hasActiveFilters && onReset && (
          <AppButton variant="ghost" leftIcon={<FilterX />} onClick={onReset}>
            {t('table.clearFilters')}
          </AppButton>
        )}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {below}
    </div>
  )
}
