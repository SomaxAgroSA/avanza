import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { Plan, PlanGroup, PlanItem } from '@/domain/plan'
import type { PlanFile, PlanUpdate } from '@/domain/plan-updates'
import type { JournalEntry, PlanIssue, PlanReport } from '@/domain/plan-management'
import type { PlanColumn } from '@/domain/plan-columns'
import type { Project, ProjectMember } from '@/domain/projects'
import type { PlanRepository } from '@/domain/repositories'
import { AppError } from '@/core/errors/app-error'
import { notify } from '@/presentation/components'
import { fakeRepositories, renderRoutes } from '@/test/utils'
import { ProjectBoard } from './ProjectBoard'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

const project = { id: 'p1', key: 'IMP', name: 'Implantação' } as Project

const group = (id: string, number: string, name: string, extra: Partial<PlanGroup> = {}): PlanGroup => ({
  id,
  parentId: null,
  name,
  color: 'blue',
  position: 0,
  number,
  summary: null,
  ...extra,
})

const item = (id: string, groupId: string, name: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  id,
  groupId,
  parentId: null,
  name,
  statusId: null,
  startDate: null,
  endDate: null,
  dueDate: null,
  owner: null,
  resourceIds: [],
  estimatedHours: null,
  actualHours: null,
  durationDays: null,
  durationManual: null,
  progress: { value: 0, source: 'none' },
  progressManual: null,
  subitems: 0,
  position: 1,
  blocked: false,
  updates: 0,
  files: 0,
  baselineStart: null,
  baselineEnd: null,
  custom: {},
  ...extra,
})

function makePlan(extra: Partial<Plan> = {}): Plan {
  return {
    project: { id: 'p1', key: 'IMP', name: 'Implantação', archived: false },
    capabilities: { edit: true, manage: true },
    statuses: [
      { id: 'st-plan', name: 'Planejado', color: 'gray', category: 'todo', position: 1 },
      { id: 'st-prog', name: 'Em progresso', color: 'amber', category: 'in_progress', position: 2 },
      { id: 'st-done', name: 'Feito', color: 'green', category: 'done', position: 3 },
    ],
    resources: [{ id: 'r-gp', name: 'Gerente de Projetos', color: 'indigo' }],
    groups: [
      group('g-ini', '1.0', 'Iniciação', {
        summary: {
          items: 2,
          statusCounts: [
            { statusId: 'st-done', count: 1 },
            { statusId: null, count: 1 },
          ],
          startDate: '2026-01-26',
          endDate: '2026-01-30',
          estimatedHours: 4.1,
          durationDays: 10,
          progress: 50,
        },
      }),
      group('g-pl', '2.0', 'Planejamento', { color: 'green' }),
      group('g-pp', '2.1', 'Plano do Projeto', { parentId: 'g-pl', color: 'violet' }),
    ],
    items: [
      item('i1', 'g-ini', 'Elaborar pré-cronograma', {
        statusId: 'st-done',
        startDate: '2026-01-26',
        endDate: '2026-01-27',
        durationDays: 2,
        resourceIds: ['r-gp'],
        estimatedHours: 1,
        progress: { value: 100, source: 'done' },
      }),
      item('i2', 'g-ini', 'Apresentar pré-cronograma', { position: 2, subitems: 1, durationDays: 1, durationManual: 1, progress: { value: 50, source: 'subitems' } }),
      item('s1', 'g-ini', 'Montar apresentação', { parentId: 'i2', estimatedHours: 2, progress: { value: 50, source: 'manual' }, progressManual: 50 }),
      item('i3', 'g-pp', 'Elaborar plano v6'),
    ],
    links: [],
    columns: [],
    settings: { dependencyRule: 'warn', baselineAt: null },
    summary: null,
    truncated: false,
    ...extra,
  }
}

const members: ProjectMember[] = [
  { user: { id: 'u-ana', name: 'Ana', email: 'ana@x.com', avatarUrl: null, status: 'active' }, role: 'manager', isOwner: true, joinedAt: null },
  { user: { id: 'u-bia', name: 'Bia', email: 'bia@x.com', avatarUrl: null, status: 'active' }, role: 'member', isOwner: false, joinedAt: null },
]

function setup(plan: Partial<PlanRepository> = {}, data: Plan = makePlan(), initialPath = '/') {
  const repositories = fakeRepositories({
    plan: { get: () => Promise.resolve(data), ...plan },
    projects: { listMembers: () => Promise.resolve(members) },
  })
  return renderRoutes([{ path: '/', element: <ProjectBoard projectId={project.id} /> }], { repositories, initialPath })
}

