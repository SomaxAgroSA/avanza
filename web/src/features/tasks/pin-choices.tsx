/** Fixar na Lista de tarefas (§50/§55): tons do 📌, a dica e as opções do menu (as mesmas no "⋯" da linha). */
import type { TFunction } from 'i18next'
import { Pin, PinOff } from 'lucide-react'
import { formatRelative } from '@/core/utils/format'
import {
  MAX_PERSONAL_PINNED_TASKS,
  MAX_PINNED_TASKS,
  pinStateOf,
  type PinChoices,
  type PinState,
  type TaskPinCounts,
  type TaskSummary,
} from '@/domain/tasks'
import type { AppDropdownItem } from '@/presentation/components'

/** Para quem a fixação vale: só para quem olha (§55) ou para todos (§50). */
export type PinScope = 'mine' | 'all'
export type PinToggle = (task: TaskSummary, scope: PinScope, pinned: boolean) => void

/** Cabe mais uma fixada em cada escopo (domain/tasks.ts#pinRoom). */
export type PinRoom = { mine: boolean; all: boolean }

/** Cor do 📌 (ajuste 27/11): azul = fixada para mim (manda quando é as duas), verde = para todos, cinza = sem fixar. */
export const PIN_TONE: Record<PinState, string> = {
  both: 'text-info-text hover:text-info-text',
  mine: 'text-info-text hover:text-info-text',
  all: 'text-primary-text hover:text-primary-text',
  none: 'text-subtle opacity-60 hover:opacity-100',
}

/** Como a tarefa está fixada, em palavras (a dica do 📌); null = não fixada. */
export function pinStatus(task: TaskSummary, t: TFunction, locale: string): string | null {
  const state = pinStateOf(task)
  if (state === 'both') return t('tasks.pin.both')
  if (state === 'mine') return t('tasks.pin.mine.state')
  if (!task.pinned) return null
  const when = formatRelative(task.pinned.at, locale)
  return task.pinned.by ? t('tasks.pin.by', { name: task.pinned.by.name, when }) : t('tasks.pin.byNobody', { when })
}

/**
 * Opções de fixar (§55), as mesmas no menu do 📌 e no "⋯" da linha: "Fixar para mim" (ícone azul), separador e
 * "Fixar para todos" (ícone verde), cada uma com a linha que explica; no limite, desligada e dizendo por quê.
 */
export function pinMenuItems(task: TaskSummary, choices: PinChoices, room: PinRoom, counts: TaskPinCounts | undefined, t: TFunction, onToggle: PinToggle): AppDropdownItem[] {
  const option = (scope: PinScope, on: boolean, hasRoom: boolean, max: number, tone: string): AppDropdownItem => ({
    key: `pin-${scope}`,
    label: t(on ? `tasks.pin.${scope}.remove` : `tasks.pin.${scope}.action`),
    description: !on && !hasRoom ? t(`tasks.pin.${scope}.full`, { max }) : t(on ? `tasks.pin.${scope}.removeHint` : `tasks.pin.${scope}.actionHint`),
    icon: on ? <PinOff className={tone} /> : <Pin className={tone} />,
    disabled: !on && !hasRoom,
    onSelect: () => onToggle(task, scope, !on),
  })
  return [
    ...(choices.mine ? [option('mine', !!task.pinnedMine, room.mine, counts?.maxMine ?? MAX_PERSONAL_PINNED_TASKS, 'text-info-text')] : []),
    ...(choices.mine && choices.all ? [{ type: 'separator' as const, key: 'pin-separator' }] : []),
    ...(choices.all ? [option('all', !!task.pinned, room.all, counts?.maxAll ?? MAX_PINNED_TASKS, 'text-primary-text')] : []),
  ]
}
