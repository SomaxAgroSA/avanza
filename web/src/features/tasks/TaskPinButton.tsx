import { useTranslation } from 'react-i18next'
import { Pin } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { pinStateOf, type PinChoices, type TaskPinCounts, type TaskSummary } from '@/domain/tasks'
import { AppDropdown, AppIconButton } from '@/presentation/components'
import { PIN_TONE, pinMenuItems, pinStatus, type PinRoom, type PinScope, type PinToggle } from './pin-choices'

export interface TaskPinButtonProps {
  task: TaskSummary
  choices: PinChoices
  room: PinRoom
  counts?: TaskPinCounts
  onToggle: PinToggle
  /** Gravando a fixação desta linha. */
  pending: boolean
}

/**
 * O 📌 da linha da Lista de tarefas (§50/§55). Com as duas opções, abre um menu pequeno (Radix: papel menu, setas,
 * Esc devolve o foco ao botão); com uma só, um clique fixa/desafixa nela; sem nenhuma ação ("para todos" visível
 * para quem não edita), só mostra a fixação na dica. A linha fica igual às outras: só a cor do ícone muda.
 */
export function TaskPinButton({ task, choices, room, counts, onToggle, pending }: TaskPinButtonProps) {
  const { t, i18n } = useTranslation()
  const state = pinStateOf(task)
  const status = pinStatus(task, t, i18n.language)
  const icon = <Pin className={cn(state !== 'none' && 'fill-current')} />
  const common = { size: 'sm' as const, icon, 'data-testid': 'task-pin', 'data-pin-state': state }

  if (choices.mode === 'menu') {
    return (
      <AppDropdown
        items={pinMenuItems(task, choices, room, counts, t, onToggle)}
        trigger={
          <AppIconButton
            {...common}
            label={status ?? t('tasks.pin.action')}
            aria-label={`${t('tasks.pin.column')}: ${task.title}`}
            className={PIN_TONE[state]}
            disabled={pending}
          />
        }
      />
    )
  }

  // um clique (só uma opção no perfil) ou só a informação (sem ação)
  const scope: PinScope | null = choices.mode === 'mine' ? 'mine' : choices.mode === 'all' ? 'all' : null
  const on = scope === 'mine' ? !!task.pinnedMine : !!task.pinned
  const action = t(scope ? (on ? `tasks.pin.${scope}.remove` : `tasks.pin.${scope}.action`) : task.pinned ? 'tasks.pin.remove' : 'tasks.pin.action')
  const hint = status ? (scope && on ? t('tasks.pin.hintRemove', { pinned: status }) : status) : action
  return (
    <AppIconButton
      {...common}
      label={hint}
      aria-label={`${action}: ${task.title}`}
      aria-pressed={on}
      className={cn(PIN_TONE[state], !scope && 'cursor-default hover:bg-transparent')}
      // sem ação: aria-disabled (e não disabled) para a dica de quem fixou continuar aparecendo
      aria-disabled={!scope || undefined}
      disabled={!!scope && pending}
      onClick={scope ? () => onToggle(task, scope, !on) : undefined}
    />
  )
}
