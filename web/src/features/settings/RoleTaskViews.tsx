import { useTranslation } from 'react-i18next'
import { TASK_SCREENS, screenStart, shownScreens, startScreen, toggleScreen, type TaskScreen, type TaskViews } from '@/domain/task-views'
import { AppCheckbox, AppSelect } from '@/presentation/components'

/**
 * Tarefas do perfil (ajustes 23 e 24/11, aprovado em demonstração): "O que aparece" — a Lista e cada caixa da
 * Caixa de entrada, com uma caixa de marcar por tela (sempre ao menos uma) — e "Ao entrar em Tarefas abre", entre
 * as marcadas. Só a tela: o que a pessoa pode fazer continua nas permissões. Com uma só marcada (ajuste 25/11), a
 * tela se chama "Caixa de entrada", sem botões, e abre direto com os dados (a dica embaixo da lista diz isso).
 */
export function RoleTaskViews({ value, onChange }: { value: TaskViews; onChange: (next: TaskViews) => void }) {
  const { t } = useTranslation()
  const shown = shownScreens(value)
  // perfil gravado com uma entrada que já não aparece: mostra a primeira marcada (é onde o menu abre de fato)
  const start = shown.includes(startScreen(value.tasksStart)) ? startScreen(value.tasksStart) : shown[0]!
  const name = (screen: TaskScreen) => (screen === 'list' ? t('taskList.viewList') : t(`demands.tabs.${screen}`))
  const entry = (screen: TaskScreen) => (screen === 'list' ? t('taskList.viewList') : `${t('taskList.viewDemands')} · ${t(`demands.tabs.${screen}`)}`)
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-semibold text-fg">{t('roles.tasks.title')}</legend>
      <div role="group" aria-label={t('roles.tasks.show')} className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">{t('roles.tasks.show')}</span>
        <ul className="flex flex-col rounded-md border border-border bg-surface p-1">
          {TASK_SCREENS.map((screen) => (
            <li key={screen}>
              <AppCheckbox
                className="flex w-full rounded px-2 py-1.5 hover:bg-surface-2"
                label={name(screen)}
                checked={shown.includes(screen)}
                // a última marcada não se desmarca: o perfil sempre vê ao menos uma tela
                disabled={shown.length === 1 && shown[0] === screen}
                onCheckedChange={(on) => onChange(toggleScreen(value, screen, on))}
              />
            </li>
          ))}
        </ul>
        {/* ajuste 25/11: com uma tela só marcada, a Caixa de entrada abre direto, sem botões */}
        <p className="text-xs text-muted">{t('roles.tasks.hint')}</p>
      </div>
      <AppSelect
        label={t('roles.tasks.start')}
        value={start}
        onValueChange={(screen) => onChange({ ...value, tasksStart: screenStart(screen as TaskScreen) })}
        options={shown.map((screen) => ({ value: screen, label: entry(screen) }))}
      />
    </fieldset>
  )
}
