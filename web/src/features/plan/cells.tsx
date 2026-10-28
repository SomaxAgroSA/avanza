import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, Settings2 } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { ProjectMember } from '@/domain/projects'
import {
  PLAN_LIMITS,
  formatNumber,
  formatNumberInput,
  formatSchedule,
  parseNumberInput,
  rangeDays,
  type PlanResource,
  type PlanStatus,
  type ProgressSource,
  type StatusSegment,
} from '@/domain/plan'
import type { OptionColor } from '@/domain/task-config'
import { AppAvatar, AppCalendar, AppInlineEdit, AppPopover, AppRangeCalendar, notify, type AppDateRange } from '@/presentation/components'
import { optionSolid, optionText, optionTint } from '@/features/task-config/config-theme'

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Botão que ocupa a célula inteira (abre o seletor). */
const cellButton =
  'flex h-full min-h-9 w-full items-center justify-center gap-1 px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'

/* ------------------------------------------------------------------ status */

export function StatusBlock({ status, className }: { status: PlanStatus | null; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn('flex h-full min-h-9 w-full items-center justify-center truncate px-2 text-[13px] font-medium', status ? 'text-white' : 'bg-surface-3 text-subtle', className)}
      style={status ? { backgroundColor: optionSolid(status.color) } : undefined}
    >
      {status ? status.name : <span className="sr-only">{t('plan.statusBlank')}</span>}
    </span>
  )
}

export function StatusCell({
  statuses,
  value,
  itemName,
  readOnly,
  canEditLabels,
  onChange,
  onEditLabels,
}: {
  statuses: PlanStatus[]
  value: string | null
  itemName: string
  readOnly: boolean
  canEditLabels: boolean
  onChange: (statusId: string | null) => void
  onEditLabels: () => void
}) {
  const { t } = useTranslation()
  const current = statuses.find((s) => s.id === value) ?? null
  if (readOnly) return <StatusBlock status={current} />
  return (
    <AppPopover
      label={t('plan.statusOf', { name: itemName })}
      className="w-56"
      trigger={
        <button type="button" aria-label={t('plan.statusOfValue', { name: itemName, value: current?.name ?? t('plan.statusBlank') })} className={cn(cellButton, 'p-0 hover:brightness-110')}>
          <StatusBlock status={current} />
        </button>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-1">
          {[...statuses, null].map((status) => {
            const selected = (status?.id ?? null) === value
            return (
              <button
                key={status?.id ?? 'blank'}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  if (!selected) onChange(status?.id ?? null)
                  close()
                }}
                className={cn('relative h-8 overflow-hidden rounded-md outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring', selected && 'ring-2 ring-primary')}
              >
                <StatusBlock status={status} className="min-h-8" />
                {!status && <span className="absolute inset-0 flex items-center justify-center text-xs text-muted">{t('plan.statusBlank')}</span>}
              </button>
            )
          })}
          {canEditLabels && (
            <button
              type="button"
              onClick={() => {
                close()
                onEditLabels()
              }}
              className="mt-1 flex items-center justify-center gap-1.5 rounded-md border-t border-border px-2 pt-2 text-xs font-medium text-muted hover:text-fg [&_svg]:size-3.5"
            >
              <Settings2 />
              {t('plan.editLabels')}
            </button>
          )}
        </div>
      )}
    </AppPopover>
  )
}

/* ------------------------------------------------------------------ cronograma */

export function SchedulePill({ start, end, color, className }: { start: string | null; end: string | null; color: OptionColor; className?: string }) {
  const { i18n } = useTranslation()
  const text = formatSchedule(start, end, i18n.language)
  if (!text) return null
  return (
    <span className={cn('inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-xs font-medium text-white tabular-nums', className)} style={{ backgroundColor: optionSolid(color) }}>
      {text}
    </span>
  )
}

