/**
 * Anexos — testes de API contra um PocketBase real (upload multipart, validação por conteúdo, download protegido).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

/** PNG 1x1 válido. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')

function form(files, field) {
  const data = new FormData()
  files.forEach(([name, bytes, type]) => data.append('files', new Blob([bytes], { type: type || 'application/octet-stream' }), name))
  if (field) data.append('field', field)
  return data
}

describe('API /api/v1/tasks/{id}/attachments', { timeout: 180000 }, () => {
  let pb
  let admin
  let member
  let viewer
  let outsider
  let task

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const make = async (name, email) => {
      const created = await admin.post('/users', { name, email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'MEMBER').id })
      const client = createClient(pb.api)
      await client.login(email, 'SenhaTeste123')
      return { client, user: created.body.data }
    }
    member = await make('Mário', 'mario@example.com')
    viewer = await make('Lia', 'lia@example.com')
    outsider = await make('Otto', 'otto@example.com')
    const project = (await admin.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: member.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: viewer.user.id, role: 'viewer' })
    const doc = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
    task = (await member.client.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Manual' })).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('anexa imagem e PDF; tipo pelo conteúdo; contagem na tarefa', async () => {
    const res = await member.client.post(`/tasks/${task.id}/attachments`, form([['tela.png', PNG, 'image/png'], ['manual.pdf', PDF, 'application/pdf']]))
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.deepEqual(res.body.data.map((a) => [a.name, a.mime, a.kind, a.size]), [
      ['tela.png', 'image/png', 'image', PNG.length],
      ['manual.pdf', 'application/pdf', 'document', PDF.length],
    ])
    assert.equal((await member.client.get('/tasks')).body.data[0].attachment_count, 2)
    const history = (await member.client.get(`/tasks/${task.id}/history`)).body.data
    assert.deepEqual(history[0].new_value, { attachments: 'tela.png, manual.pdf' })
  })

  it('recusa extensão falsa, tipo proibido e conteúdo que o PocketBase não reconhece como permitido', async () => {
    const fake = await member.client.post(`/tasks/${task.id}/attachments`, form([['foto.png', PDF, 'image/png']]))
    assert.equal(fake.status, 400)
    assert.equal(fake.body.error.details.fields.files, 'type_mismatch')
    const svg = await member.client.post(`/tasks/${task.id}/attachments`, form([['logo.svg', Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml']]))
    assert.equal(svg.body.error.details.fields.files, 'unsupported_type')
    // parece texto para a primeira barreira, mas o PocketBase detecta HTML e recusa
    const html = await member.client.post(`/tasks/${task.id}/attachments`, form([['nota.txt', Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>'), 'text/plain']]))
    assert.equal(html.status, 400, JSON.stringify(html.body))
    assert.equal(html.body.error.details.fields.files, 'invalid_file')
    const empty = await member.client.post(`/tasks/${task.id}/attachments`, form([]))
    assert.equal(empty.body.error.details.fields.files, 'required')
    assert.equal((await member.client.get(`/tasks/${task.id}/attachments`)).body.data.length, 2)
  })

  it('download protegido: leitor baixa, estranho não; cabeçalhos de segurança', async () => {
    const [image] = (await viewer.client.get(`/tasks/${task.id}/attachments`)).body.data
    const file = await viewer.client.get(`/attachments/${image.id}/file`, { raw: true })
    assert.equal(file.status, 200)
    assert.ok(file.bytes.equals(PNG))
    assert.equal(file.headers.get('content-type'), 'image/png')
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff')
    assert.match(file.headers.get('content-security-policy') || '', /sandbox/)
    const download = await viewer.client.get(`/attachments/${image.id}/file?download=1`, { raw: true })
    assert.match(download.headers.get('content-disposition') || '', /attachment/)

    assert.equal((await outsider.client.get(`/attachments/${image.id}/file`)).body.error.code, 'ATTACHMENT_NOT_FOUND')
    const anonymous = createClient(pb.api)
    assert.equal((await anonymous.get(`/attachments/${image.id}/file`)).status, 401)
    // a API genérica do PocketBase não expõe o arquivo
    assert.equal((await anonymous.get(`/../api/collections/attachments/records`)).status >= 400, true)
  })

  it('leitora comenta com anexo; arquivo aparece no comentário e some ao excluir o comentário', async () => {
    const comment = (await viewer.client.post(`/tasks/${task.id}/comments`, { content: 'Segue o print' })).body.data
    const data = form([['print.png', PNG, 'image/png']])
    data.append('comment_id', comment.id)
    const up = await viewer.client.post(`/tasks/${task.id}/attachments`, data)
    assert.equal(up.status, 201, JSON.stringify(up.body))
    assert.equal(up.body.data[0].comment_id, comment.id)
    const [shown] = (await member.client.get(`/tasks/${task.id}/comments`)).body.data
    assert.deepEqual(shown.attachments.map((a) => a.name), ['print.png'])
    assert.equal((await member.client.get(`/attachments/${up.body.data[0].id}/file`, { raw: true })).status, 200)
    // não entra na aba de anexos da tarefa
    assert.equal((await member.client.get(`/tasks/${task.id}/attachments`)).body.data.some((a) => a.name === 'print.png'), false)
    // outra pessoa não anexa no comentário da leitora
    const other = form([['x.png', PNG]])
    other.append('comment_id', comment.id)
    assert.equal((await member.client.post(`/tasks/${task.id}/attachments`, other)).status, 403)

    assert.equal((await viewer.client.del(`/comments/${comment.id}`)).status, 200)
    assert.equal((await member.client.get(`/attachments/${up.body.data[0].id}/file`)).body.error.code, 'ATTACHMENT_NOT_FOUND')
  })

  it('leitor não anexa nem exclui; quem enviou exclui', async () => {
    assert.equal((await viewer.client.post(`/tasks/${task.id}/attachments`, form([['a.png', PNG]]))).status, 403)
    const [image] = (await member.client.get(`/tasks/${task.id}/attachments`)).body.data
    assert.equal((await viewer.client.del(`/attachments/${image.id}`)).status, 403)
    assert.equal((await member.client.del(`/attachments/${image.id}`)).status, 200)
    assert.equal((await member.client.get(`/tasks/${task.id}/attachments`)).body.data.length, 1)
  })
})
