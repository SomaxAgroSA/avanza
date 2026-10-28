import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import {
  addDays,
  addMonths,
  compareDays,
  dayOfWeek,
  formatDayValue,
  formatLongDay,
  formatMonthYear,
  isSameDay,
  monthGrid,
  monthNames,
  parseDay,
  today as getToday,
  weekStartFor,
  weekdayNames,
  type Day,
} from '@/core/utils/calendar'

export interface AppCalendarProps {
  /** Data selecionada (AAAA-MM-DD) ou '' */
  value: string
  onChange: (value: string) => void
  /** Limites (AAAA-MM-DD), inclusivos. */
  min?: string
  max?: string
  /** Mostra os atalhos "Hoje" e "Limpar". */
  showFooter?: boolean
  clearable?: boolean
  /** Foca o dia selecionado (ou hoje) ao montar — usado quando abre num popover. */
  focusOnMount?: boolean
  /** Fim do intervalo (AAAA-MM-DD): com ele, `value` é o início e os dias entre os dois ficam destacados. */
  rangeEnd?: string
  className?: string
}

type View = 'days' | 'months' | 'years'

const navButton =
  'inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg ' +
  'focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40'

/**
 * Calendário do design system (somente dia). Tema do app, cantos arredondados,
 * idioma/semana conforme o i18n e navegação completa por teclado.
 */
