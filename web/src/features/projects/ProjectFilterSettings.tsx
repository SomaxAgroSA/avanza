import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { OPTIONS_ONLY_SCREENS, toggleProjectFilterStatus, type ProjectFilterScreen } from '@/domain/project-filter'
import { PROJECT_STATUSES } from '@/domain/projects'
import { AppButton, AppCheckbox, AppIconButton, AppPopover, AppSwitch } from '@/presentation/components'
import { useProjectFilterSettings } from './use-project-filter'

export interface ProjectFilterSettingsButtonProps {
  screen: ProjectFilterScreen
  /** `sm` na barra de filtros (altura dos filtros compactos); `md` ao lado do seletor de projeto. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Engrenagem ao lado do filtro de projeto: abre o configurador desta tela (por pessoa) — status do
 * projeto e "só projetos de que participo". Salva a cada mudança; com configuração ativa, mostra um
 * ponto na engrenagem.
 */
export function ProjectFilterSettingsButton({ screen, size = 'md', className }: ProjectFilterSettingsButtonProps) {
  const { t } = useTranslation()
  const { settings, active, save, reset } = useProjectFilterSettings(screen)
  const allStatuses = settings.statuses.length === 0
  const label = active ? t('projects.filterSettings.buttonActive') : t('projects.filterSettings.button')

  return (
    <AppPopover
      label={t('projects.filterSettings.title')}
      align="end"
      className="w-72 p-0"
      trigger={
        <AppIconButton
          variant="secondary"
          size={size}
          label={label}
          data-testid={`project-filter-settings-${screen}`}
          data-active={active || undefined}
          className={cn(size === 'sm' && 'size-8', active && 'border-primary-border text-primary-text', className)}
          icon={
            <span className="relative inline-flex">
              <Settings />
              {active && <span aria-hidden className="absolute -right-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-surface" />}
            </span>
          }
        />
      }
    >
      <div className="flex flex-col gap-4 p-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            {t('projects.filterSettings.title')}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{t('projects.filterSettings.hint')}</p>
          {OPTIONS_ONLY_SCREENS.includes(screen) && <p className="mt-1 text-xs text-subtle">{t('projects.filterSettings.optionsOnly')}</p>}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{t('projects.filterSettings.statuses')}</legend>
          <AppCheckbox
            checked={allStatuses}
            label={t('projects.filterSettings.allStatuses')}
            onCheckedChange={(checked) => checked && save({ ...settings, statuses: [] })}
          />
          {PROJECT_STATUSES.map((status) => (
            <AppCheckbox
              key={status}
              checked={settings.statuses.includes(status)}
              label={t(`projects.status.${status}`)}
              onCheckedChange={(checked) => save(toggleProjectFilterStatus(settings, status, checked))}
            />
          ))}
        </fieldset>

        <AppSwitch
          size="sm"
          checked={settings.membersOnly}
          onCheckedChange={(membersOnly) => save({ ...settings, membersOnly })}
          label={t('projects.filterSettings.membersOnly')}
          description={t('projects.filterSettings.membersOnlyHint')}
        />

        <div className="flex justify-end border-t border-border pt-3">
          <AppButton variant="ghost" size="sm" disabled={!active} onClick={reset}>
            {t('projects.filterSettings.reset')}
          </AppButton>
        </div>
      </div>
    </AppPopover>
  )
}
