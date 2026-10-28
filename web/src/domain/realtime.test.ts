import { describe, expect, it } from 'vitest'
import { invalidationKeys, projectTopic, userTopic } from './realtime'

const event = (collection: string, extra: Partial<{ id: string; projectId: string | null; taskId: string | null; itemId: string | null }> = {}) => ({
  collection,
  action: 'update' as const,
  id: 'x1',
  projectId: 'p1',
  taskId: null,
  itemId: null,
  ...extra,
})

describe('domain/realtime — o que atualizar na tela', () => {
  it('tópicos', () => {
    expect(projectTopic('p1')).toBe('project:p1')
    expect(userTopic('u1')).toBe('user:u1')
  })

  it('tarefa: quadro, planejamento, timeline, listas, relatórios e a própria tarefa', () => {
    expect(invalidationKeys(event('tasks', { id: 't1', taskId: 't1' }))).toEqual([
      ['tasks', 'board', 'p1'],
      ['tasks', 'board-all'],
      ['tasks', 'backlog', 'p1'],
      ['tasks', 'timeline', 'p1'],
      ['tasks', 'list'],
      ['tasks', 'reports'],
      ['tasks', 'detail', 't1'],
      ['tasks', 'history', 't1'],
      ['tasks', 'relations', 't1'],
    ])
  })

  it('comentário, anexo e relação atualizam a tarefa deles', () => {
    expect(invalidationKeys(event('comments', { taskId: 't1' }))).toEqual([
      ['tasks', 'comments', 't1'],
      ['tasks', 'history', 't1'],
    ])
    expect(invalidationKeys(event('attachments', { taskId: 't1' }))).toEqual([
      ['tasks', 'attachments', 't1'],
      ['tasks', 'detail', 't1'],
    ])
    expect(invalidationKeys(event('task_relations', { taskId: 't1' }))).toEqual([
      ['tasks', 'relations', 't1'],
      ['tasks', 'board', 'p1'],
      ['tasks', 'board-all'],
      ['tasks', 'timeline', 'p1'],
    ])
  })

  it('quadro da Gestão, sprints, marcos, projeto e notificações', () => {
    expect(invalidationKeys(event('plan_items'))).toEqual([['plan', 'p1']])
    expect(invalidationKeys(event('plan_journal'))).toEqual([['plan', 'p1']])
    expect(invalidationKeys(event('sprints'))).toEqual([
      ['sprints', 'p1'],
      ['tasks', 'backlog', 'p1'],
      ['tasks', 'board', 'p1'],
    ])
    expect(invalidationKeys(event('project_milestones'))).toEqual([['tasks', 'timeline', 'p1']])
    expect(invalidationKeys(event('project_members'))).toEqual([
      ['projects', 'detail', 'p1'],
      ['projects', 'members', 'p1'],
      ['tasks', 'board-all'],
    ])
    expect(invalidationKeys(event('project_files'))).toEqual([
      ['projects', 'files', 'p1'],
      ['projects', 'history', 'p1'],
    ])
    expect(invalidationKeys(event('notifications', { projectId: null }))).toEqual([['notifications']])
    expect(invalidationKeys(event('desconhecida'))).toEqual([])
  })
})
