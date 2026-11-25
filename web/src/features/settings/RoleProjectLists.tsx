import { useTranslation } from 'react-i18next'
import { PROJECT_LISTS, PROJECT_LIST_LABELS, toggleProjectList, type ProjectList } from '@/domain/project-lists'
import { AppCheckbox } from '@/presentation/components'

/**
 * Projetos do perfil (ajuste 25/11, aprovado em demonstração): "Listas no menu" — uma caixa de marcar por lista
 * (sempre ao menos uma). Com uma só, Projetos abre direto nela. Só a tela: as permissões do perfil não mudam.
 */
export function RoleProjectLists({ value, onChange }: { value: ProjectList[]; onChange: (next: ProjectList[]) => void }) {
  const { t } = useTranslation()
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-semibold text-fg">{t('roles.projects.title')}</legend>
      <div role="group" aria-label={t('roles.projects.lists')} className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">{t('roles.projects.lists')}</span>
        <ul className="flex flex-col rounded-md border border-border bg-surface p-1">
          {PROJECT_LISTS.map((list) => (
            <li key={list}>
              <AppCheckbox
                className="flex w-full rounded px-2 py-1.5 hover:bg-surface-2"
                label={t(PROJECT_LIST_LABELS[list])}
                checked={value.includes(list)}
                // a última marcada não se desmarca: o menu Projetos sempre tem ao menos uma lista
                disabled={value.length === 1 && value[0] === list}
                onCheckedChange={(on) => onChange(toggleProjectList(value, list, on))}
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{t('roles.projects.hint')}</p>
      </div>
    </fieldset>
  )
}
