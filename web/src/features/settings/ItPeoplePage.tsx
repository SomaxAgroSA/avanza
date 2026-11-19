import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Save } from 'lucide-react'
import { AppButton, AppCard, AppErrorState, AppMultiSelect, AppSkeleton, notify } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useErrorMessage } from '@/presentation/common/use-error-message'

const IT_PEOPLE_KEY = ['platform', 'it-people'] as const

/**
 * Configurações → Pessoas de TI (settings.manage; regras §42): quem é de TI para as "Dependências de TI" do
 * painel Direção e gerência. O Responsável TI de cada projeto conta no projeto dele sem estar aqui.
 */
export function ItPeoplePage() {
  const { t } = useTranslation()
  const { platform } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const current = useQuery({ queryKey: IT_PEOPLE_KEY, queryFn: () => platform.getItPeople() })
  // null = sem mudança na tela: vale a lista salva
  const [draft, setDraft] = useState<string[] | null>(null)
  const selected = draft ?? current.data?.userIds ?? []
  const save = useMutation({
    mutationFn: (ids: string[]) => platform.updateItPeople(ids),
    onSuccess: (data) => {
      queryClient.setQueryData(IT_PEOPLE_KEY, (old: typeof data | undefined) => ({ ...data, candidates: data.candidates.length ? data.candidates : (old?.candidates ?? []) }))
      setDraft(null)
      // o painel Direção e gerência recalcula as entregas
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'ti-dependencies'] })
      notify.success(t('tiDependencies.settings.saved'))
    },
    onError: (error) => notify.error(errorMessage(error)),
  })
  // as já escolhidas entram nas opções mesmo se a pessoa ficou inativa (para poder tirar)
  const options = useMemo(() => {
    const people = new Map([...(current.data?.candidates ?? []), ...(current.data?.users ?? [])].map((u) => [u.id, u]))
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ value: u.id, label: u.email ? `${u.name} · ${u.email}` : u.name }))
  }, [current.data])
  const dirty = !!current.data && [...selected].sort().join() !== [...current.data.userIds].sort().join()

  return (
    <>
      <PageHeader
        title={t('tiDependencies.settings.title')}
        description={t('tiDependencies.settings.description')}
        actions={
          current.data && (
            <AppButton leftIcon={<Save />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(selected)}>
              {t('tiDependencies.settings.save')}
            </AppButton>
          )
        }
      />
      {current.isPending ? (
        <AppSkeleton className="h-28 rounded-xl" />
      ) : current.isError ? (
        <AppErrorState onRetry={() => void current.refetch()} />
      ) : (
        <AppCard className="max-w-2xl">
          <AppMultiSelect
            label={t('tiDependencies.settings.label')}
            placeholder={t('tiDependencies.settings.placeholder')}
            hint={t('tiDependencies.settings.hint')}
            value={selected}
            onValueChange={setDraft}
            options={options}
          />
        </AppCard>
      )}
    </>
  )
}
