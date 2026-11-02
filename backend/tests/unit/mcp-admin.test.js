const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { validateArguments } = require('../../src/mcp/schema')
const { TOOLS: BASE_TOOLS } = require('../../src/mcp/tools')
const { TOOLS: CONFIG_TOOLS } = require('../../src/mcp/catalog/config')
const { TOOLS: ADMIN_TOOLS } = require('../../src/mcp/catalog/admin')

const TOOLS = CONFIG_TOOLS.concat(ADMIN_TOOLS)

describe('mcp/catalog config e admin', () => {
  const ctx = { principal: { userId: 'u1' } }

  /** Serviços falsos: guardam as chamadas e devolvem o que o teste pedir. */
  function spyServices(returns) {
    const calls = []
    const handler = (service) =>
      new Proxy(
        {},
        {
          get: (_, method) => async (...args) => {
            calls.push({ service, method, args: args.slice(1) })
            const value = (returns || {})[`${service}.${method}`]
            return typeof value === 'function' ? value(...args.slice(1)) : value
          },
        },
      )
    return { calls, services: new Proxy({}, { get: (_, service) => handler(service) }) }
  }
  const byName = (name) => {
    const tool = TOOLS.find((t) => t.name === name)
    assert.ok(tool, name)
    return tool
  }
  const run = async (name, args, returns) => {
    const spy = spyServices(returns)
    const out = await byName(name).run(args, { services: spy.services, ctx })
    return { calls: spy.calls, out }
  }

  it('catálogo: nomes únicos (também no catálogo principal), descrições, esquemas fechados e anotações coerentes', () => {
    const names = TOOLS.map((t) => t.name)
    assert.equal(new Set(names).size, names.length)
    const all = BASE_TOOLS.map((t) => t.name)
    names.forEach((name) => assert.equal(all.filter((n) => n === name).length, 1, `${name} repetido no catálogo principal`))
    TOOLS.forEach((tool) => {
      assert.match(tool.name, /^[a-z][a-z_]{2,40}$/, tool.name)
      assert.ok(tool.title && tool.description.length > 20, tool.name)
      assert.match(tool.description, /Requires [a-z_]+\.[a-z_]+/, `${tool.name} sem a permissão na descrição`)
      assert.equal(tool.inputSchema.type, 'object', tool.name)
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name)
      ;(tool.inputSchema.required || []).forEach((key) => assert.ok(tool.inputSchema.properties[key], `${tool.name}.${key}`))
      Object.keys(tool.inputSchema.properties).forEach((key) => assert.ok(tool.inputSchema.properties[key].description, `${tool.name}.${key} sem descrição`))
      assert.equal(tool.annotations.readOnlyHint, /^(get|list|find|search|whoami)/.test(tool.name), tool.name)
      assert.equal(tool.annotations.openWorldHint, false, tool.name)
      assert.equal(typeof tool.run, 'function')
      const confirms = tool.description.endsWith('Confirm with the user first.')
      if (/^delete_/.test(tool.name)) assert.ok(confirms && tool.annotations.destructiveHint, tool.name)
    })
    ;['purge_audit_logs', 'set_user_status', 'reset_user_password', 'delete_role'].forEach((name) => {
      assert.ok(byName(name).description.endsWith('Confirm with the user first.'), name)
      assert.equal(byName(name).annotations.destructiveHint, true, name)
    })
  })

  it('status: listar com inativos, o id sai do corpo e a reordenação leva a lista de ids', async () => {
    const { calls } = await run('list_statuses', { include_inactive: true })
    assert.deepEqual(calls[0], { service: 'statuses', method: 'list', args: [{ include_inactive: '1' }] })
    assert.deepEqual((await run('list_statuses', {})).calls[0].args, [{}])

    const update = await run('update_status', { status_id: 's1', wip_limit: 3, allowed_next: ['s2'] })
    assert.deepEqual(update.calls[0], { service: 'statuses', method: 'update', args: ['s1', { wip_limit: 3, allowed_next: ['s2'] }] })

    const reorder = await run('reorder_statuses', { ids: ['s2', 's1'] })
    assert.deepEqual(reorder.calls[0], { service: 'statuses', method: 'reorder', args: [['s2', 's1']] })

    const remove = await run('delete_priority', { priority_id: 'p1' })
    assert.deepEqual(remove.calls[0], { service: 'priorities', method: 'delete', args: ['p1'] })
  })

  it('áreas: sem padrão no esquema, o id sai do corpo e a reordenação leva a lista de ids', async () => {
    assert.deepEqual((await run('list_areas', { include_inactive: true })).calls[0], { service: 'areas', method: 'list', args: [{ include_inactive: '1' }] })
    assert.deepEqual(validateArguments({ key: 'TI', name: 'Dpto. TI', is_default: true }, byName('create_area').inputSchema), { is_default: 'unknown_field' })
    const create = await run('create_area', { key: 'TI', name: 'Dpto. TI', color: 'blue' })
    assert.deepEqual(create.calls[0], { service: 'areas', method: 'create', args: [{ key: 'TI', name: 'Dpto. TI', color: 'blue' }] })
    const update = await run('update_area', { area_id: 'a1', is_active: false })
    assert.deepEqual(update.calls[0], { service: 'areas', method: 'update', args: ['a1', { is_active: false }] })
    assert.deepEqual((await run('delete_area', { area_id: 'a1' })).calls[0], { service: 'areas', method: 'delete', args: ['a1'] })
    assert.deepEqual((await run('reorder_areas', { ids: ['a2', 'a1'] })).calls[0], { service: 'areas', method: 'reorder', args: [['a2', 'a1']] })
  })

  it('tipos de tarefa: campos do tipo, reordenação e histórico paginado', async () => {
    const fields = [{ field_id: 'f1', required: false, required_status_ids: ['s3'] }]
    assert.deepEqual(validateArguments({ task_type_id: 't1', fields }, byName('set_task_type_fields').inputSchema), {})
    assert.deepEqual(validateArguments({ task_type_id: 't1', fields: [{ required: true }] }, byName('set_task_type_fields').inputSchema), { fields: 'invalid_type' })
    const set = await run('set_task_type_fields', { task_type_id: 't1', fields })
    assert.deepEqual(set.calls[0], { service: 'taskTypes', method: 'setTypeFields', args: ['t1', fields] })

    const reorder = await run('reorder_task_types', { ids: ['t2', 't1'] })
    assert.deepEqual(reorder.calls[0], { service: 'taskTypes', method: 'reorderTypes', args: [['t2', 't1']] })

    const translations = { en: { name: 'Bug' }, es: null }
    assert.deepEqual(validateArguments({ task_type_id: 't1', translations }, byName('update_task_type').inputSchema), {})
    assert.deepEqual(validateArguments({ task_type_id: 't1', translations: { fr: { name: 'x' } } }, byName('update_task_type').inputSchema), { translations: 'invalid_type' })

    const meta = { page: 2, perPage: 10, total: 11, totalPages: 2 }
    const history = await run('get_task_type_history', { task_type_id: 't1', page: 2, per_page: 10 }, { 'audit.listEntityHistory': { items: [{ id: 'a1' }], meta } })
    assert.deepEqual(history.calls[0], { service: 'audit', method: 'listEntityHistory', args: ['task_type', 't1', { page: 2, perPage: 10 }] })
    assert.deepEqual(history.out, { items: [{ id: 'a1' }], meta })
  })

  it('campos e tags: filtros, opção nova e o id fora do corpo', async () => {
    assert.deepEqual((await run('list_custom_fields', { type: 'select' })).calls[0].args, [{ type: 'select' }])
    const option = await run('add_custom_field_option', { field_id: 'f1', label: 'Novo' })
    assert.deepEqual(option.calls[0], { service: 'customFields', method: 'addOption', args: ['f1', { label: 'Novo' }] })
    const update = await run('update_custom_field', { field_id: 'f1', label: 'Versão', options: [{ id: 'o1', label: 'A' }] })
    assert.deepEqual(update.calls[0].args, ['f1', { label: 'Versão', options: [{ id: 'o1', label: 'A' }] }])
    assert.deepEqual(validateArguments({ field_id: 'f1', config: { colunas: 2 } }, byName('update_custom_field').inputSchema), { config: 'invalid_type' })
    const tag = await run('update_tag', { tag_id: 'g1', color: 'red' })
    assert.deepEqual(tag.calls[0], { service: 'tags', method: 'updateTag', args: ['g1', { color: 'red' }] })
  })

  it('usuários: convite na criação, filtros no formato da API, status e senha', async () => {
    const create = await run('create_user', { name: 'Ana', email: 'ana@x.com', role_id: 'r1', send_invite: true })
    assert.deepEqual(create.calls[0], { service: 'users', method: 'createUser', args: [{ name: 'Ana', email: 'ana@x.com', role_id: 'r1', send_invite: true }] })

    const list = await run('list_users', { status: 'disabled', per_page: 5 }, { 'users.listUsers': { items: [], meta: { page: 1 } } })
    assert.deepEqual(list.calls[0].args, [{ status: 'disabled', perPage: 5 }])
    assert.deepEqual(list.out, { items: [], meta: { page: 1 } })

    const status = await run('set_user_status', { user_id: 'u2', status: 'disabled' })
    assert.deepEqual(status.calls[0], { service: 'users', method: 'changeUserStatus', args: ['u2', 'disabled'] })
    assert.deepEqual(validateArguments({ user_id: 'u2', status: 'blocked' }, byName('set_user_status').inputSchema), { status: 'invalid_option' })

    const reset = await run('reset_user_password', { user_id: 'u2', password: 'Senha1234' })
    assert.deepEqual(reset.calls[0], { service: 'users', method: 'resetPassword', args: ['u2', { password: 'Senha1234' }] })

    const update = await run('update_user', { user_id: 'u2', role_id: 'r2' })
    assert.deepEqual(update.calls[0], { service: 'users', method: 'updateUser', args: ['u2', { role_id: 'r2' }] })

    const invite = await run('resend_user_invite', { user_id: 'u2' })
    assert.deepEqual(invite.calls[0], { service: 'accountLinks', method: 'resendInvite', args: ['u2'] })
  })

  it('perfis: permissões do catálogo e a lista inteira no lugar da atual', async () => {
    const set = await run('set_role_permissions', { role_id: 'r1', permissions: ['tasks.view', 'tasks.edit'] })
    assert.deepEqual(set.calls[0], { service: 'roles', method: 'updateRolePermissions', args: ['r1', ['tasks.view', 'tasks.edit']] })
    assert.deepEqual(validateArguments({ role_id: 'r1', permissions: ['tasks.fly'] }, byName('set_role_permissions').inputSchema), { permissions: 'invalid_type' })
    const update = await run('update_role', { role_id: 'r1', name: 'QA' })
    assert.deepEqual(update.calls[0], { service: 'roles', method: 'updateRole', args: ['r1', { name: 'QA' }] })
  })

  it('auditoria e Configurador geral: filtros, dry_run e limpeza', async () => {
    const audit = await run('list_audit_logs', { action: 'user.disabled', from: '2026-10-01', page: 3 }, { 'audit.listAuditLogs': { items: [], meta: {} } })
    assert.deepEqual(audit.calls[0], { service: 'audit', method: 'listAuditLogs', args: [{ action: 'user.disabled', from: '2026-10-01', page: 3 }] })

    const preview = await run('update_platform_settings', { audit_retention_months: 1, dry_run: true })
    assert.deepEqual(preview.calls[0], { service: 'platformSettings', method: 'updateSettings', args: [{ audit_retention_months: 1, dry_run: true }] })
    assert.deepEqual(validateArguments({ audit_retention_months: 2 }, byName('update_platform_settings').inputSchema), { audit_retention_months: 'invalid_option' })
    assert.deepEqual(validateArguments({ password_min_length: 4 }, byName('update_platform_settings').inputSchema), { password_min_length: 'too_small' })

    const purge = await run('purge_audit_logs', {})
    assert.deepEqual(purge.calls[0], { service: 'platformSettings', method: 'runRetentionNow', args: [] })
  })

  it('e-mail: a senha do SMTP fica de fora e o teste vai para o caso de uso', async () => {
    const schema = byName('update_email_settings').inputSchema
    assert.deepEqual(validateArguments({ host: 'smtp.x.com', password: 'segredo' }, schema), { password: 'unknown_field' })
    const update = await run('update_email_settings', { enabled: true, port: 465, tls: true })
    assert.deepEqual(update.calls[0], { service: 'email', method: 'updateSettings', args: [{ enabled: true, port: 465, tls: true }] })
    const test = await run('send_test_email', { to: 'ana@x.com' })
    assert.deepEqual(test.calls[0], { service: 'email', method: 'sendTest', args: [{ to: 'ana@x.com' }] })
  })

  it('webhooks e tokens: eventos do catálogo, id fora do corpo, reenvio e lista de todos', async () => {
    const schema = byName('create_webhook').inputSchema
    assert.deepEqual(validateArguments({ name: 'CI', url: 'https://ci.x.com/hook', events: ['task.*', 'project.created'] }, schema), {})
    assert.deepEqual(validateArguments({ name: 'CI', url: 'https://ci.x.com/hook', events: ['nada.feito'] }, schema), { events: 'invalid_type' })
    const update = await run('update_webhook', { webhook_id: 'w1', active: false })
    assert.deepEqual(update.calls[0], { service: 'webhooks', method: 'update', args: ['w1', { active: false }] })
    const redeliver = await run('redeliver_webhook', { delivery_id: 'd1' })
    assert.deepEqual(redeliver.calls[0], { service: 'webhooks', method: 'redeliver', args: ['d1'] })
    const tokens = await run('list_api_tokens', {})
    assert.deepEqual(tokens.calls[0], { service: 'apiTokens', method: 'listAll', args: [] })
    assert.equal(TOOLS.some((t) => /revoke|reveal|create_api_token/.test(t.name)), false)
  })
})