export function AppCalendar({ value, onChange, min, max, showFooter = true, clearable = true, focusOnMount, rangeEnd, className }: AppCalendarProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const selected = parseDay(value)
  const rangeLast = parseDay(rangeEnd)
  const minDay = parseDay(min)
  const maxDay = parseDay(max)
  const todayDay = getToday()
  const start = selected ?? todayDay

  const [view, setView] = useState<View>('days')
  const [visible, setVisible] = useState({ year: start.year, month: start.month })
  const [focused, setFocused] = useState<Day>(start)
  const gridRef = useRef<HTMLDivElement>(null)
  const shouldFocus = useRef(!!focusOnMount)

  const weekStart = weekStartFor(locale)
  const weekdays = useMemo(() => weekdayNames(locale, weekStart, 'narrow'), [locale, weekStart])
  const weekdaysLong = useMemo(() => weekdayNames(locale, weekStart, 'long'), [locale, weekStart])
  const months = useMemo(() => monthNames(locale, 'short'), [locale])
  const grid = useMemo(() => monthGrid(visible.year, visible.month, weekStart), [visible, weekStart])

  const isDisabled = (day: Day) => (!!minDay && compareDays(day, minDay) < 0) || (!!maxDay && compareDays(day, maxDay) > 0)

  // Move o foco do teclado para o dia focado (roving tabindex).
  useEffect(() => {
    if (!shouldFocus.current || view !== 'days') return
    shouldFocus.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${formatDayValue(focused)}"]`)?.focus()
  }, [focused, view])

  function moveFocus(next: Day) {
    shouldFocus.current = true
    setFocused(next)
    if (next.year !== visible.year || next.month !== visible.month) setVisible({ year: next.year, month: next.month })
  }

  function select(day: Day) {
    if (isDisabled(day)) return
    onChange(formatDayValue(day))
  }

  function onDayKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const moves: Record<string, () => Day> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
      Home: () => addDays(focused, -((dayOfWeek(focused) - weekStart + 7) % 7)),
      End: () => addDays(focused, 6 - ((dayOfWeek(focused) - weekStart + 7) % 7)),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    moveFocus(move())
  }

  function shift(direction: -1 | 1) {
    if (view === 'days') {
      const next = addMonths({ ...visible, day: 1 }, direction)
      setVisible({ year: next.year, month: next.month })
    } else {
      setVisible((v) => ({ ...v, year: v.year + direction * (view === 'years' ? 12 : 1) }))
    }
  }

  const yearPageStart = Math.floor(visible.year / 12) * 12
  const title =
    view === 'days' ? capitalizeFirst(formatMonthYear(visible.year, visible.month, locale)) : view === 'months' ? String(visible.year) : `${yearPageStart} – ${yearPageStart + 11}`
  const prevLabel = view === 'days' ? t('calendar.previousMonth') : view === 'months' ? t('calendar.previousYear') : t('calendar.previousYears')
  const nextLabel = view === 'days' ? t('calendar.nextMonth') : view === 'months' ? t('calendar.nextYear') : t('calendar.nextYears')

  const cell = 'rounded-lg text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring'

  return (
    <div className={cn('w-[18.5rem] select-none p-3', className)}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" className={navButton} aria-label={prevLabel} onClick={() => shift(-1)}>
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setView(view === 'days' ? 'months' : view === 'months' ? 'years' : 'days')}
          aria-label={view === 'days' ? t('calendar.chooseMonth') : t('calendar.chooseYear')}
          aria-live="polite"
          className="rounded-lg px-2 py-1 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {title}
        </button>
        <button type="button" className={navButton} aria-label={nextLabel} onClick={() => shift(1)}>
          <ChevronRight className="size-4" />
        </button>
      </div>

      {view === 'days' && (
        <div role="grid" aria-label={title} ref={gridRef}>
          <div role="row" className="mb-1 grid grid-cols-7">
            {weekdays.map((name, index) => (
              <div
                key={index}
                role="columnheader"
                aria-label={weekdaysLong[index]}
                className="flex h-8 items-center justify-center text-xs font-medium uppercase text-subtle"
              >
                {name}
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, week) => (
            <div role="row" key={week} className="grid grid-cols-7 gap-0.5">
              {grid.slice(week * 7, week * 7 + 7).map((day) => {
                const outside = day.month !== visible.month
                const isSelected = isSameDay(day, selected) || (!!rangeLast && isSameDay(day, rangeLast))
                const inRange = !!selected && !!rangeLast && compareDays(day, selected) > 0 && compareDays(day, rangeLast) < 0
                const isToday = isSameDay(day, todayDay)
                const disabled = isDisabled(day)
                const isFocused = isSameDay(day, focused)
                return (
                  <div role="gridcell" key={formatDayValue(day)} aria-selected={isSelected || inRange}>
                    <button
                      type="button"
                      data-day={formatDayValue(day)}
                      tabIndex={isFocused ? 0 : -1}
                      disabled={disabled}
                      aria-label={formatLongDay(day, locale)}
                      aria-current={isToday ? 'date' : undefined}
                      onKeyDown={onDayKeyDown}
                      onClick={() => {
                        setFocused(day)
                        select(day)
                      }}
                      className={cn(
                        cell,
                        'relative flex size-9 w-full items-center justify-center font-medium',
                        isSelected
                          ? 'bg-primary text-primary-fg shadow-sm hover:bg-primary-hover'
                          : inRange
                            ? 'bg-primary-soft text-primary-soft-fg hover:brightness-95'
                            : outside
                            ? 'text-subtle/60 hover:bg-surface-2'
                            : 'text-fg hover:bg-surface-2',
                        isToday && !isSelected && 'text-primary-text ring-1 ring-inset ring-primary/60',
                        disabled && 'cursor-not-allowed opacity-35 hover:bg-transparent',
                      )}
                    >
                      {day.day}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {view === 'months' && (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {months.map((name, month) => {
            const current = selected?.year === visible.year && selected.month === month
            return (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setVisible((v) => ({ ...v, month }))
                  setView('days')
                }}
                className={cn(cell, 'h-11 capitalize', current ? 'bg-primary text-primary-fg' : 'text-fg hover:bg-surface-2', visible.month === month && !current && 'ring-1 ring-inset ring-border-strong')}
              >
                {name.replace('.', '')}
              </button>
            )
          })}
        </div>
      )}

      {view === 'years' && (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {Array.from({ length: 12 }, (_, index) => yearPageStart + index).map((year) => {
            const current = selected?.year === year
            return (
              <button
                key={year}
                type="button"
                onClick={() => {
                  setVisible((v) => ({ ...v, year }))
                  setView('months')
                }}
                className={cn(cell, 'h-11', current ? 'bg-primary text-primary-fg' : 'text-fg hover:bg-surface-2', year === todayDay.year && !current && 'text-primary-text')}
              >
                {year}
              </button>
            )
          })}
        </div>
      )}

      {showFooter && (
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
          <button
            type="button"
            disabled={!clearable || !value}
            onClick={() => onChange('')}
            className="rounded-lg px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          >
            {t('calendar.clear')}
          </button>
          <button
            type="button"
            disabled={isDisabled(todayDay)}
            onClick={() => {
              setVisible({ year: todayDay.year, month: todayDay.month })
              setView('days')
              select(todayDay)
            }}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-primary-text transition-colors hover:bg-primary-soft disabled:opacity-40"
          >
            {t('calendar.today')}
          </button>
        </div>
      )}
    </div>
  )
}

/** "setembro de 2026" -> "Setembro de 2026" (só a primeira letra; CSS capitalize afetaria o "de"). */
function capitalizeFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}
