/**
 * Configurador geral — API contra um PocketBase real e isolado: permissão própria, limites, prévia e
 * limpeza do histórico (com registros antigos semeados por uma migration do teste), bloqueio e senha
 * pela política, identidade pública (logo/ícone com tipo conferido, SVG perigoso recusado).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startPocketBase, createClient } = require('../support/pb-harness')

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

/** Três registros de 2020 no histórico (a API não cria registros com data antiga). */
const OLD_AUDIT = {
  name: '1799999999_test_old_audit.js',
  content: [
    'migrate((app) => {',
    "  const collection = app.findCollectionByNameOrId('audit_logs')",
    '  for (let i = 0; i < 3; i++) {',
    '    const record = new Record(collection)',
    "    record.set('entity_type', 'task')",
    "    record.set('entity_id', 'antigo' + i)",
    "    record.set('action', 'test.old')",
    '    app.save(record)',
    '  }',
    "  app.db().newQuery(\"UPDATE audit_logs SET created = '2020-01-01 00:00:00.000Z' WHERE action = 'test.old'\").execute()",
    '}, () => {})',
    '',
  ].join('\n'),
}

describe('API Configurador geral', { timeout: 180000 }, () => {
  let pb
  let root
  let admin
  let gestor
  let roles

  before(async () => {
    pb = await startPocketBase(undefined, { extraMigrations: [OLD_AUDIT] })
    root = createClient(pb.api)
    await root.login(pb.admin.email, pb.admin.password)
    roles = (await root.get('/roles')).body.data
    const make = async (email, role) => {
      const created = await root.post('/users', { name: email.split('@')[0], email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === role).id })
      assert.equal(created.status, 201, JSON.stringify(created.body))
      const client = createClient(pb.api)
      await client.login(email, 'SenhaTeste123')
      return client
    }
    admin = await make('admin2@example.com', 'ADMIN')
    gestor = await make('gestor@example.com', 'MANAGER')
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('identidade pública sem login; configurações só com platform.manage (Admin sim, Gestor não)', async () => {
    const anon = createClient(pb.api)
    const info = await anon.get('/platform')
    assert.equal(info.status, 200)
    assert.deepEqual(info.body.data, { name: 'Avanza', logo_light_url: null, logo_dark_url: null, favicon_url: null, password_reset: false })

    assert.equal((await anon.get('/settings/platform')).status, 401)
    assert.equal((await gestor.get('/settings/platform')).status, 403)
    assert.equal((await gestor.patch('/settings/platform', { platform_name: 'X' })).status, 403)
    const view = await admin.get('/settings/platform')
    assert.equal(view.status, 200, JSON.stringify(view.body))
    assert.equal(view.body.data.values.audit_retention_months, 3)
    assert.deepEqual(view.body.data.retention_options, [1, 3, 6, 12, 24, 0])
    const catalog = (await root.get('/permissions')).body.data
    assert.ok(catalog.some((p) => p.code === 'platform.manage'))
  })

  it('rota pública com sessão vencida não mexe no cookie (o /auth/me em paralelo ainda responde SESSION_EXPIRED)', async () => {
    const stale = { headers: { Cookie: 'kb_session=token-que-nao-existe' } }
    const info = await createClient(pb.api).get('/platform', stale)
    assert.equal(info.status, 200)
    assert.equal(info.setCookie, null)
    const me = await createClient(pb.api).get('/auth/me', stale)
    assert.equal(me.status, 401)
    assert.equal(me.body.error.code, 'SESSION_EXPIRED')
    assert.match(me.setCookie, /kb_session=;/)
  })

  it('alterar valida os limites, grava, registra no histórico e o nome aparece na rota pública', async () => {
    const bad = await admin.patch('/settings/platform', { lockout_threshold: 1, platform_name: '' })
    assert.equal(bad.status, 400)
    assert.deepEqual(bad.body.error.details.fields, { lockout_threshold: 'too_small', platform_name: 'required' })
    const ok = await admin.patch('/settings/platform', { platform_name: 'Portal da Obra' })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(ok.body.data.values.platform_name, 'Portal da Obra')
    assert.equal((await createClient(pb.api).get('/platform')).body.data.name, 'Portal da Obra')
    const history = (await root.get('/audit-logs?entity_type=platform_settings')).body.data
    assert.equal(history[0].action, 'platform_settings.update')
    assert.deepEqual(history[0].new_value, { platform_name: 'Portal da Obra' })
  })

  it('retenção: a prévia conta o que sairia; a limpeza apaga só o que passou do prazo', async () => {
    const preview = await admin.patch('/settings/platform', { audit_retention_months: 1, dry_run: true })
    assert.equal(preview.status, 200, JSON.stringify(preview.body))
    assert.deepEqual(preview.body.data, { dry_run: true, audit_to_delete: 3 })
    assert.equal((await admin.get('/settings/platform')).body.data.values.audit_retention_months, 3)

    const run = await admin.post('/settings/platform/purge-audit')
    assert.equal(run.status, 200, JSON.stringify(run.body))
    assert.equal(run.body.data.removed, 3)
    assert.equal((await root.get('/audit-logs?action=test.old')).body.data.length, 0)
    const purge = (await root.get('/audit-logs?action=audit_log.purge')).body.data
    assert.equal(purge.length, 1)
    assert.equal(purge[0].new_value.removed, 3)
    assert.equal((await gestor.post('/settings/platform/purge-audit')).status, 403)
  })

  it('senha e bloqueio seguem a política configurada', async () => {
    const set = await admin.patch('/settings/platform', { password_min_length: 12, password_require_symbol: true, lockout_threshold: 3 })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.deepEqual((await gestor.get('/auth/password-policy')).body.data, {
      min_length: 12,
      max_length: 72,
      require_letters_numbers: true,
      require_mixed_case: false,
      require_symbol: true,
    })
    assert.equal((await createClient(pb.api).get('/auth/password-policy')).status, 401)
    const weak = await root.post('/users', { name: 'Bia', email: 'bia@example.com', password: 'SemSimbolo1234', role_id: roles.find((r) => r.code === 'MEMBER').id })
    assert.equal(weak.status, 400)
    assert.equal(weak.body.error.details.fields.password, 'needs_symbol')

    const client = createClient(pb.api)
    for (let i = 0; i < 3; i++) assert.equal((await client.login('gestor@example.com', `errada${i}xxxxx`)).body.error.code, 'INVALID_CREDENTIALS')
    assert.equal((await client.login('gestor@example.com', 'SenhaTeste123')).body.error.code, 'ACCOUNT_LOCKED')
  })

  it('logo e ícone: PNG aceito e servido sem login com nosniff/CSP; SVG perigoso recusado; remover', async () => {
    const form = new FormData()
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'marca.png')
    const up = await admin.post('/settings/platform/branding/logo_light', form)
    assert.equal(up.status, 200, JSON.stringify(up.body))
    assert.equal(up.body.data.branding.logo_light.name, 'marca.png')

    const info = (await createClient(pb.api).get('/platform')).body.data
    assert.match(info.logo_light_url, /^\/api\/v1\/platform\/branding\/logo_light\?v=\d+$/)
    const file = await fetch(`${pb.baseUrl}${info.logo_light_url}`)
    assert.equal(file.status, 200)
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff')
    assert.match(file.headers.get('content-security-policy'), /sandbox/)
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG)
    assert.equal((await fetch(`${pb.baseUrl}/api/v1/platform/branding/favicon`)).status, 404)

    const svg = new FormData()
    svg.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 'm.svg')
    const unsafe = await admin.post('/settings/platform/branding/logo_dark', svg)
    assert.equal(unsafe.status, 400)
    assert.equal(unsafe.body.error.details.fields.file, 'unsafe_svg')

    const fake = new FormData()
    fake.append('file', new Blob(['não sou png'], { type: 'image/png' }), 'x.png')
    assert.equal((await admin.post('/settings/platform/branding/favicon', fake)).body.error.details.fields.file, 'type_mismatch')

    const removed = await admin.del('/settings/platform/branding/logo_light')
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    assert.equal(removed.body.data.branding.logo_light, null)
    assert.equal((await createClient(pb.api).get('/platform')).body.data.logo_light_url, null)
  })
})
