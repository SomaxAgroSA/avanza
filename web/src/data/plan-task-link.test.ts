import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/core/networking/api-client'
import type { PlanItemDto, TaskDetailDto, TaskDto } from './dtos'
import { createHttpTaskRepository } from './http-repositories'
import { toPlanItem, toTaskDetail, toTaskSummary } from './mappers'

const taskDto: TaskDto = {
  id: 't1',
  code: 'IMP-1',
  number: 1,
  title: 'Levantar requisitos',
  project: { id: 'p1', key: 'IMP', name: 'Implantação' },
  type: null,
  status: null,
  priority: null,
  creator: null,
  assignee: null,
  reporter: null,
  parent_task_id: null,
  due_date: null,
  estimated_hours: null,
  actual_hours: null,
  started_at: null,
  completed_at: null,
  created_at: null,
  updated_at: null,
}

const detailDto: TaskDetailDto = { ...taskDto, description: '', custom_values: {}, fields: [], capabilities: { edit: true, delete: false, assign: true } }

const itemDto: PlanItemDto = {
  id: 'i1',
  group_id: 'g1',
  parent_id: null,
  name: 'Kickoff',
  status_id: null,
  start_date: null,
  end_date: null,
  due_date: null,
  owner: null,
  estimated_hours: null,
  actual_hours: null,
  duration_days: null,
  duration_manual: null,
  progress_manual: null,
}

describe('vínculo tarefa ↔ elemento da Gestão (dados)', () => {
  it('tarefa: plan_item vira planItem (ausente ou null = sem vínculo), no resumo e no detalhe', () => {
    expect(toTaskSummary({ ...taskDto, plan_item: { id: 'i1', name: 'Kickoff' } }).planItem).toEqual({ id: 'i1', name: 'Kickoff' })
    expect(toTaskSummary({ ...taskDto, plan_item: null }).planItem).toBeNull()
    expect(toTaskSummary(taskDto).planItem).toBeNull()
    expect(toTaskDetail({ ...detailDto, plan_item: { id: 'i2', name: 'Plano' } }).planItem).toEqual({ id: 'i2', name: 'Plano' })
  })

  it('elemento: tarefas vinculadas e progresso pelas tarefas', () => {
    const item = toPlanItem({ ...itemDto, tasks: { total: 5, done: 3 }, progress: { value: 60, source: 'tasks' } })
    expect(item.tasks).toEqual({ total: 5, done: 3 })
    expect(item.progress).toEqual({ value: 60, source: 'tasks' })
    expect(toPlanItem(itemDto).tasks).toEqual({ total: 0, done: 0 })
  })

  it('repositório: plan_item_id na criação/edição (null desvincula) e filtro por elemento', async () => {
    const get = vi.fn(() => Promise.resolve({ data: [taskDto], meta: { page: 1, perPage: 20, total: 1, totalPages: 1 } }))
    const post = vi.fn(() => Promise.resolve({ data: detailDto, meta: {} }))
    const patch = vi.fn(() => Promise.resolve({ data: detailDto, meta: {} }))
    const repo = createHttpTaskRepository({ get, post, patch } as unknown as ApiClient)

    await repo.list({ page: 1, perPage: 20, sort: null, search: '', filters: {} }, { projectId: 'p1', planItemId: 'i1' })
    expect(get).toHaveBeenCalledWith('/tasks', { query: expect.objectContaining({ project_id: 'p1', plan_item_id: 'i1' }) })

    await repo.create({ projectId: 'p1', taskTypeId: 'tt', title: 'X', planItemId: 'i1' })
    expect(post).toHaveBeenCalledWith('/tasks', expect.objectContaining({ plan_item_id: 'i1' }))

    await repo.update('t1', { planItemId: null })
    expect(patch).toHaveBeenCalledWith('/tasks/t1', expect.objectContaining({ plan_item_id: null }))
  })
})
