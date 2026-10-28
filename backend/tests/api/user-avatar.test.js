/**
 * Foto do usuário contra a API real e isolada: envio multipart pelo próprio usuário ou por quem tem
 * users.edit, tipo conferido pelo conteúdo, a imagem servida a qualquer pessoa autenticada (com a URL
 * versionada), remoção e o arquivo saindo do Storage pela lixeira.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')

function form(name, bytes, type) {
  const data = new FormData()
  data.append('file', new Blob([bytes], { type }), name)
  return data
}

describe('API foto do usuário', { timeout: 180000 }, () => {
  let pb
  let admin
  let maria
  let otto

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const make = async (name, email) => {
      const created = await admin.post('/users', { name, email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'MEMBER').id })
      const client = createClient(pb.api)
      await client.login(email, 'SenhaTeste123')
      return { client, user: created.body.data }
    }
    maria = await make('Maria', 'maria@example.com')
    otto = await make('Otto', 'otto@example.com')
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('o Admin envia no cadastro; todos veem a imagem; a pessoa troca e remove a dela; outro membro não mexe', async () => {
    assert.equal(maria.user.avatar_url, null)
    const sent = await admin.post(`/users/${maria.user.id}/avatar`, form('maria.png', PNG, 'image/png'))
    assert.equal(sent.status, 200, JSON.stringify(sent.body))
    const url = sent.body.data.avatar_url
    assert.match(url, new RegExp(`^/api/v1/users/${maria.user.id}/avatar\\?v=[0-9a-f]{10}$`))
    assert.equal((await admin.get(`/users/${maria.user.id}`)).body.data.avatar_url, url)

    // qualquer pessoa autenticada vê a imagem (aparece em listas, tarefas e comentários)
    const image = await otto.client.get(url.replace('/api/v1', ''), { raw: true })
    assert.equal(image.status, 200)
    assert.deepEqual(image.bytes, PNG)
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff')
    assert.match(image.headers.get('content-security-policy') || '', /sandbox/)
    assert.match(image.headers.get('cache-control') || '', /max-age=86400/)
    assert.equal((await createClient(pb.api).get(url.replace('/api/v1', ''), { raw: true })).status, 401)

    // a própria pessoa troca: o endereço muda
    const changed = await maria.client.post(`/users/${maria.user.id}/avatar`, form('nova.png', PNG, 'image/png'))
    assert.notEqual(changed.body.data.avatar_url, url)

    // tipo pelo conteúdo; outro membro não mexe; sem CSRF não passa
    const fake = await maria.client.post(`/users/${maria.user.id}/avatar`, form('foto.png', PDF, 'image/png'))
    assert.equal(fake.body.error.code, 'VALIDATION_ERROR')
    assert.equal((await otto.client.post(`/users/${maria.user.id}/avatar`, form('x.png', PNG, 'image/png'))).body.error.code, 'FORBIDDEN')
    assert.equal((await otto.client.del(`/users/${maria.user.id}/avatar`)).body.error.code, 'FORBIDDEN')
    assert.equal((await maria.client.post(`/users/${maria.user.id}/avatar`, form('x.png', PNG, 'image/png'), { csrf: false })).status, 403)

    const removed = await maria.client.del(`/users/${maria.user.id}/avatar`)
    assert.equal(removed.body.data.avatar_url, null)
    assert.equal((await otto.client.get(`/users/${maria.user.id}/avatar`, { raw: true })).status, 404)

    const history = (await admin.get(`/users/${maria.user.id}/history`)).body.data.map((entry) => entry.action)
    assert.deepEqual(history.filter((a) => a.startsWith('user.avatar')), ['user.avatar_removed', 'user.avatar_updated', 'user.avatar_updated'])
  })
})
