import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DependencyRule, Plan, PlanBulkInput, PlanGroupInput, PlanGroupMove, PlanImportRow, PlanItem, PlanItemInput, PlanItemMove, PlanLinkKind, PlanResourceInput, PlanStatusInput } from '@/domain/plan'
import type { PlanUpdateInput } from '@/domain/plan-updates'
import type { IssueInput, JournalInput } from '@/domain/plan-management'
import type { PlanColumnInput } from '@/domain/plan-columns'
import { useRepositories } from '@/presentation/common/repositories-context'

/** Quadro do projeto: chave própria (módulo à parte das tarefas). */
export const planKeys = {
  all: ['plan'] as const,
  detail: (projectId: string) => ['plan', projectId] as const,
}

export function usePlan(projectId: string, enabled = true) {
  const { plan } = useRepositories()
  return useQuery({ queryKey: planKeys.detail(projectId), queryFn: () => plan.get(projectId), enabled: enabled && !!projectId })
}

/** Campos diretos do elemento (os calculados voltam do servidor ao recarregar o quadro). */
function patchItem(item: PlanItem, input: PlanItemInput): PlanItem {
  const next = { ...item }
  if (input.name !== undefined) next.name = input.name
  if (input.statusId !== undefined) next.statusId = input.statusId
  if (input.startDate !== undefined) next.startDate = input.startDate
  if (input.endDate !== undefined) next.endDate = input.endDate
  if (input.dueDate !== undefined) next.dueDate = input.dueDate
  if (input.resourceIds !== undefined) next.resourceIds = input.resourceIds
  if (input.estimatedHours !== undefined) next.estimatedHours = input.estimatedHours
  if (input.actualHours !== undefined) next.actualHours = input.actualHours
  if (input.durationDays !== undefined) next.durationManual = input.durationDays
  if (input.custom !== undefined) {
    const custom = { ...next.custom }
    Object.entries(input.custom).forEach(([id, value]) => {
      if (value === null) delete custom[id]
      else custom[id] = value
    })
    next.custom = custom
  }
  if (input.progress !== undefined) {
    next.progressManual = input.progress
    if (input.progress !== null) next.progress = { value: input.progress, source: 'manual' }
  }
  return next
}

/**
 * Mutações do quadro. Edição de célula é otimista (o valor fica na célula na hora; em erro, volta);
 * tudo recarrega o quadro em seguida para atualizar totais, duração e progresso calculados.
 */
