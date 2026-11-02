/**
 * Fluxos de aceite do MVP (§43) no navegador, contra o build de produção servido por um
 * PocketBase isolado: login/idioma/tema/sair, projeto e membro, Kanban (inclusive campo exigido pelo
 * status de destino), timeline (arrastar e esticar barras), planejamento em sprint,
 * colaboração (comentário, relação, fork), relatórios, leitor sem edição e sessão encerrada.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN, PASSWORD, api, launchBrowser, login, seedBase, startApp, watchErrors } from './support.mjs'

/** Arrasto com o mouse em passos (o dnd-kit só ativa depois de alguns pixels). */
async function drag(page, from, to, offsetY = 40) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + offsetY, { steps: 15 })
  await page.waitForTimeout(300)
  await page.mouse.up()
}

describe('E2E — fluxos do MVP', { timeout: 300000 }, () => {
  let app
  let browser
  let seed
  const contexts = []

  before(async () => {
    app = await startApp()
    browser = await launchBrowser()
    seed = await seedBase(app.admin)
  })

  after(async () => {
    for (const context of contexts) await context.close().catch(() => {})
    if (browser) await browser.close()
    if (app) await app.pb.stop()
  })

  async function signIn(email, password, options) {
    const session = await login(browser, app.baseUrl, email, password, options)
    contexts.push(session.context)
    return session
  }

  const statusId = (key) => seed.statuses.find((s) => s.key === key).id

  it('login com troca de idioma, tema escuro e sair', async () => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
    contexts.push(context)
    const page = await context.newPage()
    const errors = watchErrors(page)
    const chunks = []
    page.on('response', (r) => r.url().includes('/assets/') && chunks.push(r.url().split('/assets/')[1]))

    await page.goto(`${app.baseUrl}/login`)
    await page.getByRole('heading', { name: 'Entrar' }).waitFor()
    assert.ok(!chunks.some((c) => /^(en|es)-/.test(c)), 'en/es não devem vir no carregamento inicial')

    // idioma sob demanda: o inglês só é baixado quando escolhido
    await page.getByRole('combobox', { name: 'Idioma' }).click()
    await page.getByRole('option', { name: 'English' }).click()
    await page.getByRole('heading', { name: 'Sign in' }).waitFor()
    assert.ok(chunks.some((c) => /^en-/.test(c)), 'pacote do inglês carregado sob demanda')
    await page.getByRole('combobox', { name: 'Language' }).click()
    await page.getByRole('option', { name: 'Português (Brasil)' }).click()
    await page.getByRole('heading', { name: 'Entrar' }).waitFor()

    // senha errada: mensagem genérica, sem dizer se o e-mail existe
    await page.fill('input[type=email]', ADMIN.email)
    await page.fill('input[type=password]', 'errada-123456')
    await page.click('button[type=submit]')
    await page.getByRole('alert').waitFor()

    await page.fill('input[type=password]', ADMIN.password)
    await page.click('button[type=submit]')
    await page.waitForURL('**/dashboard')

    // tema escuro aplicado na raiz e mantido ao navegar
    await page.getByRole('button', { name: 'Tema' }).click()
    await page.getByRole('menuitem', { name: /Escuro/ }).click()
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Tarefas' }).click()
    await page.waitForURL('**/tasks')
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true)
    await page.getByRole('button', { name: 'Tema' }).click()
    await page.getByRole('menuitem', { name: /Sistema/ }).click()

    // idioma pelo menu da conta (salvo no perfil) e de volta
    await page.getByRole('button', { name: 'Menu da conta' }).click()
    await page.getByRole('menuitem', { name: 'Español' }).click()
    await page.getByRole('navigation', { name: /navegación/i }).getByRole('link', { name: 'Tareas' }).waitFor()
    // cadastros traduzidos: os tipos de tarefa padrão aparecem em espanhol na hora
    await page.getByRole('navigation', { name: /navegación/i }).getByRole('link', { name: 'Tareas' }).click()
    await page.getByRole('button', { name: /Nueva tarea/ }).first().click()
    await page.getByRole('dialog').getByRole('combobox', { name: /^Tipo/ }).click()
    await page.getByRole('option', { name: 'Documentación' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('listbox').waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: /cuenta/i }).click()
    await page.getByRole('menuitem', { name: 'Português (Brasil)' }).click()
    await page.getByRole('navigation', { name: 'Navegação principal' }).waitFor()

    await page.getByRole('button', { name: 'Menu da conta' }).click()
    await page.getByRole('menuitem', { name: 'Sair' }).click()
    await page.waitForURL('**/login')
    await page.getByText('Você saiu com segurança').waitFor()
    // voltar para uma página interna exige login de novo
    await page.goto(`${app.baseUrl}/tasks`)
    await page.waitForURL(/\/login/)
    assert.deepEqual(errors, [])
  })

  it('cria projeto e adiciona membro pela interface', async () => {
    const { page, errors } = await signIn(ADMIN.email, ADMIN.password)
    await page.goto(`${app.baseUrl}/projects`)
    await page.getByRole('button', { name: 'Novo projeto' }).first().click()
    const drawer = page.getByRole('dialog')
    await drawer.getByLabel(/^Nome/).fill('Portal do Cliente')
    await page.waitForFunction(() => {
      const input = [...document.querySelectorAll('input')].find((i) => i.labels && [...i.labels].some((l) => l.textContent.startsWith('Chave')))
      return input && input.value.length > 0
    })
    await drawer.getByRole('button', { name: 'Novo projeto' }).click()
    await page.waitForURL(/\/projects\/[a-z0-9]+$/)
    await page.getByText(/Projeto .* criado/).waitFor()

    // abas do projeto são endereços (/projects/:id/members)
    await page.getByRole('link', { name: /^Membros/ }).click()
    await page.getByRole('button', { name: 'Adicionar membro' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder('Buscar por nome ou e-mail').fill('Lia')
    await dialog.getByRole('listitem').filter({ hasText: 'Lia Leitora' }).getByRole('button', { name: 'Adicionar' }).click()
    await page.getByText(/Lia Leitora adicionado como/).waitFor()

    // a aba fica no endereço (/projects/:id/members): o id é o trecho depois de /projects/
    const projectId = new URL(page.url()).pathname.split('/')[2]
    const members = (await api(page, 'GET', `/projects/${projectId}/members`)).json.data
    assert.ok(members.some((m) => m.user.email === 'lia@kamban.test'))
    assert.deepEqual(errors, [])
  })

  it('Kanban: criação rápida e arrastar entre colunas', async () => {
    const { page, errors } = await signIn('mario@kamban.test', PASSWORD, { viewport: { width: 1600, height: 900 } })
    await page.goto(`${app.baseUrl}/projects/${seed.project.id}/kanban`)
    await page.waitForSelector('[data-testid=kanban-board]')

    await page.getByRole('button', { name: 'Criar tarefa em Backlog' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Título/).fill('Revisar manual de uso')
    await dialog.getByRole('combobox', { name: /Tipo/ }).click()
    await page.getByRole('option', { name: seed.doc.name }).click()
    await dialog.getByRole('button', { name: 'Nova tarefa' }).click()
    await page.getByText(/Tarefa E2E-\d+ criada/).waitFor()

    const task = (await api(page, 'GET', `/tasks?project_id=${seed.project.id}&search=${encodeURIComponent('Revisar manual')}`)).json.data[0]
    assert.equal(task.status.key, 'BACKLOG')
    const card = page.getByTestId(`kanban-card-${task.id}`)
    await card.waitFor()
    const target = page.getByTestId(`kanban-cell-all::${statusId('TRIAGEM')}`)
    await target.scrollIntoViewIfNeeded()
    await drag(page, card, target)
    await page.getByText(`${task.code} movida para "Triagem".`).waitFor()
    assert.equal((await api(page, 'GET', `/tasks/${task.id}`)).json.data.status.key, 'TRIAGEM')

    // o painel lateral abre ao clicar no card
    await page.getByTestId(`kanban-card-${task.id}`).click()
    await page.getByRole('dialog').getByText('Revisar manual de uso').first().waitFor()
    assert.deepEqual(errors, [])
  })

  it('obrigatório por status: arrastar para a coluna que exige campo pede o preenchimento e move', async () => {
    const parecer = (await app.admin.post('/custom-fields', { label: 'Parecer do analista', type: 'textarea' })).body.data
    const type = (await app.admin.post('/task-types', { key: 'ANALISE_TEC', name: 'Análise técnica' })).body.data
    await app.admin.put(`/task-types/${type.id}/fields`, { fields: [{ field_id: parecer.id, required_status_ids: [statusId('TRIAGEM')] }] })
    const task = (await app.admin.post('/tasks', { project_id: seed.project.id, task_type_id: type.id, title: 'Avaliar integração fiscal' })).body.data

    const { page, errors } = await signIn('mario@kamban.test', PASSWORD, { viewport: { width: 1600, height: 900 } })
    await page.goto(`${app.baseUrl}/projects/${seed.project.id}/kanban`)
    const card = page.getByTestId(`kanban-card-${task.id}`)
    await card.waitFor()
    const target = page.getByTestId(`kanban-cell-all::${statusId('TRIAGEM')}`)
    await target.scrollIntoViewIfNeeded()
    await drag(page, card, target)

    const dialog = page.getByRole('dialog', { name: 'Preencha para mover para "Triagem"' })
    await dialog.waitFor()
    await dialog.getByLabel(/Parecer do analista/).fill('Viável, sem impacto no fechamento.')
    await dialog.getByRole('button', { name: 'Salvar e mover' }).click()
    await page.getByText(`${task.code} movida para "Triagem".`).first().waitFor()
    const saved = (await api(page, 'GET', `/tasks/${task.id}`)).json.data
    assert.equal(saved.status.key, 'TRIAGEM')
    assert.equal(saved.custom_values.parecer_do_analista, 'Viável, sem impacto no fechamento.')
    assert.deepEqual(errors, [])
  })

  it('timeline: arrastar a barra move as datas; puxar a ponta muda o prazo; leitor só vê', async () => {
    const task = await seed.task('Cronograma de implantação', { start_date: '2026-11-02', due_date: '2026-11-06' })
    await app.admin.post(`/projects/${seed.project.id}/milestones`, { name: 'Go-live', due_date: '2026-11-30' })
    const { page, errors } = await signIn('mario@kamban.test', PASSWORD, { viewport: { width: 1600, height: 900 } })
    await page.goto(`${app.baseUrl}/projects/${seed.project.id}/timeline`)
    const bar = page.getByTestId(`timeline-bar-${task.id}`)
    await bar.waitFor()
    await bar.scrollIntoViewIfNeeded()
    // escala padrão: semanas (18 px por dia) — 3 dias para a direita
    const box = await bar.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 6 })
    await page.mouse.move(box.x + box.width / 2 + 54, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()
    await page.getByText(new RegExp(`${task.code}: `)).first().waitFor()
    let saved = (await api(page, 'GET', `/tasks/${task.id}`)).json.data
    assert.deepEqual([saved.start_date.slice(0, 10), saved.due_date.slice(0, 10)], ['2026-11-05', '2026-11-09'])

    // ponta direita: +2 dias só no prazo
    const moved = await bar.boundingBox()
    await page.mouse.move(moved.x + moved.width - 3, moved.y + moved.height / 2)
    await page.mouse.down()
    await page.mouse.move(moved.x + moved.width + 20, moved.y + moved.height / 2, { steps: 6 })
    await page.mouse.move(moved.x + moved.width - 3 + 36, moved.y + moved.height / 2, { steps: 6 })
    await page.mouse.up()
    await page.waitForFunction(
      async ([id]) => {
        const res = await fetch(`/api/v1/tasks/${id}`)
        const body = await res.json()
        return body.data.due_date.slice(0, 10) === '2026-11-11'
      },
      [task.id],
      { timeout: 10000 },
    )
    saved = (await api(page, 'GET', `/tasks/${task.id}`)).json.data
    assert.equal(saved.start_date.slice(0, 10), '2026-11-05')
    assert.deepEqual(errors, [])

    const viewer = await signIn('lia@kamban.test', PASSWORD, { viewport: { width: 1600, height: 900 } })
    await viewer.page.goto(`${app.baseUrl}/projects/${seed.project.id}/timeline`)
    await viewer.page.getByTestId(`timeline-bar-${task.id}`).waitFor()
    await viewer.page.getByText('Somente leitura').first().waitFor()
    assert.equal(await viewer.page.getByRole('button', { name: 'Novo marco' }).count(), 0)
    assert.deepEqual(viewer.errors, [])
  })

  it('planejamento: gestor cria a sprint; membro arrasta a tarefa para ela', async () => {
    const task = await seed.task('Especificar integração', { status_id: statusId('ANALISE') })
    const manager = await signIn(ADMIN.email, ADMIN.password)
    await manager.page.goto(`${app.baseUrl}/projects/${seed.project.id}/planning`)
    await manager.page.waitForSelector('[data-testid=backlog-list]')
    await manager.page.getByRole('button', { name: 'Nova sprint' }).first().click()
    const dialog = manager.page.getByRole('dialog')
    await dialog.getByLabel(/^Nome/).fill('Sprint 1')
    await dialog.getByRole('button', { name: 'Salvar' }).click()
    await manager.page.getByText('Sprint "Sprint 1" criada.').waitFor()
    const sprint = (await api(manager.page, 'GET', `/projects/${seed.project.id}/sprints`)).json.data.find((s) => s.name === 'Sprint 1')
    assert.deepEqual(manager.errors, [])

    const { page, errors } = await signIn('mario@kamban.test', PASSWORD)
    await page.goto(`${app.baseUrl}/projects/${seed.project.id}/planning`)
    await page.waitForSelector('[data-testid=backlog-list]')
    assert.equal(await page.getByRole('button', { name: 'Nova sprint' }).count(), 0, 'membro não gerencia sprints')

    const handle = page.getByRole('button', { name: `Arrastar ${task.code} · Especificar integração` })
    await drag(page, handle, page.getByTestId(`backlog-group-${sprint.id}`), 60)
    await page.getByText(`${task.code} agora está em "Sprint 1".`).waitFor()
    const saved = (await api(page, 'GET', `/tasks/${task.id}`)).json.data
    assert.equal(saved.sprint && saved.sprint.id, sprint.id)
    assert.deepEqual(errors, [])
  })

  it('colaboração: comentário, relação e fork', async () => {
    const a = await seed.task('Migrar base de clientes', { description: 'Origem: planilha' })
    const b = await seed.task('Desligar sistema antigo')
    const { page, errors } = await signIn('mario@kamban.test', PASSWORD)

    await page.goto(`${app.baseUrl}/tasks/${a.id}?tab=comments`)
    await page.getByRole('combobox', { name: 'Novo comentário' }).fill('Planilha validada com o time comercial.')
    await page.getByRole('button', { name: 'Comentar' }).click()
    await page.getByRole('list', { name: 'Comentários' }).getByText('Planilha validada com o time comercial.').waitFor()

    await page.goto(`${app.baseUrl}/tasks/${a.id}?tab=relations`)
    await page.getByRole('button', { name: 'Adicionar relação' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'bloqueia…' }).click()
    await dialog.getByPlaceholder('Buscar tarefa por código ou título').fill('Desligar')
    await dialog.getByRole('option', { name: /Desligar sistema antigo/ }).click()
    await dialog.getByRole('button', { name: 'Adicionar relação' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal((await api(page, 'GET', `/tasks/${b.id}`)).json.data.blocked, true)

    await page.goto(`${app.baseUrl}/tasks/${a.id}`)
    await page.getByRole('button', { name: 'Fork' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Criar fork' }).click()
    await page.waitForURL((url) => url.pathname.startsWith('/tasks/') && !url.pathname.endsWith(a.id))
    const forkId = page.url().split('/tasks/')[1].split('?')[0]
    const fork = (await api(page, 'GET', `/tasks/${forkId}`)).json.data
    assert.equal(fork.forked_from.id, a.id)
    assert.equal(fork.description, 'Origem: planilha')
    assert.deepEqual(errors, [])
  })

  it('relatórios: indicadores do período', async () => {
    const { page, errors } = await signIn(ADMIN.email, ADMIN.password)
    const report = page.waitForResponse((r) => r.url().includes('/api/v1/reports') && r.request().method() === 'GET')
    await page.goto(`${app.baseUrl}/reports`)
    assert.equal((await report).status(), 200)
    await page.getByRole('heading', { name: 'Relatórios' }).waitFor()
    await page.getByText('Abertas', { exact: true }).first().waitFor()
    await page.getByText('Bloqueadas', { exact: true }).first().waitFor()
    assert.deepEqual(errors, [])
  })

  it('leitor: consulta sem editar; área administrativa restrita', async () => {
    const { page, errors } = await signIn('lia@kamban.test', PASSWORD)
    await page.goto(`${app.baseUrl}/projects/${seed.project.id}/kanban`)
    await page.waitForSelector('[data-testid=kanban-board]')
    await page.getByText('Somente leitura').first().waitFor()
    assert.equal(await page.getByRole('button', { name: /^Criar tarefa em/ }).count(), 0)

    await page.goto(`${app.baseUrl}/projects/${seed.project.id}/planning`)
    await page.waitForSelector('[data-testid=backlog-list]')
    assert.equal(await page.getByRole('button', { name: /^Arrastar/ }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Nova sprint' }).count(), 0)

    await page.goto(`${app.baseUrl}/users`)
    await page.getByText('Acesso restrito').waitFor()

    // o servidor também recusa, mesmo chamando a API direto
    const denied = await api(page, 'POST', '/tasks', { project_id: seed.project.id, task_type_id: seed.doc.id, title: 'Não pode' })
    assert.equal(denied.status, 403)
    assert.deepEqual(errors, [])
  })

  it('sessão encerrada em outro lugar leva ao login com aviso', async () => {
    const { page, errors } = await signIn('mario@kamban.test', PASSWORD)
    const other = app.client()
    await other.login('mario@kamban.test', PASSWORD)
    assert.equal((await other.post('/auth/sessions/revoke-others')).status, 200)

    await page.goto(`${app.baseUrl}/tasks`)
    await page.waitForURL(/\/login/)
    await page.getByText('Sua sessão expirou').waitFor()
    assert.deepEqual(errors, [])
  })
})
