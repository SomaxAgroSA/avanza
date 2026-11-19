import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/core/networking/api-client'
import type { DocModuleDto, DocSpaceDto } from './dtos'
import { createHttpDocsRepository } from './http-repositories'
import { toDocModule, toDocSpace } from './mappers'

const spaceDto: DocSpaceDto = {
  id: 'sp1',
  key: 'MKT',
  name: 'Campanhas',
  description: '',
  icon: 'book',
  color: 'blue',
  visibility: 'company',
  project: null,
  module: { id: 'm1', name: 'Marketing', color: 'pink' },
  home_page_id: 'h1',
  page_count: 1,
  created_at: '2026-11-12T10:00:00.000Z',
  updated_at: null,
  capabilities: { edit: true, manage: true },
}
const moduleDto: DocModuleDto = { id: 'm1', name: 'Marketing', color: 'pink', position: 0, space_count: 3 }

describe('módulos da documentação (dados)', () => {
  it('espaço: module vira { id, name, color } (ausente ou null = Sem módulo); módulo com a contagem', () => {
    expect(toDocSpace(spaceDto).module).toEqual({ id: 'm1', name: 'Marketing', color: 'pink' })
    expect(toDocSpace({ ...spaceDto, module: null }).module).toBeNull()
    const { module: _ignored, ...withoutModule } = spaceDto
    expect(toDocSpace(withoutModule).module).toBeNull()
    expect(toDocModule(moduleDto)).toEqual({ id: 'm1', name: 'Marketing', color: 'pink', position: 0, spaceCount: 3 })
  })

  it('repositório: module_id vai no corpo do espaço (criar e mover; "" = Sem módulo) e o CRUD de módulos usa /docs/modules', async () => {
    const get = vi.fn(() => Promise.resolve({ data: [moduleDto], meta: {} }))
    const post = vi.fn((path: string) => Promise.resolve({ data: path === '/docs/modules' ? moduleDto : spaceDto, meta: {} }))
    const patch = vi.fn((path: string) => Promise.resolve({ data: path.startsWith('/docs/modules') ? moduleDto : spaceDto, meta: {} }))
    const del = vi.fn(() => Promise.resolve({ data: { deleted: true, spaces: 2 }, meta: {} }))
    const repo = createHttpDocsRepository({ get, post, patch, del } as unknown as ApiClient)

    await repo.createSpace({ key: 'MKT', name: 'Campanhas', visibility: 'company', moduleId: 'm1' })
    expect(post).toHaveBeenCalledWith('/docs/spaces', expect.objectContaining({ module_id: 'm1' }))
    await repo.updateSpace('sp1', { moduleId: '' })
    expect(patch).toHaveBeenCalledWith('/docs/spaces/sp1', { module_id: '' })

    expect((await repo.listModules()).map((m) => m.name)).toEqual(['Marketing'])
    expect(get).toHaveBeenCalledWith('/docs/modules')
    await repo.createModule({ name: 'Marketing', color: 'pink' })
    expect(post).toHaveBeenCalledWith('/docs/modules', { name: 'Marketing', color: 'pink' })
    await repo.updateModule('m1', { position: 2 })
    expect(patch).toHaveBeenCalledWith('/docs/modules/m1', { position: 2 })
    expect(await repo.deleteModule('m1')).toBe(2)
    expect(del).toHaveBeenCalledWith('/docs/modules/m1')
  })
})