export function usePlanMutations(projectId: string) {
  const { plan } = useRepositories()
  const queryClient = useQueryClient()
  const key = planKeys.detail(projectId)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

  return {
    updateItem: useMutation({
      mutationFn: ({ id, input }: { id: string; input: PlanItemInput }) => plan.updateItem(id, input),
      onMutate: async ({ id, input }) => {
        await queryClient.cancelQueries({ queryKey: key })
        const previous = queryClient.getQueryData<Plan>(key)
        if (previous) queryClient.setQueryData<Plan>(key, { ...previous, items: previous.items.map((i) => (i.id === id ? patchItem(i, input) : i)) })
        return { previous }
      },
      onError: (_error, _input, context) => {
        if (context?.previous) queryClient.setQueryData(key, context.previous)
      },
      onSettled: invalidate,
    }),
    createItem: useMutation({ mutationFn: (input: PlanItemInput) => plan.createItem(projectId, input), onSettled: invalidate }),
    deleteItem: useMutation({ mutationFn: (id: string) => plan.deleteItem(id), onSettled: invalidate }),
    createGroup: useMutation({ mutationFn: (input: PlanGroupInput) => plan.createGroup(projectId, input), onSettled: invalidate }),
    updateGroup: useMutation({ mutationFn: ({ id, input }: { id: string; input: PlanGroupInput }) => plan.updateGroup(id, input), onSettled: invalidate }),
    moveGroup: useMutation({ mutationFn: ({ id, target }: { id: string; target: PlanGroupMove }) => plan.moveGroup(id, target), onSettled: invalidate }),
    duplicateGroup: useMutation({ mutationFn: (id: string) => plan.duplicateGroup(id), onSettled: invalidate }),
    deleteGroup: useMutation({ mutationFn: (id: string) => plan.deleteGroup(id), onSettled: invalidate }),
    createStatus: useMutation({ mutationFn: (input: PlanStatusInput) => plan.createStatus(projectId, input), onSettled: invalidate }),
    updateStatus: useMutation({ mutationFn: ({ id, input }: { id: string; input: PlanStatusInput }) => plan.updateStatus(id, input), onSettled: invalidate }),
    deleteStatus: useMutation({ mutationFn: (id: string) => plan.deleteStatus(id), onSettled: invalidate }),
    createResource: useMutation({ mutationFn: (input: PlanResourceInput) => plan.createResource(projectId, input), onSettled: invalidate }),
    updateResource: useMutation({ mutationFn: ({ id, input }: { id: string; input: PlanResourceInput }) => plan.updateResource(id, input), onSettled: invalidate }),
    deleteResource: useMutation({ mutationFn: (id: string) => plan.deleteResource(id), onSettled: invalidate }),
    // GP-2 — arrastar/mover (a ordem nova fica na tela até o quadro recarregar), massa, dependências, regra e importação
    moveItem: useMutation({ mutationFn: ({ id, target }: { id: string; target: PlanItemMove }) => plan.moveItem(id, target), onSettled: invalidate }),
    duplicateItem: useMutation({ mutationFn: (id: string) => plan.duplicateItem(id), onSettled: invalidate }),
    bulk: useMutation({ mutationFn: (input: PlanBulkInput) => plan.bulk(projectId, input), onSettled: invalidate }),
    createLink: useMutation({ mutationFn: ({ itemId, kind, otherId }: { itemId: string; kind: PlanLinkKind; otherId: string }) => plan.createLink(itemId, { kind, itemId: otherId }), onSettled: invalidate }),
    deleteLink: useMutation({ mutationFn: (id: string) => plan.deleteLink(id), onSettled: invalidate }),
    updateSettings: useMutation({ mutationFn: (dependencyRule: DependencyRule) => plan.updateSettings(projectId, { dependencyRule }), onSettled: invalidate }),
    importItems: useMutation({ mutationFn: (rows: PlanImportRow[]) => plan.importItems(projectId, rows), onSettled: invalidate }),
    // GP-4 — linha de base do Cronograma (gestor)
    saveBaseline: useMutation({ mutationFn: () => plan.saveBaseline(projectId), onSettled: invalidate }),
    clearBaseline: useMutation({ mutationFn: () => plan.clearBaseline(projectId), onSettled: invalidate }),
    // GP-5 — colunas personalizadas (gestor)
    createColumn: useMutation({ mutationFn: (input: PlanColumnInput) => plan.createColumn(projectId, input), onSettled: invalidate }),
    updateColumn: useMutation({ mutationFn: ({ id, input }: { id: string; input: PlanColumnInput }) => plan.updateColumn(id, input), onSettled: invalidate }),
    changeColumnType: useMutation({ mutationFn: ({ id, input }: { id: string; input: PlanColumnInput }) => plan.changeColumnType(id, input), onSettled: invalidate }),
    duplicateColumn: useMutation({ mutationFn: (id: string) => plan.duplicateColumn(id), onSettled: invalidate }),
    deleteColumn: useMutation({ mutationFn: (id: string) => plan.deleteColumn(id), onSettled: invalidate }),
  }
}

export type PlanMutations = ReturnType<typeof usePlanMutations>

/* ------------------------------------------------------------------ painel do elemento (GP-3) */

/** Sob a chave do quadro: recarregar o quadro também atualiza o painel (e vice-versa). */
export const panelKeys = {
  updates: (projectId: string, itemId: string) => ['plan', projectId, 'item', itemId, 'updates'] as const,
  history: (projectId: string, itemId: string) => ['plan', projectId, 'item', itemId, 'history'] as const,
  people: (projectId: string, itemId: string) => ['plan', projectId, 'item', itemId, 'people'] as const,
}

