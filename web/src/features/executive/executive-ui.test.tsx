import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { localDay, type ExecutiveDashboard } from '@/domain/executive'
import type { PermissionCode } from '@/domain/permissions'
import type { ExecutiveRepository } from '@/domain/repositories'
import { RequireAuth } from '@/features/auth/guards'
import { AppShell } from '@/presentation/layouts/AppShell'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ExecutivePage } from './ExecutivePage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const crm = { id: 'p1', key: 'CRM', name: 'CRM' }
const erp = { id: 'p2', key: 'ERP', name: 'ERP Antigo' }

function dashboard(overrides: Partial<ExecutiveDashboard> = {}): ExecutiveDashboard {
  return {
    generatedAt: new Date(2026, 9, 29, 10, 42),
    period: { from: null, to: new Date(2026, 9, 29, 23, 59, 59, 999) },
    projects: [
      { ...crm, cover: 'blue', icon: 'folder', archived: false },
      { ...erp, cover: 'slate', icon: 'box', archived: true },
    ],
    summary: {
      activeProjects: 12,
      health: { ok: 7, attention: 3, critical: 2, none: 0 },
      progress: 64,
      deliveries: { tasks: 120, planItems: 25, milestones: 3 },
      overdue: { tasks: 5, planItems: 4 },
      openIssues: 3,
      criticalBugs: 1,
    },
    portfolio: [
      {
        project: { ...crm, cover: 'blue', icon: 'folder', status: 'active', priority: 'high', startDate: '2026-01-10', dueDate: '2026-12-15', owner: { id: 'u1', name: 'Ana', avatarUrl: null } },
        health: {
          level: 'critical',
          factors: [
            { key: 'schedule', value: 35, level: 'critical', count: 7, of: 20 },
            { key: 'progress', value: 12, level: 'attention', planned: 70, actual: 58 },
            { key: 'issues', value: 2, level: 'attention' },
          ],
        },
        progress: { value: 72, source: 'plan' },
        plan: { total: 25, done: 12, open: 13, overdue: 7, stuck: 0 },
        tasks: { total: 80, open: 30, overdue: 4, done: 48 },
        nextMilestone: { id: 'm1', name: 'Go-live', dueDate: '2026-12-01' },
        openIssues: 2,
      },
    ],
    plan: {
      items: { total: 60, done: 30, open: 28, overdue: 4, stuck: 1, canceled: 2 },
      statusDistribution: [
        { category: 'in_progress', count: 10 },
        { category: 'done', count: 30 },
      ],
      schedule: { onTime: 20, overdue: 4, unscheduled: 4, done: 30 },
      effort: { estimated: 1200, actual: 900, remaining: 300 },
      issues: [{ id: 'i1', number: 3, description: 'Fornecedor atrasou', state: 'pending', openedOn: '2026-10-01', project: crm }],
      openIssuesTotal: 3,
      upcomingMilestones: [{ id: 'm1', name: 'Go-live', dueDate: '2026-11-15', project: crm }],
    },
    kanban: {
      funnel: { backlog: 40, todo: 20, in_progress: 15, done: 300, cancelled: 12 },
      created: 180,
      completed: 120,
      leadTime: { hours: 96.5, count: 120 },
      cycleTime: { hours: 20, count: 110 },
      overdue: 5,
      blocked: 2,
      criticalBugs: 1,
      overdueTasks: [{ id: 't1', code: 'CRM-12', title: 'Integração', project: crm, dueDate: '2026-10-20', status: { id: 's1', name: 'Em andamento', color: 'blue', category: 'in_progress' } }],
    },
    timeline: {
      bucket: 'month',
      points: [
        { start: '2026-09-01', tasksCreated: 30, tasksCompleted: 25, planItemsCompleted: 6 },
        { start: '2026-10-01', tasksCreated: 12, tasksCompleted: 9, planItemsCompleted: 2 },
      ],
    },
    achievements: [
      {
        project: { ...crm, archived: false },
        tasksDone: 48,
        planItemsDone: 12,
        milestonesDone: [{ id: 'm0', name: 'Homologação', dueDate: '2026-10-10' }],
        recent: [
          { kind: 'task', id: 't9', code: 'CRM-9', title: 'Tela de clientes', completedAt: new Date('2026-10-28T15:00:00.000Z') },
          { kind: 'plan_item', id: 'e3', code: null, title: 'Levantamento', completedAt: new Date('2026-10-20T10:00:00.000Z') },
        ],
      },
      { project: { ...erp, archived: true }, tasksDone: 3, planItemsDone: 0, milestonesDone: [], recent: [] },
    ],
    ...overrides,
  }
}

