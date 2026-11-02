import { describe, expect, it } from 'vitest'
import { buildChronology } from './project-chronology'
import type { JournalEntry } from './plan-management'
import type { TaskSummary } from './tasks'
import type { Milestone } from './timeline'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function journal(id: string, entryDate: string): JournalEntry {
  return { id, entryDate, content: `registro ${id}`, author: null, createdAt: null, updatedAt: null, capabilities: { edit: false, delete: false } }
}

function milestone(id: string, dueDate: string): Milestone {
  return { id, projectId: 'p', name: `marco ${id}`, description: '', dueDate, state: 'done', createdAt: null, updatedAt: null }
}

function task(id: string, start: string | null, due: string | null): TaskSummary {
  return { id, code: `GCS-${id}`, title: `tarefa ${id}`, status: null, assignee: null, startDate: start ? day(start) : null, dueDate: due ? day(due) : null } as TaskSummary
}

describe('buildChronology', () => {
  it('ordena pela data do fato, do mais antigo ao mais recente, não pela ordem recebida', () => {
    const { days } = buildChronology({ journal: [journal('j3', '2026-10-08'), journal('j1', '2026-09-22'), journal('j2', '2026-10-01')] })
    expect(days.map((d) => d.date)).toEqual(['2026-09-22', '2026-10-01', '2026-10-08'])
  })

  it('agrupa no mesmo dia: Diário, depois marcos, depois tarefas', () => {
    const { days } = buildChronology({
      tasks: [task('1', '2026-10-20', '2026-10-20')],
      milestones: [milestone('m', '2026-10-20')],
      journal: [journal('j', '2026-10-20')],
    })
    expect(days).toHaveLength(1)
    expect(days[0]!.items.map((i) => i.kind)).toEqual(['journal', 'milestone', 'task'])
  })

  it('tarefa entra no dia de início; sem início, no prazo; sem nenhum, fica em undated', () => {
    const { days, undated } = buildChronology({ tasks: [task('a', '2026-10-17', '2026-10-20'), task('b', null, '2026-10-27'), task('c', null, null)] })
    expect(days.map((d) => d.date)).toEqual(['2026-10-17', '2026-10-27'])
    expect(days[0]!.items[0]).toMatchObject({ kind: 'task', start: '2026-10-17', due: '2026-10-20' })
    expect(undated.map((i) => i.id)).toEqual(['c'])
  })

  it('aceita fontes ausentes (sem permissão para o quadro ou a timeline)', () => {
    expect(buildChronology({})).toEqual({ days: [], undated: [] })
  })
})
