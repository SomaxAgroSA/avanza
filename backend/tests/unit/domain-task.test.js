const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const task = require('../../src/domain/task')
const { resolveAccess } = require('../../src/domain/project')
const { createPrincipal } = require('../../src/domain/rbac')
const { DEFAULT_ROLE_PERMISSIONS } = require('../../src/domain/permissions')

const project = { id: 'p1', key: 'CRM', ownerId: 'owner', archivedAt: null }

function principal(roleCode, userId) {
  return createPrincipal({ userId: userId || 'u1', roleId: roleCode, roleCode, permissions: DEFAULT_ROLE_PERMISSIONS[roleCode].slice() })
}

function access(roleCode, memberRole, options) {
  const p = principal(roleCode, options && options.userId)
  const proj = Object.assign({}, project, options && options.project)
  return { access: resolveAccess(p, proj, memberRole ? { role: memberRole } : null), project: proj }
}

function codeOf(fn) {
  try {
    fn()
  } catch (err) {
    return err.code
  }
  return 'OK'
}

describe('domain/task — acesso', () => {
  it('quem não enxerga o projeto recebe TASK_NOT_FOUND (não revela existência)', () => {
    const a = access('MEMBER', null)
    assert.equal(codeOf(() => task.assertTaskAccess(a.access, a.project, 'view')), 'TASK_NOT_FOUND')
  })

  it('leitor do projeto vê mas não cria nem edita', () => {
    const a = access('MEMBER', 'viewer')
    assert.equal(codeOf(() => task.assertTaskAccess(a.access, a.project, 'view')), 'OK')
    assert.equal(codeOf(() => task.assertTaskAccess(a.access, a.project, 'create')), 'FORBIDDEN')
    assert.equal(codeOf(() => task.assertTaskAccess(a.access, a.project, 'edit')), 'FORBIDDEN')
  })

  it('membro cria e edita; exclui só o que criou; gestor exclui qualquer uma', () => {
    const member = access('MANAGER', 'member', { userId: 'u1' })
    assert.equal(codeOf(() => task.assertTaskAccess(member.access, member.project, 'create')), 'OK')
    assert.equal(codeOf(() => task.assertTaskAccess(member.access, member.project, 'delete', { creatorId: 'outro' })), 'FORBIDDEN')
    assert.equal(codeOf(() => task.assertTaskAccess(member.access, member.project, 'delete', { creatorId: 'u1' })), 'OK')
    const manager = access('MANAGER', 'manager')
    assert.equal(codeOf(() => task.assertTaskAccess(manager.access, manager.project, 'delete', { creatorId: 'outro' })), 'OK')
  })

  it('permissão global também é exigida (MEMBER não tem tasks.delete)', () => {
    const a = access('MEMBER', 'manager', { userId: 'u1' })
    assert.equal(codeOf(() => task.assertTaskAccess(a.access, a.project, 'delete', { creatorId: 'u1' })), 'FORBIDDEN')
  })

  it('projeto arquivado fica somente leitura', () => {
    const a = access('ADMIN', null, { project: { archivedAt: new Date() } })
    assert.equal(codeOf(() => task.assertTaskAccess(a.access, a.project, 'view')), 'OK')
    assert.equal(codeOf(() => task.assertTaskAccess(a.access, a.project, 'edit')), 'PROJECT_ARCHIVED')
  })

  it('capacidades resumem o que a interface pode oferecer', () => {
    const a = access('MEMBER', 'member', { userId: 'u1' })
    assert.deepEqual(task.taskCapabilities(a.access, a.project, { creatorId: 'u1' }), { edit: true, delete: false, assign: true, link: true, fork: true, comment: true })
  })
})