describe('Quadro do projeto (Gerenciamento)', () => {
  it('mostra grupos numerados, fase com subgrupo, células e totais do rodapé', async () => {
    setup()
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    expect(within(ini).getByRole('button', { name: 'Editar nome de Elaborar pré-cronograma' })).toBeInTheDocument()
    expect(within(ini).getByRole('button', { name: 'Status de Elaborar pré-cronograma: Feito' })).toBeInTheDocument()
    expect(within(ini).getByRole('button', { name: 'Cronograma de Elaborar pré-cronograma: 2 dias' })).toHaveTextContent('26 — 27 jan')
    expect(within(ini).getByRole('button', { name: 'Recursos de Elaborar pré-cronograma: Gerente de Projetos' })).toBeInTheDocument()
    // rodapé: distribuição de status, soma do esforço e da duração
    expect(within(ini).getByRole('img', { name: 'Feito: 1 (50%) · Em branco: 1 (50%)' })).toBeInTheDocument()
    expect(within(ini).getByText('4,1')).toBeInTheDocument()
    expect(within(ini).getByText('10')).toBeInTheDocument()
    // fase só com subgrupos: cabeçalho; subgrupo com o título do pai
    expect(screen.getByRole('region', { name: '2.0 Planejamento' })).toHaveTextContent('1 subgrupo')
    expect(screen.getByRole('table', { name: '2.0 Planejamento | 2.1 Plano do Projeto' })).toBeInTheDocument()
    // duração calculada pelo cronograma não é editável; progresso por subelementos também não
    expect(within(ini).queryByRole('button', { name: 'Duração de Elaborar pré-cronograma (dias)' })).not.toBeInTheDocument()
    expect(within(ini).getByRole('button', { name: 'Duração de Apresentar pré-cronograma (dias)' })).toBeInTheDocument()
    expect(within(ini).queryByRole('button', { name: 'Editar progresso de Apresentar pré-cronograma (0 a 100)' })).not.toBeInTheDocument()
  })

  it('edita nome, status e esforço direto na célula', async () => {
    const updateItem = vi.fn<PlanRepository['updateItem']>((id) => Promise.resolve(item(id, 'g-ini', 'x')))
    const error = vi.spyOn(notify, 'error')
    setup({ updateItem })
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })

    await userEvent.click(within(ini).getByRole('button', { name: 'Editar nome de Elaborar pré-cronograma' }))
    const input = within(ini).getByRole('textbox', { name: 'Editar nome de Elaborar pré-cronograma' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Pré-cronograma v2{Enter}')
    await waitFor(() => expect(updateItem).toHaveBeenCalledWith('i1', { name: 'Pré-cronograma v2' }))

    await userEvent.click(within(ini).getByRole('button', { name: 'Status de Apresentar pré-cronograma: Em branco' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Status de Apresentar pré-cronograma' })).getByRole('button', { name: 'Em progresso' }))
    await waitFor(() => expect(updateItem).toHaveBeenCalledWith('i2', { statusId: 'st-prog' }))

    await userEvent.click(within(ini).getByRole('button', { name: 'Esforço estimado de Apresentar pré-cronograma (horas)' }))
    await userEvent.type(within(ini).getByRole('textbox', { name: 'Esforço estimado de Apresentar pré-cronograma (horas)' }), '2,5{Enter}')
    await waitFor(() => expect(updateItem).toHaveBeenCalledWith('i2', { estimatedHours: 2.5 }))

    await userEvent.click(within(ini).getByRole('button', { name: 'Esforço estimado de Elaborar pré-cronograma (horas)' }))
    const effort = within(ini).getByRole('textbox', { name: 'Esforço estimado de Elaborar pré-cronograma (horas)' })
    await userEvent.clear(effort)
    await userEvent.type(effort, 'abc{Enter}')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Valor inválido'))
    expect(updateItem).toHaveBeenCalledTimes(3)
  })

  it('recursos: marca etiqueta existente e cria nova pela busca', async () => {
    const updateItem = vi.fn<PlanRepository['updateItem']>((id) => Promise.resolve(item(id, 'g-ini', 'x')))
    const createResource = vi.fn<PlanRepository['createResource']>(() => Promise.resolve({ id: 'r-cli', name: 'Cliente', color: 'indigo' }))
    setup({ updateItem, createResource })
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(within(ini).getByRole('button', { name: 'Recursos de Apresentar pré-cronograma: sem recursos' }))
    const picker = await screen.findByRole('dialog', { name: 'Recursos de Apresentar pré-cronograma' })
    await userEvent.click(within(picker).getByRole('button', { name: 'Gerente de Projetos' }))
    await waitFor(() => expect(updateItem).toHaveBeenCalledWith('i2', { resourceIds: ['r-gp'] }))
    await userEvent.type(within(picker).getByRole('textbox', { name: 'Criar ou localizar etiquetas' }), 'Cliente')
    await userEvent.click(within(picker).getByRole('button', { name: 'Criar “Cliente”' }))
    await waitFor(() => expect(createResource).toHaveBeenCalledWith('p1', { name: 'Cliente' }))
    await waitFor(() => expect(updateItem).toHaveBeenLastCalledWith('i2', { resourceIds: expect.arrayContaining(['r-cli']) as string[] }))
  })

  it('subelementos: abre a subtabela e adiciona pela linha "+ Adicionar subelemento"; adiciona elemento no grupo', async () => {
    const createItem = vi.fn<PlanRepository['createItem']>((_p, input) => Promise.resolve(item('new', 'g-ini', input.name ?? '')))
    setup({ createItem })
    await userEvent.click(await screen.findByRole('button', { name: 'Mostrar 1 subelemento de Apresentar pré-cronograma' }))
    const subs = await screen.findByRole('table', { name: 'Subelementos de Apresentar pré-cronograma' })
    expect(within(subs).getByRole('button', { name: 'Editar nome de Montar apresentação' })).toBeInTheDocument()
    expect(within(subs).getByRole('columnheader', { name: /Trabalho \(h\)/ })).toBeInTheDocument()
    await userEvent.type(within(subs).getByRole('textbox', { name: 'Adicionar subelemento em Apresentar pré-cronograma' }), 'Revisar slides{Enter}')
    await waitFor(() => expect(createItem).toHaveBeenCalledWith('p1', { parentId: 'i2', name: 'Revisar slides' }))

    await userEvent.type(screen.getByRole('textbox', { name: 'Adicionar elemento em 1.0 Iniciação' }), 'Reunião de kickoff{Enter}')
    await waitFor(() => expect(createItem).toHaveBeenCalledWith('p1', { groupId: 'g-ini', name: 'Reunião de kickoff' }))
  })

  it('recolhe o grupo (linha de resumo) e expande tudo de novo', async () => {
    setup()
    await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(screen.getByRole('button', { name: 'Recolher 1.0 Iniciação' }))
    const collapsed = screen.getByRole('table', { name: '1.0 Iniciação' })
    expect(within(collapsed).queryByRole('button', { name: /Editar nome/ })).not.toBeInTheDocument()
    expect(within(collapsed).getByText('2 elementos')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Recolher tudo' }))
    // subgrupo some junto com a fase recolhida
    expect(screen.queryByRole('table', { name: '2.0 Planejamento | 2.1 Plano do Projeto' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expandir tudo' }))
    expect(await screen.findByRole('table', { name: '2.0 Planejamento | 2.1 Plano do Projeto' })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: '1.0 Iniciação' })).getByRole('button', { name: 'Editar nome de Elaborar pré-cronograma' })).toBeInTheDocument()
  })

  it('largura das tabelas em px (nunca %), a mesma em todos os grupos, recolhidos ou não — a rolagem acaba na última coluna', async () => {
    setup()
    await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(screen.getByRole('button', { name: 'Recolher 1.0 Iniciação' }))
    const tables = [screen.getByRole('table', { name: '1.0 Iniciação' }), screen.getByRole('table', { name: '2.0 Planejamento | 2.1 Plano do Projeto' })]
    const widths = tables.map((table) => table.style.width)
    expect(widths[0]).toMatch(/^\d+px$/)
    expect(widths[1]).toBe(widths[0])
    tables.forEach((table) => expect(table.style.minWidth).toBe('100%'))
  })

  it('menu da coluna: ordena e oculta (vale para todos os grupos)', async () => {
    setup()
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    const names = () => within(screen.getByRole('table', { name: '1.0 Iniciação' })).getAllByRole('button', { name: /^Editar nome de/ }).map((b) => b.textContent)
    expect(names()).toEqual(['Elaborar pré-cronograma', 'Apresentar pré-cronograma'])
    await userEvent.click(within(ini).getByRole('button', { name: 'Opções da coluna Esforço estimado' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Ordenar decrescente' }))
    // vazio fica no fim
    expect(names()).toEqual(['Elaborar pré-cronograma', 'Apresentar pré-cronograma'])
    await userEvent.click(within(ini).getByRole('button', { name: 'Opções da coluna Elemento' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Ordenar crescente' }))
    expect(names()).toEqual(['Apresentar pré-cronograma', 'Elaborar pré-cronograma'])

    await userEvent.click(within(screen.getByRole('table', { name: '1.0 Iniciação' })).getByRole('button', { name: 'Opções da coluna Recursos' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Ocultar coluna' }))
    expect(within(screen.getByRole('table', { name: '1.0 Iniciação' })).queryByRole('columnheader', { name: /Recursos/ })).not.toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: '2.0 Planejamento | 2.1 Plano do Projeto' })).queryByRole('columnheader', { name: /Recursos/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Colunas (1 oculta)' })).toBeInTheDocument()
  })

  it('grupo: excluir pede confirmação com o que vai junto', async () => {
    const deleteGroup = vi.fn<PlanRepository['deleteGroup']>(() => Promise.resolve({ deleted: 2, items: 1 }))
    setup({ deleteGroup })
    await userEvent.click(await screen.findByRole('button', { name: 'Ações do grupo 2.0 Planejamento' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir grupo' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('subgrupos (1) e os elementos (1)')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(deleteGroup).toHaveBeenCalledWith('g-pl'))
  })

  it('quadro vazio: gestor cria o primeiro grupo', async () => {
    const createGroup = vi.fn<PlanRepository['createGroup']>(() => Promise.resolve(group('g1', '1.0', 'Iniciação')))
    setup({ createGroup }, makePlan({ groups: [], items: [] }))
    await userEvent.click(await screen.findByRole('button', { name: 'Criar grupo de elementos' }))
    const dialog = await screen.findByRole('dialog', { name: 'Novo grupo' })
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Iniciação')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar grupo' }))
    await waitFor(() => expect(createGroup).toHaveBeenCalledWith('p1', { name: 'Iniciação', color: 'blue', parentId: null }))
  })

  it('leitor: sem edição, sem linhas de adicionar e sem menus de grupo', async () => {
    setup({}, makePlan({ capabilities: { edit: false, manage: false } }))
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    expect(within(ini).getByText('Elaborar pré-cronograma')).toBeInTheDocument()
    expect(within(ini).queryByRole('button', { name: /Editar nome/ })).not.toBeInTheDocument()
    expect(within(ini).queryByRole('button', { name: /^Status de/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Adicionar elemento/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ações do grupo/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Criar elemento' })).not.toBeInTheDocument()
  })
})

describe('Quadro do projeto — GP-2 (interação)', () => {
  const names = (table: HTMLElement) => within(table).queryAllByRole('button', { name: /^Editar nome de/ }).map((b) => b.textContent)

  it('filtro combinável ("Filtros (1)"), "Filtrar" no menu da coluna e limpar', async () => {
    setup()
    await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(within(screen.getByRole('table', { name: '1.0 Iniciação' })).getByRole('button', { name: 'Opções da coluna Status' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Filtrar' }))
    const panel = await screen.findByRole('dialog', { name: 'Filtros do quadro' })
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Feito' }))
    expect(names(screen.getByRole('table', { name: '1.0 Iniciação' }))).toEqual(['Elaborar pré-cronograma'])
    // subgrupo sem resultado some
    expect(screen.queryByRole('table', { name: '2.0 Planejamento | 2.1 Plano do Projeto' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filtros (1)' })).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Limpar filtros' }))
    expect(names(screen.getByRole('table', { name: '1.0 Iniciação' }))).toHaveLength(2)
  })

  it('pessoa: só os elementos com subelementos dela, já abertos', async () => {
    const data = makePlan()
    data.items = data.items.map((i) => (i.id === 's1' ? { ...i, owner: { id: 'u-bia', name: 'Bia', email: 'bia@x.com', avatarUrl: null } } : i))
    setup({}, data)
    await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(screen.getByRole('button', { name: 'Pessoa' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Pessoa' })).getByRole('button', { name: /Bia/ }))
    // o elemento (com a subtabela aberta, só com o subelemento da pessoa)
    expect(names(screen.getByRole('table', { name: '1.0 Iniciação' }))).toEqual(['Apresentar pré-cronograma', 'Montar apresentação'])
    expect(names(screen.getByRole('table', { name: 'Subelementos de Apresentar pré-cronograma' }))).toEqual(['Montar apresentação'])
  })

  it('agrupar por status: uma seção por etiqueta (em branco no fim), sem ações de grupo', async () => {
    setup()
    await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(screen.getByRole('button', { name: 'Agrupar por' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Status' }))
    expect(await screen.findByRole('table', { name: 'Feito' })).toBeInTheDocument()
    expect(names(screen.getByRole('table', { name: 'Em branco' }))).toEqual(['Apresentar pré-cronograma', 'Elaborar plano v6'])
    expect(screen.queryByRole('button', { name: /^Ações do grupo/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agrupado: Status' })).toBeInTheDocument()
  })

  it('seleção em massa: marca, muda o status e exclui com confirmação', async () => {
    const bulk = vi.fn<PlanRepository['bulk']>((_p, input) => Promise.resolve(input.action === 'delete' ? { deleted: 3 } : { updated: 2 }))
    setup({ bulk })
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(within(ini).getByRole('checkbox', { name: 'Selecionar todos de 1.0 Iniciação' }))
    const bar = screen.getByRole('toolbar', { name: 'Ações para 2 elementos' })
    expect(bar).toHaveTextContent('2 selecionados')
    await userEvent.click(within(bar).getByRole('button', { name: 'Status' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Mudar o status dos selecionados' })).getByRole('button', { name: 'Feito' }))
    await waitFor(() => expect(bulk).toHaveBeenCalledWith('p1', { ids: ['i1', 'i2'], action: 'update', statusId: 'st-done' }))

    await userEvent.click(within(bar).getByRole('button', { name: 'Excluir' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('1 subelemento')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith('p1', { ids: ['i1', 'i2'], action: 'delete' }))
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: /^Ações para/ })).not.toBeInTheDocument())
  })

  it('dependências: liga "depende de", mostra pendente e desfaz; regra do quadro pelo gestor', async () => {
    const createLink = vi.fn<PlanRepository['createLink']>(() => Promise.resolve({ id: 'l2', fromId: 'i3', toId: 'i2', type: 'blocks' }))
    const deleteLink = vi.fn<PlanRepository['deleteLink']>(() => Promise.resolve())
    const updateSettings = vi.fn<PlanRepository['updateSettings']>(() => Promise.resolve({ dependencyRule: 'block' }))
    const data = makePlan({ links: [{ id: 'l1', fromId: 'i2', toId: 'i1', type: 'blocks' }] })
    data.items = data.items.map((i) => (i.id === 'i1' ? { ...i, blocked: true } : i))
    setup({ createLink, deleteLink, updateSettings }, data)
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    const pending = within(ini).getByRole('button', { name: 'Dependências de Elaborar pré-cronograma: depende de 1 — dependência pendente' })
    await userEvent.click(pending)
    const panel = await screen.findByRole('dialog', { name: 'Dependências de Elaborar pré-cronograma' })
    expect(panel).toHaveTextContent('Apresentar pré-cronograma')
    await userEvent.click(within(panel).getByRole('button', { name: 'Desfazer a ligação com Apresentar pré-cronograma' }))
    await waitFor(() => expect(deleteLink).toHaveBeenCalledWith('l1'))
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(ini).getByRole('button', { name: /^Dependências de Apresentar pré-cronograma/ }))
    const other = await screen.findByRole('dialog', { name: 'Dependências de Apresentar pré-cronograma' })
    await userEvent.click(within(other).getByRole('button', { name: 'Elaborar plano v6' }))
    await waitFor(() => expect(createLink).toHaveBeenCalledWith('i2', { kind: 'depends_on', itemId: 'i3' }))
    await userEvent.click(within(other).getByRole('button', { name: 'Alterar regra' }))
    const dialog = await screen.findByRole('dialog', { name: 'Regra de dependências' })
    await userEvent.click(within(dialog).getByRole('radio', { name: /Impedir iniciar ou concluir/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith('p1', { dependencyRule: 'block' }))
  })

  it('dependência pendente com a regra "impedir": a troca de status volta e avisa', async () => {
    const updateItem = vi.fn<PlanRepository['updateItem']>(() => Promise.reject(new AppError({ code: 'PLAN_DEPENDENCY_PENDING', message: 'x', status: 409, details: { items: ['Apresentar pré-cronograma'] } })))
    const error = vi.spyOn(notify, 'error')
    setup({ updateItem })
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(within(ini).getByRole('button', { name: 'Status de Apresentar pré-cronograma: Em branco' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Status de Apresentar pré-cronograma' })).getByRole('button', { name: 'Feito' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('“Apresentar pré-cronograma” possui uma dependência pendente.'))
    await waitFor(() => expect(within(ini).getByRole('button', { name: 'Status de Apresentar pré-cronograma: Em branco' })).toBeInTheDocument())
  })

  it('mover pelo menu (teclado): para baixo entre os irmãos; duplicar', async () => {
    const moveItem = vi.fn<PlanRepository['moveItem']>((id) => Promise.resolve(item(id, 'g-ini', 'x')))
    const duplicateItem = vi.fn<PlanRepository['duplicateItem']>(() => Promise.resolve(item('c1', 'g-ini', 'Elaborar pré-cronograma (cópia)')))
    setup({ moveItem, duplicateItem })
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    expect(within(ini).getByRole('button', { name: 'Arrastar Elaborar pré-cronograma' })).toBeInTheDocument()
    await userEvent.click(within(ini).getByRole('button', { name: 'Ações de Elaborar pré-cronograma' }))
    expect(screen.getByRole('menuitem', { name: 'Mover para cima' })).toHaveAttribute('data-disabled')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mover para baixo' }))
    await waitFor(() => expect(moveItem).toHaveBeenCalledWith('i1', { prevId: 'i2' }))
    await userEvent.click(within(ini).getByRole('button', { name: 'Ações de Elaborar pré-cronograma' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicar' }))
    await waitFor(() => expect(duplicateItem).toHaveBeenCalledWith('i1'))
  })

  it('importar: lê o CSV, reconhece as colunas, aponta problema da linha e importa', async () => {
    const importItems = vi
      .fn<PlanRepository['importItems']>()
      .mockRejectedValueOnce(new AppError({ code: 'VALIDATION_ERROR', message: 'x', status: 400, details: { fields: { rows: 'invalid' }, rows: { 1: { status: 'invalid_option' } } } }))
      .mockResolvedValueOnce({ groups: 0, statuses: 0, resources: 1, items: 1, subitems: 1 })
    setup({ importItems })
    await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(screen.getByRole('button', { name: 'Mais opções de criação' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Importar elementos' }))
    const dialog = await screen.findByRole('dialog', { name: 'Importar elementos' })
    const csv = 'Grupo;Elemento;Subelemento;Status;Início;Recursos;Esforço estimado\n1.0 Iniciação;Kickoff;;Feito;26/01/2026;Cliente;1,5\n1.0 Iniciação;Kickoff;Pauta;Nada;;;2\n'
    const file = new File([csv], 'plano.csv', { type: 'text/csv' })
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, file)
    expect(await within(dialog).findByText(/elementos: 1 · subelementos: 1/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Importar (2)' }))
    await waitFor(() =>
      expect(importItems).toHaveBeenCalledWith('p1', [
        expect.objectContaining({ group: '1.0 Iniciação', name: 'Kickoff', parent: null, status: 'Feito', startDate: '2026-01-26', resources: ['Cliente'], estimatedHours: 1.5 }),
        expect.objectContaining({ name: 'Pauta', parent: 'Kickoff', estimatedHours: 2 }),
      ]),
    )
    expect(await within(dialog).findByText('Linha 3 · Status: status não existe (só o gestor cria etiquetas de status)')).toBeInTheDocument()
    // o problema bloqueia até mudar algo: deixa a coluna Status de fora e importa
    expect(within(dialog).getByRole('button', { name: 'Importar (2)' })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Ignorar' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Importar (2)' }))
    await waitFor(() => expect(importItems).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Importar elementos' })).not.toBeInTheDocument())
  })
})

describe('Quadro do projeto — GP-3 (painel do elemento)', () => {
  const author = { id: 'u-ana', name: 'Ana', email: 'ana@x.com', avatarUrl: null }
  const update = (id: string, content: string, extra: Partial<PlanUpdate> = {}): PlanUpdate => ({
    id,
    itemId: 'i1',
    parentId: null,
    author,
    content,
    mentions: [],
    deleted: false,
    createdAt: new Date('2026-09-30T10:00:00Z'),
    editedAt: null,
    capabilities: { edit: true, delete: true, reply: true },
    files: [],
    replies: [],
    ...extra,
  })

  it('o botão da linha abre o painel; publica, responde, edita e exclui atualizações', async () => {
    const createUpdate = vi.fn<PlanRepository['createUpdate']>((_i, input) => Promise.resolve(update('n1', input.content)))
    const editUpdate = vi.fn<PlanRepository['editUpdate']>((id, content) => Promise.resolve(update(id, content)))
    const deleteUpdate = vi.fn<PlanRepository['deleteUpdate']>(() => Promise.resolve())
    const listUpdates = vi.fn<PlanRepository['listUpdates']>(() =>
      Promise.resolve({ updates: [update('u1', 'Pauta **pronta**', { replies: [update('r1', 'Vi!', { parentId: 'u1', capabilities: { edit: false, delete: false, reply: false } })] })], capabilities: { post: true } }),
    )
    const data = makePlan()
    data.items = data.items.map((i) => (i.id === 'i1' ? { ...i, updates: 2 } : i))
    const { router } = setup({ listUpdates, createUpdate, editUpdate, deleteUpdate }, data)
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(within(ini).getByRole('button', { name: 'Atualizações de Elaborar pré-cronograma: 2' }))
    const panel = await screen.findByRole('dialog', { name: 'Elaborar pré-cronograma' })
    expect(router.state.location.search).toBe('?item=i1&panel=updates')
    expect(within(panel).getByRole('tab', { name: 'Atualizações (2)' })).toHaveAttribute('aria-selected', 'true')
    expect(await within(panel).findByText('pronta')).toBeInTheDocument()
    expect(within(panel).getByRole('list', { name: 'Respostas à atualização de Ana' })).toHaveTextContent('Vi!')

    await userEvent.type(within(panel).getByLabelText(/^Nova atualização/), 'Enviei a ata')
    await userEvent.click(within(panel).getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(createUpdate).toHaveBeenCalledWith('i1', { content: 'Enviei a ata', files: [] }))

    await userEvent.click(within(panel).getByRole('button', { name: 'Responder' }))
    await userEvent.type(within(panel).getByLabelText(/^Responder a Ana/), 'Obrigado')
    await userEvent.click(within(panel).getAllByRole('button', { name: 'Responder' }).at(-1) as HTMLElement)
    await waitFor(() => expect(createUpdate).toHaveBeenLastCalledWith('i1', { content: 'Obrigado', parentId: 'u1', files: [] }))

    await userEvent.click(within(panel).getAllByRole('button', { name: 'Editar atualização' })[0] as HTMLElement)
    const editor = within(panel).getByLabelText(/^Editar atualização/)
    await userEvent.clear(editor)
    await userEvent.type(editor, 'Pauta revisada')
    await userEvent.click(within(panel).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(editUpdate).toHaveBeenCalledWith('u1', 'Pauta revisada'))

    await userEvent.click(within(panel).getAllByRole('button', { name: 'Excluir atualização' })[0] as HTMLElement)
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(deleteUpdate).toHaveBeenCalledWith('u1'))
  })

  it('cola a imagem (Ctrl+V) na atualização: miniatura antes de enviar, só a imagem já publica; a imagem aparece na conversa', async () => {
    const shot: PlanFile = { id: 'f1', itemId: 'i1', updateId: 'u1', name: 'print.png', mime: 'image/png', kind: 'image', size: 10, uploadedBy: author, createdAt: null, url: '/api/v1/plan/files/f1/file', capabilities: { delete: true } }
    const listUpdates = vi.fn<PlanRepository['listUpdates']>(() => Promise.resolve({ updates: [update('u1', '', { files: [shot] })], capabilities: { post: true } }))
    const createUpdate = vi.fn<PlanRepository['createUpdate']>((_i, input) => Promise.resolve(update('n1', input.content)))
    const deleteFile = vi.fn<PlanRepository['deleteFile']>(() => Promise.resolve())
    setup({ listUpdates, createUpdate, deleteFile }, makePlan(), '/?item=i1&panel=updates')
    const panel = await screen.findByRole('dialog', { name: 'Elaborar pré-cronograma' })
    expect(within(panel).queryByRole('tab', { name: /Arquivos/ })).not.toBeInTheDocument()
    expect(await within(panel).findByRole('button', { name: 'Abrir print.png' })).toBeInTheDocument()

    const box = within(panel).getByLabelText(/^Nova atualização/)
    const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' })
    fireEvent.paste(box, { clipboardData: { files: [image], getData: () => '' } })
    const toSend = within(panel).getByRole('list', { name: 'Imagens e arquivos da atualização' })
    expect(within(toSend).getByRole('button', { name: /^Tirar imagem-colada-\d{8}-\d{6}\.png$/ })).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(createUpdate).toHaveBeenCalledTimes(1))
    const sent = createUpdate.mock.calls[0]?.[1]
    expect(sent?.content).toBe('')
    expect(sent?.files?.map((file) => file.name)).toEqual([expect.stringMatching(/^imagem-colada-\d{8}-\d{6}\.png$/)])
    await waitFor(() => expect(within(panel).queryByRole('list', { name: 'Imagens e arquivos da atualização' })).not.toBeInTheDocument())

    // sem texto e sem imagem: pede o texto
    await userEvent.click(within(panel).getByRole('button', { name: 'Atualizar' }))
    expect(await within(panel).findByText('Campo obrigatório')).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'Excluir print.png' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(deleteFile).toHaveBeenCalledWith('f1'))
  })

  it('endereço direto abre a aba; histórico e detalhes; aba antiga de arquivos cai nas atualizações', async () => {
    const history = vi.fn<PlanRepository['history']>(() =>
      Promise.resolve({
        items: [{ id: 'a1', entityType: 'plan_item', entityId: 'i1', action: 'plan_item.update_added', oldValue: null, newValue: { update: 'Pauta pronta' }, user: { id: 'u-ana', name: 'Ana', email: 'a@x.com' }, ip: '', userAgent: '', correlationId: '', createdAt: new Date('2026-09-30T10:00:00Z') }],
        page: 1,
        perPage: 100,
        total: 1,
        totalPages: 1,
      }),
    )
    setup({ history }, makePlan(), '/?item=i2&panel=files')
    const panel = await screen.findByRole('dialog', { name: 'Apresentar pré-cronograma' })
    expect(within(panel).getByRole('tab', { name: 'Atualizações' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(within(panel).getByRole('tab', { name: 'Histórico' }))
    expect(await within(panel).findByText(/atualização publicada/i)).toBeInTheDocument()
    expect(history).toHaveBeenCalledWith('i2')

    await userEvent.click(within(panel).getByRole('tab', { name: 'Detalhes' }))
    expect(within(panel).getByText('Subelementos')).toBeInTheDocument()
  })
})

describe('Quadro do projeto — GP-4 (visões e gestão)', () => {
  it('barra de visões no endereço; Cronograma com barras, Bateria, Esforço, "Sem cronograma" e linha de base do gestor', async () => {
    const saveBaseline = vi.fn<PlanRepository['saveBaseline']>(() => Promise.resolve({ savedAt: new Date(), items: 1 }))
    const data = makePlan({
      summary: { items: 3, statusCounts: [{ statusId: 'st-done', count: 1 }, { statusId: null, count: 2 }], startDate: '2026-01-26', endDate: '2026-01-27', estimatedHours: 5.5, durationDays: 3, progress: 50 },
    })
    const { router } = setup({ saveBaseline }, data)
    const nav = await screen.findByRole('navigation', { name: 'Visões do quadro' })
    expect(within(nav).getByRole('link', { name: 'Quadro principal' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(nav).getByRole('link', { name: 'Cronograma' }))
    await waitFor(() => expect(router.state.location.search).toBe('?view=timeline'))
    expect(await screen.findByRole('group', { name: 'Cronograma de Implantação' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Elaborar pré-cronograma, 26 de jan/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Bateria' })).toHaveTextContent('33,3%')
    expect(screen.getByRole('region', { name: 'Esforço estimado (h)' })).toHaveTextContent('5,5')
    const unscheduled = screen.getByRole('region', { name: /^Sem cronograma/ })
    expect(within(unscheduled).getByRole('button', { name: 'Apresentar pré-cronograma' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Linha de base' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Salvar linha de base' }))
    await waitFor(() => expect(saveBaseline).toHaveBeenCalledWith('p1'))
  })

  it('Cronograma com linha de base salva: traço sob a barra (pode ocultar); só o gestor substitui', async () => {
    const data = makePlan({ settings: { dependencyRule: 'warn', baselineAt: new Date('2026-01-20T12:00:00Z') } })
    data.items = data.items.map((i) => (i.id === 'i1' ? { ...i, baselineStart: '2026-01-26', baselineEnd: '2026-01-26' } : i))
    setup({}, data, '/?view=timeline')
    expect(await screen.findByTestId('timeline-baseline-i1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Elaborar pré-cronograma, .*fim 1 dia depois da linha de base/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Linha de base' }))
    expect(screen.queryByTestId('timeline-baseline-i1')).not.toBeInTheDocument()
  })

  it('Kanban: colunas por status com contagem e "Em branco"; "Mover para…" do card muda o status; o card abre o painel', async () => {
    const updateItem = vi.fn<PlanRepository['updateItem']>((id) => Promise.resolve(makePlan().items.find((i) => i.id === id) as PlanItem))
    const { router } = setup({ updateItem }, makePlan(), '/?view=kanban')
    const done = await screen.findByRole('region', { name: 'Feito: 1' })
    expect(within(done).getByText('Elaborar pré-cronograma')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Em branco: 2' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Apresentar pré-cronograma' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mover para "Em progresso"' }))
    await waitFor(() => expect(updateItem).toHaveBeenCalledWith('i2', { statusId: 'st-prog' }))
    await userEvent.click(screen.getByRole('button', { name: 'Abrir Elaborar pré-cronograma' }))
    await waitFor(() => expect(router.state.location.search).toContain('item=i1'))
  })

  it('Gestão: registra no diário, muda a situação do problema na lista e abre um problema novo', async () => {
    const entry = (input: { entryDate?: string; content?: string }): JournalEntry => ({ id: 'j1', entryDate: input.entryDate ?? '', content: input.content ?? '', author: null, createdAt: null, updatedAt: null, capabilities: { edit: true, delete: true } })
    const issue: PlanIssue = { id: 'pb1', number: 1, openedOn: '2026-02-05', description: 'Cliente sem VPN', state: 'pending', owner: null, resolvedOn: null, createdBy: null, createdAt: null, updatedAt: null, capabilities: { edit: true, delete: true } }
    const createJournalEntry = vi.fn<PlanRepository['createJournalEntry']>((_p, input) => Promise.resolve(entry(input)))
    const listIssues = vi.fn<PlanRepository['listIssues']>(() => Promise.resolve({ issues: [issue], capabilities: { create: true } }))
    const createIssue = vi.fn<PlanRepository['createIssue']>((_p, input) => Promise.resolve({ ...issue, id: 'pb2', number: 2, description: input.description ?? '' }))
    const updateIssue = vi.fn<PlanRepository['updateIssue']>((_id, input) => Promise.resolve({ ...issue, state: input.state ?? issue.state }))
    setup({ createJournalEntry, listIssues, createIssue, updateIssue }, makePlan(), '/?view=management')

    await userEvent.click(await screen.findByRole('button', { name: 'Novo registro' }))
    const dialog = await screen.findByRole('dialog', { name: 'Novo registro no diário' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Registro/ }), 'Reunião de abertura')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Novo registro' }))
    await waitFor(() => expect(createJournalEntry).toHaveBeenCalledWith('p1', { entryDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), content: 'Reunião de abertura' }))

    expect(await screen.findByText('Cliente sem VPN')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: 'Situação do problema #1' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Resolvido' }))
    await waitFor(() => expect(updateIssue).toHaveBeenCalledWith('pb1', { state: 'resolved' }))

    await userEvent.click(screen.getByRole('button', { name: 'Novo problema' }))
    const form = await screen.findByRole('dialog', { name: 'Novo problema' })
    await userEvent.type(within(form).getByRole('textbox', { name: /^Descrição/ }), 'Servidor atrasado')
    await userEvent.click(within(form).getByRole('button', { name: 'Novo problema' }))
    await waitFor(() => expect(createIssue).toHaveBeenCalledWith('p1', expect.objectContaining({ description: 'Servidor atrasado', state: 'pending', ownerId: null })))
  })

  it('Relatórios: saúde do projeto com cada fator e o valor; resumo, esforço e grupos; "hoje" no fuso de quem vê', async () => {
    const data: PlanReport = {
      today: '2026-02-10',
      summary: { total: 3, done: 1, open: 2, overdue: 1, stuck: 0, canceled: 0, progress: 50 },
      schedule: { onTime: 0, overdue: 1, unscheduled: 1, done: 1 },
      effort: { estimated: 5.5, actual: 3, remaining: 2.5, deviation: { hours: 1, percent: 25 } },
      resources: [{ resourceId: 'r-gp', name: 'Gerente de Projetos', color: 'indigo', items: 1, open: 0, estimated: 1 }],
      groups: [{ groupId: 'g-ini', number: '1.0', name: 'Iniciação', color: 'blue', items: 2, done: 1, overdue: 1, progress: 50, estimated: 5.5, actual: 3 }],
      health: {
        level: 'critical',
        factors: [
          { key: 'schedule', level: 'critical', value: 100, count: 1, of: 1 },
          { key: 'progress', level: 'ok', value: 0, planned: 50, actual: 50 },
          { key: 'stuck', level: 'ok', value: 0, count: 0, of: 2 },
          { key: 'effort', level: 'attention', value: 25, hours: 1 },
          { key: 'issues', level: 'ok', value: 0 },
        ],
      },
    }
    const report = vi.fn<PlanRepository['report']>(() => Promise.resolve(data))
    setup({ report }, makePlan(), '/?view=reports')
    const health = await screen.findByRole('region', { name: 'Saúde do projeto' })
    expect(within(health).getAllByText('Crítico').length).toBeGreaterThan(0)
    expect(within(health).getByText('100% dos abertos com data estão atrasados (1 de 1).')).toBeInTheDocument()
    expect(within(health).getByText('Realizado 25% acima do estimado nos feitos (1 h).')).toBeInTheDocument()
    expect(report).toHaveBeenCalledWith('p1', new Date().getTimezoneOffset())
    expect(screen.getByRole('region', { name: 'Esforço' })).toHaveTextContent('+25%')
    expect(screen.getByRole('table', { name: 'Grupos' })).toHaveTextContent('1.0 Iniciação')
  })
})

describe('Quadro do projeto — GP-5 (colunas personalizadas)', () => {
  const custo: PlanColumn = { id: 'c-custo', name: 'Custo', type: 'number', settings: { unit: 'R$' }, position: 1 }
  const fase: PlanColumn = { id: 'c-fase', name: 'Fase', type: 'dropdown', settings: { options: [{ id: 'o-pil', name: 'Piloto', color: 'blue' }, { id: 'o-pro', name: 'Produção', color: 'green' }] }, position: 2 }
  const withColumns = () => {
    const data = makePlan({ columns: [custo, fase] })
    data.items = data.items.map((i) => (i.id === 'i1' ? { ...i, custom: { 'c-custo': 1200, 'c-fase': 'o-pil' } } : i))
    data.groups = data.groups.map((g) => (g.id === 'g-ini' && g.summary ? { ...g, summary: { ...g.summary, customSums: { 'c-custo': 1200 } } } : g))
    return data
  }

  it('gestor: "+" no fim do cabeçalho adiciona coluna (nome, tipo e opções da lista)', async () => {
    const createColumn = vi.fn<PlanRepository['createColumn']>((_p, input) => Promise.resolve({ id: 'c-new', name: input.name ?? '', type: input.type ?? 'text', settings: input.settings ?? {}, position: 3 }))
    setup({ createColumn })
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    await userEvent.click(within(ini).getByRole('button', { name: 'Adicionar coluna' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nova coluna' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Nome da coluna/ }), 'Etapa')
    await userEvent.click(within(dialog).getByRole('radio', { name: /Lista de opções/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adicionar opção' }))
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nome da opção 1' }), 'Piloto')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adicionar coluna' }))
    await waitFor(() => expect(createColumn).toHaveBeenCalledWith('p1', { name: 'Etapa', type: 'dropdown', settings: { options: [{ name: 'Piloto', color: expect.any(String) }] } }))
  })

  it('células por tipo: número com unidade e soma no rodapé; lista colorida; editar grava só a coluna', async () => {
    const updateItem = vi.fn<PlanRepository['updateItem']>((id) => Promise.resolve(withColumns().items.find((i) => i.id === id) as PlanItem))
    setup({ updateItem }, withColumns())
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    expect(within(ini).getByRole('columnheader', { name: /Custo/ })).toBeInTheDocument()
    expect(within(ini).getByRole('button', { name: 'Custo de Elaborar pré-cronograma' })).toHaveTextContent('1.200 R$')
    expect(within(ini).getByRole('button', { name: 'Fase de Elaborar pré-cronograma: Piloto' })).toBeInTheDocument()
    // a célula e o total do rodapé
    expect(within(ini).getAllByText('1.200 R$')).toHaveLength(2)

    await userEvent.click(within(ini).getByRole('button', { name: 'Fase de Elaborar pré-cronograma: Piloto' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Produção', pressed: false }))
    await waitFor(() => expect(updateItem).toHaveBeenCalledWith('i1', { custom: { 'c-fase': 'o-pro' } }))

    await userEvent.click(within(ini).getByRole('button', { name: 'Custo de Apresentar pré-cronograma' }))
    const input = within(ini).getByRole('textbox', { name: 'Custo de Apresentar pré-cronograma' })
    await userEvent.type(input, '350,5{Enter}')
    await waitFor(() => expect(updateItem).toHaveBeenCalledWith('i2', { custom: { 'c-custo': 350.5 } }))
  })

  it('menu da coluna: alterar o tipo mostra a prévia do que se perde; excluir pede confirmação', async () => {
    const previewColumnType = vi.fn<PlanRepository['previewColumnType']>(() => Promise.resolve({ converted: 0, lost: 1 }))
    const changeColumnType = vi.fn<PlanRepository['changeColumnType']>(() => Promise.resolve({ ...fase, type: 'text' }))
    const deleteColumn = vi.fn<PlanRepository['deleteColumn']>(() => Promise.resolve({ values: 1 }))
    setup({ previewColumnType, changeColumnType, deleteColumn }, withColumns())
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })

    await userEvent.click(within(ini).getByRole('button', { name: 'Opções da coluna Fase' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Alterar tipo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Alterar o tipo de "Fase"' })
    await userEvent.click(within(dialog).getByRole('radio', { name: /Número/ }))
    expect(await within(dialog).findByText('0 convertido(s) · 1 valor não converte e fica vazio.')).toBeInTheDocument()
    expect(previewColumnType).toHaveBeenCalledWith('c-fase', { type: 'number' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Alterar tipo' }))
    await waitFor(() => expect(changeColumnType).toHaveBeenCalledWith('c-fase', { type: 'number' }))

    await userEvent.click(within(ini).getByRole('button', { name: 'Opções da coluna Custo' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir coluna' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('O valor de 1 elemento será apagado.')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(deleteColumn).toHaveBeenCalledWith('c-custo'))
  })

  it('quem não é gestor: sem "+" nem opções de coluna; leitor vê os valores sem editar', async () => {
    const data = withColumns()
    data.capabilities = { edit: false, manage: false }
    setup({}, data)
    const ini = await screen.findByRole('table', { name: '1.0 Iniciação' })
    expect(within(ini).queryByRole('button', { name: 'Adicionar coluna' })).not.toBeInTheDocument()
    expect(within(ini).getByText('Piloto')).toBeInTheDocument()
    expect(within(ini).queryByRole('button', { name: /^Fase de/ })).not.toBeInTheDocument()
    await userEvent.click(within(ini).getByRole('button', { name: 'Opções da coluna Fase' }))
    expect(screen.queryByRole('menuitem', { name: 'Excluir coluna' })).not.toBeInTheDocument()
  })
})
