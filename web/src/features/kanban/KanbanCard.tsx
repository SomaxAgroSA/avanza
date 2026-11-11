import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BoardCard } from '@/domain/kanban'
import { cn } from '@/core/utils/cn'
import type { FieldType } from '@/domain/task-config'
import { AppAvatar, AppBadge, AppKanbanCard } from '@/presentation/components'
import type { CustomFieldReferences } from '@/features/task-config/CustomFieldInput'
import { CustomFieldValue } from '@/features/task-config/CustomFieldValue'
import { TagList } from '@/features/tags/tag-visuals'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { DueDate, TaskCode } from '@/features/tasks/task-visuals'
import { UrgencyBadge } from '@/features/tasks/TaskUrgency'
import { usePriorities } from '@/features/workflow/queries'

/** Tipos que não cabem no card (ficam no detalhe). */
const NOT_ON_CARD: readonly FieldType[] = ['image', 'file', 'textarea']

const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

/**
 * Conteúdo do card, enxuto: código (o nome do projeto ao passar o mouse), urgência e prioridade só quando
 * fogem do padrão, título em até 2 linhas, campos marcados "no card", até 2 tags, prazo e responsável.
 * Área, checklist e comentários ficam no painel da tarefa (abre com um clique).
 * `showProject` (quadro de todos os projetos): o código já começa com a chave do projeto (ex.: ECC-1),
 * então a chave só aparece à parte quando o código não a traz.
 */
export function KanbanCardContent({
  card,
  references,
  showProject = false,
  compact = false,
}: {
  card: BoardCard
  references?: CustomFieldReferences
  showProject?: boolean
  /** Modo compacto: título em até 2 linhas, sem os campos extras, até 2 tags. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const priorities = usePriorities(false)
  const defaultPriorityId = priorities.data?.find((p) => p.isDefault)?.id
  // a prioridade padrão (ex.: Média) não diz nada no quadro: só aparece a que foge dela
  const showPriority = !!card.priority && card.priority.id !== defaultPriorityId
  const keyInCode = !!card.project && card.code.startsWith(`${card.project.key}-`)
  const fields = compact ? [] : card.cardFields.filter((f) => !NOT_ON_CARD.includes(f.field.type) && !isEmpty(f.value))
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5" title={showProject && card.project ? t('kanban.projectOf', { name: card.project.name }) : undefined}>
          {showProject && card.project && !keyInCode && (
            // texto principal sobre a superfície neutra: contraste AA no claro e no escuro
            <AppBadge className={cn('max-w-24 shrink-0 font-mono text-fg', compact && 'px-1.5 py-0 text-[10px]')} data-testid="kanban-card-project">
              <span className="truncate">{card.project.key}</span>
            </AppBadge>
          )}
          <TaskCode task={card} className="min-w-0" compact={compact} />
          {/* urgência: o semáforo junto ao código (o nome fica no título e para leitores de tela) */}
          <UrgencyBadge urgency={card.urgency} />
        </span>
        {showPriority && card.priority && <LookupBadge item={card.priority} className="max-w-[50%]" iconOnly />}
      </div>
      <p className={cn('font-medium break-words text-fg', compact ? 'line-clamp-1 text-xs leading-snug' : 'line-clamp-2 text-sm')}>{card.title}</p>
      {fields.length > 0 && (
        <dl className="flex flex-col gap-0.5 text-xs">
          {fields.map(({ field, value }) => (
            <div key={field.id} className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-muted">{field.label}:</dt>
              <dd className="min-w-0 truncate text-fg">
                <CustomFieldValue field={field} value={value} references={references} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!compact && <TagList tags={card.tags} max={2} />}
      <div className={cn('flex items-center justify-between gap-2', compact ? 'min-h-5 text-[11px] [&_svg]:size-3' : 'min-h-6 text-xs')}>
        <span className="flex min-w-0 items-center gap-x-2">{card.dueDate && <DueDate task={card} />}</span>
        {card.assignee ? (
          <span title={card.assignee.name} className="shrink-0">
            <AppAvatar name={card.assignee.name} src={card.assignee.avatarUrl} size="xs" />
            <span className="sr-only">{t('kanban.assignedTo', { name: card.assignee.name })}</span>
          </span>
        ) : (
          <span className="sr-only">{t('tasks.unassigned')}</span>
        )}
      </div>
    </>
  )
}

/**
 * Card arrastável. Mouse/toque arrastam; no teclado, Espaço pega/solta, setas movem e Esc cancela.
 * Clique ou Enter abre o painel da tarefa.
 */
export function SortableKanbanCard({
  card,
  locked,
  onOpen,
  references,
  showProject = false,
  compact = false,
}: {
  card: BoardCard
  locked: boolean
  onOpen: (id: string) => void
  references?: CustomFieldReferences
  showProject?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: locked })

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(card.id)
      return
    }
    listeners?.onKeyDown?.(event)
  }

  return (
    <AppKanbanCard
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-roledescription={locked ? undefined : t('kanban.cardRole')}
      aria-label={`${card.code} · ${card.title}`}
      data-testid={`kanban-card-${card.id}`}
      locked={locked}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={compact ? 'gap-1 rounded-lg p-2' : undefined}
      onClick={() => onOpen(card.id)}
    >
      <KanbanCardContent card={card} references={references} showProject={showProject} compact={compact} />
    </AppKanbanCard>
  )
}
