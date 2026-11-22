import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import type { ColumnLabels, TableColumnLabels } from '@/domain/column-labels'
import { notify } from '@/presentation/components/notify'
import { useRepositories } from './repositories-context'
import { useErrorMessage } from './use-error-message'

export const COLUMN_LABELS_QUERY_KEY = ['platform', 'column-labels'] as const

const EMPTY: ColumnLabels = {}

/** Só textos (o que vier estragado do navegador é ignorado). */
function onlyTexts(value: unknown): ColumnLabels {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''))
}

const ownKey = (tableId: string) => `kamban.table.${tableId}.labels`
const readOwn = (tableId: string) => onlyTexts(readJson<unknown>(ownKey(tableId), {}))

/**
 * Nomes que a própria pessoa deu às colunas da tabela (§44): no navegador, junto das colunas da tabela
 * (`kamban.table.<tabela>.labels`), como a escolha das colunas à vista.
 */
export function useOwnColumnLabels(tableId: string): { labels: ColumnLabels; save: (labels: ColumnLabels) => void } {
  const [state, setState] = useState(() => ({ tableId, labels: readOwn(tableId) }))
  // outra tabela no mesmo lugar: lê os nomes dela
  const current = state.tableId === tableId ? state : { tableId, labels: readOwn(tableId) }
  if (state.tableId !== tableId) setState(current)
  const save = useCallback(
    (labels: ColumnLabels) => {
      setState({ tableId, labels })
      writeJson(ownKey(tableId), labels)
    },
    [tableId],
  )
  return { labels: current.labels, save }
}

/**
 * Nomes das colunas da tabela que valem para todos (Configurações da plataforma; gravar exige
 * `platform.manage`). A tela mostra o novo nome na hora e volta atrás se o servidor recusar.
 */
export function useCompanyColumnLabels(tableId: string): { labels: ColumnLabels; save: (labels: ColumnLabels) => Promise<void> } {
  const { platform } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const query = useQuery({ queryKey: COLUMN_LABELS_QUERY_KEY, queryFn: () => platform.getTableColumnLabels(), staleTime: 5 * 60_000, retry: false })
  const mutation = useMutation({
    mutationFn: (labels: ColumnLabels) => platform.updateTableColumnLabels(tableId, labels),
    onMutate: async (labels) => {
      await queryClient.cancelQueries({ queryKey: COLUMN_LABELS_QUERY_KEY })
      const previous = queryClient.getQueryData<TableColumnLabels>(COLUMN_LABELS_QUERY_KEY)
      queryClient.setQueryData<TableColumnLabels>(COLUMN_LABELS_QUERY_KEY, (all) => ({ ...all, [tableId]: labels }))
      return { previous }
    },
    onError: (error, _labels, context) => {
      if (context?.previous) queryClient.setQueryData(COLUMN_LABELS_QUERY_KEY, context.previous)
      else void queryClient.invalidateQueries({ queryKey: COLUMN_LABELS_QUERY_KEY })
      notify.error(errorMessage(error))
    },
    onSuccess: (all) => queryClient.setQueryData(COLUMN_LABELS_QUERY_KEY, all),
  })
  const { mutateAsync } = mutation
  const save = useCallback(
    async (labels: ColumnLabels) => {
      await mutateAsync(labels).catch(() => undefined)
    },
    [mutateAsync],
  )
  const all = query.data
  const labels = all && Object.prototype.hasOwnProperty.call(all, tableId) ? (all[tableId] ?? EMPTY) : EMPTY
  return { labels, save }
}