export function ScheduleCell({
  start,
  end,
  color,
  itemName,
  readOnly,
  onChange,
}: {
  start: string | null
  end: string | null
  color: OptionColor
  itemName: string
  readOnly: boolean
  onChange: (range: { startDate: string | null; endDate: string | null }) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<AppDateRange>({ start: start ?? '', end: end ?? '' })
  const days = rangeDays(start, end)
  const pill = <SchedulePill start={start} end={end} color={color} />
  if (readOnly) return <span className="flex justify-center">{pill}</span>
  return (
    <AppPopover
      label={t('plan.scheduleOf', { name: itemName })}
      onOpenChange={(open) => {
        if (open) {
          setDraft({ start: start ?? '', end: end ?? '' })
          return
        }
        const next = { startDate: draft.start || null, endDate: draft.end || draft.start || null }
        if (next.startDate !== start || next.endDate !== end) onChange(next)
      }}
      trigger={
        <button
          type="button"
          aria-label={t('plan.scheduleOfValue', { name: itemName, value: days ? t('plan.daysCount', { count: days }) : t('plan.noSchedule') })}
          title={days ? t('plan.daysCount', { count: days }) : undefined}
          className={cn(cellButton, 'group/cell')}
        >
          {pill ?? <span className="text-xs text-subtle opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100">{t('plan.noSchedule')}</span>}
        </button>
      }
    >
      <AppRangeCalendar value={draft} onChange={setDraft} focusOnMount />
    </AppPopover>
  )
}

/* ------------------------------------------------------------------ recursos */

export function ResourceChip({ resource }: { resource: PlanResource }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: optionTint(resource.color), color: optionText(resource.color) }}>
      {resource.name}
    </span>
  )
}

export function ResourcesCell({
  resources,
  value,
  itemName,
  readOnly,
  canCreate,
  onChange,
  onCreate,
  onEditLabels,
}: {
  resources: PlanResource[]
  value: string[]
  itemName: string
  readOnly: boolean
  canCreate: boolean
  onChange: (ids: string[]) => void
  onCreate: (name: string) => Promise<PlanResource>
  onEditLabels: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const selected = value.map((id) => resources.find((r) => r.id === id)).filter((r): r is PlanResource => !!r)
  const chips = (
    <span className="flex min-w-0 items-center justify-center gap-1">
      {selected.slice(0, 2).map((r) => (
        <ResourceChip key={r.id} resource={r} />
      ))}
      {selected.length > 2 && <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-xs text-muted">+{selected.length - 2}</span>}
    </span>
  )
  const q = fold(query.trim())
  const matches = useMemo(() => resources.filter((r) => !q || fold(r.name).includes(q)), [resources, q])
  const exact = resources.some((r) => fold(r.name) === q)
  if (readOnly) return <span className="flex justify-center">{chips}</span>

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])

  async function create() {
    const name = query.trim()
    if (!name || creating) return
    if (value.length >= PLAN_LIMITS.resources) return
    setCreating(true)
    try {
      const created = await onCreate(name)
      onChange([...value, created.id])
      setQuery('')
    } catch {
      // a mensagem já foi mostrada por quem criou
    } finally {
      setCreating(false)
    }
  }

  return (
    <AppPopover
      label={t('plan.resourcesOf', { name: itemName })}
      className="w-64"
      onOpenChange={(open) => {
        if (!open) setQuery('')
      }}
      trigger={
        <button
          type="button"
          aria-label={t('plan.resourcesOfValue', { name: itemName, value: selected.map((r) => r.name).join(', ') || t('plan.noResources') })}
          className={cn(cellButton, 'group/cell')}
        >
          {selected.length ? chips : <Plus aria-hidden className="size-4 text-subtle opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100" />}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const only = matches.length === 1 ? matches[0] : undefined
              if (only && q) toggle(only.id)
              else if (!exact && canCreate) void create()
            }
          }}
          maxLength={PLAN_LIMITS.resourceName}
          aria-label={t('plan.findOrCreate')}
          placeholder={t('plan.findOrCreate')}
          className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
        />
        <div className="flex max-h-60 flex-col gap-0.5 overflow-auto">
          {matches.map((r) => {
            const on = value.includes(r.id)
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(r.id)}
                disabled={!on && value.length >= PLAN_LIMITS.resources}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong')}>
                  {on && <Check className="size-3" />}
                </span>
                <ResourceChip resource={r} />
              </button>
            )
          })}
          {matches.length === 0 && !canCreate && <p className="px-2 py-1.5 text-sm text-subtle">{t('plan.noResourcesFound')}</p>}
        </div>
        {canCreate && q && !exact && (
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium text-primary-text hover:bg-primary-soft disabled:opacity-50 [&_svg]:size-3.5"
          >
            <Plus />
            {t('plan.createResource', { name: query.trim() })}
          </button>
        )}
        <button
          type="button"
          onClick={onEditLabels}
          className="flex items-center justify-center gap-1.5 border-t border-border pt-2 text-xs font-medium text-muted hover:text-fg [&_svg]:size-3.5"
        >
          <Settings2 />
          {t('plan.editLabels')}
        </button>
      </div>
    </AppPopover>
  )
}

