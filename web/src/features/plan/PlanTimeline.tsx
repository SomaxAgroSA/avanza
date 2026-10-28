import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CalendarOff, ChartGantt, Download, Flag, GripVertical, Maximize2 } from 'lucide-react'
import { downloadText } from '@/core/utils/download'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import { formatNumber, type Plan, type PlanItem } from '@/domain/plan'
import type { OptionColor } from '@/domain/task-config'
import { groupTitle, isOverdue } from '@/domain/plan-view'
import { baselineSpan, battery, fitZoom, itemSpan, scheduleCsv, scheduleRange, slipDays } from '@/domain/plan-schedule'
import { PX_PER_DAY, TIMELINE_ZOOMS, dateFromDay, dropSpan, headerTiers, isConflict, isoFromDay, todayOf, type DaySpan, type HeaderSegment, type TimelineZoom } from '@/domain/timeline'
import {
  AppBadge,
  AppButton,
  AppConfirmDialog,
  AppDropdown,
  AppEmptyState,
  AppSelect,
  AppSwitch,
  AppTimeline,
  TIMELINE_DRAG_TYPE,
  notify,
  type AppTimelineBar,
  type AppTimelineGroup,
} from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { optionColor, optionText, optionTint } from '@/features/task-config/config-theme'
import { StatusBar } from './cells'
import { usePlanMutations } from './queries'

const ZOOM_KEY = 'kb.plan.timeline.zoom'
const BASELINE_KEY = 'kb.plan.timeline.baseline'
/** Largura da coluna dos nomes no Gantt (a mesma do AppTimeline em telas médias para cima). */
const LEFT_COLUMN = 288

/**
 * Cronograma do quadro (GP-4): Gantt dos elementos por grupo (subgrupos com o título da fase), escala
 * dias/semanas/meses/trimestres, linha de hoje, linha de base, ajuste automático e exportação; ao lado,
 * Bateria (distribuição de status) e Esforço estimado. Arrastar a barra muda o cronograma do elemento.
 */
