import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { COLUMN_LABEL_MAX } from '@/domain/column-labels'
import { AppButton } from '../AppButton'
import { AppCheckbox } from '../AppCheckbox'
import { AppPopover } from '../AppPopover'
import { inputClasses } from '../input-styles'

export interface ColumnsMenuColumn {
  id: string
  /** Nome em uso (o da pessoa, o de todos ou o do sistema). */
  label: string
  /** Nome do sistema (traduzido): o que volta com o campo vazio. */
  builtIn: string
  visible: boolean
  /** Coluna que não pode ser ocultada (a primeira, que identifica a linha) ou a última à vista. */
  locked: boolean
}

export interface ColumnsMenuAction {
  key: string
  label: string
  checked: boolean
}

export interface ColumnsMenuProps {
  trigger: ReactNode
  /** "Colunas" ou "Colunas e ações". */
  label: string
  columns: ColumnsMenuColumn[]
  onToggleColumn: (id: string, visible: boolean) => void
  onRename: (id: string, value: string) => void
  canResetNames: boolean
  onResetNames: () => void
  /** Só para quem tem `platform.manage`: "Usar estes nomes para todos". */
  forAll?: { checked: boolean; onChange: (checked: boolean) => void } | undefined
  /** "Ações em cada linha" (vazio = a tabela não tem ações por linha). */
  actions: ColumnsMenuAction[]
  onToggleAction: (key: string, checked: boolean) => void
}

/**
 * Menu "Colunas" / "Colunas e ações" da DataTable (§44): cada coluna com a caixa de mostrar/ocultar e o
 * nome, que se edita ali mesmo (Enter ou sair do campo grava; vazio volta ao nome do sistema);
 * "Restaurar nomes"; e, quando a tabela tem ações por linha, quais ações cada linha mostra.
 */
export function ColumnsMenu({ trigger, label, columns, onToggleColumn, onRename, canResetNames, onResetNames, forAll, actions, onToggleAction }: ColumnsMenuProps) {
  const { t } = useTranslation()
  return (
    <AppPopover trigger={trigger} label={label} align="end" className="w-80 max-w-[calc(100vw-2rem)]">
      <p className="px-1 pb-1.5 text-xs font-medium text-subtle">{t('table.columns')}</p>
      <ul className="flex flex-col gap-1">
        {columns.map((column) => (
          <li key={column.id} className="flex items-center gap-2 px-1">
            <AppCheckbox
              checked={column.visible}
              disabled={column.locked}
              onCheckedChange={(checked) => onToggleColumn(column.id, checked)}
              aria-label={t('table.showColumn', { name: column.label })}
            />
            <ColumnNameInput value={column.label} placeholder={column.builtIn} label={t('table.columnName', { name: column.builtIn })} onCommit={(value) => onRename(column.id, value)} />
          </li>
        ))}
      </ul>
      <div className={cn('mt-2 flex flex-wrap items-center gap-2 border-t border-border px-1 pt-2', forAll ? 'justify-between' : 'justify-end')}>
        {forAll && <AppCheckbox checked={forAll.checked} onCheckedChange={forAll.onChange} label={t('table.namesForAll')} />}
        <AppButton variant="ghost" size="sm" leftIcon={<RotateCcw />} disabled={!canResetNames} onClick={onResetNames}>
          {t('table.resetNames')}
        </AppButton>
      </div>
      {actions.length > 0 && (
        <>
          <p className="mt-2 border-t border-border px-1 pb-1.5 pt-2 text-xs font-medium text-subtle">{t('table.rowActions')}</p>
          <div className="flex flex-col gap-1.5 px-1 pb-1">
            {actions.map((action) => (
              <AppCheckbox key={action.key} checked={action.checked} onCheckedChange={(checked) => onToggleAction(action.key, checked)} label={action.label} />
            ))}
          </div>
        </>
      )}
    </AppPopover>
  )
}

/** Nome da coluna: grava com Enter, ao sair do campo ou ao fechar o menu; Esc desfaz o que foi digitado. */
function ColumnNameInput({ value, placeholder, label, onCommit }: { value: string; placeholder: string; label: string; onCommit: (value: string) => void }) {
  // null = sem edição em curso (o campo mostra o nome em uso, que pode mudar por fora: restaurar, nomes para todos)
  const [draft, setDraft] = useState<string | null>(null)
  const latest = useRef({ draft, value, onCommit })
  useEffect(() => {
    latest.current = { draft, value, onCommit }
  })
  // menu fechado com o campo ainda em edição: grava o que estava digitado
  useEffect(
    () => () => {
      const last = latest.current
      if (last.draft !== null && last.draft !== last.value) last.onCommit(last.draft)
    },
    [],
  )
  // lê o último texto (não o da renderização): Esc seguido do blur ao fechar o menu não grava nada
  const finish = (save: boolean) => {
    const current = latest.current
    latest.current = { ...current, draft: null }
    setDraft(null)
    if (save && current.draft !== null && current.draft !== current.value) current.onCommit(current.draft)
  }
  return (
    <input
      type="text"
      value={draft ?? value}
      placeholder={placeholder}
      maxLength={COLUMN_LABEL_MAX}
      aria-label={label}
      onChange={(event) => {
        latest.current = { ...latest.current, draft: event.target.value }
        setDraft(event.target.value)
      }}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') finish(false)
      }}
      className={cn(inputClasses, 'h-8 px-2')}
    />
  )
}
