const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createTaskService } = require('../../src/application/tasks')
const { createAttachmentService } = require('../../src/application/attachments')
const { createCustomFieldService } = require('../../src/application/custom-fields')
const { createTaskTypeService } = require('../../src/application/task-types')
const { createLookupService } = require('../../src/application/lookups')
const { createPrincipal } = require('../../src/domain/rbac')

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]
const PDF = Array.from(Buffer.from('%PDF-1.7\n'))

function upload(name, head, size) {
  return { name, head, size: size === undefined ? 1000 : size, handle: { fake: name } }
}

async function ctxOf(deps, user) {
  const role = await deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

async function codeOf(fn) {
  try {
    await fn()
  } catch (err) {
    return err.code === 'VALIDATION_ERROR' ? `${err.code}:${JSON.stringify(err.details.fields)}` : err.code
  }
  return 'OK'
}

async function setup() {
  const deps = createFakeDeps()
  const adminUser = await seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const ana = await seedUser(deps, { roleCode: 'MEMBER', name: 'Ana' })
  const lia = await seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' })
  const outsider = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const admin = await ctxOf(deps, adminUser)
  const project = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  for (const [u, role] of [
    [gabi, 'manager'],
    [mario, 'member'],
    [ana, 'member'],
    [lia, 'viewer'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role })
  }
  const fields = createCustomFieldService(deps)
  const evidencias = await fields.createField(admin, { label: 'Evidências', type: 'image' })
  const contrato = await fields.createField(admin, { label: 'Contrato', type: 'file' })
  const types = createTaskTypeService(deps)
  const bug = await types.createType(admin, { key: 'BUG', name: 'Bug' })
  await types.setTypeFields(admin, bug.id, [{ field_id: evidencias.id }, { field_id: contrato.id }])
  await createLookupService(deps, 'status').create(admin, { key: 'TODO', name: 'A fazer', category: 'todo' })
  await createLookupService(deps, 'priority').create(admin, { key: 'MEDIA', name: 'Média' })
  const tasks = createTaskService(deps)
  const ctx = { admin, gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), ana: await ctxOf(deps, ana), lia: await ctxOf(deps, lia), outsider: await ctxOf(deps, outsider) }
  const task = await tasks.createTask(ctx.mario, { project_id: project.id, task_type_id: bug.id, title: 'Erro' })
  return { deps, tasks, attachments: createAttachmentService(deps), ctx, task }
}

