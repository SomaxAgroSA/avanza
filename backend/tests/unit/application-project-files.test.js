const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createProjectFileService } = require('../../src/application/project-files')
const { createProjectService } = require('../../src/application/projects')
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
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const ana = await seedUser(deps, { roleCode: 'MEMBER', name: 'Ana' })
  const lia = await seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' })
  const outsider = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const viewerRole = await seedUser(deps, { roleCode: 'VIEWER', name: 'Vera' })
  const project = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  for (const [u, role] of [
    [gabi, 'manager'],
    [mario, 'member'],
    [ana, 'member'],
    [lia, 'viewer'],
    [viewerRole, 'member'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role })
  }
  const ctx = {
    gabi: await ctxOf(deps, gabi),
    mario: await ctxOf(deps, mario),
    ana: await ctxOf(deps, ana),
    lia: await ctxOf(deps, lia),
    outsider: await ctxOf(deps, outsider),
    vera: await ctxOf(deps, viewerRole),
  }
  return { deps, files: createProjectFileService(deps), projects: createProjectService(deps), ctx, project, users: { gabi, mario } }
}

describe('application/project-files', () => {
  it('enviar: colaborador com tasks.edit envia; tipo decidido pelo conteúdo; histórico no projeto', async () => {
    const { deps, files, ctx, project, users } = await setup()
    const saved = await files.uploadFiles(ctx.mario, project.id, [upload('contrato.pdf', PDF, 2048), upload('logo.png', PNG)])
    assert.deepEqual(saved.map((f) => [f.name, f.kind, f.mime]), [
      ['contrato.pdf', 'document', 'application/pdf'],
      ['logo.png', 'image', 'image/png'],
    ])
    assert.equal(saved[0].project_id, project.id)
    assert.equal(saved[0].size, 2048)
    assert.equal(saved[0].uploaded_by.id, users.mario.id)
    assert.equal(saved[0].url, `/api/v1/project-files/${saved[0].id}/file`)
    assert.deepEqual(saved[0].capabilities, { delete: true })
    const audit = deps.store.audit.filter((a) => a.action === 'project.file_added')
    assert.equal(audit.length, 1)
    assert.equal(audit[0].entityType, 'project')
    assert.equal(audit[0].entityId, project.id)
    assert.deepEqual(audit[0].newValue, { attachments: 'contrato.pdf, logo.png' })
  })

  it('enviar: valida tudo antes de gravar (tipo, conteúdo, tamanho, quantidade) e nada fica pela metade', async () => {
    const { deps, files, ctx, project } = await setup()
    assert.equal(await codeOf(() => files.uploadFiles(ctx.mario, project.id, [])), 'VALIDATION_ERROR:{"files":"required"}')
    assert.equal(await codeOf(() => files.uploadFiles(ctx.mario, project.id, [upload('a.png', PNG), upload('virus.exe', PNG)])), 'VALIDATION_ERROR:{"files":"unsupported_type"}')
    assert.equal(await codeOf(() => files.uploadFiles(ctx.mario, project.id, [upload('falso.pdf', PNG)])), 'VALIDATION_ERROR:{"files":"type_mismatch"}')
    assert.equal(await codeOf(() => files.uploadFiles(ctx.mario, project.id, [upload('grande.pdf', PDF, 21 * 1024 * 1024)])), 'VALIDATION_ERROR:{"files":"file_too_large"}')
    const many = Array.from({ length: 11 }, (_, i) => upload(`f${i}.png`, PNG))
    assert.equal(await codeOf(() => files.uploadFiles(ctx.mario, project.id, many)), 'VALIDATION_ERROR:{"files":"too_many"}')
    assert.equal(deps.store.projectFiles.length, 0)
  })

  it('quem pode: leitor do projeto e perfil sem tasks.edit só veem; fora do projeto = inexistente; arquivado = só leitura', async () => {
    const { deps, files, projects, ctx, project } = await setup()
    await files.uploadFiles(ctx.mario, project.id, [upload('a.pdf', PDF)])
    assert.equal(await codeOf(() => files.uploadFiles(ctx.lia, project.id, [upload('b.pdf', PDF)])), 'FORBIDDEN')
    assert.equal(await codeOf(() => files.uploadFiles(ctx.vera, project.id, [upload('b.pdf', PDF)])), 'FORBIDDEN')
    assert.equal((await files.listFiles(ctx.lia, project.id)).length, 1)
    assert.equal(await codeOf(() => files.listFiles(ctx.outsider, project.id)), 'PROJECT_NOT_FOUND')
    const [file] = await files.listFiles(ctx.lia, project.id)
    assert.equal(await codeOf(() => files.fileFor(ctx.outsider, file.id)), 'PROJECT_FILE_NOT_FOUND')
    assert.equal((await files.fileFor(ctx.lia, file.id)).id, file.id)

    await projects.archiveProject(ctx.gabi, project.id)
    assert.equal(await codeOf(() => files.uploadFiles(ctx.mario, project.id, [upload('c.pdf', PDF)])), 'PROJECT_ARCHIVED')
    assert.equal(await codeOf(() => files.deleteFile(ctx.gabi, file.id)), 'PROJECT_ARCHIVED')
    assert.equal((await files.listFiles(ctx.mario, project.id))[0].capabilities.delete, false)
    assert.equal(deps.store.projectFiles.length, 1)
  })

  it('excluir: quem enviou ou o gestor; outro membro não; histórico', async () => {
    const { deps, files, ctx, project } = await setup()
    const [file] = await files.uploadFiles(ctx.mario, project.id, [upload('a.pdf', PDF)])
    const asAna = (await files.listFiles(ctx.ana, project.id))[0]
    assert.equal(asAna.capabilities.delete, false)
    assert.equal(await codeOf(() => files.deleteFile(ctx.ana, file.id)), 'FORBIDDEN')
    assert.equal((await files.listFiles(ctx.gabi, project.id))[0].capabilities.delete, true)
    assert.deepEqual(await files.deleteFile(ctx.gabi, file.id), { deleted: true })
    assert.equal(deps.store.projectFiles.length, 0)
    const audit = deps.store.audit.find((a) => a.action === 'project.file_deleted')
    assert.deepEqual(audit.oldValue, { attachments: 'a.pdf' })
    assert.equal(await codeOf(() => files.deleteFile(ctx.gabi, file.id)), 'PROJECT_FILE_NOT_FOUND')

    const [own] = await files.uploadFiles(ctx.ana, project.id, [upload('b.pdf', PDF)])
    assert.equal(await codeOf(() => files.deleteFile(ctx.ana, own.id)), 'OK')
  })

  it('lista: mais recentes primeiro; o projeto informa se a pessoa pode enviar', async () => {
    const { files, projects, ctx, project } = await setup()
    await files.uploadFiles(ctx.mario, project.id, [upload('primeiro.pdf', PDF)])
    await files.uploadFiles(ctx.mario, project.id, [upload('segundo.pdf', PDF)])
    assert.deepEqual((await files.listFiles(ctx.mario, project.id)).map((f) => f.name), ['segundo.pdf', 'primeiro.pdf'])
    assert.equal((await projects.getProject(ctx.mario, project.id)).capabilities.upload_files, true)
    assert.equal((await projects.getProject(ctx.lia, project.id)).capabilities.upload_files, false)
  })
})
