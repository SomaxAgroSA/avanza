import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_PROJECT_FILTER,
  filterProjectsBySettings,
  isDefaultProjectFilter,
  toProjectFilterSubject,
  type ProjectFilterScreen,
  type ProjectFilterSettings,
} from '@/domain/project-filter'
import type { Project } from '@/domain/projects'
import { notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useRepositories } from '@/presentation/common/repositories-context'
import { PROJECT_OPTIONS_QUERY, useProjects } from './queries'

/** Fora do prefixo `auth`: some junto com os demais dados quando a sessão acaba (são da pessoa). */
export const preferenceKeys = {
  projectFilter: (screen: ProjectFilterScreen) => ['preferences', 'project_filter', screen] as const,
}

/**
 * Configurador do filtro de projetos de uma tela (por pessoa). Enquanto carrega — ou se a leitura
 * falhar — vale o padrão; `ready` diz quando a tela já pode confiar no valor. Salvar é otimista: em
 * erro, volta ao anterior e avisa.
 */
export function useProjectFilterSettings(screen: ProjectFilterScreen) {
  const { t } = useTranslation()
  const { preferences } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const key = preferenceKeys.projectFilter(screen)
  const query = useQuery({ queryKey: key, queryFn: () => preferences.getProjectFilter(screen), staleTime: 5 * 60_000 })
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: (next: ProjectFilterSettings) => preferences.saveProjectFilter(screen, isDefaultProjectFilter(next) ? null : next),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ProjectFilterSettings>(key)
      queryClient.setQueryData(key, next)
      return { previous }
    },
    onError: (error, _next, context) => {
      queryClient.setQueryData(key, context?.previous ?? DEFAULT_PROJECT_FILTER)
      notify.error(t('projects.filterSettings.saveError', { reason: errorMessage(error) }))
    },
  })
  const settings = query.data ?? DEFAULT_PROJECT_FILTER
  return {
    settings,
    ready: !query.isPending,
    active: !isDefaultProjectFilter(settings),
    save: (next: ProjectFilterSettings) => mutation.mutate(next),
    reset: () => mutation.mutate(DEFAULT_PROJECT_FILTER),
  }
}

/**
 * Projetos da lista geral que a tela mostra no filtro de projeto, já com o configurador aplicado.
 * `keep` = ids em uso (projeto aberto, escolhidos), que nunca somem da lista.
 */
export function useScreenProjects(screen: ProjectFilterScreen, keep: readonly string[] = [], enabled = true) {
  const projects = useProjects(PROJECT_OPTIONS_QUERY, enabled)
  const filter = useProjectFilterSettings(screen)
  const keepKey = keep.join(',')
  const items = useMemo<Project[]>(
    () => filterProjectsBySettings(projects.data?.items ?? [], filter.settings, toProjectFilterSubject, keepKey ? keepKey.split(',') : []),
    [projects.data, filter.settings, keepKey],
  )
  return { items, all: projects.data?.items, loaded: !!projects.data, filter }
}
