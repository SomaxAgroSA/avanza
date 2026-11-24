import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Filter, Search } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { AppPopover } from '../AppPopover'
import { filterValues, foldText, isMultiFilter } from './filter-values'
import type { TableFilterDef } from './TableFilters'

/** A partir de quantas opções o painel ganha a busca (pessoas, projetos). */
const SEARCH_FROM = 8

/**
 * Painel de um filtro (ajuste 24/11/2026): as opções com a marca de escolhida, a busca quando são muitas e
 * "Limpar". Um só valor (fecha ao escolher, com "Todos" no topo) ou vários ao mesmo tempo — o mesmo painel no
 * funil da coluna e no filtro da barra, que mexem no mesmo valor.
 */
export function FilterOptionsPanel({ filter, value, onChange, close }: { filter: TableFilterDef; value: string | undefined; onChange: (value: string | undefined) => void; close: () => void }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const multiple = isMultiFilter(filter)
  const chosen = filterValues(value)
  const shown = search.trim() ? filter.options.filter((option) => foldText(option.label).includes(foldText(search.trim()))) : filter.options
  const pick = (option: string) => {
    if (!multiple) {
      onChange(option)
      close()
      return
    }
    const next = chosen.includes(option) ? chosen.filter((item) => item !== option) : [...chosen, option]
    onChange(next.length ? next.join(',') : undefined)
  }
  return (
    <div className="flex w-60 flex-col gap-1.5">
      <p className="px-1 text-xs font-semibold text-fg">{filter.label}</p>
      {filter.options.length >= SEARCH_FROM && (
        <label className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2 text-sm focus-within:border-primary focus-within:outline-2 focus-within:outline-ring">
          <Search className="size-3.5 shrink-0 text-subtle" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            className="w-full min-w-0 bg-transparent text-fg outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      )}
      <ul className="flex max-h-60 flex-col overflow-y-auto">
        {!multiple && !search.trim() && (
          <li>
            <Choice
              selected={chosen.length === 0}
              onSelect={() => {
                onChange(undefined)
                close()
              }}
            >
              {filter.allLabel ?? t('common.all')}
            </Choice>
          </li>
        )}
        {shown.map((option) => (
          <li key={option.value}>
            <Choice selected={chosen.includes(option.value)} onSelect={() => pick(option.value)}>
              {option.label}
            </Choice>
          </li>
        ))}
        {shown.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">{t('table.noOptions')}</li>}
      </ul>
      {multiple && (
        <div className="flex items-center justify-between border-t border-border px-1 pt-1.5 text-xs text-muted">
          <span>{chosen.length ? t('table.chosenCount', { count: chosen.length }) : (filter.allLabel ?? t('common.all'))}</span>
          <button type="button" disabled={chosen.length === 0} onClick={() => onChange(undefined)} className="rounded px-1 font-medium text-primary-text hover:underline disabled:opacity-40 disabled:hover:no-underline">
            {t('table.clearFilter')}
          </button>
        </div>
      )}
    </div>
  )
}

function Choice({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
    >
      <span aria-hidden className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded border', selected ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong')}>
        {selected && <Check className="size-3" />}
      </span>
      <span className="truncate">{children}</span>
    </button>
  )
}

/** Funil do cabeçalho: cheio (cor do botão principal) quando a coluna está filtrando. */
const funnelClass = (active: boolean) =>
  cn(
    'inline-flex size-6 shrink-0 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-ring',
    active ? 'bg-primary text-primary-fg' : 'text-subtle hover:bg-border hover:text-fg',
  )

/** Filtro da coluna (ajuste 24/11): o funil do cabeçalho abre as opções — o mesmo valor do filtro da barra. */
export function ColumnFilterButton({ filter, value, onChange }: { filter: TableFilterDef; value: string | undefined; onChange: (value: string | undefined) => void }) {
  const { t } = useTranslation()
  const active = filterValues(value).length > 0
  const name = t('table.filterColumn', { column: filter.label })
  return (
    <AppPopover
      label={name}
      align="end"
      trigger={
        <button type="button" aria-label={name} title={name} aria-pressed={active} className={funnelClass(active)}>
          <Filter className="size-3.5" aria-hidden />
        </button>
      }
    >
      {(close) => <FilterOptionsPanel filter={filter} value={value} onChange={onChange} close={close} />}
    </AppPopover>
  )
}

/**
 * Filtro da coluna do nome (ajuste 24/11): o funil abre "contém", que é a própria busca da tabela — o que se
 * escreve aqui aparece na busca da barra, e vice-versa.
 */
export function ColumnSearchButton({ label, value, onSearch }: { label: string; value: string; onSearch: (value: string) => void }) {
  const { t } = useTranslation()
  const active = value.trim() !== ''
  const name = t('table.filterColumn', { column: label })
  return (
    <AppPopover
      label={name}
      align="start"
      trigger={
        <button type="button" aria-label={name} title={name} aria-pressed={active} className={funnelClass(active)}>
          <Filter className="size-3.5" aria-hidden />
        </button>
      }
    >
      {(close) => <SearchPanel label={label} value={value} onSearch={onSearch} close={close} />}
    </AppPopover>
  )
}

function SearchPanel({ label, value, onSearch, close }: { label: string; value: string; onSearch: (value: string) => void; close: () => void }) {
  const { t } = useTranslation()
  const [text, setText] = useState(value)
  const apply = () => {
    onSearch(text.trim())
    close()
  }
  return (
    <form
      className="flex w-60 flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        apply()
      }}
    >
      <label className="flex flex-col gap-1.5 px-1 text-xs font-semibold text-fg">
        {t('table.contains', { column: label })}
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- o painel abre para escrever
          autoFocus
          type="search"
          value={text}
          maxLength={100}
          onChange={(event) => setText(event.target.value)}
          className="h-8 rounded-md border border-border bg-surface px-2 text-sm font-normal text-fg outline-none focus:border-primary focus:outline-2 focus:outline-ring [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <div className="flex items-center justify-between px-1 text-xs">
        <button
          type="button"
          disabled={value.trim() === '' && text === ''}
          onClick={() => {
            setText('')
            onSearch('')
            close()
          }}
          className="rounded px-1 font-medium text-primary-text hover:underline disabled:opacity-40 disabled:hover:no-underline"
        >
          {t('table.clearFilter')}
        </button>
        <button type="submit" className="rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-fg hover:bg-primary-hover">
          {t('table.applyFilter')}
        </button>
      </div>
    </form>
  )
}