describe('domain/task — Responsável TI (§33/§36)', () => {
  const mine = { id: 't1', assigneeId: 'ti', creatorId: 'gabi', itVisible: false }
  const shared = { id: 't2', assigneeId: 'gabi', creatorId: 'gabi', itVisible: true }
  const other = { id: 't3', assigneeId: 'gabi', creatorId: 'gabi', itVisible: false }

  it('só as tarefas atribuídas a ele ou marcadas; nelas, colaborador sem excluir, reatribuir, criar, relacionar nem fazer fork', () => {
    const a = access('MANAGER', 'it', { userId: 'ti' })
    assert.equal(a.access.limited, true)
    assert.equal(codeOf(() => task.assertTaskAccess(task.scopedAccess(a.access, other), a.project, 'view', other)), 'TASK_NOT_FOUND')
    for (const t of [mine, shared]) {
      const scoped = task.scopedAccess(a.access, t)
      assert.equal(scoped.scoped, true)
      assert.equal(codeOf(() => task.assertTaskAccess(scoped, a.project, 'view', t)), 'OK')
      assert.equal(codeOf(() => task.assertTaskAccess(scoped, a.project, 'edit', t)), 'OK')
      for (const action of ['delete', 'assign', 'create', 'link', 'fork']) {
        assert.equal(codeOf(() => task.assertTaskAccess(scoped, a.project, action, t)), 'FORBIDDEN', action)
      }
      assert.deepEqual(task.taskCapabilities(scoped, a.project, t), { edit: true, delete: false, assign: false, link: false, fork: false, comment: true })
    }
    // sem tarefa (criar, quadro, backlog…) continua fora
    assert.equal(codeOf(() => task.assertTaskAccess(a.access, a.project, 'create')), 'TASK_NOT_FOUND')
  })

  it('quem não é limitado não muda; o papel decide a visibilidade para notificações e menções', () => {
    const m = access('MEMBER', 'member', { userId: 'u1' })
    assert.equal(task.scopedAccess(m.access, other), m.access)
    assert.equal(task.memberSeesTask(project, { role: 'member' }, 'u1', other), true)
    assert.equal(task.memberSeesTask(project, { role: 'it' }, 'ti', other), false)
    assert.equal(task.memberSeesTask(project, { role: 'it' }, 'ti', mine), true)
    assert.equal(task.memberSeesTask(project, { role: 'it' }, 'ti', shared), true)
    assert.equal(task.memberSeesTask(project, null, 'owner', other), true)
    assert.equal(task.memberSeesTask(project, null, 'x', other), false)
  })

  it('o Responsável TI pode ser responsável pela tarefa', () => {
    assert.equal(task.canBeAssignee(project, { role: 'it' }, 'ti'), true)
  })
})