export function PlanTimeline({ plan, onOpen }: { plan: Plan; onOpen: (itemId: string) => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const errorMessage = useErrorMessage()
  const mutations = usePlanMutations(plan.project.id)
  const canEdit = plan.capabilities.edit
  const canManage = plan.capabilities.manage
  const area = useRef<HTMLDivElement>(null)

  const [now] = useState(() => new Date())
  const today = todayOf(now)
  const [zoom, setZoomState] = useState<TimelineZoom>(() => {
    const saved = readJson<string>(ZOOM_KEY, 'week')
    return TIMELINE_ZOOMS.find((z) => z === saved) ?? 'week'
  })
  const [showBaseline, setShowBaselineState] = useState<boolean>(() => readJson<boolean>(BASELINE_KEY, true) !== false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [scrollTo, setScrollTo] = useState({ day: today, nonce: 1 })
  const [confirm, setConfirm] = useState<'save' | 'clear' | null>(null)

  const setZoom = (value: TimelineZoom) => {
    setZoomState(value)
    writeJson(ZOOM_KEY, value)
  }
  const setShowBaseline = (value: boolean) => {
    setShowBaselineState(value)
    writeJson(BASELINE_KEY, value)
  }

  const top = useMemo(() => plan.items.filter((i) => !i.parentId), [plan.items])
  const range = useMemo(() => scheduleRange(top, today), [top, today])
  const pxPerDay = PX_PER_DAY[zoom]
  const tiers = useMemo(() => headerTiers(range, zoom), [range, zoom])
  const topFormat = useMemo(() => new Intl.DateTimeFormat(locale, zoom === 'day' || zoom === 'week' ? { month: 'long', year: 'numeric', timeZone: 'UTC' } : { year: 'numeric', timeZone: 'UTC' }), [locale, zoom])
  const bottomFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, zoom === 'day' ? { day: 'numeric', timeZone: 'UTC' } : zoom === 'week' ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { month: 'short', timeZone: 'UTC' }),
    [locale, zoom],
  )
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }), [locale])
  const formatSpan = useCallback(
    (span: DaySpan) => (span.start === span.end ? dayFormat.format(dateFromDay(span.start)) : t('timeline.period', { from: dayFormat.format(dateFromDay(span.start)), to: dayFormat.format(dateFromDay(span.end)) })),
    [dayFormat, t],
  )

  const statusById = useMemo(() => new Map(plan.statuses.map((s) => [s.id, s])), [plan.statuses])
  const spans = useMemo(() => new Map(top.map((i) => [i.id, itemSpan(i)])), [top])
  const links = useMemo(
    () =>
      plan.links
        .filter((l) => l.type === 'blocks' && spans.get(l.fromId) && spans.get(l.toId))
        .map((l) => ({ id: l.id, from: l.fromId, to: l.toId, conflict: isConflict(spans.get(l.fromId) ?? null, spans.get(l.toId) ?? null) })),
    [plan.links, spans],
  )
  const conflicted = useMemo(() => new Set(links.filter((l) => l.conflict).map((l) => l.to)), [links])
  const isoToday = isoFromDay(today)
  const hasBaseline = !!plan.settings.baselineAt

  const toBar = (item: PlanItem, color: OptionColor): AppTimelineBar => {
    const span = itemSpan(item)
    const status = item.statusId ? statusById.get(item.statusId) : undefined
    const overdue = isOverdue(item, isoToday, status?.category ?? null)
    const slip = slipDays(item)
    const extra = [
      status?.name,
      `${item.progress.value}%`,
      overdue ? t('timeline.overdue') : '',
      conflicted.has(item.id) ? t('timeline.conflictHint') : '',
      hasBaseline && slip ? t(slip > 0 ? 'plan.timeline.slipLate' : 'plan.timeline.slipEarly', { count: Math.abs(slip) }) : '',
    ]
      .filter(Boolean)
      .join(', ')
    return {
      id: item.id,
      label: <span className="truncate text-sm text-fg">{item.name}</span>,
      barText: item.name,
      ariaLabel: `${item.name}${span ? `, ${formatSpan(span)}` : ''}${extra ? ` (${extra})` : ''}`,
      span,
      accent: optionColor(color),
      tint: optionTint(color),
      text: optionText(color),
      progress: item.progress.value / 100,
      danger: overdue,
      conflict: conflicted.has(item.id),
      baseline: showBaseline && hasBaseline ? baselineSpan(item) : null,
      draggable: canEdit,
    }
  }

  const byGroup = useMemo(() => {
    const map = new Map<string, PlanItem[]>()
    top.forEach((i) => {
      if (spans.get(i.id)) map.set(i.groupId, [...(map.get(i.groupId) ?? []), i])
    })
    map.forEach((list) => list.sort((a, b) => a.position - b.position))
    return map
  }, [top, spans])
  const groupById = useMemo(() => new Map(plan.groups.map((g) => [g.id, g])), [plan.groups])

  const groups: AppTimelineGroup[] = plan.groups
    .filter((g) => (byGroup.get(g.id) ?? []).length > 0)
    .map((g) => {
      const parent = g.parentId ? groupById.get(g.parentId) : undefined
      const list = byGroup.get(g.id) ?? []
      const summary = g.summary?.startDate && g.summary.endDate ? { span: itemSpan({ startDate: g.summary.startDate, endDate: g.summary.endDate }) as DaySpan, color: optionColor(g.color) } : null
      return {
        key: g.id,
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate" style={{ color: optionText(g.color) }}>
              {parent ? `${groupTitle(parent)} | ${groupTitle(g)}` : groupTitle(g)}
            </span>
            <span className="shrink-0 text-xs font-normal text-muted">{list.length}</span>
          </span>
        ),
        collapsed: collapsed.has(g.id),
        bars: list.map((item) => toBar(item, g.color)),
        summary,
      }
    })
  const unscheduled = top.filter((i) => !spans.get(i.id)).sort((a, b) => a.name.localeCompare(b.name, locale))

  function saveDates(item: PlanItem, span: DaySpan) {
    mutations.updateItem.mutate(
      { id: item.id, input: { startDate: isoFromDay(span.start), endDate: isoFromDay(span.end) } },
      {
        onSuccess: () => notify.success(t('plan.timeline.moved', { name: item.name, period: formatSpan(span) })),
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  }
  const itemById = (id: string) => top.find((i) => i.id === id)

  function fit() {
    const width = (area.current?.clientWidth ?? 1200) - LEFT_COLUMN
    setZoom(fitZoom(range, width))
    setScrollTo((s) => ({ day: range.start, nonce: s.nonce + 1 }))
  }

  function exportCsv() {
    const labels = {
      group: t('plan.timeline.group'),
      name: t('plan.columns.item'),
      status: t('plan.columns.status'),
      start: t('plan.timeline.start'),
      end: t('plan.timeline.end'),
      duration: t('plan.columns.duration'),
      estimated: t('plan.columns.estimated'),
      progress: t('plan.columns.progress'),
      baselineStart: t('plan.timeline.baselineStart'),
      baselineEnd: t('plan.timeline.baselineEnd'),
    }
    downloadText(`${t('plan.timeline.fileName')}-${plan.project.key}.csv`, scheduleCsv(plan, locale, labels), 'text/csv;charset=utf-8')
  }

  function runBaseline(action: 'save' | 'clear') {
    const mutation = action === 'save' ? mutations.saveBaseline : mutations.clearBaseline
    mutation.mutate(undefined, {
      onSuccess: () => {
        notify.success(t(action === 'save' ? 'plan.timeline.baselineSaved' : 'plan.timeline.baselineCleared'))
        setConfirm(null)
        if (action === 'save') setShowBaseline(true)
      },
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  const bat = battery(plan.summary, plan.statuses)
  const doneName = plan.statuses.find((s) => s.category === 'done')?.name ?? t('plan.timeline.done')
  const savedAt = plan.settings.baselineAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(plan.settings.baselineAt) : null

  return (
    <div className="flex flex-col gap-4" ref={area}>
      <div className="flex flex-wrap items-center gap-2">
        <AppSelect
          size="sm"
          className="w-40"
          aria-label={t('timeline.zoom.label')}
          value={zoom}
          onValueChange={(value) => setZoom(value as TimelineZoom)}
          options={TIMELINE_ZOOMS.map((z) => ({ value: z, label: t(`timeline.zoom.${z}`) }))}
        />
        <AppButton variant="secondary" size="sm" leftIcon={<CalendarDays />} onClick={() => setScrollTo((s) => ({ day: today, nonce: s.nonce + 1 }))}>
          {t('timeline.today')}
        </AppButton>
        <AppButton variant="secondary" size="sm" leftIcon={<Maximize2 />} onClick={fit}>
          {t('plan.timeline.fit')}
        </AppButton>
        {hasBaseline && <AppSwitch size="sm" checked={showBaseline} onCheckedChange={setShowBaseline} label={<span className="text-xs">{t('plan.timeline.showBaseline')}</span>} />}
        {canManage && (
          <AppDropdown
            trigger={
              <AppButton variant="secondary" size="sm" leftIcon={<Flag />}>
                {t('plan.timeline.baseline')}
              </AppButton>
            }
            items={[
              { key: 'save', label: hasBaseline ? t('plan.timeline.replaceBaseline') : t('plan.timeline.saveBaseline'), onSelect: () => (hasBaseline ? setConfirm('save') : runBaseline('save')) },
              ...(hasBaseline ? [{ key: 'clear', label: t('plan.timeline.clearBaseline'), onSelect: () => setConfirm('clear') }] : []),
            ]}
          />
        )}
        <AppButton variant="secondary" size="sm" leftIcon={<Download />} onClick={exportCsv} disabled={top.length === 0}>
          {t('plan.timeline.export')}
        </AppButton>
        {!canEdit && <AppBadge>{t('kanban.readOnly')}</AppBadge>}
        <p className="ml-auto text-xs text-muted" aria-live="polite">
          {t('timeline.summary', { count: top.length - unscheduled.length })} · {t('timeline.unscheduledCount', { count: unscheduled.length })}
          {savedAt && <span> · {t('plan.timeline.baselineAt', { date: savedAt })}</span>}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        {groups.length === 0 ? (
          <AppEmptyState icon={<ChartGantt />} title={t('plan.timeline.empty')} description={t('plan.timeline.emptyHint')} />
        ) : (
          <AppTimeline
            label={t('plan.timeline.label', { name: plan.project.name })}
            groups={groups}
            showGroupHeaders
            range={range}
            pxPerDay={pxPerDay}
            today={today}
            tiers={tiers}
            formatTop={(seg: HeaderSegment) => topFormat.format(dateFromDay(seg.start))}
            formatBottom={(seg: HeaderSegment) => bottomFormat.format(dateFromDay(seg.start))}
            formatSpan={formatSpan}
            leftHeader={t('plan.columns.item')}
            todayLabel={t('timeline.today')}
            keyboardHint={t('timeline.keyboardHint')}
            links={links}
            shadeWeekends={zoom === 'day' || zoom === 'week'}
            scrollTo={scrollTo}
            onToggleGroup={(key) =>
              setCollapsed((set) => {
                const next = new Set(set)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              })
            }
            onOpen={onOpen}
            onChange={(id, span) => {
              const item = itemById(id)
              if (item) saveDates(item, span)
            }}
            onDropExternal={
              canEdit
                ? (id, day) => {
                    const item = itemById(id)
                    if (item) saveDates(item, dropSpan(day, item.estimatedHours))
                  }
                : undefined
            }
          />
        )}

        <div className="flex flex-col gap-4 xl:max-h-[calc(100dvh-17rem)] xl:overflow-y-auto">
          <section aria-labelledby="plan-battery" className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
            <h2 id="plan-battery" className="text-sm font-semibold text-fg">
              {t('plan.timeline.battery')}
            </h2>
            <p className="text-2xl font-semibold tabular-nums text-fg">
              {formatNumber(bat.donePercent, locale)}% <span className="text-sm font-normal text-muted">{doneName}</span>
            </p>
            <StatusBar segments={bat.segments} statuses={plan.statuses} />
            <ul className="flex flex-col gap-1 text-xs text-muted">
              {bat.segments.map((s) => {
                const status = s.statusId ? statusById.get(s.statusId) : undefined
                return (
                  <li key={s.statusId ?? 'blank'} className="flex items-center gap-2">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-surface-3" style={status ? { backgroundColor: optionColor(status.color) } : undefined} />
                    <span className="min-w-0 flex-1 truncate">{status?.name ?? t('plan.statusBlank')}</span>
                    <span className="tabular-nums">{formatNumber(s.percent, locale)}%</span>
                  </li>
                )
              })}
            </ul>
          </section>
          <section aria-labelledby="plan-effort" className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 shadow-card">
            <h2 id="plan-effort" className="text-sm font-semibold text-fg">
              {t('plan.timeline.effort')}
            </h2>
            <p className="text-2xl font-semibold tabular-nums text-fg">{formatNumber(plan.summary?.estimatedHours ?? null, locale) ?? '0'}</p>
            <p className="text-xs text-muted">{t('plan.timeline.effortHint')}</p>
          </section>
          <section aria-labelledby="plan-unscheduled" className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
            <h2 id="plan-unscheduled" className="flex items-center gap-2 text-sm font-semibold text-fg">
              <CalendarOff className="size-4 text-muted" aria-hidden /> {t('plan.timeline.unscheduled')}
              <span className="text-xs font-normal text-muted">{unscheduled.length}</span>
            </h2>
            <p className="text-xs text-muted">{canEdit ? t('plan.timeline.unscheduledHint') : t('plan.timeline.unscheduledReadOnly')}</p>
            {unscheduled.length === 0 ? (
              <p className="py-3 text-center text-xs text-subtle">{t('timeline.allScheduled')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {unscheduled.map((item) => (
                  <li
                    key={item.id}
                    draggable={canEdit}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(TIMELINE_DRAG_TYPE, item.id)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5"
                  >
                    {canEdit && <GripVertical className="size-4 shrink-0 cursor-grab text-subtle" aria-hidden />}
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-sm text-fg hover:text-primary-text" onClick={() => onOpen(item.id)}>
                      {item.name}
                    </button>
                    {canEdit && (
                      <AppButton variant="ghost" size="sm" aria-label={t('plan.timeline.scheduleToday', { name: item.name })} onClick={() => saveDates(item, dropSpan(today, item.estimatedHours))}>
                        {t('plan.timeline.today')}
                      </AppButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <AppConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'clear' ? t('plan.timeline.clearTitle') : t('plan.timeline.replaceTitle')}
        description={confirm === 'clear' ? t('plan.timeline.clearDescription') : t('plan.timeline.replaceDescription')}
        confirmLabel={confirm === 'clear' ? t('plan.timeline.clearBaseline') : t('plan.timeline.replaceBaseline')}
        loading={mutations.saveBaseline.isPending || mutations.clearBaseline.isPending}
        onConfirm={() => confirm && runBaseline(confirm)}
      />
    </div>
  )
}