/* ------------------------------------------------------------------ números */

export function NumberCell({
  value,
  label,
  readOnly,
  integer,
  max,
  suffix,
  title,
  onChange,
}: {
  value: number | null
  label: string
  readOnly: boolean
  integer?: boolean
  max: number
  suffix?: string
  title?: string
  onChange: (value: number | null) => void
}) {
  const { t, i18n } = useTranslation()
  const shown = formatNumber(value, i18n.language)
  const display = shown === null ? '' : suffix ? `${shown} ${suffix}` : shown
  return (
    <span title={title} className="block">
      <AppInlineEdit
        value={formatNumberInput(value, i18n.language)}
        display={display}
        label={label}
        readOnly={readOnly}
        align="center"
        inputMode={integer ? 'numeric' : 'decimal'}
        className="tabular-nums"
        onCommit={(text) => {
          const parsed = parseNumberInput(text, { integer, max })
          if (!parsed.ok) {
            notify.error(integer ? t('plan.invalidInteger', { max: formatNumber(max, i18n.language) }) : t('plan.invalidNumber', { max: formatNumber(max, i18n.language) }))
            return false
          }
          if (parsed.value !== value) onChange(parsed.value)
        }}
      />
    </span>
  )
}

/* ------------------------------------------------------------------ progresso */