describe('domain/task — checklist, comentários e tags', () => {
  const ids = (() => {
    let n = 0
    return () => `n${++n}`
  })()

  it('normaliza checklist: apara textos, gera ids e rejeita itens inválidos', () => {
    assert.deepEqual(
      task.normalizeChecklist([{ text: '  Revisar  ', done: true }, { id: 'a1', text: 'Publicar' }], ids),
      { value: [{ id: 'n1', text: 'Revisar', done: true }, { id: 'a1', text: 'Publicar', done: false }] },
    )
    assert.deepEqual(task.normalizeChecklist([{ text: ' ' }], ids), { error: 'item_text_required' })
    assert.deepEqual(task.normalizeChecklist([{ text: 'x'.repeat(301) }], ids), { error: 'too_long' })
    assert.deepEqual(task.normalizeChecklist('x', ids), { error: 'invalid_type' })
    assert.deepEqual(task.normalizeChecklist(new Array(101).fill({ text: 'a' }), ids), { error: 'too_many' })
    // ids repetidos são renovados
    const dup = task.normalizeChecklist([{ id: 'a', text: '1' }, { id: 'a', text: '2' }], ids).value
    assert.notEqual(dup[0].id, dup[1].id)
  })

  it('resumo do checklist para o histórico', () => {
    assert.deepEqual(task.checklistSummary([{ text: 'A', done: true }, { text: 'B', done: false }]), ['✓ A', '○ B'])
  })

  it('comentários: qualquer pessoa com acesso ao projeto comenta (inclusive leitor); autor edita; autor ou gestor exclui', () => {
    const member = access('MEMBER', 'member', { userId: 'u1' })
    const viewer = access('VIEWER', 'viewer', { userId: 'u9' })
    const outsider = access('MEMBER', null, { userId: 'u8' })
    const manager = access('MANAGER', 'manager', { userId: 'u2' })
    const mine = { userId: 'u1', deletedAt: null }
    assert.equal(codeOf(() => task.assertCommentAccess(member.access, member.project, 'create')), 'OK')
    assert.equal(codeOf(() => task.assertCommentAccess(viewer.access, viewer.project, 'create')), 'OK')
    assert.equal(codeOf(() => task.assertCommentAccess(viewer.access, viewer.project, 'edit', { userId: 'u9', deletedAt: null })), 'OK')
    assert.equal(codeOf(() => task.assertCommentAccess(outsider.access, outsider.project, 'create')), 'TASK_NOT_FOUND')
    assert.equal(codeOf(() => task.assertCommentAccess(member.access, member.project, 'edit', mine)), 'OK')
    assert.equal(codeOf(() => task.assertCommentAccess(manager.access, manager.project, 'edit', mine)), 'FORBIDDEN')
    assert.equal(codeOf(() => task.assertCommentAccess(manager.access, manager.project, 'delete', mine)), 'OK')
    assert.equal(codeOf(() => task.assertCommentAccess(member.access, member.project, 'edit', { userId: 'u1', deletedAt: new Date() })), 'COMMENT_NOT_FOUND')
  })

  it('menções: extrai pessoas marcadas (sem repetir) e gera texto legível', () => {
    const content = 'Oi @[Carla Mendes](u7), veja com @[Gabi](u2) e @[Carla Mendes](u7)'
    assert.deepEqual(task.extractMentions(content), ['u7', 'u2'])
    assert.equal(task.plainText(content), 'Oi @Carla Mendes, veja com @Gabi e @Carla Mendes')
    assert.deepEqual(task.extractMentions('email a@b.com e @solto'), [])
    // Markdown some do texto do histórico
    assert.equal(
      task.plainText('Veja **isto**, *aquilo*, ~~velho~~, `cod` e [doc](https://x.dev) com snake_case_ok'),
      'Veja isto, aquilo, velho, cod e doc (https://x.dev) com snake_case_ok',
    )
  })

  it('tags: nome obrigatório, até 40 caracteres, chave sem diferenciar maiúsculas e acentos', () => {
    assert.equal(task.tagKey('  Urgência  '), 'urgencia')
    assert.equal(task.tagNameIssue(''), 'required')
    assert.equal(task.tagNameIssue('x'.repeat(41)), 'too_long')
    assert.equal(task.tagNameIssue('Front-end'), null)
  })
})