export function useItemUpdates(projectId: string, itemId: string) {
  const { plan } = useRepositories()
  return useQuery({ queryKey: panelKeys.updates(projectId, itemId), queryFn: () => plan.listUpdates(itemId) })
}

export function useItemHistory(projectId: string, itemId: string, enabled: boolean) {
  const { plan } = useRepositories()
  return useQuery({ queryKey: panelKeys.history(projectId, itemId), queryFn: () => plan.history(itemId), enabled })
}

export function useItemMentionPeople(projectId: string, itemId: string, enabled: boolean) {
  const { plan } = useRepositories()
  return useQuery({ queryKey: panelKeys.people(projectId, itemId), queryFn: () => plan.mentionCandidates(itemId), enabled, staleTime: 60_000 })
}

/** Mutações do painel; recarregam o quadro (contadores) e o painel. */
export function useItemPanelMutations(projectId: string, itemId: string) {
  const { plan } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: planKeys.detail(projectId) })
  return {
    createUpdate: useMutation({ mutationFn: (input: PlanUpdateInput) => plan.createUpdate(itemId, input), onSettled: invalidate }),
    editUpdate: useMutation({ mutationFn: ({ id, content }: { id: string; content: string }) => plan.editUpdate(id, content), onSettled: invalidate }),
    deleteUpdate: useMutation({ mutationFn: (id: string) => plan.deleteUpdate(id), onSettled: invalidate }),
    addFiles: useMutation({ mutationFn: ({ updateId, files }: { updateId: string; files: File[] }) => plan.addUpdateFiles(updateId, files), onSettled: invalidate }),
    deleteFile: useMutation({ mutationFn: (id: string) => plan.deleteFile(id), onSettled: invalidate }),
  }
}

/* ------------------------------------------------------------------ visões e gestão (GP-4) */

/** Sob a chave do quadro: mudar o quadro também atualiza o relatório. */
export const managementKeys = {
  journal: (projectId: string) => ['plan', projectId, 'journal'] as const,
  issues: (projectId: string) => ['plan', projectId, 'issues'] as const,
  report: (projectId: string) => ['plan', projectId, 'report'] as const,
}

export function usePlanJournal(projectId: string, enabled = true) {
  const { plan } = useRepositories()
  return useQuery({ queryKey: managementKeys.journal(projectId), queryFn: () => plan.listJournal(projectId), enabled })
}

export function usePlanIssues(projectId: string) {
  const { plan } = useRepositories()
  return useQuery({ queryKey: managementKeys.issues(projectId), queryFn: () => plan.listIssues(projectId) })
}

/** Relatório com "hoje" no fuso de quem consulta. */
export function usePlanReport(projectId: string) {
  const { plan } = useRepositories()
  return useQuery({ queryKey: managementKeys.report(projectId), queryFn: () => plan.report(projectId, new Date().getTimezoneOffset()) })
}

/** Diário e problemas; recarregam a gestão e o relatório (os problemas em aberto pesam na saúde). */
export function usePlanManagementMutations(projectId: string) {
  const { plan } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: planKeys.detail(projectId) })
  return {
    createEntry: useMutation({ mutationFn: (input: JournalInput) => plan.createJournalEntry(projectId, input), onSettled: invalidate }),
    updateEntry: useMutation({ mutationFn: ({ id, input }: { id: string; input: JournalInput }) => plan.updateJournalEntry(id, input), onSettled: invalidate }),
    deleteEntry: useMutation({ mutationFn: (id: string) => plan.deleteJournalEntry(id), onSettled: invalidate }),
    createIssue: useMutation({ mutationFn: (input: IssueInput) => plan.createIssue(projectId, input), onSettled: invalidate }),
    updateIssue: useMutation({ mutationFn: ({ id, input }: { id: string; input: IssueInput }) => plan.updateIssue(id, input), onSettled: invalidate }),
    deleteIssue: useMutation({ mutationFn: (id: string) => plan.deleteIssue(id), onSettled: invalidate }),
  }
}
