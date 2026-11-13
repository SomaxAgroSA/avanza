const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createProjectService } = require('../../src/application/projects')
const { createPrincipal } = require('../../src/domain/rbac')

async function ctxOf(deps, user) {
  const role = await deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

async function setup() {
  const deps = createFakeDeps()
  const projects = createProjectService(deps)
  const ana = await seedUser(deps, { name: 'Angelica', roleCode: 'MANAGER' })
  const douglas = await seedUser(deps, { name: 'Douglas', roleCode: 'MEMBER' })
  const lia = await seedUser(deps, { name: 'Lia', roleCode: 'MEMBER' })
  return { deps, projects, users: { ana, douglas, lia }, ctx: { ana: await ctxOf(deps, ana) } }
}

describe('application/projects — responsável pelo desenvolvimento', () => {
  it('nasce vazio; separado do responsável do projeto; leitor ou de fora não; null limpa; histórico com os nomes', async () => {
    const { deps, projects, users, ctx } = await setup()
    const created = await projects.createProject(ctx.ana, { name: 'DRE', key: 'DRE' })
    assert.equal(created.dev_lead, null)
    assert.equal(created.lead.id, users.ana.id)
    await projects.addMember(ctx.ana, created.id, { user_id: users.douglas.id, role: 'member' })
    await projects.addMember(ctx.ana, created.id, { user_id: users.lia.id, role: 'viewer' })

    const updated = await projects.updateProject(ctx.ana, created.id, { dev_lead_id: users.douglas.id })
    assert.equal(updated.dev_lead.name, 'Douglas')
    assert.equal(updated.lead.name, 'Angelica', 'a gestão continua com quem era responsável')
    assert.equal(updated.owner.id, users.ana.id, 'o dono não muda')
    const entry = deps.store.audit.filter((e) => e.action === 'project.updated').pop()
    assert.deepEqual([entry.oldValue.dev_lead, entry.newValue.dev_lead], [null, 'Douglas'])
    assert.equal(entry.newValue.lead, undefined, 'só o campo que mudou entra no histórico')

    await assert.rejects(() => projects.updateProject(ctx.ana, created.id, { dev_lead_id: users.lia.id }), (err) => err.details.fields.dev_lead_id === 'not_a_member')
    const outsider = await seedUser(deps, { name: 'Otto', roleCode: 'MEMBER' })
    await assert.rejects(() => projects.updateProject(ctx.ana, created.id, { dev_lead_id: outsider.id }), (err) => err.details.fields.dev_lead_id === 'not_a_member')

    const cleared = await projects.updateProject(ctx.ana, created.id, { dev_lead_id: null })
    assert.equal(cleared.dev_lead, null)
    assert.equal(cleared.lead.name, 'Angelica')
  })

  it('quem é o responsável pelo desenvolvimento e sai do projeto deixa o campo vazio (a gestão não muda)', async () => {
    const { deps, projects, users, ctx } = await setup()
    const p = await projects.createProject(ctx.ana, { name: 'FUP', key: 'FUP' })
    await projects.addMember(ctx.ana, p.id, { user_id: users.douglas.id, role: 'member' })
    await projects.updateProject(ctx.ana, p.id, { dev_lead_id: users.douglas.id })
    await projects.removeMember(ctx.ana, p.id, users.douglas.id)
    const after = await projects.getProject(ctx.ana, p.id)
    assert.equal(after.dev_lead, null)
    assert.equal(after.lead.id, users.ana.id)
    const entry = deps.store.audit.filter((e) => e.action === 'project.updated').pop()
    assert.deepEqual([entry.oldValue.dev_lead, entry.newValue.dev_lead], ['Douglas', null])
    assert.equal(entry.oldValue.lead, undefined)
  })

  it('quem era responsável pelos dois e sai: a gestão volta ao dono e o desenvolvimento fica vazio, num registro só', async () => {
    const { deps, projects, users, ctx } = await setup()
    const p = await projects.createProject(ctx.ana, { name: 'GCS', key: 'GCS' })
    await projects.addMember(ctx.ana, p.id, { user_id: users.douglas.id, role: 'manager' })
    await projects.updateProject(ctx.ana, p.id, { lead_id: users.douglas.id, dev_lead_id: users.douglas.id })
    const before = deps.store.audit.filter((e) => e.action === 'project.updated').length
    await projects.removeMember(ctx.ana, p.id, users.douglas.id)
    const after = await projects.getProject(ctx.ana, p.id)
    assert.equal(after.lead.id, users.ana.id)
    assert.equal(after.dev_lead, null)
    const entries = deps.store.audit.filter((e) => e.action === 'project.updated')
    assert.equal(entries.length, before + 1)
    assert.deepEqual(entries.pop().newValue, { lead: 'Angelica', dev_lead: null })
  })

  it('a lista traz o responsável pelo desenvolvimento e ordena por ele (vazios no fim, como no Postgres)', async () => {
    const { projects, users, ctx } = await setup()
    const a = await projects.createProject(ctx.ana, { name: 'Alfa', key: 'ALF' })
    await projects.createProject(ctx.ana, { name: 'Beta', key: 'BET' })
    await projects.addMember(ctx.ana, a.id, { user_id: users.douglas.id, role: 'member' })
    await projects.updateProject(ctx.ana, a.id, { dev_lead_id: users.douglas.id })
    const list = await projects.listProjects(ctx.ana, { sort: 'dev_lead' })
    assert.deepEqual(
      list.items.map((p) => [p.key, p.dev_lead && p.dev_lead.name]),
      [
        ['ALF', 'Douglas'],
        ['BET', null],
      ],
    )
  })
})
