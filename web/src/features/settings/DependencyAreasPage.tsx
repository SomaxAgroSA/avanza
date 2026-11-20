import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Save, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { TI_AREA_KEY, type DependencyArea } from '@/domain/dependencies'
import { AppButton, AppCard, AppErrorState, AppIconButton, AppMultiSelect, AppSkeleton, AppTextField, notify } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useErrorMessage } from '@/presentation/common/use-error-message'

const AREAS_KEY = ['platform', 'dependency-areas'] as const
const KNOWN_ERRORS = ['name_required', 'name_too_long', 'duplicate_name', 'duplicate_person', 'too_many', 'too_many_people']

type Draft = Array<Pick<DependencyArea, 'key' | 'name' | 'userIds'> & { id: string }>

/**
 * Configurações → Dependências por área (settings.manage; regras §42): as áreas que entregam coisas aos
 * projetos e as pessoas de cada uma. A TI sempre existe (pode ser renomeada, não removida): o Responsável TI
 * de cada projeto conta nela sem estar aqui. Uma pessoa fica em uma área só.
 */
export function DependencyAreasPage() {
  const { t } = useTranslation()
  const { platform } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const current = useQuery({ queryKey: AREAS_KEY, queryFn: () => platform.getDependencyAreas() })
  // null = sem mudança na tela: vale a lista salva
  const [draft, setDraft] = useState<Draft | null>(null)
  const saved: Draft = useMemo(() => (current.data?.areas ?? []).map((a) => ({ id: a.key, key: a.key, name: a.name, userIds: a.userIds })), [current.data])
  const areas = draft ?? saved
  const save = useMutation({
    mutationFn: (list: Draft) => platform.updateDependencyAreas(list.map(({ key, name, userIds }) => ({ key, name: name.trim(), userIds }))),
    onSuccess: (data) => {
      queryClient.setQueryData(AREAS_KEY, (old: typeof data | undefined) => ({ ...data, candidates: data.candidates.length ? data.candidates : (old?.candidates ?? []) }))
      setDraft(null)
      // o painel Direção e gerência recalcula as entregas
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'dependencies'] })
      notify.success(t('dependencies.settings.saved'))
    },
    onError: (error) => {
      const code = isAppError(error) ? error.fieldErrors().areas : undefined
      notify.error(code && KNOWN_ERRORS.includes(code) ? t(`dependencies.settings.errors.${code}`) : errorMessage(error))
    },
  })

  // pessoas: ativas + as já escolhidas (mesmo se ficaram inativas, para poder tirar)
  const people = useMemo(() => {
    const all = new Map([...(current.data?.candidates ?? []), ...(current.data?.areas ?? []).flatMap((a) => a.users)].map((u) => [u.id, u]))
    return [...all.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [current.data])
  const change = (id: string, patch: Partial<Draft[number]>) => setDraft(areas.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  const dirty = JSON.stringify(areas.map(({ key, name, userIds }) => [key, name.trim(), userIds])) !== JSON.stringify(saved.map(({ key, name, userIds }) => [key, name, userIds]))
  const invalid = areas.some((a) => !a.name.trim())

  return (
    <>
      <PageHeader
        title={t('dependencies.settings.title')}
        actions={
          current.data && (
            <AppButton leftIcon={<Save />} disabled={!dirty || invalid} loading={save.isPending} onClick={() => save.mutate(areas)}>
              {t('dependencies.settings.save')}
            </AppButton>
          )
        }
      />
      {current.isPending ? (
        <AppSkeleton className="h-28 rounded-xl" />
      ) : current.isError ? (
        <AppErrorState onRetry={() => void current.refetch()} />
      ) : (
        <div className="flex max-w-3xl flex-col gap-3">
          {areas.map((area) => {
            const isTi = area.key === TI_AREA_KEY
            // quem já está em outra área não aparece aqui (uma pessoa, uma área)
            const taken = new Set(areas.filter((other) => other.id !== area.id).flatMap((other) => other.userIds))
            const options = people.filter((u) => !taken.has(u.id)).map((u) => ({ value: u.id, label: u.email ? `${u.name} · ${u.email}` : u.name }))
            return (
              <AppCard key={area.id} className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-start" data-testid="dependency-area">
                <AppTextField label={t('dependencies.settings.name')} value={area.name} maxLength={40} required onChange={(event) => change(area.id, { name: event.target.value })} />
                <AppMultiSelect
                  label={t('dependencies.settings.people')}
                  placeholder={t('dependencies.settings.placeholder')}
                  hint={isTi ? t('dependencies.settings.tiHint') : undefined}
                  value={area.userIds}
                  onValueChange={(userIds) => change(area.id, { userIds })}
                  options={options}
                />
                {isTi ? (
                  <span aria-hidden className="hidden w-9 sm:block" />
                ) : (
                  <AppIconButton
                    className="sm:mt-6"
                    variant="danger"
                    label={t('dependencies.settings.remove', { name: area.name || t('dependencies.settings.newArea') })}
                    icon={<Trash2 />}
                    onClick={() => setDraft(areas.filter((a) => a.id !== area.id))}
                  />
                )}
              </AppCard>
            )
          })}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AppButton variant="secondary" leftIcon={<Plus />} onClick={() => setDraft([...areas, { id: `new-${Date.now()}`, key: '', name: '', userIds: [] }])}>
              {t('dependencies.settings.add')}
            </AppButton>
            <p className="text-xs text-muted">{t('dependencies.settings.hint')}</p>
          </div>
        </div>
      )}
    </>
  )
}
