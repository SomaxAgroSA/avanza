import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import type { OptionColor } from '@/domain/task-config'
import type { TaskDetail } from '@/domain/tasks'
import { isUrgency, NO_URGENCY } from '@/domain/urgency'
import { statusChoices, type StatusCategory } from '@/domain/workflow'
import { AppSelect } from '@/presentation/components'
import { useProjectMembers } from '@/features/projects/queries'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { usePriorities, useStatuses } from '@/features/workflow/queries'
import { useTaskQuickChange } from './use-task-quick-change'
import { useUrgencyChoices } from './urgency-choices'

const NONE = '__none__'

interface LookupOption {
  id: string
  name: string
  color: OptionColor
  category?: StatusCategory
}

const withCurrent = <T extends { id: string }>(list: readonly T[], current: T | null): T[] =>
  current && !list.some((x) => x.id === current.id) ? [...list, current] : [...list]

/**
 * Troca rápida de status, prioridade, urgência e responsável (página da tarefa e painel do Kanban),
 * com mensagem e "desfazer". O status lista só as transições permitidas a partir do atual. A urgência
 * muda como na lista (sem exigir os obrigatórios do status).
 * `split` (página da tarefa, ajuste 20/11): com quem recebe e distribui (§45), cinco campos — Status,
 * Prioridade, Urgência, Responsável (quem recebe e distribui; só leitura, muda no formulário) e Atribuída a
 * (quem executa; muda pelo fluxo). Na tarefa comum continua um só Responsável.
 * As colunas seguem a largura do painel (container query), não a da tela: no painel lateral ficam 2 × 2.
 */
export function TaskQuickFields({ task, className, split = false }: { task: TaskDetail; className?: string; split?: boolean }) {
  const { t } = useTranslation()
  const statuses = useStatuses(false)
  const priorities = usePriorities(false)
  const urgencyChoices = useUrgencyChoices()
  // a lista de pessoas só serve para trocar o responsável (o Responsável TI não reatribui nem vê os membros)
  const members = useProjectMembers(task.capabilities.assign ? task.project?.id : undefined)
  const assignable = (members.data ?? []).filter((m) => m.user.status === 'active' && (m.role !== 'viewer' || m.isOwner))
  const { change: quickChange, changeUrgency, busy, dialog } = useTaskQuickChange(task)

  const owner = split ? (task.demand?.owner ?? null) : null
  return (
    <div className={cn('@container', className)}>
      <div className={cn('grid gap-3 @sm:grid-cols-2', owner ? '@4xl:grid-cols-5' : '@3xl:grid-cols-4')}>
        <AppSelect
          size="sm"
          label={t('tasks.fields.status')}
          value={task.status?.id}
          // com quem recebe e distribui (§45), o status muda pelo fluxo
          disabled={!task.capabilities.edit || !!task.demand || busy}
          onValueChange={(statusId) => quickChange({ statusId }, { statusId: task.status?.id })}
          options={withCurrent<LookupOption>(statusChoices(statuses.data ?? [], task.status?.id), task.status).map((s) => ({ value: s.id, label: <LookupBadge item={s} /> }))}
        />
        <AppSelect
          size="sm"
          label={t('tasks.fields.priority')}
          value={task.priority?.id}
          disabled={!task.capabilities.edit || busy}
          onValueChange={(priorityId) => quickChange({ priorityId }, { priorityId: task.priority?.id })}
          options={withCurrent<LookupOption>(priorities.data ?? [], task.priority).map((p) => ({ value: p.id, label: <LookupBadge item={p} /> }))}
        />
        <AppSelect
          size="sm"
          label={t('tasks.fields.urgency')}
          value={task.urgency ?? NO_URGENCY}
          disabled={!task.capabilities.edit || busy}
          onValueChange={(value) => {
            const next = isUrgency(value) ? value : null
            if (next !== task.urgency) changeUrgency(next, task.urgency)
          }}
          options={urgencyChoices}
        />
        {owner && (
          <AppSelect
            size="sm"
            label={t('tasks.fields.assignee')}
            value={owner.id}
            disabled
            onValueChange={() => undefined}
            options={[{ value: owner.id, label: owner.name }]}
          />
        )}
        <AppSelect
          size="sm"
          label={owner ? t('tasks.fields.assignedTo') : t('tasks.fields.assignee')}
          value={task.assignee?.id ?? NONE}
          disabled={!task.capabilities.assign || !!task.demand || busy}
          onValueChange={(value) => quickChange({ assigneeId: value === NONE ? null : value }, { assigneeId: task.assignee?.id ?? null })}
          options={[
            { value: NONE, label: owner ? t('tasks.noAssignee') : t('tasks.unassigned') },
            ...withCurrent(
              assignable.map((m) => m.user),
              task.assignee,
            ).map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        {dialog}
      </div>
    </div>
  )
}
