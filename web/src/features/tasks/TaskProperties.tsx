import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatDateTime, formatDay, formatNumber } from '@/core/utils/format'
import type { TaskDetail } from '@/domain/tasks'
import { useCan } from '@/features/auth/session'
import { managementLink } from '@/features/plan/paths'
import { CustomFieldValue } from '@/features/task-config/CustomFieldValue'
import type { CustomFieldReferences } from '@/features/task-config/CustomFieldInput'
import { DueDate, PersonCell } from './task-visuals'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-start gap-3 py-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-fg">{children}</dd>
    </div>
  )
}

/** Propriedades da tarefa (pessoas, datas, horas). */
export function TaskProperties({ task }: { task: TaskDetail }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const hours = (n: number | null) => (n === null ? <span className="text-subtle">—</span> : `${formatNumber(n, locale)} h`)
  const date = (d: Date | null) => (d ? formatDateTime(d, locale) : <span className="text-subtle">—</span>)
  const canViewPlan = useCan('plan.view')
  return (
    <dl className="divide-y divide-border">
      <Row label={t('tasks.fields.project')}>{task.project ? `${task.project.key} · ${task.project.name}` : '—'}</Row>
      <Row label={t('tasks.fields.assignee')}>
        <PersonCell person={task.assignee} />
      </Row>
      <Row label={t('tasks.fields.reporter')}>
        <PersonCell person={task.reporter} emptyLabel="—" />
      </Row>
      <Row label={t('tasks.fields.sprint')}>
        {task.sprint ? (
          <span>
            {task.sprint.name}
            {task.sprint.state === 'closed' && <span className="text-subtle"> · {t('sprints.states.closed')}</span>}
          </span>
        ) : (
          <span className="text-subtle">{t('sprints.none')}</span>
        )}
      </Row>
      {task.planItem && (
        <Row label={t('tasks.planLink.label')}>
          {canViewPlan && task.project ? (
            <Link
              to={managementLink(task.project.id, { item: task.planItem.id })}
              title={t('tasks.planLink.open', { name: task.planItem.name })}
              className="font-medium break-words text-fg hover:text-primary-text"
            >
              {task.planItem.name}
            </Link>
          ) : (
            <span className="break-words">{task.planItem.name}</span>
          )}
        </Row>
      )}
      <Row label={t('tasks.fields.startDate')}>{task.startDate ? formatDay(task.startDate, i18n.language) : '—'}</Row>
      <Row label={t('tasks.fields.dueDate')}>
        <DueDate task={task} />
      </Row>
      <Row label={t('tasks.fields.estimatedHours')}>{hours(task.estimatedHours)}</Row>
      <Row label={t('tasks.fields.actualHours')}>{hours(task.actualHours)}</Row>
      <Row label={t('tasks.fields.startedAt')}>{date(task.startedAt)}</Row>
      <Row label={t('tasks.fields.completedAt')}>{date(task.completedAt)}</Row>
      <Row label={t('tasks.fields.creator')}>
        <span className="text-muted">
          {task.creator?.name ?? '—'} · {formatDateTime(task.createdAt, locale)}
        </span>
      </Row>
    </dl>
  )
}

/** Campos personalizados visíveis do tipo, em modo leitura. */
export function TaskCustomValues({ task, references }: { task: TaskDetail; references?: CustomFieldReferences }) {
  const { t } = useTranslation()
  const visible = task.fields.filter((link) => link.visible)
  if (visible.length === 0) return <p className="text-sm text-muted">{t('tasks.noTypeFields')}</p>
  return (
    <dl className="divide-y divide-border">
      {visible.map((link) => (
        <Row key={link.field.id} label={link.field.label}>
          <CustomFieldValue field={link.field} value={task.customValues[link.field.name]} references={references} />
        </Row>
      ))}
    </dl>
  )
}
