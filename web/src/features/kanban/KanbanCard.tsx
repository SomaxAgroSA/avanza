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
import { DueDate, TaskCode, TaskIndicators } from '@/features/tasks/task-visuals'
import { UrgencyBadge } from '@/features/tasks/TaskUrgency'
import { AreaBadge } from '@/features/workflow/area-visuals'

/** Tipos que não cabem no card (ficam no detalhe). */
const NOT_ON_CARD: readonly FieldType[] = ['image', 'file', 'textarea']

const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

/**
 * Conteúdo do card: código, prioridade, título, campos "no card", tags, prazo, indicadores e responsável.
 * `showProject` (quadro de todos os projetos): etiqueta com a chave do projeto do card.
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
  const fields = compact ? [] : card.cardFields.filter((f) => !NOT_ON_CARD.includes(f.field.type) && !isEmpty(f.value))
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {showProject && card.project && (
            // texto principal sobre a superfície neutra: contraste AA no claro e no escuro
            <AppBadge className={cn('max-w-24 shrink-0 font-mono text-fg', compact && 'px-1.5 py-0 text-[10px]')} title={t('kanban.projectOf', { name: card.project.name })} data-testid="kanban-card-project">
              <span className="truncate">{card.project.key}</span>
            </AppBadge>
          )}
          <TaskCode task={card} className="min-w-0" compact={compact} />
          {/* urgência: o semáforo junto ao código (o nome fica no título e para leitores de tela) */}
          <UrgencyBadge urgency={card.urgency} />
        </span>
        {card.priority && <LookupBadge item={card.priority} className="max-w-[50%]" iconOnly={compact} />}
      </div>
      <p className={cn('font-medium break-words text-fg', compact ? 'line-clamp-2 text-xs leading-snug' : 'line-clamp-3 text-sm')}>{card.title}</p>
      {/* área responsável: o selo com o nome (no compacto, menor) */}
      {card.area && <AreaBadge area={card.area} className={cn('self-start', compact && 'px-1.5 py-0 text-[10px]')} />}
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
      <TagList tags={card.tags} max={compact ? 2 : 3} compact={compact} />
      <div className={cn('flex items-center justify-between gap-2', compact ? 'min-h-5 text-[11px] [&_svg]:size-3' : 'min-h-6 text-xs')}>
        <span className={cn('flex min-w-0 flex-wrap items-center gap-y-1', compact ? 'gap-x-2' : 'gap-x-3')}>
          {card.dueDate && <DueDate task={card} />}
          <TaskIndicators task={card} className={compact ? 'mt-0 gap-x-2 text-[11px]' : undefined} />
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