export function ProgressBar({ value, className, label }: { value: number; className?: string; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <span className={cn('flex w-full items-center gap-2', className)}>
      <span role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span className={cn('block h-full rounded-full', clamped >= 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${clamped}%` }} />
      </span>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted">{clamped}%</span>
    </span>
  )
}

export function ProgressCell({
  value,
  source,
  itemName,
  editable,
  onChange,
}: {
  value: number
  source: ProgressSource
  itemName: string
  /** Pode digitar (tem permissão e o progresso não é automático). */
  editable: boolean
  onChange: (value: number | null) => void
}) {
  const { t } = useTranslation()
  const label = t('plan.progressOf', { name: itemName })
  const bar = <ProgressBar value={value} label={label} />
  if (!editable)
    return (
      <span title={t(`plan.progressSource.${source}`)} className="flex h-full items-center px-1">
        {bar}
      </span>
    )
  return (
    <span title={t(`plan.progressSource.${source}`)} className="block">
      <AppInlineEdit
        value={source === 'manual' ? String(value) : ''}
        display={bar}
        label={t('plan.editProgress', { name: itemName })}
        inputMode="numeric"
        align="center"
        className="tabular-nums"
        onCommit={(text) => {
          const parsed = parseNumberInput(text, { integer: true, max: 100 })
          if (!parsed.ok) {
            notify.error(t('plan.invalidProgress'))
            return false
          }
          onChange(parsed.value)
        }}
      />
    </span>
  )
}

/* ------------------------------------------------------------------ responsável e data (subelementos) */

export function OwnerCell({
  owner,
  members,
  itemName,
  readOnly,
  onChange,
  labels,
}: {
  owner: { id: string; name: string; avatarUrl?: string | null } | null
  members: ProjectMember[]
  itemName: string
  readOnly: boolean
  onChange: (ownerId: string | null) => void
  /** Rótulos acessíveis (padrão: os do responsável do subelemento). */
  labels?: { popover: string; button: (value: string) => string; empty: string }
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const q = fold(query.trim())
  const people = members.filter((m) => m.user.status === 'active' && (!q || fold(`${m.user.name} ${m.user.email}`).includes(q)))
  const face = owner ? (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className="flex">
        <AppAvatar name={owner.name} src={owner.avatarUrl} size="xs" />
      </span>
      <span className="truncate text-xs">{owner.name}</span>
    </span>
  ) : null
  if (readOnly) return <span className="flex justify-center">{face}</span>
  return (
    <AppPopover
      label={labels?.popover ?? t('plan.ownerOf', { name: itemName })}
      className="w-60"
      onOpenChange={(open) => {
        if (!open) setQuery('')
      }}
      trigger={
        <button
          type="button"
          aria-label={labels ? labels.button(owner?.name ?? labels.empty) : t('plan.ownerOfValue', { name: itemName, value: owner?.name ?? t('plan.noOwner') })}
          className={cn(cellButton, 'group/cell min-h-8')}
        >
          {face ?? <Plus aria-hidden className="size-4 text-subtle opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100" />}
        </button>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('plan.searchPeople')}
            placeholder={t('plan.searchPeople')}
            className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
          />
          <div className="flex max-h-60 flex-col gap-0.5 overflow-auto">
            {owner && (
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  close()
                }}
                className="rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-2"
              >
                {labels?.empty ?? t('plan.noOwner')}
              </button>
            )}
            {people.map((m) => (
              <button
                key={m.user.id}
                type="button"
                aria-pressed={owner?.id === m.user.id}
                onClick={() => {
                  if (owner?.id !== m.user.id) onChange(m.user.id)
                  close()
                }}
                className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2', owner?.id === m.user.id && 'bg-primary-soft text-primary-soft-fg')}
              >
                <span aria-hidden className="flex">
                  <AppAvatar name={m.user.name} src={m.user.avatarUrl} size="xs" />
                </span>
                <span className="truncate">{m.user.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </AppPopover>
  )
}

export function DateCell({
  value,
  itemName,
  readOnly,
  onChange,
  labels,
}: {
  value: string | null
  itemName: string
  readOnly: boolean
  onChange: (value: string | null) => void
  /** Rótulos acessíveis (padrão: os da data do subelemento). */
  labels?: { popover: string; button: (value: string) => string; empty: string }
}) {
  const { t, i18n } = useTranslation()
  const text = formatSchedule(value, value, i18n.language)
  const shown = text ? <span className="text-xs tabular-nums">{text}</span> : null
  if (readOnly) return <span className="flex justify-center">{shown}</span>
  return (
    <AppPopover
      label={labels?.popover ?? t('plan.dueOf', { name: itemName })}
      trigger={
        <button
          type="button"
          aria-label={labels ? labels.button(text ?? labels.empty) : t('plan.dueOfValue', { name: itemName, value: text ?? t('plan.noDate') })}
          className={cn(cellButton, 'group/cell min-h-8')}
        >
          {shown ?? <Plus aria-hidden className="size-4 text-subtle opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100" />}
        </button>
      }
    >
      {(close) => (
        <AppCalendar
          value={value ?? ''}
          focusOnMount
          onChange={(day) => {
            if ((day || null) !== value) onChange(day || null)
            close()
          }}
        />
      )}
    </AppPopover>
  )
}

/* ------------------------------------------------------------------ rodapé */

/** Barra de distribuição de status do grupo (rodapé e grupo recolhido). */
export function StatusBar({ segments, statuses }: { segments: StatusSegment[]; statuses: PlanStatus[] }) {
  const { t } = useTranslation()
  if (!segments.length) return null
  const nameOf = (id: string | null) => statuses.find((s) => s.id === id)?.name ?? t('plan.statusBlank')
  const description = segments.map((s) => t('plan.statusShare', { name: nameOf(s.statusId), count: s.count, percent: s.percent })).join(' · ')
  return (
    <span role="img" aria-label={description} title={description} className="flex h-5 w-full overflow-hidden rounded-sm">
      {segments.map((s) => {
        const status = statuses.find((x) => x.id === s.statusId)
        return <span key={s.statusId ?? 'blank'} className={cn('h-full', !status && 'bg-surface-3')} style={{ width: `${s.percent}%`, backgroundColor: status ? optionSolid(status.color) : undefined }} />
      })}
    </span>
  )
}

/** Total numérico do rodapé: "4,1" + "total". */
export function FooterSum({ value, suffix }: { value: number | null; suffix?: string }) {
  const { t, i18n } = useTranslation()
  const shown = formatNumber(value, i18n.language)
  if (shown === null) return null
  return (
    <span className="flex flex-col items-center leading-tight">
      <span className="text-sm font-medium tabular-nums">{suffix ? `${shown} ${suffix}` : shown}</span>
      <span className="text-[10px] text-subtle">{t('plan.total')}</span>
    </span>
  )
}