describe('application/attachments', () => {
  it('colaborador anexa imagem e PDF; o tipo vem do conteúdo; histórico registra', async () => {
    const { attachments, ctx, task, deps } = await setup()
    const created = await attachments.uploadAttachments(ctx.mario, task.id, [upload('Print da tela.png', PNG, 2048), upload('contrato.pdf', PDF)])
    assert.deepEqual(created.map((a) => [a.name, a.mime, a.kind, a.size]), [
      ['Print da tela.png', 'image/png', 'image', 2048],
      ['contrato.pdf', 'application/pdf', 'document', 1000],
    ])
    assert.equal(created[0].uploaded_by.name, 'Mário')
    assert.match(created[0].url, /^\/api\/v1\/attachments\/.+\/file$/)
    assert.deepEqual(created[0].capabilities, { delete: true })
    const audit = deps.store.audit.at(-1)
    assert.equal(audit.action, 'attachment.added')
    assert.deepEqual(audit.newValue, { attachments: 'Print da tela.png, contrato.pdf' })
    assert.equal((await tasks(deps).listTasks(ctx.mario, {})).items[0].attachment_count, 2)
  })

  it('recusa arquivo com conteúdo diferente da extensão, tipo não permitido, vazio ou grande demais', async () => {
    const { attachments, ctx, task, deps } = await setup()
    assert.equal(await codeOf(() => attachments.uploadAttachments(ctx.mario, task.id, [upload('foto.png', PDF)])), 'VALIDATION_ERROR:{"files":"type_mismatch"}')
    assert.equal(await codeOf(() => attachments.uploadAttachments(ctx.mario, task.id, [upload('script.html', [60, 104])])), 'VALIDATION_ERROR:{"files":"unsupported_type"}')
    assert.equal(await codeOf(() => attachments.uploadAttachments(ctx.mario, task.id, [upload('a.png', PNG, 0)])), 'VALIDATION_ERROR:{"files":"empty_file"}')
    assert.equal(await codeOf(() => attachments.uploadAttachments(ctx.mario, task.id, [upload('a.png', PNG, 21 * 1024 * 1024)])), 'VALIDATION_ERROR:{"files":"file_too_large"}')
    assert.equal(await codeOf(() => attachments.uploadAttachments(ctx.mario, task.id, [])), 'VALIDATION_ERROR:{"files":"required"}')
    // nada é gravado se um dos arquivos for inválido
    assert.equal(await codeOf(() => attachments.uploadAttachments(ctx.mario, task.id, [upload('ok.png', PNG), upload('ruim.png', PDF)])), 'VALIDATION_ERROR:{"files":"type_mismatch"}')
    assert.equal(deps.store.attachments.length, 0)
  })

  it('leitor vê e baixa, mas não anexa; quem não é do projeto não vê', async () => {
    const { attachments, ctx, task } = await setup()
    const [a] = await attachments.uploadAttachments(ctx.mario, task.id, [upload('a.png', PNG)])
    assert.equal(await codeOf(() => attachments.uploadAttachments(ctx.lia, task.id, [upload('b.png', PNG)])), 'FORBIDDEN')
    assert.deepEqual((await attachments.listAttachments(ctx.lia, task.id)).map((x) => [x.name, x.capabilities.delete]), [['a.png', false]])
    assert.equal((await attachments.fileFor(ctx.lia, a.id)).name, 'a.png')
    assert.equal(await codeOf(() => attachments.fileFor(ctx.outsider, a.id)), 'ATTACHMENT_NOT_FOUND')
    assert.equal(await codeOf(() => attachments.listAttachments(ctx.outsider, task.id)), 'TASK_NOT_FOUND')
  })

  it('exclui: quem enviou ou o gestor; outra colaboradora não', async () => {
    const { attachments, ctx, task, deps } = await setup()
    const [a] = await attachments.uploadAttachments(ctx.mario, task.id, [upload('a.png', PNG)])
    assert.equal(await codeOf(() => attachments.deleteAttachment(ctx.ana, a.id)), 'FORBIDDEN')
    assert.deepEqual(await attachments.deleteAttachment(ctx.gabi, a.id), { deleted: true })
    assert.equal(deps.store.attachments.length, 0)
    assert.deepEqual(deps.store.audit.at(-1).oldValue, { attachments: 'a.png' })
  })

  it('campos de imagem/arquivo: anexo vai para o campo; imagem só aceita imagem; excluir tira do campo', async () => {
    const { attachments, tasks: taskService, ctx, task } = await setup()
    const [img] = await attachments.uploadAttachments(ctx.mario, task.id, [upload('erro.png', PNG)], 'evidencias')
    assert.deepEqual((await taskService.getTask(ctx.mario, task.id)).custom_values, { evidencias: [img.id] })
    assert.equal(
      await codeOf(() => attachments.uploadAttachments(ctx.mario, task.id, [upload('doc.pdf', PDF)], 'evidencias')),
      'VALIDATION_ERROR:{"files":"image_required"}',
    )
    assert.equal(await codeOf(() => attachments.uploadAttachments(ctx.mario, task.id, [upload('a.png', PNG)], 'nao_existe')), 'VALIDATION_ERROR:{"field":"unknown_field"}')
    const [pdf] = await attachments.uploadAttachments(ctx.mario, task.id, [upload('contrato.pdf', PDF)], 'contrato')
    assert.deepEqual((await taskService.getTask(ctx.mario, task.id)).custom_values.contrato, [pdf.id])

    await attachments.deleteAttachment(ctx.mario, img.id)
    assert.equal((await taskService.getTask(ctx.mario, task.id)).custom_values.evidencias, undefined)
  })

  it('ao editar a tarefa, campo de imagem só aceita anexos de imagem da própria tarefa', async () => {
    const { attachments, tasks: taskService, ctx, task } = await setup()
    const [pdf] = await attachments.uploadAttachments(ctx.mario, task.id, [upload('contrato.pdf', PDF)])
    const [img] = await attachments.uploadAttachments(ctx.mario, task.id, [upload('erro.png', PNG)])
    assert.equal(
      await codeOf(() => taskService.updateTask(ctx.mario, task.id, { custom_values: { evidencias: [pdf.id] } })),
      'VALIDATION_ERROR:{"custom_values.evidencias":"invalid_option"}',
    )
    assert.equal(
      await codeOf(() => taskService.updateTask(ctx.mario, task.id, { custom_values: { evidencias: ['outro_id'] } })),
      'VALIDATION_ERROR:{"custom_values.evidencias":"invalid_option"}',
    )
    const updated = await taskService.updateTask(ctx.mario, task.id, { custom_values: { evidencias: [img.id], contrato: [pdf.id] } })
    assert.deepEqual(updated.custom_values, { evidencias: [img.id], contrato: [pdf.id] })
  })

  it('histórico dos campos de imagem/arquivo usa o nome do arquivo', async () => {
    const { attachments, tasks: taskService, ctx, task, deps } = await setup()
    const [img] = await attachments.uploadAttachments(ctx.mario, task.id, [upload('erro.png', PNG)])
    await taskService.updateTask(ctx.mario, task.id, { custom_values: { evidencias: [img.id] } })
    assert.deepEqual(deps.store.audit.at(-1).newValue, { 'cf:Evidências': 'erro.png' })
  })
})

