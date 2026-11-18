import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { ProjectView } from '@/domain/projects'
import type { ProjectListQuery, ProjectPage } from '@/domain/repositories'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ProjectsPage } from './ProjectsPage'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
beforeEach(() => {
  window.localStorage.clear()
})

const PAGE: ProjectPage = {
  items: [],
  page: 1,
  perPage: 20,
  total: 0,
  totalPages: 0,
  facets: { status: { planning: 10, active: 6, paused: 5 }, priority: { low: 1, medium: 13, high: 7 }, urgency: { low: 8, medium: 8, high: 3, none: 2 } },
}

function setup(view: ProjectView = 'ongoing') {
  const list = vi.fn((_query: ProjectListQuery) => Promise.resolve(PAGE))
  const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['projects.view']) }, projects: { list } })
  renderRoutes([{ path: '/projects', element: <ProjectsPage view={view} /> }], { repositories, initialPath: '/projects' })
  return { list }
}

const texts = (elements: HTMLElement[]) => elements.map((e) => e.textContent)

describe('Listas de proyectos: filtros en una línea (§37)', () => {
  it('Estado en selector; Prioridad y Urgencia en botones sin cantidades; sin Departamento ni "Más filtros"', async () => {
    const { list } = setup()
    const prioridad = await screen.findByRole('group', { name: 'Prioridad' })
    // de mayor a menor (Crítica → Baja), sin cantidades (ajuste 18/11): la lista no pide los conteos
    expect(texts(within(prioridad).getAllByRole('button'))).toEqual(['Crítica', 'Alta', 'Media', 'Baja'])
    const urgencia = screen.getByRole('group', { name: 'Urgencia' })
    expect(texts(within(urgencia).getAllByRole('button'))).toEqual(['Alta', 'Media', 'Baja', 'Sin urgencia'])
    expect(screen.getByRole('combobox', { name: 'Estado' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Departamento' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Más filtros/ })).toBeNull()
    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ view: 'ongoing' })))
    list.mock.calls.forEach(([query]) => expect(query.facets).toBeUndefined())

    await userEvent.click(within(prioridad).getByRole('button', { name: 'Alta' }))
    await userEvent.click(within(prioridad).getByRole('button', { name: 'Crítica' }))
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ filters: { priority: 'high,critical' } })))

    // Estado: solo los estados de esta lista, sin cantidades
    await userEvent.click(screen.getByRole('combobox', { name: 'Estado' }))
    expect(texts(await screen.findAllByRole('option'))).toEqual(['Todos', 'Planificación', 'En curso', 'Pausado'])
  })

  it('"Limpiar (n)" junto a Columnas cuenta los valores marcados y los quita todos', async () => {
    const { list } = setup()
    const prioridad = await screen.findByRole('group', { name: 'Prioridad' })
    expect(screen.queryByRole('button', { name: /^Limpiar/ })).toBeNull()
    await userEvent.click(within(prioridad).getByRole('button', { name: 'Alta' }))
    await userEvent.click(within(prioridad).getByRole('button', { name: 'Crítica' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Urgencia' })).getByRole('button', { name: 'Media' }))
    const clear = screen.getByRole('button', { name: 'Limpiar 3 filtros' })
    expect(clear).toHaveTextContent('Limpiar (3)')
    expect(clear.parentElement).toContainElement(screen.getByRole('button', { name: 'Columnas' }))
    await userEvent.click(clear)
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ filters: {} })))
    expect(screen.queryByRole('button', { name: /^Limpiar/ })).toBeNull()
  })

  it('Terminados ofrece en Estado solo Completado y Cancelado', async () => {
    setup('finished')
    await userEvent.click(await screen.findByRole('combobox', { name: 'Estado' }))
    expect(texts(await screen.findAllByRole('option'))).toEqual(['Todos', 'Completado', 'Cancelado'])
  })

  it('un filtro de Departamento o de Proyecto padre guardado en el navegador no filtra a escondidas', async () => {
    window.localStorage.setItem('kamban.table.projects-ongoing', JSON.stringify({ filters: { area: 'a1', parent: 'none', priority: 'high' } }))
    const { list } = setup()
    await screen.findByRole('group', { name: 'Prioridad' })
    expect(list).toHaveBeenCalled()
    list.mock.calls.forEach(([query]) => expect(query.filters).toEqual({ priority: 'high' }))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('kamban.table.projects-ongoing') ?? '{}').filters).toEqual({ priority: 'high' }))
  })
})