function setup(path = '/executive', data: ExecutiveDashboard = dashboard()) {
  const get = vi.fn<ExecutiveRepository['get']>(() => Promise.resolve(data))
  const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['executive.view']) }, executive: { get } })
  const utils = renderRoutes([{ path: '/executive', element: <ExecutivePage /> }], { repositories, initialPath: path })
  return { ...utils, get }
}

describe('Painel executivo', () => {
  it('estado primeiro: saúde do portfólio e só três números na faixa de destaque', async () => {
    const { get } = setup()
    expect(await screen.findByText('Atualizado às 10:42')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith({ projectIds: [], from: null, to: null, tzOffset: new Date().getTimezoneOffset() })

    const hero = screen.getByRole('region', { name: 'Resumo' })
    expect(within(hero).getByRole('img', { name: 'Saúde do portfólio: Em dia 7, Atenção 3, Crítico 2' })).toBeInTheDocument()
    expect(within(hero).getByText('projetos ativos')).toBeInTheDocument()
    expect(within(hero).getByText('64%')).toBeInTheDocument()
    expect(within(hero).getByRole('progressbar', { name: 'Progresso médio' })).toHaveAttribute('aria-valuenow', '64')
    expect(within(hero).getByText('148')).toBeInTheDocument()
    expect(within(hero).getByText('120 tarefas · 25 elementos · 3 marcos')).toBeInTheDocument()
    expect(within(hero).getByRole('img', { name: 'Entregas ao longo do período' })).toBeInTheDocument()
    expect(within(hero).getByText('Atrasos').nextElementSibling).toHaveTextContent('9')
    expect(within(hero).getByText('Atrasos').nextElementSibling).toHaveClass('text-danger')
    expect(within(hero).getByText('5 tarefas · 4 elementos')).toBeInTheDocument()
    // os indicadores secundários saíram do topo
    expect(screen.queryByText('Problemas em aberto')).not.toBeInTheDocument()
    expect(screen.queryByText(/bug crítico/)).not.toBeInTheDocument()
  })

  it('exceções depois: críticos primeiro e um de cada tipo (problema, tarefa atrasada, marco) com o link', async () => {
    setup()
    const attention = await screen.findByRole('region', { name: /Precisa de atenção/ })
    const rows = within(attention).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('CRM')
    expect(rows[0]).toHaveTextContent('Crítico · Prazos: 35% atrasado')
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', '/projects/p1')
    expect(within(rows[1]!).getByRole('link', { name: /Fornecedor atrasou/ })).toHaveAttribute('href', '/project-management/p1?view=management')
    expect(within(rows[2]!).getByRole('link', { name: /Integração/ })).toHaveAttribute('href', '/tasks/t1')
    expect(within(rows[3]!).getByRole('link', { name: 'Go-live' })).toHaveAttribute('href', '/timeline/p1')
    expect(within(attention).queryByRole('button', { name: /Ver mais/ })).not.toBeInTheDocument()
  })

  it('mais de seis exceções: "Ver mais" mostra o resto', async () => {
    const base = dashboard()
    const task = base.kanban.overdueTasks[0]!
    setup('/executive', dashboard({ kanban: { ...base.kanban, overdueTasks: Array.from({ length: 6 }, (_, i) => ({ ...task, id: `t${i}`, title: `Tarefa ${i}` })) } }))
    const attention = await screen.findByRole('region', { name: /Precisa de atenção/ })
    const rows = within(attention).getAllByRole('listitem')
    expect(rows).toHaveLength(9)
    expect(rows.filter((row) => row.classList.contains('hidden'))).toHaveLength(3)
    const more = within(attention).getByRole('button', { name: 'Ver mais (3)' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    expect(within(attention).getByRole('button', { name: 'Ver menos' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(attention).getAllByRole('listitem').filter((row) => row.classList.contains('hidden'))).toHaveLength(0)
  })

  it('nada pede atenção: "Tudo em dia" e atrasos sem alarde', async () => {
    const base = dashboard()
    setup(
      '/executive',
      dashboard({
        summary: { ...base.summary, health: { ok: 12, attention: 0, critical: 0, none: 0 }, overdue: { tasks: 0, planItems: 0 } },
        portfolio: [{ ...base.portfolio[0]!, health: { level: 'ok', factors: [] } }],
        plan: { ...base.plan!, issues: [], openIssuesTotal: 0, upcomingMilestones: [] },
        kanban: { ...base.kanban, overdue: 0, overdueTasks: [] },
      }),
    )
    const attention = await screen.findByRole('region', { name: /Precisa de atenção/ })
    expect(within(attention).getByText('Tudo em dia')).toBeInTheDocument()
    const hero = screen.getByRole('region', { name: 'Resumo' })
    expect(within(hero).getByText('Nenhum atraso')).toBeInTheDocument()
    const overdue = within(hero).getByText('Atrasos').nextElementSibling
    expect(overdue).toHaveTextContent('0')
    expect(overdue).not.toHaveClass('text-danger')
  })

  it('portfólio enxuto (projeto, saúde, progresso, prazo), módulos com um visual cada e o que já foi feito', async () => {
    setup()
    const portfolio = await screen.findByRole('region', { name: /Portfólio/ })
    expect(within(portfolio).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Projeto', 'Saúde', 'Progresso', 'Prazo'])
    expect(within(portfolio).getByRole('link', { name: /CRM/ })).toHaveAttribute('href', '/projects/p1')
    expect(within(portfolio).getByText('Crítico')).toBeInTheDocument()
    expect(within(portfolio).getByText('Prazos: 35% atrasado')).toBeInTheDocument()
    expect(within(portfolio).getByRole('progressbar', { name: 'Progresso de CRM' })).toHaveAttribute('aria-valuenow', '72')
    expect(within(portfolio).getByText(/Próximo marco: Go-live/)).toBeInTheDocument()

    const plan = screen.getByRole('region', { name: /Gestão de projetos/ })
    expect(within(plan).getByRole('img', { name: 'Elementos por situação: Em andamento 10, Concluído 30' })).toBeInTheDocument()
    expect(within(plan).getByText('No prazo').parentElement).toHaveTextContent('20')
    expect(within(plan).getByText('900 h de 1.200 h estimadas')).toBeInTheDocument()

    const kanban = screen.getByRole('region', { name: /Kanban de atividades/ })
    expect(within(kanban).getByRole('img', { name: /^Tarefas por etapa: Backlog 40, A fazer 20, Em andamento 15, Concluída 300$/ })).toBeInTheDocument()
    expect(within(kanban).getByText('Tempo médio de entrega').parentElement).toHaveTextContent('4 dias')
    expect(within(kanban).queryByText('20 h')).not.toBeInTheDocument()

    const timeline = screen.getByRole('region', { name: /Entregas ao longo do tempo/ })
    expect(timeline).toHaveTextContent('Elementos concluídos')
    expect(timeline).not.toHaveTextContent('Tarefas criadas')

    const done = screen.getByRole('region', { name: /O que já foi feito/ })
    const crmRow = within(done).getByRole('listitem', { name: 'CRM · CRM' })
    expect(crmRow).toHaveTextContent('48 tarefas · 12 elementos · 1 marco')
    expect(within(crmRow).queryByRole('link', { name: /Levantamento/ })).not.toBeInTheDocument()
    await userEvent.click(within(crmRow).getByRole('button', { name: 'Últimas conclusões de CRM' }))
    expect(within(done).getByRole('link', { name: /Levantamento/ })).toHaveAttribute('href', '/project-management/p1?item=e3')
    expect(within(done).getByRole('link', { name: /Tela de clientes/ })).toHaveAttribute('href', '/tasks/t9')
    const archived = within(done).getByRole('listitem', { name: 'ERP · ERP Antigo' })
    expect(within(archived).getByText('Arquivado')).toBeInTheDocument()
    // partes zeradas somem
    expect(archived).toHaveTextContent('3 tarefas')
    expect(archived).not.toHaveTextContent('0 elementos')
  })

  it('filtrar por projetos e período manda project_ids e as datas; "Todos os projetos" limpa o filtro', async () => {
    const { get, router } = setup()
    await screen.findByText('Atualizado às 10:42')

    await userEvent.click(screen.getByRole('combobox', { name: 'Projetos' }))
    const option = await screen.findByRole('option', { name: 'ERP · ERP Antigo (arquivado)' })
    await userEvent.click(within(option).getByRole('button'))
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ projectIds: ['p2'] })))
    expect(router.state.location.search).toContain('projects=p2')
    await userEvent.keyboard('{Escape}')

    const period = screen.getByRole('radiogroup', { name: 'Período' })
    expect(within(period).getByRole('radio', { name: 'Desde o início' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(period).getByRole('radio', { name: 'Este ano' }))
    const now = new Date()
    await waitFor(() => expect(get).toHaveBeenLastCalledWith({ projectIds: ['p2'], from: `${now.getFullYear()}-01-01`, to: localDay(now), tzOffset: now.getTimezoneOffset() }))
    expect(router.state.location.search).toContain('period=year')

    await userEvent.click(screen.getByRole('button', { name: 'Todos os projetos' }))
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ projectIds: [] })))
    expect(router.state.location.search).not.toContain('projects=')
  })

  it('período personalizado manda as duas datas; incompleto avisa e não consulta; escolher "Personalizado" abre o calendário', async () => {
    const { get } = setup('/executive?period=custom&from=2026-03-01&to=2026-03-31&projects=p1')
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.objectContaining({ projectIds: ['p1'], from: '2026-03-01', to: '2026-03-31' })))
    expect(screen.getByRole('radio', { name: 'Personalizado' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: /1 de mar\.? – 31 de mar/ })).toBeInTheDocument()

    const incomplete = setup('/executive?period=custom&from=2026-03-01')
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha as duas datas do período')
    expect(incomplete.get).not.toHaveBeenCalled()
  })

  it('"Personalizado" abre o calendário do intervalo', async () => {
    setup()
    await screen.findByText('Atualizado às 10:42')
    await userEvent.click(screen.getByRole('radio', { name: 'Personalizado' }))
    expect(await screen.findByRole('dialog', { name: 'Período' })).toBeInTheDocument()
  })

  it('sem dados: cada bloco explica o vazio e a série de entregas some', async () => {
    setup(
      '/executive',
      dashboard({
        summary: { activeProjects: 0, health: { ok: 0, attention: 0, critical: 0, none: 0 }, progress: null, deliveries: { tasks: 0, planItems: 0, milestones: 0 }, overdue: { tasks: 0, planItems: 0 }, openIssues: 0, criticalBugs: 0 },
        portfolio: [],
        plan: null,
        kanban: { funnel: { backlog: 0, todo: 0, in_progress: 0, done: 0, cancelled: 0 }, created: 0, completed: 0, leadTime: { hours: null, count: 0 }, cycleTime: { hours: null, count: 0 }, overdue: 0, blocked: 0, criticalBugs: 0, overdueTasks: [] },
        timeline: { bucket: 'month', points: [] },
        achievements: [],
      }),
    )
    expect(await screen.findByText('Nenhum projeto ativo no filtro')).toBeInTheDocument()
    expect(screen.getByText('Sem medição')).toBeInTheDocument()
    expect(screen.getByText('Nada entregue ainda')).toBeInTheDocument()
    expect(screen.getByText('Tudo em dia')).toBeInTheDocument()
    expect(screen.getByText('Nenhum quadro de gestão no filtro')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma tarefa no filtro')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Entregas ao longo do tempo/ })).not.toBeInTheDocument()
    expect(screen.getByText('Nada concluído no período')).toBeInTheDocument()
  })

  it('nenhum projeto: um vazio só, no lugar do painel', async () => {
    setup('/executive', dashboard({ projects: [], portfolio: [], achievements: [] }))
    expect(await screen.findByText('Nenhum projeto ainda')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Resumo' })).not.toBeInTheDocument()
  })

  it('erro ao carregar mostra o aviso com "Tentar novamente"', async () => {
    const get = vi.fn<ExecutiveRepository['get']>(() => Promise.reject(new Error('falhou')))
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['executive.view']) }, executive: { get } })
    renderRoutes([{ path: '/executive', element: <ExecutivePage /> }], { repositories, initialPath: '/executive' })
    expect(await screen.findByText('Não foi possível carregar o painel executivo.')).toBeInTheDocument()
  })
})

describe('Painel executivo — menu', () => {
  function shell(permissions: PermissionCode[]) {
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(permissions) } })
    renderRoutes([{ path: '/', element: <RequireAuth><AppShell /></RequireAuth>, children: [{ path: 'dashboard', element: <p>Início</p> }] }], { repositories, initialPath: '/dashboard' })
  }

  it('aparece com executive.view', async () => {
    shell(['executive.view'])
    expect(await screen.findByText('Início')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Painel executivo/ })).toHaveAttribute('href', '/executive')
  })

  it('fica escondido sem a permissão', async () => {
    shell(['reports.view', 'plan.view'])
    expect(await screen.findByText('Início')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Painel executivo/ })).not.toBeInTheDocument()
  })
})
