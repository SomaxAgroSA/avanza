/**
 * Varredura de acessibilidade e responsividade (Fase 9): todas as telas em desktop (1366) e
 * celular (390), tema claro e escuro. Exige zero violações graves/críticas do axe-core (WCAG 2.1
 * A/AA), nenhuma rolagem horizontal, nenhuma 2ª barra de rolagem (só o <main> rola) e nenhum
 * erro no console.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN, axeViolations, documentVerticalOverflow, horizontalOverflow, launchBrowser, login, seedBase, startApp, watchErrors } from './support.mjs'

const MODES = [
  { name: 'desktop claro', viewport: { width: 1366, height: 900 }, colorScheme: 'light' },
  { name: 'desktop escuro', viewport: { width: 1366, height: 900 }, colorScheme: 'dark' },
  { name: 'celular claro', viewport: { width: 390, height: 844 }, colorScheme: 'light' },
  { name: 'celular escuro', viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
]

describe('E2E — acessibilidade e responsividade', { timeout: 600000 }, () => {
  let app
  let browser
  let pages

  before(async () => {
    app = await startApp()
    browser = await launchBrowser()
    const seed = await seedBase(app.admin)
    const st = (key) => seed.statuses.find((s) => s.key === key).id
    const a = await seed.task('Configurar ambiente', { description: 'Passos **principais** do ambiente.', status_id: st('DESENVOLVIMENTO'), estimated_hours: 4, due_date: '2020-01-10' })
    const b = await seed.task('Publicar versão', { status_id: st('PRIORIZADO') })
    await seed.task('Revisar textos', { status_id: st('CONCLUIDO') })
    await seed.task('Subtarefa de ambiente', { parent_task_id: a.id })
    await app.admin.post(`/tasks/${a.id}/relations`, { type: 'blocks', target_id: b.id })
    await app.admin.post(`/tasks/${a.id}/comments`, { content: 'Ambiente de homologação pronto.' })
    const sprint = (await app.admin.post(`/projects/${seed.project.id}/sprints`, { name: 'Sprint 1' })).body.data
    await app.admin.patch(`/tasks/${b.id}`, { sprint_id: sprint.id })
    await app.admin.patch(`/tasks/${a.id}`, { start_date: '2020-01-01' })
    await app.admin.post(`/projects/${seed.project.id}/milestones`, { name: 'Go-live', due_date: '2020-01-31' })
    const type = seed.types.find((t) => t.key === 'BUG') || seed.types[0]
    // quadro de gerenciamento (módulo à parte das tarefas): fase, subgrupo, elementos, subelemento e etiquetas
    const board = (await app.admin.get(`/projects/${seed.project.id}/plan`)).body.data
    const feito = board.statuses.find((x) => x.category === 'done')
    const ini = (await app.admin.post(`/projects/${seed.project.id}/groups`, { name: 'Iniciação', color: 'blue' })).body.data
    const fase = (await app.admin.post(`/projects/${seed.project.id}/groups`, { name: 'Planejamento', color: 'green' })).body.data
    const plano = (await app.admin.post(`/projects/${seed.project.id}/groups`, { name: 'Plano do Projeto', parent_id: fase.id, color: 'violet' })).body.data
    const gp = (await app.admin.post(`/projects/${seed.project.id}/plan/resources`, { name: 'Gerente de Projetos' })).body.data
    const kickoff = (
      await app.admin.post(`/projects/${seed.project.id}/plan/items`, {
        group_id: ini.id,
        name: 'Reunião de kickoff',
        status_id: feito.id,
        start_date: '2020-01-06',
        end_date: '2020-01-07',
        resource_ids: [gp.id],
        estimated_hours: 2,
      })
    ).body.data
    await app.admin.post(`/projects/${seed.project.id}/plan/items`, { parent_id: kickoff.id, name: 'Preparar pauta', owner_id: seed.member.id, due_date: '2020-01-05', estimated_hours: 1, progress: 50 })
    await app.admin.post(`/projects/${seed.project.id}/plan/items`, { group_id: plano.id, name: 'Elaborar plano', duration_days: 3 })
    // gestão: um registro no diário e um problema (a tela de gestão e o relatório com dados)
    await app.admin.post(`/projects/${seed.project.id}/plan/journal`, { entry_date: '2020-01-06', content: 'Reunião de abertura do projeto.' })
    await app.admin.post(`/projects/${seed.project.id}/plan/issues`, { opened_on: '2020-01-07', description: 'Cliente sem acesso à VPN', owner_id: seed.member.id })
    await app.admin.put(`/projects/${seed.project.id}/plan/baseline`, {})
    // colunas personalizadas (GP-5) com valores: número, lista, caixa, pessoa e link
    const col = async (body) => (await app.admin.post(`/projects/${seed.project.id}/plan/columns`, body)).body.data
    const custo = await col({ name: 'Custo', type: 'number', settings: { unit: 'R$' } })
    const etapa = await col({ name: 'Etapa', type: 'dropdown', settings: { options: [{ name: 'Piloto', color: 'violet' }] } })
    const ok = await col({ name: 'Aprovado', type: 'checkbox' })
    const quem = await col({ name: 'Aprovador', type: 'people' })
    const site = await col({ name: 'Ata', type: 'link' })
    await app.admin.patch(`/plan/items/${kickoff.id}`, { custom: { [custo.id]: 1200, [etapa.id]: etapa.settings.options[0].id, [ok.id]: true, [quem.id]: seed.member.id, [site.id]: 'https://example.com/ata' } })
    // documentação: espaço com uma página rica publicada e uma subpágina em rascunho
    const space = (await app.admin.post('/docs/spaces', { key: 'MANUAL', name: 'Manuais', description: 'Guias de uso.', visibility: 'company' })).body.data
    const docPage = (await app.admin.post(`/docs/spaces/${space.id}/pages`, { title: 'Cadastro de clientes' })).body.data
    await app.admin.post(`/docs/spaces/${space.id}/pages`, { title: 'Regras do cadastro', parent_id: docPage.id })
    const txt = (text) => ({ type: 'text', text })
    const para = (text) => ({ type: 'paragraph', content: [txt(text)] })
    const cell = (type, text) => ({ type, content: [para(text)] })
    await app.admin.post(`/docs/pages/${docPage.id}/publish`, {
      title: 'Cadastro de clientes',
      content: {
        type: 'doc',
        content: [
          { type: 'tableOfContents' },
          { type: 'heading', attrs: { level: 2 }, content: [txt('Regras')] },
          para('O cadastro exige a validação do CNPJ.'),
          { type: 'callout', attrs: { tone: 'warning' }, content: [para('Não salve sem o CNPJ.')] },
          { type: 'heading', attrs: { level: 2 }, content: [txt('Campos')] },
          { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'Campo'), cell('tableHeader', 'Regra')] }, { type: 'tableRow', content: [cell('tableCell', 'CNPJ'), cell('tableCell', 'Obrigatório')] }] },
          { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para('Revisado')] }] },
          { type: 'codeBlock', content: [txt('GET /api/v1/clientes')] },
        ],
      },
    })
    const p = seed.project.id
    pages = [
      ['dashboard', '/dashboard'],
      ['projetos', '/projects'],
      ['projeto', `/projects/${p}`],
      ['projeto — tarefas', `/projects/${p}/tasks`],
      ['projeto — gestão', `/projects/${p}/management`],
      ['gestão — cronograma', `/projects/${p}/management?view=timeline`],
      ['gestão — diário e problemas', `/projects/${p}/management?view=management`],
      ['projeto — arquivos', `/projects/${p}/files`],
      ['projeto — membros', `/projects/${p}/members`],
      ['projeto — histórico', `/projects/${p}/history`],
      ['tarefas', '/tasks'],
      ['tarefa', `/tasks/${a.id}`],
      ['tarefa — comentários', `/tasks/${a.id}?tab=comments`],
      ['tarefa — relações', `/tasks/${a.id}?tab=relations`],
      ['tarefa — histórico', `/tasks/${a.id}?tab=history`],
      ['kanban de todos os projetos', '/kanban'],
      ['projeto — kanban', `/projects/${p}/kanban`],
      ['projeto — planejamento', `/projects/${p}/planning`],
      ['projeto — cronograma', `/projects/${p}/timeline`],
      ['relatórios', '/reports'],
      ['acompanhamento de projetos', '/tracking'],
      ['documentação', '/docs'],
      ['espaço de documentação', '/docs/MANUAL'],
      ['página de documentação', `/docs/MANUAL/${docPage.id}`],
      ['editor de documentação', `/docs/MANUAL/${docPage.id}/edit`],
      ['notificações', '/notifications'],
      ['conta', '/account'],
      ['sessões', '/account/sessions'],
      ['tokens de API', '/account/tokens'],
      ['usuários', '/users'],
      ['configurações gerais', '/settings/general'],
      ['integrações', '/settings/integrations'],
      ['tipos de tarefa', '/settings/task-types'],
      ['tipo de tarefa', `/settings/task-types/${type.id}`],
      ['campos personalizados', '/settings/custom-fields'],
      ['status', '/settings/statuses'],
      ['prioridades', '/settings/priorities'],
      ['tags', '/settings/tags'],
      ['perfis', '/settings/roles'],
      ['permissões', '/settings/permissions'],
      ['auditoria', '/settings/audit'],
      ['página inexistente', '/nao-existe'],
    ]
  })

  after(async () => {
    if (browser) await browser.close()
    if (app) await app.pb.stop()
  })

  async function settle(page) {
    await page.waitForLoadState('networkidle')
    // animações de entrada (opacidade) confundem o cálculo de contraste
    await page.waitForTimeout(450)
  }

  for (const mode of MODES) {
    it(`telas — ${mode.name}`, async () => {
      const problems = []
      const check = async (page, label, inShell = true) => {
        await settle(page)
        const violations = await axeViolations(page)
        violations.forEach((v) => problems.push(`${label}: [${v.impact}] ${v.id} — ${v.help} → ${v.nodes.join(' | ')}`))
        const overflow = await horizontalOverflow(page)
        if (overflow > 0) problems.push(`${label}: rolagem horizontal de ${overflow}px`)
        const doubleScroll = inShell ? await documentVerticalOverflow(page) : 0
        if (doubleScroll > 0) problems.push(`${label}: o documento rola ${doubleScroll}px além da janela (2ª barra de rolagem)`)
      }

      // tela pública
      const context = await browser.newContext({ viewport: mode.viewport, colorScheme: mode.colorScheme, bypassCSP: true })
      const publicPage = await context.newPage()
      const publicErrors = watchErrors(publicPage)
      await publicPage.goto(`${app.baseUrl}/login`)
      await check(publicPage, 'login', false)
      await publicPage.goto(`${app.baseUrl}/forgot-password`)
      await check(publicPage, 'esqueci minha senha', false)
      await publicPage.goto(`${app.baseUrl}/reset-password?token=invalido`)
      await check(publicPage, 'nova senha (link inválido)', false)
      await context.close()

      const { page, context: session, errors } = await login(browser, app.baseUrl, ADMIN.email, ADMIN.password, { ...mode, axe: true })
      for (const [label, path] of pages) {
        await page.goto(`${app.baseUrl}${path}`)
        await check(page, label)
      }

      // sobreposições: formulário de nova tarefa e paleta de comandos
      await page.goto(`${app.baseUrl}/tasks`)
      await settle(page)
      await page.getByRole('button', { name: 'Nova tarefa' }).first().click()
      await page.getByRole('dialog').waitFor()
      await check(page, 'formulário de tarefa')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+k')
      await page.getByRole('dialog').waitFor()
      await check(page, 'paleta de comandos')
      await page.keyboard.press('Escape')

      // quadro de gerenciamento: painel de filtros, barra da seleção em massa e importação
      await page.goto(`${app.baseUrl}${pages.find(([label]) => label === 'gestão de projetos')[1]}`)
      await page.getByRole('table', { name: '1.0 Iniciação', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Filtro', exact: true }).click()
      await page.getByRole('dialog', { name: 'Filtros do quadro' }).waitFor()
      await check(page, 'quadro — filtros')
      await page.keyboard.press('Escape')
      await page.getByRole('checkbox', { name: 'Selecionar todos de 1.0 Iniciação' }).click()
      await page.getByRole('toolbar', { name: /^Ações para/ }).waitFor()
      await check(page, 'quadro — seleção em massa')
      await page.getByRole('toolbar', { name: /^Ações para/ }).getByRole('button', { name: 'Limpar seleção' }).click()
      await page.getByRole('button', { name: 'Mais opções de criação' }).click()
      await page.getByRole('menuitem', { name: 'Importar elementos' }).click()
      await page.getByRole('dialog', { name: 'Importar elementos' }).waitFor()
      await check(page, 'quadro — importar')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Abrir as atualizações de Reunião de kickoff' }).click({ force: true })
      await page.getByRole('dialog', { name: 'Reunião de kickoff' }).waitFor()
      await check(page, 'quadro — painel do elemento')
      await session.close()

      problems.push(...publicErrors.map((e) => `login: ${e}`), ...errors)
      assert.deepEqual(problems, [], `\n${problems.join('\n')}`)
    })
  }
})