describe('application/attachments — anexos em comentários', () => {
  async function withComment(s, ctx, content) {
    const { createCommentService } = require('../../src/application/comments')
    const comments = createCommentService(s.deps)
    return { comments, comment: await comments.createComment(ctx, s.task.id, { content: content || 'Veja o print' }) }
  }

  it('autor do comentário anexa (inclusive leitora); aparece no comentário e não na aba da tarefa', async () => {
    const s = await setup()
    const { comments, comment } = await withComment(s, s.ctx.lia)
    const [file] = await s.attachments.uploadAttachments(s.ctx.lia, s.task.id, [upload('print.png', PNG)], undefined, comment.id)
    assert.equal(file.comment_id, comment.id)
    assert.deepEqual((await comments.listComments(s.ctx.mario, s.task.id))[0].attachments.map((a) => a.name), ['print.png'])
    assert.deepEqual(await s.attachments.listAttachments(s.ctx.mario, s.task.id), [])
    assert.deepEqual(s.deps.store.audit.at(-1).newValue, { attachments: 'print.png', comment: 'Veja o print' })
  })

  it('só o autor anexa ao próprio comentário; comentário de outra tarefa ou excluído é recusado', async () => {
    const s = await setup()
    const { comments, comment } = await withComment(s, s.ctx.mario)
    assert.equal(await codeOf(() => s.attachments.uploadAttachments(s.ctx.ana, s.task.id, [upload('a.png', PNG)], undefined, comment.id)), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.attachments.uploadAttachments(s.ctx.mario, s.task.id, [upload('a.png', PNG)], undefined, 'nao_existe')), 'COMMENT_NOT_FOUND')
    await comments.deleteComment(s.ctx.mario, comment.id)
    assert.equal(await codeOf(() => s.attachments.uploadAttachments(s.ctx.mario, s.task.id, [upload('a.png', PNG)], undefined, comment.id)), 'COMMENT_NOT_FOUND')
  })

  it('excluir o comentário apaga os anexos dele; gestor pode remover anexo de comentário', async () => {
    const s = await setup()
    const { comments, comment } = await withComment(s, s.ctx.mario)
    const [a, b] = await s.attachments.uploadAttachments(s.ctx.mario, s.task.id, [upload('a.png', PNG), upload('b.pdf', PDF)], undefined, comment.id)
    assert.equal(await codeOf(() => s.attachments.deleteAttachment(s.ctx.ana, a.id)), 'FORBIDDEN')
    assert.deepEqual(await s.attachments.deleteAttachment(s.ctx.gabi, a.id), { deleted: true })
    await comments.deleteComment(s.ctx.mario, comment.id)
    assert.equal(s.deps.store.attachments.some((x) => x.id === b.id), false)
    assert.deepEqual((await comments.listComments(s.ctx.mario, s.task.id))[0].attachments, [])
  })
})

function tasks(deps) {
  return createTaskService(deps)
}
