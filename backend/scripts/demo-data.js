/**
 * Dados de demonstração (open source: avaliar a plataforma sem cadastrar tudo à mão). Tudo pela API
 * `/api/v1` — as mesmas validações da tela. Cria duas pessoas de exemplo, o projeto DEMO (tarefas,
 * sprint, comentários e relação), o quadro da Gestão de projetos (fases, elementos, subelementos,
 * recursos, colunas personalizadas, diário, problemas e linha de base), a ficha do projeto, um
 * subprojeto e um espaço de documentação.
 * Não mexe no que já existe: se o projeto DEMO já estiver lá, não faz nada.
 *
 * `api`: { get, post, patch, put } → Promise<{ status, body }> (o cliente do teste ou o do comando).
 */

const DEMO_KEY = 'DEMO'

function day(offset) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

async function seedDemo(api, options) {
  const password = (options && options.password) || 'DemoBlydSync2026'
  const ok = (res, what) => {
    if (res.status >= 300) throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body && res.body.error)}`)
    return res.body.data
  }

  const existing = ok(await api.get(`/projects?search=${DEMO_KEY}&perPage=50`), 'listar projetos')
  if (existing.some((p) => p.key === DEMO_KEY)) return { created: false }

  // pessoas de exemplo (reaproveita se já existirem)
  const roles = ok(await api.get('/roles'), 'perfis')
  const roleId = (code) => roles.find((r) => r.code === code).id
  async function person(name, email, role) {
    const res = await api.post('/users', { name, email, password, role_id: roleId(role) })
    if (res.status < 300) return res.body.data
    const found = ok(await api.get(`/users?search=${encodeURIComponent(email)}`), 'buscar pessoa').find((u) => u.email === email)
    if (!found) throw new Error(`pessoa ${email}: ${JSON.stringify(res.body.error)}`)
    return found
  }
  const carla = await person('Carla Mendes', 'carla.demo@blydsync.local', 'MEMBER')
  const rafael = await person('Rafael Lima', 'rafael.demo@blydsync.local', 'MEMBER')

  // projeto
  const project = ok(
    await api.post('/projects', {
      name: 'Implantação do ERP (demonstração)',
      key: DEMO_KEY,
      description: 'Projeto de exemplo: tarefas do time no Kanban e a gestão do projeto (fases, cronograma, saúde) na Gestão de projetos.',
      start_date: day(-20),
      due_date: day(60),
    }),
    'criar projeto',
  )
  const p = project.id
  ok(await api.post(`/projects/${p}/members`, { user_id: carla.id, role: 'manager' }), 'membro')
  ok(await api.post(`/projects/${p}/members`, { user_id: rafael.id, role: 'member' }), 'membro')

  // tarefas do time (tipo sem campos obrigatórios por padrão; status do fluxo padrão)
  const types = ok(await api.get('/task-types'), 'tipos')
  const statuses = ok(await api.get('/statuses'), 'status')
  const type = (types.find((t) => t.key === 'DOCUMENTACAO') || types[0]).id
  const statusId = (key, category) => {
    const found = statuses.find((s) => s.key === key) || statuses.find((s) => s.category === category)
    return found ? found.id : undefined
  }
  const sprint = ok(await api.post(`/projects/${p}/sprints`, { name: 'Sprint 1', start_date: day(-7), end_date: day(7) }), 'sprint')
  const task = async (title, extra) => ok(await api.post('/tasks', Object.assign({ project_id: p, task_type_id: type, title }, extra)), `tarefa ${title}`)
  const t1 = await task('Levantar requisitos do módulo fiscal', { assignee_id: carla.id, due_date: day(-3), sprint_id: sprint.id, status_id: statusId('CONCLUIDO', 'done'), estimated_hours: 8 })
  const t2 = await task('Configurar plano de contas', { assignee_id: rafael.id, start_date: day(-2), due_date: day(4), sprint_id: sprint.id, status_id: statusId('DESENVOLVIMENTO', 'in_progress'), estimated_hours: 12 })
  const t3 = await task('Migrar cadastro de clientes', { assignee_id: rafael.id, due_date: day(10), status_id: statusId('PRIORIZADO', 'todo'), estimated_hours: 16 })
  await task('Treinar a equipe financeira', { assignee_id: carla.id, due_date: day(25), estimated_hours: 6 })
  await task('Validar relatórios gerenciais', { due_date: day(30) })
  ok(await api.post(`/tasks/${t1.id}/relations`, { type: 'blocks', target_id: t2.id }), 'relação')
  ok(await api.post(`/tasks/${t2.id}/comments`, { content: `Plano de contas importado; @[Carla Mendes](${carla.id}) pode revisar as contas de resultado?` }), 'comentário')

  // Gestão de projetos: fases, elementos e subelementos
  const board = ok(await api.get(`/projects/${p}/plan`), 'quadro')
  const st = (category) => board.statuses.find((s) => s.category === category).id
  const group = async (name, color, parentId) => ok(await api.post(`/projects/${p}/groups`, Object.assign({ name, color }, parentId ? { parent_id: parentId } : {})), `grupo ${name}`)
  const ini = await group('Iniciação', 'blue')
  const plan = await group('Planejamento', 'green')
  const planDoc = await group('Plano do Projeto', 'violet', plan.id)
  const exec = await group('Execução', 'amber')
  const resource = async (name) => ok(await api.post(`/projects/${p}/plan/resources`, { name }), `recurso ${name}`)
  const gp = await resource('Gerente de Projetos')
  const cliente = await resource('Cliente')
  const consultor = await resource('Consultor')
  const item = async (body) => ok(await api.post(`/projects/${p}/plan/items`, body), `elemento ${body.name}`)
  const kickoff = await item({ group_id: ini.id, name: 'Reunião de kickoff', status_id: st('done'), start_date: day(-20), end_date: day(-20), resource_ids: [gp.id, cliente.id], estimated_hours: 2 })
  await item({ parent_id: kickoff.id, name: 'Preparar a pauta', owner_id: carla.id, due_date: day(-21), estimated_hours: 1, progress: 100 })
  await item({ group_id: ini.id, name: 'Alinhamento com as áreas', status_id: st('done'), start_date: day(-18), end_date: day(-16), resource_ids: [gp.id], estimated_hours: 4 })
  const cronograma = await item({ group_id: planDoc.id, name: 'Elaborar o cronograma', status_id: st('in_progress'), start_date: day(-10), end_date: day(2), resource_ids: [gp.id, consultor.id], estimated_hours: 16 })
  await item({ group_id: planDoc.id, name: 'Aprovar o plano com o patrocinador', start_date: day(3), end_date: day(4), resource_ids: [gp.id, cliente.id], estimated_hours: 2 })
  const parametrizacao = await item({ group_id: exec.id, name: 'Parametrização do sistema', start_date: day(5), end_date: day(25), resource_ids: [consultor.id], estimated_hours: 80 })
  await item({ group_id: exec.id, name: 'Homologação com o cliente', status_id: st('blocked'), start_date: day(26), end_date: day(35), resource_ids: [cliente.id], estimated_hours: 24 })
  ok(await api.post(`/plan/items/${cronograma.id}/links`, { type: 'blocks', item_id: parametrizacao.id }), 'dependência')

  // colunas personalizadas com valores
  const custo = ok(await api.post(`/projects/${p}/plan/columns`, { name: 'Custo', type: 'number', settings: { unit: 'R$' } }), 'coluna custo')
  const fase = ok(await api.post(`/projects/${p}/plan/columns`, { name: 'Contrato', type: 'dropdown', settings: { options: [{ name: 'Escopo fechado', color: 'green' }, { name: 'Adicional', color: 'amber' }] } }), 'coluna contrato')
  ok(await api.patch(`/plan/items/${cronograma.id}`, { custom: { [custo.id]: 3200, [fase.id]: fase.settings.options[0].id } }), 'valores')
  ok(await api.patch(`/plan/items/${parametrizacao.id}`, { custom: { [custo.id]: 18000, [fase.id]: fase.settings.options[1].id } }), 'valores')

  // gestão: diário, problemas e linha de base; atualização com menção
  ok(await api.post(`/projects/${p}/plan/journal`, { entry_date: day(-20), content: 'Reunião de abertura do projeto com o patrocinador e as áreas envolvidas.' }), 'diário')
  ok(await api.post(`/projects/${p}/plan/journal`, { entry_date: day(-12), content: 'Escopo do módulo fiscal confirmado; cronograma em elaboração.' }), 'diário')
  ok(await api.post(`/projects/${p}/plan/issues`, { opened_on: day(-5), description: 'Cliente ainda sem acesso à VPN para a homologação.', state: 'in_progress', owner_id: carla.id }), 'problema')
  ok(await api.post(`/projects/${p}/plan/issues`, { opened_on: day(-2), description: 'Definir o responsável pela validação dos relatórios.' }), 'problema')
  ok(await api.put(`/projects/${p}/plan/baseline`, {}), 'linha de base')
  ok(await api.post(`/plan/items/${cronograma.id}/updates`, { content: `Primeira versão do cronograma pronta, @[Rafael Lima](${rafael.id}) confira as datas da parametrização.` }), 'atualização')

  // ficha do projeto: objetivo, funcionalidades ligadas às tarefas, escopo e um resultado medido
  ok(await api.put(`/projects/${p}/charter`, { objective: 'Substituir o sistema legado pelo ERP até o fim do semestre, com o fiscal e o financeiro rodando no novo sistema.' }), 'objetivo geral')
  const charter = async (body) => ok(await api.post(`/projects/${p}/charter/items`, body), `ficha ${body.title}`)
  await charter({ kind: 'objective', title: 'Fechar o mês contábil no ERP' })
  await charter({ kind: 'objective', title: 'Eliminar as planilhas paralelas do financeiro' })
  await charter({ kind: 'feature', title: 'Módulo fiscal', task_ids: [t1.id] })
  await charter({ kind: 'feature', title: 'Plano de contas e cadastros', task_ids: [t2.id, t3.id] })
  await charter({ kind: 'scope_in', title: 'Fiscal, financeiro e contabilidade' })
  await charter({ kind: 'scope_out', title: 'Folha de pagamento' })
  const resultado = await charter({ kind: 'result', title: 'Notas fiscais emitidas no ERP', unit: '%', baseline: 0, target: 100, owner_id: carla.id, start_date: day(-20), due_date: day(60), frequency: 'weekly' })
  ok(await api.post(`/charter-items/${resultado.id}/measurements`, { value: 35, measured_at: day(-1) }), 'medição')

  // subprojeto (um só nível): aparece no card "Subprojetos" do Resumo do projeto
  ok(await api.post('/projects', { name: 'Treinamento dos usuários (demonstração)', key: 'DEMOT', parent_id: p, start_date: day(20), due_date: day(50) }), 'subprojeto')

  // documentação
  const space = ok(await api.post('/docs/spaces', { key: DEMO_KEY, name: 'Manual do ERP (demonstração)', description: 'Guias de uso do projeto de exemplo.', visibility: 'company' }), 'espaço')
  const page = ok(await api.post(`/docs/spaces/${space.id}/pages`, { title: 'Como lançar uma nota fiscal' }), 'página')
  const text = (value) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] })
  ok(
    await api.post(`/docs/pages/${page.id}/publish`, {
      title: 'Como lançar uma nota fiscal',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Passo a passo' }] },
          { type: 'orderedList', content: ['Abra o módulo Fiscal.', 'Escolha "Nova nota".', 'Confira os impostos calculados e salve.'].map((v) => ({ type: 'listItem', content: [text(v)] })) },
          { type: 'callout', attrs: { tone: 'info' }, content: [text('Notas de devolução usam o mesmo fluxo, com o tipo "Devolução".')] },
        ],
      },
    }),
    'publicar página',
  )

  return { created: true, project, users: [carla, rafael], password, task: t2, space, page }
}

module.exports = { seedDemo, DEMO_KEY }
