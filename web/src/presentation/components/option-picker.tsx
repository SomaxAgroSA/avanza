import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { foldText } from '@/core/utils/text'

/** Opção da lista com busca (texto para buscar/ler + enfeite opcional à esquerda). */
export interface PickerOption {
  value: string
  label: string
  prefix?: ReactNode
  disabled?: boolean
}

/**
 * Cria uma opção a partir do texto buscado e devolve o valor dela (null/undefined = não criou).
 * Quem passa a função avisa o erro ao usuário; aqui a falha só encerra o "criando".
 */
export type CreateOptionHandler = (label: string) => Promise<string | null | undefined>

interface OptionPickerProps {
  listboxId: string
  options: PickerOption[]
  isSelected: (value: string) => boolean
  onPick: (value: string) => void
  multiple?: boolean
  /** Mostra a busca (com `onCreateOption`, ela aparece sempre). */
  searchable?: boolean
  onCreateOption?: CreateOptionHandler | undefined
  /** Valor recém-criado: quem chama o seleciona. */
  onCreated: (value: string) => void
  /** Primeiro item "todos" (ex.: "Todos os projetos"): marcado quando nada está escolhido; escolher limpa. */
  allOption?: { label: string; selected: boolean; onPick: () => void } | undefined
}

const ITEM = '[data-picker-item]:not(:disabled)'

/**
 * Conteúdo do popover das seleções do design system (AppMultiSelect e AppSelect com criação):
 * busca sem acentos/maiúsculas, lista e, quando dá para criar, o item "Adicionar “texto”" para uma
 * busca sem opção igual. Teclado: setas andam entre a busca e os itens; Enter na busca escolhe a
 * opção igual ao texto ou cria a nova.
 */
export function OptionPicker({ listboxId, options, isSelected, onPick, multiple, searchable, onCreateOption, onCreated, allOption }: OptionPickerProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const query = foldText(search)
  const visible = query ? options.filter((o) => foldText(o.label).includes(query)) : options
  const exact = query ? options.find((o) => foldText(o.label) === query && !o.disabled) : undefined
  const canCreate = !!onCreateOption && !!query && !options.some((o) => foldText(o.label) === query)

  async function create() {
    if (!onCreateOption || creating) return
    // o foco vai para a busca: o item "Adicionar" fica desabilitado e some ao terminar — sem isso o foco
    // cairia no diálogo por trás e o popover fecharia (Radix trata como foco fora da lista)
    searchInput.current?.focus()
    setCreating(true)
    try {
      const value = await onCreateOption(search.trim().replace(/\s+/g, ' '))
      if (value) {
        setSearch('')
        onCreated(value)
      }
    } catch {
      // quem passou onCreateOption já avisou o erro
    } finally {
      setCreating(false)
    }
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    navigate(event)
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    const only = visible.length === 1 && !visible[0]?.disabled ? visible[0] : undefined
    const target = exact ?? (canCreate ? undefined : only)
    if (target) {
      if (!(multiple && isSelected(target.value))) onPick(target.value)
      setSearch('')
    } else if (canCreate) void create()
  }

  /** Setas para cima/baixo entre a busca e os itens da lista. */
  function navigate(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const stops = Array.from(root.current?.querySelectorAll<HTMLElement>(`input[type=search], ${ITEM}`) ?? [])
    if (stops.length === 0) return
    event.preventDefault()
    const index = stops.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? Math.min(index + 1, stops.length - 1) : Math.max(index - 1, 0)
    stops[index < 0 ? 0 : next]?.focus()
  }

  return (
    <div ref={root}>
      {(searchable || onCreateOption) && (
        <input
          ref={searchInput}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={onSearchKey}
          placeholder={onCreateOption ? t('multiSelect.searchOrCreate') : t('common.search')}
          aria-label={t('common.search')}
          aria-controls={listboxId}
          className="mb-1 h-8 w-full rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:border-primary"
        />
      )}
      <ul id={listboxId} role="listbox" aria-multiselectable={multiple || undefined} className="max-h-64 overflow-y-auto">
        {allOption && !query && (
          <li role="option" aria-selected={allOption.selected} className="mb-1 border-b border-border pb-1">
            <button
              type="button"
              data-picker-item
              onKeyDown={navigate}
              onClick={allOption.onPick}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
            >
              <PickerCheck multiple={multiple} checked={allOption.selected} />
              <span className="truncate">{allOption.label}</span>
            </button>
          </li>
        )}
        {visible.length === 0 && !canCreate && <li className="px-2 py-6 text-center text-sm text-muted">{t('commandPalette.empty')}</li>}
        {visible.map((option) => {
          const checked = isSelected(option.value)
          return (
            <li key={option.value} role="option" aria-selected={checked}>
              <button
                type="button"
                data-picker-item
                disabled={option.disabled}
                onKeyDown={navigate}
                onClick={() => onPick(option.value)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-surface-2 focus-visible:bg-surface-2 disabled:opacity-50"
              >
                <PickerCheck multiple={multiple} checked={checked} />
                {option.prefix}
                <span className="truncate">{option.label}</span>
              </button>
            </li>
          )
        })}
        {canCreate && (
          <li role="option" aria-selected={false}>
            <button
              type="button"
              data-picker-item
              disabled={creating}
              onKeyDown={navigate}
              onClick={() => void create()}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-primary-text outline-none hover:bg-surface-2 focus-visible:bg-surface-2 disabled:opacity-60"
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              </span>
              <span className="truncate">{t('multiSelect.create', { item: search.trim().replace(/\s+/g, ' ') })}</span>
            </button>
          </li>
        )}
      </ul>
    </div>
  )
}

/** Caixa de marcar (múltipla) ou visto (única) à esquerda do item. */
function PickerCheck({ multiple, checked }: { multiple: boolean | undefined; checked: boolean }) {
  if (!multiple) return <span className="flex size-4 shrink-0 items-center justify-center">{checked && <Check className="size-4 text-primary-text" aria-hidden />}</span>
  return (
    <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-[5px] border', checked ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong')}>
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  )
}