describe('domain/task — regras', () => {
  it('código da tarefa = chave do projeto + número', () => {
    assert.equal(task.taskCode('CRM', 12), 'CRM-12')
  })

  it('datas de início e conclusão acompanham a categoria do status', () => {
    const now = new Date('2026-09-28T10:00:00Z')
    const later = new Date('2026-09-29T10:00:00Z')
    let dates = task.statusDates({ startedAt: null, completedAt: null }, 'todo', 'in_progress', now)
    assert.deepEqual(dates, { startedAt: now, completedAt: null })
    // voltar para "a fazer" não apaga o início
    dates = task.statusDates(dates, 'in_progress', 'todo', later)
    assert.deepEqual(dates, { startedAt: now, completedAt: null })
    dates = task.statusDates(dates, 'todo', 'done', later)
    assert.deepEqual(dates, { startedAt: now, completedAt: later })
    // reabrir limpa a conclusão
    dates = task.statusDates(dates, 'done', 'in_progress', later)
    assert.deepEqual(dates, { startedAt: now, completedAt: null })
    // criar direto como concluída preenche as duas
    assert.deepEqual(task.statusDates({ startedAt: null, completedAt: null }, null, 'done', now), { startedAt: now, completedAt: now })
  })

  it('valida campos personalizados: obrigatórios visíveis, tipo e campos fora do tipo', () => {
    const links = [
      { field: { id: 'f1', name: 'versao', type: 'text', config: { max_length: 5 }, options: [] }, required: true, visible: true },
      { field: { id: 'f2', name: 'severidade', type: 'select', config: {}, options: [{ id: 'o1', is_active: true }] }, required: false, visible: true },
      { field: { id: 'f3', name: 'interno', type: 'text', config: {}, options: [] }, required: true, visible: false },
    ]
    assert.deepEqual(task.validateCustomValues(links, { versao: '1.0', severidade: 'o1' }, {}), {
      values: { f1: '1.0', f2: 'o1' },
      errors: {},
    })
    assert.deepEqual(task.validateCustomValues(links, { versao: '123456', severidade: 'xx', outro: 'a' }, {}).errors, {
      versao: 'too_long',
      severidade: 'invalid_option',
      outro: 'unknown_field',
    })
    // obrigatório vazio; oculto obrigatório não é exigido
    assert.deepEqual(task.validateCustomValues(links, {}, {}).errors, { versao: 'required' })
  })

  it('obrigatório por status: exigido só nos status marcados (e sempre, quando obrigatório geral)', () => {
    const parecer = { field: { id: 'f1', name: 'parecer', type: 'textarea', config: {}, options: [] }, required: false, visible: true, required_status_ids: ['analise', 'dev'] }
    const versao = { field: { id: 'f2', name: 'versao', type: 'text', config: {}, options: [] }, required: true, visible: true, required_status_ids: [] }
    const oculto = { field: { id: 'f3', name: 'oculto', type: 'text', config: {}, options: [] }, required: false, visible: false, required_status_ids: ['analise'] }
    assert.equal(task.requiredIn(parecer, 'analise'), true)
    assert.equal(task.requiredIn(parecer, 'backlog'), false)
    assert.equal(task.requiredIn(versao, 'backlog'), true)
    // campo oculto nunca é exigido
    assert.equal(task.requiredIn(oculto, 'analise'), false)
    const links = [parecer, versao, oculto]
    assert.deepEqual(task.validateCustomValues(links, { versao: '1.0' }, {}, 'backlog').errors, {})
    assert.deepEqual(task.validateCustomValues(links, { versao: '1.0' }, {}, 'analise').errors, { parecer: 'required' })
    // já preenchido antes: vale o valor salvo; esvaziar no status que exige é recusado
    assert.deepEqual(task.validateCustomValues(links, {}, { f1: 'Aprovado', f2: '1.0' }, 'dev').errors, {})
    assert.deepEqual(task.validateCustomValues(links, { parecer: '' }, { f1: 'Aprovado', f2: '1.0' }, 'dev').errors, { parecer: 'required' })
    // sem status informado, só o obrigatório geral
    assert.deepEqual(task.validateCustomValues(links, { versao: '1.0' }, {}).errors, {})
  })

  it('arquivo/imagem obrigatório não é exigido ao criar (só dá para anexar depois); nas alterações seguintes, sim', () => {
    const evidencias = { field: { id: 'f9', name: 'evidencias', type: 'file', config: {} }, required: true, visible: true }
    const print = { field: { id: 'f8', name: 'print', type: 'image', config: {} }, required: false, visible: true, required_status_ids: ['analise'] }
    const versao = { field: { id: 'f2', name: 'versao', type: 'text', config: {} }, required: true, visible: true }
    const links = [evidencias, print, versao]
    assert.deepEqual(task.validateCustomValues(links, { versao: '1.0' }, {}, 'analise', { creating: true }).errors, {})
    // os demais obrigatórios continuam exigidos na criação
    assert.deepEqual(task.validateCustomValues(links, {}, {}, 'analise', { creating: true }).errors, { versao: 'required' })
    // depois de criada, o arquivo passa a ser exigido (editar ou mudar de status)
    assert.deepEqual(task.validateCustomValues(links, {}, { f2: '1.0' }, 'analise').errors, { evidencias: 'required', print: 'required' })
    assert.deepEqual(task.validateCustomValues(links, {}, { f2: '1.0', f9: ['a1'], f8: ['a2'] }, 'analise').errors, {})
  })

  it('valor já salvo não é revalidado (opção desativada depois continua válida)', () => {
    const links = [{ field: { id: 'f2', name: 'severidade', type: 'select', config: {}, options: [{ id: 'o1', is_active: false }] }, required: true, visible: true }]
    assert.deepEqual(task.validateCustomValues(links, { severidade: 'o1' }, { f2: 'o1' }), { values: { f2: 'o1' }, errors: {} })
    assert.deepEqual(task.validateCustomValues(links, {}, { f2: 'o1' }).values, { f2: 'o1' })
  })
})
