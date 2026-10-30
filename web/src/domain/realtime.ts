import type { RealtimeEvent } from '@/core/realtime/realtime-client'

/**
 * Tempo real (regras de negócio §19): de cada aviso, quais dados da tela buscar de novo (prefixos de
 * chaves do cache). A busca passa pela API, que aplica as permissões de sempre.
 */

export function projectTopic(projectId: string): string {
  return `project:${projectId}`
}

export function userTopic(userId: string): string {
  return `user:${userId}`
}

type Key = readonly unknown[]

export function invalidationKeys(event: RealtimeEvent): Key[] {
  const p = event.projectId
  const task = event.taskId
  switch (event.collection) {
    case 'tasks':
      return [
        ['tasks', 'board', p],
        ['tasks', 'backlog', p],
        ['tasks', 'timeline', p],
        ['tasks', 'charter', p],
        ['tasks', 'list'],
        ['tasks', 'reports'],
        ['tasks', 'detail', event.id],
        ['tasks', 'history', event.id],
        ['tasks', 'relations', event.id],
      ]
    case 'comments':
      return [
        ['tasks', 'comments', task],
        ['tasks', 'history', task],
      ]
    case 'attachments':
      return [
        ['tasks', 'attachments', task],
        ['tasks', 'detail', task],
      ]
    case 'task_relations':
      return [
        ['tasks', 'relations', task],
        ['tasks', 'board', p],
        ['tasks', 'timeline', p],
      ]
    case 'sprints':
      return [
        ['sprints', p],
        ['tasks', 'backlog', p],
        ['tasks', 'board', p],
      ]
    case 'project_milestones':
      return [['tasks', 'timeline', p]]
    case 'project_charters':
    case 'charter_items':
    case 'charter_measurements':
      return [
        ['tasks', 'charter', p],
        ['tasks', 'charter-measurements'],
      ]
    case 'projects':
    case 'project_members':
      return [
        ['projects', 'detail', p],
        ['projects', 'members', p],
      ]
    case 'notifications':
      return [['notifications']]
    default:
      return event.collection.startsWith('plan_') || event.collection === 'project_groups' ? [['plan', p]] : []
  }
}
