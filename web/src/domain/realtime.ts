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

/**
 * Projetos que uma tela assina de uma vez (Kanban de todos os projetos). O servidor aceita até 50
 * tópicos por conexão (backend `domain/realtime.js#MAX_TOPICS`), somando todas as telas da aba: sobra
 * espaço para o sino (`user:`) e outras telas abertas.
 */
export const MAX_LIVE_PROJECTS = 40

type Key = readonly unknown[]

/** Quadro de todos os projetos (`boardKeys.all` no Kanban): atualiza com mudança em qualquer projeto. */
const ALL_PROJECTS_BOARD: Key = ['tasks', 'board-all']

export function invalidationKeys(event: RealtimeEvent): Key[] {
  const p = event.projectId
  const task = event.taskId
  switch (event.collection) {
    case 'tasks':
      return [
        ['tasks', 'board', p],
        ALL_PROJECTS_BOARD,
        ['tasks', 'backlog', p],
        ['tasks', 'timeline', p],
        // funcionalidades da ficha avançam com as tarefas vinculadas
        ['tasks', 'charter', p],
        ['tasks', 'list'],
        ['tasks', 'reports'],
        ['tasks', 'detail', event.id],
        ['tasks', 'history', event.id],
        ['tasks', 'relations', event.id],
        // elemento da Gestão com tarefas vinculadas: o progresso e a contagem vêm delas
        ['plan', p],
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
        ALL_PROJECTS_BOARD,
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
      // nome, arquivamento e quem participa mudam o que entra no quadro de todos os projetos
      return [
        ['projects', 'detail', p],
        ['projects', 'members', p],
        ALL_PROJECTS_BOARD,
      ]
    case 'project_files':
      return [
        ['projects', 'files', p],
        ['projects', 'history', p],
      ]
    case 'notifications':
      return [['notifications']]
    default:
      return event.collection.startsWith('plan_') || event.collection === 'project_groups' ? [['plan', p]] : []
  }
}
