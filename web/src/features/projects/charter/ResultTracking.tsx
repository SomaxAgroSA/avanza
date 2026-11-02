import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppError } from '@/core/errors/app-error'
import { formatDayValue, today } from '@/core/utils/calendar'
import { formatDay } from '@/core/utils/format'
import { CHARTER_LIMITS, SITUATION_TONE, formatMeasure, type ResultItem } from '@/domain/charter'
import { AppAvatar, AppBadge, AppButton, AppDatePicker, AppDialog, AppDrawer, AppEmptyState, AppSkeleton, AppTextField, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { ProgressBar } from './ProgressBar'
import { useCharterMutations, useMeasurements } from './queries'

const utcDay = (day: string) => new Date(`${day}T00:00:00.000Z`)
const todayIso = () => formatDayValue(today())

/** Registrar uma medição: a de data mais recente vira o valor atual. */
export function MeasurementDialog({ projectId, item, onClose }: { projectId: string; item: ResultItem | null; onClose: () => void }) {
  if (!item) return null
  return <MeasurementForm key={item.id} projectId={projectId} item={item} onClose={onClose} />
}

function MeasurementForm({ projectId, item, onClose }: { projectId: string; item: ResultItem; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const errorMessage = useErrorMessage()
  const { measure } = useCharterMutations(projectId)
  const [value, setValue] = useState('')
  const [measuredAt, setMeasuredAt] = useState(todayIso())
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function submit() {
    const number = Number(value.replace(',', '.'))
    const found: Record<string, string> = {}
    if (!value.trim()) found.value = 'required'
    else if (!Number.isFinite(number)) found.value = 'invalid_type'
    if (measuredAt && measuredAt > todayIso()) found.measured_at = 'in_future'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    measure.mutate(
      { id: item.id, input: { value: number, note: note.trim(), measuredAt: measuredAt || undefined } },
      {
        onSuccess: () => {
          notify.success(t('charter.measure.saved', { title: item.title }))
          onClose()
        },
        onError: (error) => (isAppError(error) && error.code === 'VALIDATION_ERROR' ? setErrors(error.fieldErrors()) : notify.error(errorMessage(error))),
      },
    )
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && !measure.isPending && onClose()}
      size="lg"
      closeOnOutsideClick={false}
      title={t('charter.measure.title')}
      description={t('charter.measure.hint', { title: item.title, target: formatMeasure(item.target, item.unit, i18n.language), current: formatMeasure(item.current, item.unit, i18n.language) })}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={measure.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={measure.isPending}>
            {t('common.save')}
          </AppButton>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <AppTextField label={t('charter.measure.value', { unit: item.unit || '—' })} required inputMode="decimal" autoComplete="off" value={value} error={errors.value} onChange={(event) => setValue(event.target.value)} />
          <AppDatePicker label={t('charter.measure.date')} value={measuredAt} error={errors.measured_at} onValueChange={setMeasuredAt} />
        </div>
        <AppTextarea label={t('charter.measure.note')} placeholder={t('charter.measure.notePlaceholder')} rows={2} maxLength={CHARTER_LIMITS.note} value={note} error={errors.note} onChange={(event) => setNote(event.target.value)} />
      </form>
    </AppDialog>
  )
}

/** Visualizar um resultado: números, situação e a série de medições. */
export function ResultDrawer({ item, canMeasure, onMeasure, onClose }: { item: ResultItem | null; canMeasure: boolean; onMeasure: (item: ResultItem) => void; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const series = useMeasurements(item?.id ?? null)
  if (!item) return null
  const fmt = (v: number | null) => formatMeasure(v, item.unit, locale)
  const facts: Array<[string, string]> = [
    [t('charter.fields.baseline'), fmt(item.baseline)],
    [t('charter.fields.target'), fmt(item.target)],
    [t('charter.fields.current'), fmt(item.current)],
    [t('charter.fields.startDate'), item.startDate ? formatDay(utcDay(item.startDate), locale) : '—'],
    [t('charter.fields.dueDate'), item.dueDate ? formatDay(utcDay(item.dueDate), locale) : '—'],
    [t('charter.fields.frequency'), t(`charter.frequency.${item.frequency}`)],
    [t('charter.fields.owner'), item.owner?.name ?? t('charter.fields.noOwner')],
  ]
  return (
    <AppDrawer
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={item.title}
      description={item.description || undefined}
      footer={
        canMeasure ? (
          <AppButton onClick={() => onMeasure(item)} className="ml-auto">
            {t('charter.measure.action')}
          </AppButton>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <AppBadge tone={SITUATION_TONE[item.situation]} dot>
            {t(`charter.situation.${item.situation}`)}
          </AppBadge>
          {item.stale && <AppBadge tone="warning">{t('charter.stale')}</AppBadge>}
        </div>
        <ProgressBar value={item.percent} label={t('charter.percentOfTarget', { percent: item.percent })} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
              <dd className="tabular-nums text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        <section aria-labelledby="charter-series" className="flex flex-col gap-2">
          <h3 id="charter-series" className="text-sm font-semibold text-fg">
            {t('charter.measure.series')}
          </h3>
          {series.isPending ? (
            <AppSkeleton className="h-24" />
          ) : (series.data ?? []).length === 0 ? (
            <AppEmptyState compact title={t('charter.measure.empty')} description={t('charter.measure.emptyHint')} />
          ) : (
            <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {(series.data ?? []).map((m) => (
                <li key={m.id} className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold tabular-nums text-fg">{fmt(m.value)}</span>
                    <span className="text-xs tabular-nums text-muted">{formatDay(utcDay(m.measuredAt), locale)}</span>
                  </div>
                  {m.note && <p className="text-sm text-muted">{m.note}</p>}
                  {m.createdBy && (
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      <AppAvatar name={m.createdBy.name} src={m.createdBy.avatarUrl} size="xs" /> {m.createdBy.name}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </AppDrawer>
  )
}
