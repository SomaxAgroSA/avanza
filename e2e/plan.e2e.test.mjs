/**
 * Gerenciamento de Projetos — quadro do projeto (GP-1) no navegador, módulo à parte das tarefas:
 * grupo e subgrupo numerados, elemento criado na linha "+ Adicionar elemento", edição direta nas
 * células (status, cronograma, recursos, esforço), subelementos com progresso calculado, totais do
 * rodapé, colunas (ocultar, arrastar) e recolher lembrados, mover, duplicar e excluir grupo; a aba
 * Tarefas continua sendo a lista de tarefas; o leitor só vê. GP-2 (interação), GP-3 (painel do elemento) e
 * GP-4 (Cronograma, Kanban, Gestão e Relatórios) e GP-5 (colunas personalizadas) em testes próprios.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN, PASSWORD, api, launchBrowser, login, seedBase, startApp } from './support.mjs'

/** Os avisos (canto superior direito) pausam com o mouse em cima; espera sumirem. */
const toastsGone = async (page) => {
  await page.mouse.move(20, 600)
  await page.waitForSelector('.Toastify__toast', { state: 'detached', timeout: 15000 })
}

const pad = (n) => String(n).padStart(2, '0')

describe('E2E — Quadro do projeto (Gerenciamento)', { timeout: 300000 }, () => {
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

  it('grupos, elementos editados nas células, subelementos, colunas, recolher, mover, duplicar e excluir; leitor só vê', async () => {
    const { page, errors } = await signIn(ADMIN.email, ADMIN.password, { viewport: { width: 1600, height: 900 } })
    const p = seed.project.id
    const board = async () => (await api(page, 'GET', `/projects/${p}/plan`)).json.data
    // endereço antigo (?tab=plan) leva à aba Gestão do projeto
    await page.goto(`${app.baseUrl}/projects/${p}?tab=plan`)
    await page.waitForURL(`**/projects/${p}/management`)
    await page.getByRole('heading', { name: 'O quadro ainda não tem grupos.' }).waitFor()

    // primeiro grupo pela tela
    await page.getByRole('button', { name: 'Criar grupo de elementos' }).click()
    let dialog = page.getByRole('dialog', { name: 'Novo grupo' })
    await dialog.getByRole('textbox', { name: /Nome/ }).fill('Iniciação')
    await dialog.getByRole('button', { name: 'Criar grupo' }).click()
    let ini = page.getByRole('table', { name: '1.0 Iniciação', exact: true })
    await ini.waitFor()
    await toastsGone(page)

    // elementos pela linha "+ Adicionar elemento"
    const add = ini.getByRole('textbox', { name: 'Adicionar elemento em 1.0 Iniciação' })
    await add.fill('Reunião de kickoff')
    await add.press('Enter')
    await ini.getByRole('button', { name: 'Editar nome de Reunião de kickoff' }).waitFor()
    await add.fill('Alinhamento com o cliente')
    await add.press('Enter')
    await ini.getByRole('button', { name: 'Editar nome de Alinhamento com o cliente' }).waitFor()

    // status (etiquetas iniciais do quadro)
    await ini.getByRole('button', { name: 'Status de Reunião de kickoff: Em branco' }).click()
    await page.getByRole('dialog', { name: 'Status de Reunião de kickoff' }).getByRole('button', { name: 'Feito' }).click()
    await ini.getByRole('button', { name: 'Status de Reunião de kickoff: Feito' }).waitFor()

    // cronograma: dois cliques no calendário → 3 dias
    const now = new Date()
    const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
    await ini.getByRole('button', { name: 'Cronograma de Reunião de kickoff: Definir datas' }).click()
    const calendar = page.getByRole('dialog', { name: 'Cronograma de Reunião de kickoff' })
    await calendar.locator(`button[data-day="${ym}-10"]`).click()
    await calendar.locator(`button[data-day="${ym}-12"]`).click()
    await calendar.getByText('3 dias selecionados').waitFor()
    await page.keyboard.press('Escape')
    await ini.getByRole('button', { name: 'Cronograma de Reunião de kickoff: 3 dias' }).waitFor()

    // recursos: cria a etiqueta pela busca
    await ini.getByRole('button', { name: 'Recursos de Reunião de kickoff: sem recursos' }).click()
    const picker = page.getByRole('dialog', { name: 'Recursos de Reunião de kickoff' })
    await picker.getByRole('textbox', { name: 'Criar ou localizar etiquetas' }).fill('Cliente')
    await picker.getByRole('button', { name: 'Criar “Cliente”' }).click()
    await picker.getByRole('button', { name: 'Cliente', pressed: true }).waitFor()
    await page.keyboard.press('Escape')
    await ini.getByRole('button', { name: 'Recursos de Reunião de kickoff: Cliente' }).waitFor()

    // esforço digitado na célula (vírgula) → total do rodapé
    await ini.getByRole('button', { name: 'Esforço estimado de Reunião de kickoff (horas)' }).click()
    await ini.getByRole('textbox', { name: 'Esforço estimado de Reunião de kickoff (horas)' }).fill('2,5')
    await page.keyboard.press('Enter')
    await ini.locator('tfoot').getByText('2,5').waitFor()
    let data = await board()
    const kickoff = data.items.find((i) => i.name === 'Reunião de kickoff')
    assert.equal(kickoff.duration_days, 3)
    assert.equal(kickoff.estimated_hours, 2.5)
    assert.equal(kickoff.progress.value, 100)

    // subelementos: um pela tela, outro pela API → progresso ponderado pelo trabalho
    await toastsGone(page)
    await ini.getByRole('button', { name: 'Ações de Alinhamento com o cliente', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Adicionar subelemento' }).click()
    const subs = page.getByRole('table', { name: 'Subelementos de Alinhamento com o cliente' })
    const addSub = subs.getByRole('textbox', { name: 'Adicionar subelemento em Alinhamento com o cliente' })
    await addSub.fill('Validar escopo')
    await addSub.press('Enter')
    await subs.getByRole('button', { name: 'Editar nome de Validar escopo' }).waitFor()
    await subs.getByRole('button', { name: 'Trabalho de Validar escopo (horas)' }).click()
    await subs.getByRole('textbox', { name: 'Trabalho de Validar escopo (horas)' }).fill('6')
    await page.keyboard.press('Enter')
    await subs.getByRole('button', { name: 'Status de Validar escopo: Em branco' }).click()
    await page.getByRole('dialog', { name: 'Status de Validar escopo' }).getByRole('button', { name: 'Feito' }).click()
    await subs.getByRole('button', { name: 'Status de Validar escopo: Feito' }).waitFor()
    const parent = (await board()).items.find((i) => i.name === 'Alinhamento com o cliente')
    await api(page, 'POST', `/projects/${p}/plan/items`, { parent_id: parent.id, name: 'Aprovar ata', estimated_hours: 2, progress: 50 })
    await page.reload()
    ini = page.getByRole('table', { name: '1.0 Iniciação', exact: true })
    await ini.getByRole('button', { name: 'Mostrar 2 subelementos de Alinhamento com o cliente' }).waitFor()
    assert.equal(await ini.getByRole('progressbar', { name: 'Progresso de Alinhamento com o cliente' }).getAttribute('aria-valuenow'), '88')

    // subgrupo pelo menu do grupo
    await page.getByRole('button', { name: 'Ações do grupo 1.0 Iniciação', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Adicionar subgrupo' }).click()
    dialog = page.getByRole('dialog', { name: 'Novo subgrupo em 1.0 Iniciação' })
    await dialog.getByRole('textbox', { name: /Nome/ }).fill('Kickoff interno')
    await dialog.getByRole('button', { name: 'Criar grupo' }).click()
    await page.getByRole('table', { name: '1.0 Iniciação | 1.1 Kickoff interno' }).waitFor()
    await toastsGone(page)

    // colunas: arrastar "Duração" para antes de "Status" e ocultar "Recursos" — lembrado ao recarregar
    const headers = async () => (await ini.getByRole('columnheader').allTextContents()).map((h) => h.trim())
    await ini.getByRole('columnheader', { name: /Duração/ }).dragTo(ini.getByRole('columnheader', { name: /Status/ }), { targetPosition: { x: 4, y: 12 } })
    await page.waitForFunction(() => {
      const table = document.querySelector('table[aria-label="1.0 Iniciação"]')
      const cells = table ? [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : []
      return cells.indexOf('Duração') >= 0 && cells.indexOf('Duração') < cells.indexOf('Status')
    })
    await ini.getByRole('button', { name: 'Opções da coluna Recursos' }).click({ force: true })
    await page.getByRole('menuitem', { name: 'Ocultar coluna' }).click()
    await page.reload()
    ini = page.getByRole('table', { name: '1.0 Iniciação', exact: true })
    await ini.waitFor()
    const after = await headers()
    assert.ok(!after.includes('Recursos'), after.join(','))
    assert.ok(after.indexOf('Duração') < after.indexOf('Status'), after.join(','))
    await page.getByRole('button', { name: 'Colunas (1 oculta)' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Recursos' }).click()
    await page.keyboard.press('Escape')
    await ini.getByRole('columnheader', { name: /Recursos/ }).waitFor()

    // recolher o grupo fica lembrado ao recarregar
    await page.getByRole('button', { name: 'Recolher 1.0 Iniciação', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Expandir 1.0 Iniciação', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Editar nome de Reunião de kickoff' }).count(), 0)
    await page.getByRole('button', { name: 'Expandir tudo' }).click()
    await ini.getByRole('button', { name: 'Editar nome de Reunião de kickoff' }).waitFor()

    // mover para o subgrupo (subelementos vão junto)
    await ini.getByRole('button', { name: 'Ações de Alinhamento com o cliente', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Mover para outro grupo…' }).click()
    dialog = page.getByRole('dialog', { name: 'Mover “Alinhamento com o cliente”' })
    await dialog.getByRole('combobox', { name: 'Grupo' }).click()
    await page.getByRole('option', { name: '1.0 Iniciação | 1.1 Kickoff interno' }).click()
    await dialog.getByRole('button', { name: 'Mover' }).click()
    await page.getByRole('table', { name: '1.0 Iniciação | 1.1 Kickoff interno' }).getByRole('button', { name: 'Editar nome de Alinhamento com o cliente' }).waitFor()
    data = await board()
    const sub = data.groups.find((g) => g.name === 'Kickoff interno')
    assert.equal(data.items.filter((i) => i.group_id === sub.id).length, 3)

    // duplicar e excluir grupo
    await toastsGone(page)
    await page.getByRole('button', { name: 'Ações do grupo 1.0 Iniciação', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Duplicar com os elementos' }).click()
    const copy = page.getByRole('table', { name: '2.0 Iniciação (cópia)', exact: true })
    await copy.waitFor()
    await toastsGone(page)
    await page.getByRole('button', { name: 'Ações do grupo 2.0 Iniciação (cópia)', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Excluir grupo' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
    // a confirmação só fecha quando a exclusão termina; aberta, ela deixa o quadro aria-hidden e o
    // localizador por papel já não acha a tabela (o "detached" passaria antes da resposta da API)
    await page.getByRole('alertdialog').waitFor({ state: 'detached' })
    await copy.waitFor({ state: 'detached' })
    data = await board()
    assert.deepEqual(data.groups.map((g) => `${g.number} ${g.name}`), ['1.0 Iniciação', '1.1 Kickoff interno'])

    // o projeto é o centro: aba Tarefas (lista) e aba Gestão (o quadro); o menu lateral não tem mais a Gestão de projetos
    await page.goto(`${app.baseUrl}/projects/${p}`)
    const tabs = page.getByRole('navigation', { name: (await board()).project.name })
    await tabs.getByRole('link', { name: 'Tarefas' }).click()
    await page.waitForURL(`**/projects/${p}/tasks`)
    await page.getByRole('button', { name: 'Nova tarefa' }).first().waitFor()
    assert.equal(await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Gestão de projetos' }).count(), 0)
    await tabs.getByRole('link', { name: 'Gestão' }).click()
    await page.waitForURL(`**/projects/${p}/management`)
    await page.getByRole('table', { name: '1.0 Iniciação', exact: true }).waitFor()
    assert.deepEqual(errors, [])

    // leitor: vê o quadro, sem criar/editar
    const viewer = await signIn('lia@kamban.test', PASSWORD, { viewport: { width: 1366, height: 900 } })
    await viewer.page.goto(`${app.baseUrl}/projects/${p}/management`)
    await viewer.page.getByRole('table', { name: '1.0 Iniciação', exact: true }).getByText('Reunião de kickoff').waitFor()
    assert.equal(await viewer.page.getByRole('button', { name: 'Criar elemento' }).count(), 0)
    assert.equal(await viewer.page.getByRole('textbox', { name: /Adicionar elemento/ }).count(), 0)
    assert.equal(await viewer.page.getByRole('button', { name: /^Ações do grupo/ }).count(), 0)
    assert.equal(await viewer.page.getByRole('button', { name: /^Status de/ }).count(), 0)
    assert.equal((await api(viewer.page, 'POST', `/projects/${p}/plan/items`, { group_id: sub.id, name: 'Não' })).status, 403)
    assert.deepEqual(viewer.errors, [])
  })

  it('GP-2: arrastar elementos e grupos, filtros, pessoa, agrupar, massa, dependência com a regra e importar', async () => {
    const { page, errors } = await signIn(ADMIN.email, ADMIN.password, { viewport: { width: 1600, height: 900 } })
    const project = (await api(page, 'POST', '/projects', { name: 'Implantação GP2', key: 'GPD' })).json.data
    const p = project.id
    await api(page, 'POST', `/projects/${p}/members`, { user_id: seed.member.id, role: 'member' })
    const board = async () => (await api(page, 'GET', `/projects/${p}/plan`)).json.data
    const statuses = (await board()).statuses
    const st = (category) => statuses.find((s) => s.category === category).id
    const exe = (await api(page, 'POST', `/projects/${p}/groups`, { name: 'Execução', color: 'blue' })).json.data
    const end = (await api(page, 'POST', `/projects/${p}/groups`, { name: 'Encerramento', color: 'green' })).json.data
    const mk = async (name, extra) => (await api(page, 'POST', `/projects/${p}/plan/items`, Object.assign({ group_id: exe.id, name }, extra))).json.data
    const a = await mk('Levantar requisitos', { status_id: st('done') })
    const b = await mk('Configurar ambiente')
    await mk('Treinar usuários')
    await api(page, 'POST', `/projects/${p}/plan/items`, { parent_id: b.id, name: 'Instalar servidor', owner_id: seed.member.id })
    const order = async (groupId) =>
      (await board()).items
        .filter((i) => i.group_id === groupId && !i.parent_id)
        .sort((x, y) => x.position - y.position)
        .map((i) => i.name)

    await page.goto(`${app.baseUrl}/projects/${p}/management`)
    const exeTable = page.getByRole('table', { name: '1.0 Execução', exact: true })
    await exeTable.waitFor()

    // arrastar pela alça (dnd-kit precisa de movimento)
    const drag = async (source, target, { dy = -8 } = {}) => {
      await source.scrollIntoViewIfNeeded()
      const from = await source.boundingBox()
      const to = await target.boundingBox()
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 })
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + dy, { steps: 18 })
      await page.waitForTimeout(150)
      await page.mouse.up()
    }
    await drag(exeTable.getByRole('button', { name: 'Arrastar Treinar usuários' }), exeTable.getByRole('button', { name: 'Arrastar Levantar requisitos' }))
    await page.getByText('Elemento movido.').first().waitFor()
    assert.deepEqual(await order(exe.id), ['Treinar usuários', 'Levantar requisitos', 'Configurar ambiente'])
    await toastsGone(page)

    // para outro grupo (tabela vazia vira área de soltar)
    const endTable = page.getByRole('table', { name: '2.0 Encerramento', exact: true })
    await drag(exeTable.getByRole('button', { name: 'Arrastar Treinar usuários' }), endTable.locator('tbody'), { dy: 0 })
    await page.getByText('Elemento movido.').first().waitFor()
    assert.deepEqual(await order(end.id), ['Treinar usuários'])
    await toastsGone(page)

    // arrastar grupo pelo título: Encerramento antes de Execução
    await drag(page.getByRole('button', { name: 'Arrastar o grupo 2.0 Encerramento' }), page.getByRole('button', { name: 'Arrastar o grupo 1.0 Execução' }), { dy: -20 })
    await page.getByText('Grupo movido.').first().waitFor()
    await page.waitForFunction(
      async (projectId) => {
        const res = await fetch(`/api/v1/projects/${projectId}/plan`)
        const data = (await res.json()).data
        return data.groups[0] && data.groups[0].name === 'Encerramento'
      },
      p,
      { timeout: 10000 },
    )
    await page.getByRole('table', { name: '1.0 Encerramento', exact: true }).waitFor()
    await toastsGone(page)
    const exeT = page.getByRole('table', { name: '2.0 Execução', exact: true })

    // filtro pelo menu da coluna; pessoa; agrupar por status
    await exeT.getByRole('button', { name: 'Opções da coluna Status' }).click({ force: true })
    await page.getByRole('menuitem', { name: 'Filtrar' }).click()
    const filters = page.getByRole('dialog', { name: 'Filtros do quadro' })
    await filters.getByRole('checkbox', { name: 'Feito' }).click()
    await page.getByRole('button', { name: 'Filtros (1)' }).waitFor()
    assert.equal(await exeT.getByRole('button', { name: 'Editar nome de Configurar ambiente' }).count(), 0)
    await filters.getByRole('button', { name: 'Limpar filtros' }).click()
    await page.keyboard.press('Escape')
    await exeT.getByRole('button', { name: 'Editar nome de Configurar ambiente' }).waitFor()

    await page.getByRole('button', { name: 'Pessoa' }).click()
    await page.getByRole('dialog', { name: 'Pessoa' }).getByRole('button', { name: 'Mário Membro', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('table', { name: 'Subelementos de Configurar ambiente' }).waitFor()
    assert.equal(await exeT.getByRole('button', { name: 'Editar nome de Levantar requisitos' }).count(), 0)
    await page.getByRole('button', { name: 'Mário Membro', exact: true }).click()
    await page.getByRole('dialog', { name: 'Pessoa' }).getByRole('button', { name: 'Limpar pessoa' }).click()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Agrupar por' }).click()
    await page.getByRole('menuitem', { name: 'Status' }).click()
    await page.getByRole('table', { name: 'Feito', exact: true }).getByRole('button', { name: 'Editar nome de Levantar requisitos' }).waitFor()
    await page.getByRole('button', { name: 'Agrupado: Status' }).click()
    await page.getByRole('menuitem', { name: 'Grupo' }).click()
    await exeT.waitFor()

    // dependência + regra "impedir": não inicia com a dependência aberta
    await api(page, 'PATCH', `/plan/items/${a.id}`, { status_id: st('todo') })
    await page.reload()
    await exeT.getByRole('button', { name: /^Dependências de Configurar ambiente/ }).click()
    const deps = page.getByRole('dialog', { name: 'Dependências de Configurar ambiente' })
    await deps.getByRole('button', { name: 'Levantar requisitos' }).click()
    await deps.getByText('Depende de elemento ainda aberto', { exact: false }).waitFor()
    await deps.getByRole('button', { name: 'Alterar regra' }).click()
    const rule = page.getByRole('dialog', { name: 'Regra de dependências' })
    await rule.getByRole('radio', { name: /Impedir iniciar ou concluir/ }).click()
    await rule.getByRole('button', { name: 'Salvar' }).click()
    await page.getByText('Regra de dependências salva.').waitFor()
    await toastsGone(page)
    await exeT.getByRole('button', { name: 'Status de Configurar ambiente: Em branco' }).click()
    await page.getByRole('dialog', { name: 'Status de Configurar ambiente' }).getByRole('button', { name: 'Em progresso' }).click()
    await page.getByText('“Configurar ambiente” possui uma dependência pendente.').waitFor()
    await exeT.getByRole('button', { name: 'Status de Configurar ambiente: Em branco' }).waitFor()
    await toastsGone(page)

    // seleção em massa: status de todos do grupo
    await exeT.getByRole('checkbox', { name: 'Selecionar todos de 2.0 Execução' }).click()
    const bar = page.getByRole('toolbar', { name: 'Ações para 2 elementos' })
    await bar.getByRole('button', { name: 'Recursos' }).waitFor()
    await bar.getByRole('button', { name: 'Status' }).click()
    await page.getByRole('dialog', { name: 'Mudar o status dos selecionados' }).getByRole('button', { name: 'Parado' }).click()
    await page.getByText('2 elementos alterados.').waitFor()
    assert.ok((await board()).items.filter((i) => i.group_id === exe.id && !i.parent_id).every((i) => i.status_id === st('blocked')))
    await bar.getByRole('button', { name: 'Limpar seleção' }).click()
    await toastsGone(page)

    // importar: CSV com elemento e subelemento
    await page.getByRole('button', { name: 'Mais opções de criação' }).click()
    await page.getByRole('menuitem', { name: 'Importar elementos' }).click()
    const imp = page.getByRole('dialog', { name: 'Importar elementos' })
    await imp.locator('input[type="file"]').setInputFiles({
      name: 'plano.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Grupo;Elemento;Subelemento;Status;Início;Fim;Recursos;Esforço estimado\n2.0 Execução;Homologar;;Planejado;02/02/2026;06/02/2026;Consultor;4\n2.0 Execução;Homologar;Roteiro de testes;;;;;2\n', 'utf8'),
    })
    await imp.getByText('elementos: 1 · subelementos: 1', { exact: false }).waitFor()
    await imp.getByRole('button', { name: 'Importar (2)' }).click()
    await page.getByText('2 elementos importados.').waitFor()
    await exeT.getByRole('button', { name: 'Editar nome de Homologar' }).waitFor()
    const homologar = (await board()).items.find((i) => i.name === 'Homologar')
    assert.equal(homologar.duration_days, 5)
    assert.equal(homologar.subitems, 1)
    assert.deepEqual(errors, [])
  })

  it('GP-3: painel do elemento — atualização com @menção e imagem colada (Ctrl+V), histórico; a notificação abre o painel e a resposta avisa o autor', async () => {
    const admin = await signIn(ADMIN.email, ADMIN.password, { viewport: { width: 1600, height: 900 } })
    const me = (await api(admin.page, 'GET', '/auth/me')).json.data
    const adminName = me.user.name
    const project = (await api(admin.page, 'POST', '/projects', { name: 'Painel GP3', key: 'PNL' })).json.data
    const p = project.id
    await api(admin.page, 'POST', `/projects/${p}/members`, { user_id: seed.member.id, role: 'member' })
    const group = (await api(admin.page, 'POST', `/projects/${p}/groups`, { name: 'Iniciação' })).json.data
    const item = (await api(admin.page, 'POST', `/projects/${p}/plan/items`, { group_id: group.id, name: 'Reunião de kickoff' })).json.data

    // membro: abre o painel pela linha, publica mencionando o administrador e colando um print (Ctrl+V)
    const mario = await signIn('mario@kamban.test', PASSWORD, { viewport: { width: 1600, height: 900 } })
    await mario.page.goto(`${app.baseUrl}/projects/${p}/management`)
    const table = mario.page.getByRole('table', { name: '1.0 Iniciação', exact: true })
    await table.getByRole('button', { name: 'Abrir as atualizações de Reunião de kickoff' }).click({ force: true })
    const panel = mario.page.getByRole('dialog', { name: 'Reunião de kickoff' })
    const editor = panel.getByRole('combobox', { name: /Nova atualização/ })
    await editor.click()
    await editor.pressSequentially(`Pauta pronta, @${adminName.slice(0, 4)}`)
    await mario.page.getByRole('option', { name: new RegExp(adminName) }).click()
    await editor.pressSequentially(' confira.')
    // colar de verdade: evento de paste com a imagem na área de transferência
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    await editor.evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, PNG)
    await panel.getByRole('list', { name: 'Imagens e arquivos da atualização' }).getByRole('img').waitFor()
    await panel.getByRole('button', { name: 'Atualizar' }).click()
    await panel.getByText('Pauta pronta,', { exact: false }).waitFor()
    await panel.getByRole('button', { name: /^Abrir imagem-colada-\d{8}-\d{6}\.png$/ }).waitFor()
    assert.equal(await panel.getByRole('tab', { name: /Arquivos/ }).count(), 0)
    await panel.getByRole('tab', { name: 'Histórico' }).click()
    await panel.getByText('atualização publicada', { exact: false }).waitFor()
    // fechado o painel, a linha mostra o contador
    await mario.page.keyboard.press('Escape')
    await table.getByRole('button', { name: 'Atualizações de Reunião de kickoff: 1' }).waitFor()

    // administrador: a notificação abre o painel do elemento; responde
    await admin.page.goto(`${app.baseUrl}/dashboard`)
    await admin.page.getByRole('button', { name: /^Notificações: 1 não lida/ }).click()
    await admin.page.getByText('Mário Membro mencionou você em “Reunião de kickoff”').click()
    const adminPanel = admin.page.getByRole('dialog', { name: 'Reunião de kickoff' })
    await adminPanel.getByText('confira.', { exact: false }).waitFor()
    assert.match(admin.page.url(), /\/projects\/[^/]+\/management\?item=/)
    await adminPanel.getByRole('button', { name: 'Responder' }).click()
    const reply = adminPanel.getByRole('combobox', { name: /Responder a Mário Membro/ })
    await reply.fill('Obrigado, vou revisar.')
    await adminPanel.getByRole('button', { name: 'Responder' }).last().click()
    // a caixa da resposta só fecha quando a resposta foi gravada; antes disso o getByText já acharia o
    // texto digitado nela (o React copia o valor da textarea controlada para o conteúdo)
    await reply.waitFor({ state: 'detached' })
    await adminPanel.getByText('Obrigado, vou revisar.').waitFor()
    const inbox = (await api(mario.page, 'GET', '/notifications')).json.data
    assert.equal(inbox[0].type, 'plan_reply')
    assert.equal(inbox[0].plan_item.id, item.id)
    assert.deepEqual(mario.errors, [])
    assert.deepEqual(admin.errors, [])
  })

  it('GP-4: Cronograma (agendar, linha de base, exportar), Gestão (diário e problema) e a saúde na visão geral do projeto', async () => {
    const admin = await signIn(ADMIN.email, ADMIN.password, { viewport: { width: 1600, height: 900 } })
    const project = (await api(admin.page, 'POST', '/projects', { name: 'Visões GP4', key: 'VIS' })).json.data
    const p = project.id
    await api(admin.page, 'POST', `/projects/${p}/members`, { user_id: seed.member.id, role: 'member' })
    const group = (await api(admin.page, 'POST', `/projects/${p}/groups`, { name: 'Iniciação' })).json.data
    const now = new Date()
    const day = (offset) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
    const kickoff = (await api(admin.page, 'POST', `/projects/${p}/plan/items`, { group_id: group.id, name: 'Reunião de kickoff', start_date: day(-3), end_date: day(-1), estimated_hours: 2 })).json.data
    await api(admin.page, 'POST', `/projects/${p}/plan/items`, { group_id: group.id, name: 'Plano de comunicação', estimated_hours: 8 })

    // Cronograma: membro agenda o elemento sem datas; o gestor salva a linha de base; exporta
    const mario = await signIn('mario@kamban.test', PASSWORD, { viewport: { width: 1600, height: 900 } })
    await mario.page.goto(`${app.baseUrl}/projects/${p}/management`)
    await mario.page.getByRole('navigation', { name: 'Visões do quadro' }).getByRole('link', { name: 'Cronograma' }).click()
    await mario.page.getByRole('group', { name: 'Cronograma de Visões GP4' }).waitFor()
    await mario.page.getByRole('button', { name: /^Reunião de kickoff, / }).waitFor()
    await mario.page.getByRole('button', { name: 'Agendar "Plano de comunicação" a partir de hoje' }).click()
    await mario.page.getByRole('button', { name: /^Plano de comunicação, / }).waitFor()
    assert.equal(await mario.page.getByRole('button', { name: 'Linha de base' }).count(), 0)

    await admin.page.goto(`${app.baseUrl}/projects/${p}/management?view=timeline`)
    await admin.page.getByRole('button', { name: 'Linha de base' }).click()
    await admin.page.getByRole('menuitem', { name: 'Salvar linha de base' }).click()
    await admin.page.getByText('Linha de base salva com o cronograma atual.').first().waitFor()
    await admin.page.getByTestId(`timeline-baseline-${kickoff.id}`).waitFor()
    const [download] = await Promise.all([admin.page.waitForEvent('download'), admin.page.getByRole('button', { name: 'Exportar' }).click()])
    assert.equal(download.suggestedFilename(), 'cronograma-VIS.csv')

    // Gestão: diário e problema (o Kanban do quadro saiu — repetia o Kanban das tarefas)
    await mario.page.goto(`${app.baseUrl}/projects/${p}/management`)
    await mario.page.getByRole('navigation', { name: 'Visões do quadro' }).getByRole('link', { name: 'Gestão' }).click()
    await mario.page.getByRole('button', { name: 'Novo registro' }).click()
    const journal = mario.page.getByRole('dialog', { name: 'Novo registro no diário' })
    await journal.getByRole('textbox', { name: /^Registro/ }).fill('Reunião de abertura do projeto.')
    await journal.getByRole('button', { name: 'Novo registro' }).click()
    await mario.page.getByRole('table', { name: 'Diário do projeto' }).getByText('Reunião de abertura do projeto.').waitFor()
    await mario.page.getByRole('button', { name: 'Novo problema' }).click()
    const issue = mario.page.getByRole('dialog', { name: 'Novo problema' })
    await issue.getByRole('textbox', { name: /^Descrição/ }).fill('Cliente sem acesso à VPN')
    await issue.getByRole('button', { name: 'Novo problema' }).click()
    await mario.page.getByRole('table', { name: 'Gestão dos problemas' }).getByText('Cliente sem acesso à VPN').waitFor()

    // saúde com os fatores na visão geral do projeto (o problema em aberto pesa)
    await mario.page.goto(`${app.baseUrl}/projects/${p}`)
    const health = mario.page.getByRole('region', { name: 'Saúde do projeto' })
    await health.getByText('1 problema em aberto na Gestão.').waitFor()
    await health.getByText('Problemas em aberto').waitFor()
    assert.deepEqual(mario.errors, [])
    assert.deepEqual(admin.errors, [])
  })

  it('GP-5: colunas personalizadas — gestor adiciona pelo "+", membro preenche, soma no rodapé, alterar tipo com prévia e excluir', async () => {
    const admin = await signIn(ADMIN.email, ADMIN.password, { viewport: { width: 1600, height: 900 } })
    const project = (await api(admin.page, 'POST', '/projects', { name: 'Colunas GP5', key: 'CGP' })).json.data
    const p = project.id
    await api(admin.page, 'POST', `/projects/${p}/members`, { user_id: seed.member.id, role: 'member' })
    const group = (await api(admin.page, 'POST', `/projects/${p}/groups`, { name: 'Execução' })).json.data
    await api(admin.page, 'POST', `/projects/${p}/plan/items`, { group_id: group.id, name: 'Compra de servidores' })
    await api(admin.page, 'POST', `/projects/${p}/plan/items`, { group_id: group.id, name: 'Licenças' })

    // gestor: "+" no fim do cabeçalho → coluna Número com unidade
    await admin.page.goto(`${app.baseUrl}/projects/${p}/management`)
    const table = admin.page.getByRole('table', { name: '1.0 Execução', exact: true })
    await table.getByRole('button', { name: 'Adicionar coluna' }).click()
    const dialog = admin.page.getByRole('dialog', { name: 'Nova coluna' })
    await dialog.getByRole('textbox', { name: /^Nome da coluna/ }).fill('Custo')
    await dialog.getByRole('radio', { name: /Número/ }).click()
    await dialog.getByRole('textbox', { name: /^Unidade/ }).fill('R$')
    await dialog.getByRole('button', { name: 'Adicionar coluna' }).click()
    await table.getByRole('columnheader', { name: /Custo/ }).waitFor()

    // membro: preenche as células; o rodapé soma
    const mario = await signIn('mario@kamban.test', PASSWORD, { viewport: { width: 1600, height: 900 } })
    await mario.page.goto(`${app.baseUrl}/projects/${p}/management`)
    const board = mario.page.getByRole('table', { name: '1.0 Execução', exact: true })
    assert.equal(await board.getByRole('button', { name: 'Adicionar coluna' }).count(), 0)
    for (const [name, value] of [
      ['Compra de servidores', '1200'],
      ['Licenças', '300,5'],
    ]) {
      await board.getByRole('button', { name: `Custo de ${name}` }).click()
      await board.getByRole('textbox', { name: `Custo de ${name}` }).fill(value)
      await mario.page.keyboard.press('Enter')
    }
    await board.getByText('1.500,5 R$').waitFor()

    // gestor: alterar o tipo para Texto (tudo converte) e excluir
    await admin.page.reload()
    await table.getByRole('button', { name: 'Opções da coluna Custo' }).click()
    await admin.page.getByRole('menuitem', { name: 'Alterar tipo' }).click()
    const typeDialog = admin.page.getByRole('dialog', { name: 'Alterar o tipo de "Custo"' })
    await typeDialog.getByRole('radio', { name: /^Texto/ }).click()
    await typeDialog.getByText('Todos os 2 valores preenchidos são convertidos.').waitFor()
    await typeDialog.getByRole('button', { name: 'Alterar tipo' }).click()
    await admin.page.getByText('Coluna "Custo" agora é Texto.').first().waitFor()
    await table.getByRole('button', { name: 'Opções da coluna Custo' }).click()
    await admin.page.getByRole('menuitem', { name: 'Excluir coluna' }).click()
    await admin.page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
    await admin.page.getByText('Coluna "Custo" excluída.').first().waitFor()
    assert.equal(await table.getByRole('columnheader', { name: /Custo/ }).count(), 0)
    assert.deepEqual(mario.errors, [])
    assert.deepEqual(admin.errors, [])
  })
})
