import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/core/networking/api-client'
import { createHttpBoardRepository, createHttpPreferenceRepository } from './http-repositories'

function fakeApi(value: unknown) {
  const get = vi.fn((path: string) => Promise.resolve({ data: { key: path.split('/').pop(), value }, meta: {} }))
  const put = vi.fn((path: string, body: { value: unknown }) => Promise.resolve({ data: { key: path.split('/').pop(), value: body.value }, meta: {} }))
  return { api: { get, put } as unknown as ApiClient, get, put }
}

describe('repositório de preferências (configurador do filtro de projetos)', () => {
  it('lê pela chave da tela; nunca salvo (null) vale o padrão', async () => {
    const { api, get } = fakeApi(null)
    expect(await createHttpPreferenceRepository(api).getProjectFilter('kanban')).toEqual({ statuses: [], membersOnly: false })
    expect(get).toHaveBeenCalledWith('/auth/preferences/project_filter.kanban')
  })

  it('converte snake_case e descarta status desconhecidos', async () => {
    const { api } = fakeApi({ statuses: ['completed', 'bogus', 'active'], members_only: true })
    expect(await createHttpPreferenceRepository(api).getProjectFilter('reports')).toEqual({ statuses: ['active', 'completed'], membersOnly: true })
  })

  it('salva como a API espera; null volta ao padrão', async () => {
    const { api, put } = fakeApi(null)
    const repo = createHttpPreferenceRepository(api)
    expect(await repo.saveProjectFilter('executive', { statuses: ['planning'], membersOnly: true })).toEqual({ statuses: ['planning'], membersOnly: true })
    expect(put).toHaveBeenCalledWith('/auth/preferences/project_filter.executive', { value: { statuses: ['planning'], members_only: true } })
    expect(await repo.saveProjectFilter('executive', null)).toEqual({ statuses: [], membersOnly: false })
    expect(put).toHaveBeenLastCalledWith('/auth/preferences/project_filter.executive', { value: null })
  })
})

describe('quadro de todos os projetos', () => {
  it('restringe com project_ids separados por vírgula; sem lista, sem parâmetro', async () => {
    const board = { project: null, projects: [], capabilities: { move: false, create: false }, columns: [] }
    const get = vi.fn(() => Promise.resolve({ data: board, meta: {} }))
    const repo = createHttpBoardRepository({ get } as unknown as ApiClient)
    await repo.getAll(['a', 'b'])
    expect(get).toHaveBeenLastCalledWith('/board', { query: { project_ids: 'a,b' } })
    await repo.getAll()
    expect(get).toHaveBeenLastCalledWith('/board', undefined)
  })
})
