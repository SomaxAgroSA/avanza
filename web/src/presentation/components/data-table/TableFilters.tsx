import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { AppPopover } from '../AppPopover'
import { AppSelect, SELECT_ALL } from '../AppSelect'
import { FilterOptionsPanel } from './ColumnFilter'
import { filterValues } from './filter-values'
import { filterTriggerClass } from './filter-styles'

export interface TableFilterDef {
  id: string
  label: string
  options: Array<{ value: string; label: string }>
  /** Fica colado ao filtro (ex.: engrenagem do configurador do filtro de projetos). */
  addon?: ReactNode
  /**
   * `buttons`: um botão por valor, vários ao mesmo tempo (§37). `menu`: um menu com vários ao mesmo tempo e
   * busca (pessoas; ajuste 24/11). Padrão: seletor de um valor.
   */
  variant?: 'select' | 'buttons' | 'menu'
  /** O que vale sem nada escolhido (ex.: "Abertas"): parado mostra "Status: Abertas" e é o rótulo da opção sem filtro. */
  allLabel?: string
  /** `column`: só no funil da coluna, fora da barra (ex.: Projeto, Prazo). Padrão: na barra e na coluna. */
  placement?: 'both' | 'column'
  /** Posição entre os filtros da barra (menor primeiro); sem ela, a ordem das colunas. */
  barOrder?: number
}

interface FilterProps {
  filter: TableFilterDef
  value: string | undefined
  onChange: (value: string | undefined) => void
}

const optionLabel = (filter: TableFilterDef, value: string | undefined) => filter.options.find((o) => o.value === value)?.label

/**
 * Filtro da barra: parado mostra só o nome ("Status"; com `allLabel`, "Status: Abertas"); ativo mostra "Status: Alta" em verde suave,
 * para dar para ver de longe o que está filtrando a lista.
 */
export function FilterSelect({ filter, value, onChange }: FilterProps) {
  const { t } = useTranslation()
  const active = value !== undefined && value !== ''
  const selected = optionLabel(filter, value)
  const select = (
    <AppSelect
      aria-label={filter.label}
      value={active ? value : SELECT_ALL}
      onValueChange={(next) => onChange(next === SELECT_ALL ? undefined : next)}
      options={[{ value: SELECT_ALL, label: filter.allLabel ?? t('common.all') }, ...filter.options]}
      renderValue={
        active ? (
          <>
            {filter.label}: <strong className="font-semibold">{selected ?? value}</strong>
          </>
        ) : filter.allLabel ? (
          <>
            {filter.label}: {filter.allLabel}
          </>
        ) : (
          filter.label
        )
      }
      className="w-auto min-w-[8.25rem]"
      triggerClassName={filterTriggerClass(active)}
    />
  )
  if (!filter.addon) return select
  return (
    <div className="flex items-center gap-2">
      {select}
      {filter.addon}
    </div>
  )
}

/**
 * Filtro em menu (ajuste 24/11): vários valores ao mesmo tempo, com busca quando são muitos — para pessoas
 * (Responsável, Atribuída a). Parado mostra o nome; ativo, "Responsável: Ana +1" em verde suave, como o seletor.
 * Sem `variant: 'menu'`, o mesmo botão com um valor só (o painel fecha ao escolher). `className` vai no botão
 * (ex.: etapas de compactação de uma barra que mede a si mesma).
 */
