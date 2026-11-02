import { UrgencyLight } from '@/features/tasks/TaskUrgency'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BoardCard } from '@/domain/kanban'
import type { FieldType } from '@/domain/task-config'
import { AppAvatar, AppKanbanCard } from '@/presentation/components'
import type { CustomFieldReferences } from '@/features/task-config/CustomFieldInput'
import { CustomFieldValue } from '@/features/task-config/CustomFieldValue'
import { TagList } from '@/features/tags/tag-visuals'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { DueDate, TaskCode, TaskIndicators } from '@/features/tasks/task-visuals'

/** Tipos que não cabem no card (ficam no detalhe). */
const NOT_ON_CARD: readonly FieldType[] = ['image', 'file', 'textarea']

const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

/** Conteúdo do card: código, prioridade, título, campos "no card", tags, prazo, indicadores e responsável. */
export function KanbanCardContent({ card, references }: { card: BoardCard; references?: CustomFieldReferences }) {
  const { t } = useTranslation()
  const fields = card.cardFields.filter((f) => !NOT_ON_CARD.includes(f.field.type) && !isEmpty(f.value))
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <TaskCode task={card} />
          {card.urgency && (
            <span title={`${t('tasks.fields.urgency')}: ${t(`tasks.urgency.${card.urgency}`)}`} className="flex">
              <UrgencyLight urgency={card.urgency} />
              <span className="sr-only">{`${t('tasks.fields.urgency')}: ${t(`tasks.urgency.${card.urgency}`)}`}</span>
            </span>
          )}
        </span>
        {card.priority && <LookupBadge item={card.priority} className="max-w-[50%]" />}
      </div>
      <p className="line-clamp-3 text-sm font-medium break-words text-fg">{card.title}</p>
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
      <TagList tags={card.tags} max={3} />
      <div className="flex min-h-6 items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {card.dueDate && <DueDate task={card} />}
          <TaskIndicators task={card} />
        </span>
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
}: {
  card: BoardCard
  locked: boolean
  onOpen: (id: string) => void
  references?: CustomFieldReferences
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
      onClick={() => onOpen(card.id)}
    >
      <KanbanCardContent card={card} references={references} />
    </AppKanbanCard>
  )
}