export function FilterMenu({ filter, value, onChange, className }: FilterProps & { className?: string }) {
  const chosen = filterValues(value)
  const active = chosen.length > 0
  const first = active ? (optionLabel(filter, chosen[0]) ?? chosen[0]) : null
  return (
    <AppPopover
      label={filter.label}
      trigger={
        <button
          type="button"
          aria-label={filter.label}
          // numa barra apertada o texto corta com "…": a dica mostra o nome e tudo o que está escolhido
          title={active ? `${filter.label}: ${chosen.map((item) => optionLabel(filter, item) ?? item).join(', ')}` : filter.label}
          // o tamanho do seletor ao lado (nunca abaixo de ~132px, nem mais largo que 240px) e as mesmas cores
          className={cn(
            'inline-flex h-9 min-w-[8.25rem] max-w-60 shrink-0 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium shadow-xs transition-colors duration-150',
            'hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring',
            active ? 'border-primary-border bg-primary-soft text-primary-soft-fg hover:border-primary' : 'text-fg',
            className,
          )}
        >
          <span className="truncate">
            {active ? (
              <>
                {filter.label}: <strong className="font-semibold">{first}</strong>
                {chosen.length > 1 && ` +${chosen.length - 1}`}
              </>
            ) : (
              filter.label
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 text-subtle" aria-hidden />
        </button>
      }
    >
      {(close) => <FilterOptionsPanel filter={filter} value={value} onChange={onChange} close={close} />}
    </AppPopover>
  )
}

/**
 * Filtro em botões (§37): o nome ao lado, na mesma linha, e um botão por valor, que liga e desliga; vários ao mesmo tempo
 * (o valor do filtro são os escolhidos unidos por vírgula). Cada grupo tem um traço à esquerda e não quebra por dentro.
 * Estados distintos: parado neutro; mouse em cima, fundo cinza (sem verde — o `hover:` do Tailwind 4 só vale em aparelho
 * com mouse); ligado, verde cheio com o ✓; ao clicar, encolhe um pouco (não com movimento reduzido); com o teclado,
 * contorno verde.
 *
 * Numa barra apertada (AppToolbar com menos de 1440px) o grupo vira um seletor compacto ("Prioridade: todas"): os dois
 * ficam na página e o CSS mostra um só — nunca dois grupos de botões sem espaço para o nome.
 */
export function FilterButtons({ filter, value, onChange }: FilterProps) {
  return (
    <>
      <FilterButtonGroup filter={filter} value={value} onChange={onChange} />
      <CompactFilterSelect filter={filter} value={value} onChange={onChange} />
    </>
  )
}

/**
 * Versão compacta do filtro em botões: um seletor de uma escolha ("Prioridade: todas", "Prioridade: Alta"; com
 * vários escolhidos nos botões, "Prioridade: Alta +1"). Escolher aqui troca a seleção por aquele valor.
 */
function CompactFilterSelect({ filter, value, onChange }: FilterProps) {
  const { t } = useTranslation()
  const selected = value ? value.split(',').filter(Boolean) : []
  const first = selected[0]
  const shown = first ? (optionLabel(filter, first) ?? first) : null
  return (
    <AppSelect
      aria-label={filter.label}
      value={first ?? SELECT_ALL}
      onValueChange={(next) => onChange(next === SELECT_ALL ? undefined : next)}
      options={[{ value: SELECT_ALL, label: filter.allLabel ?? t('common.all') }, ...filter.options]}
      renderValue={
        shown ? (
          <>
            {filter.label}: <strong className="font-semibold">{shown}</strong>
            {selected.length > 1 && ` +${selected.length - 1}`}
          </>
        ) : (
          <>
            {filter.label}: {filter.allLabel ?? t('table.compactAll')}
          </>
        )
      }
      className="hidden w-auto min-w-[8.25rem] @max-[1440px]:flex [[data-compact~='1']_&]:flex"
      triggerClassName={filterTriggerClass(selected.length > 0)}
    />
  )
}

function FilterButtonGroup({ filter, value, onChange }: FilterProps) {
  const selected = value ? value.split(',') : []
  const toggle = (option: string) => {
    const next = selected.includes(option) ? selected.filter((v) => v !== option) : selected.concat(option)
    onChange(next.length ? next.join(',') : undefined)
  }
  return (
    <div role="group" aria-label={filter.label} className="ml-1 flex shrink-0 flex-nowrap items-center gap-2 border-l border-border pl-3 @max-[1440px]:hidden [[data-compact~='1']_&]:hidden">
      <span aria-hidden className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">
        {filter.label}
      </span>
      <div className="flex flex-nowrap gap-1">
        {filter.options.map((option) => {
          const on = selected.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option.value)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-sm font-medium',
                'transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:active:scale-[0.97]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                on ? 'border-primary bg-primary text-primary-fg hover:bg-primary-hover' : 'border-border-strong bg-surface text-fg hover:bg-surface-2',
              )}
            >
              {on && <Check className="size-3.5" aria-hidden />}
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
