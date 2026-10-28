/**
 * Arquivos do projeto (regras de negócio §22) contra a API real e isolada: envio multipart com o tipo
 * decidido pelo conteúdo, lista, download protegido, permissões (leitor, fora do projeto), exclusão,
 * projeto arquivado, histórico e o arquivo saindo do Storage pela lixeira.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')

function form(files) {
  const data = new FormData()
  files.forEach(([name, bytes, type]) => data.append('files', new Blob([bytes], { type: type || 'application/octet-stream' }), name))
  return data
}

describe('API arquivos do projeto', { timeout: 180000 }, () => {
  let pb
  let admin
  let member
  let viewer
  let outsider
  let project

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
    member = await make('Mário', 'mario@example.com')
    viewer = await make('Lia', 'lia@example.com')
    outsider = await make('Otto', 'otto@example.com')
    project = (await admin.post('/projects', { name: 'Portal', key: 'PORTAL' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: member.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: viewer.user.id, role: 'viewer' })
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('membro envia; tipo pelo conteúdo; lista e download para o leitor; fora do projeto não vê', async () => {
    assert.equal((await member.client.get(`/projects/${project.id}`)).body.data.capabilities.upload_files, true)
    assert.equal((await viewer.client.get(`/projects/${project.id}`)).body.data.capabilities.upload_files, false)

    const up = await member.client.post(`/projects/${project.id}/files`, form([['Contrato.pdf', PDF, 'application/pdf'], ['logo.png', PNG, 'image/png']]))
    assert.equal(up.status, 201, JSON.stringify(up.body))
    assert.deepEqual(up.body.data.map((f) => [f.name, f.kind, f.mime]), [
      ['Contrato.pdf', 'document', 'application/pdf'],
      ['logo.png', 'image', 'image/png'],
    ])
    const pdf = up.body.data[0]
    assert.equal(pdf.project_id, project.id)
    assert.equal(pdf.uploaded_by.id, member.user.id)
    assert.equal(pdf.url, `/api/v1/project-files/${pdf.id}/file`)

    const list = await viewer.client.get(`/projects/${project.id}/files`)
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.data.map((f) => f.name).sort(), ['Contrato.pdf', 'logo.png'])
    assert.ok(list.body.data.every((f) => f.capabilities.delete === false))

    const file = await viewer.client.get(`/project-files/${pdf.id}/file`, { raw: true })
    assert.equal(file.status, 200)
    assert.deepEqual(file.bytes, PDF)
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff')
    assert.match(file.headers.get('content-security-policy') || '', /sandbox/)
    const download = await viewer.client.get(`/project-files/${pdf.id}/file?download=1`, { raw: true })
    assert.match(download.headers.get('content-disposition') || '', /attachment/)

    assert.equal((await outsider.client.get(`/projects/${project.id}/files`)).status, 404)
    const hidden = await outsider.client.get(`/project-files/${pdf.id}/file`)
    assert.equal(hidden.status, 404)
    assert.equal(hidden.body.error.code, 'PROJECT_FILE_NOT_FOUND')
  })

  it('recusa: leitor não envia; conteúdo que não bate com a extensão; HTML disfarçado', async () => {
    assert.equal((await viewer.client.post(`/projects/${project.id}/files`, form([['a.pdf', PDF]]))).status, 403)
    const mismatch = await member.client.post(`/projects/${project.id}/files`, form([['foto.pdf', PNG]]))
    assert.equal(mismatch.status, 400)
    assert.equal(mismatch.body.error.details.fields.files, 'type_mismatch')
    const html = await member.client.post(`/projects/${project.id}/files`, form([['nota.txt', Buffer.from('<script>alert(1)</script>')]]))
    assert.equal(html.body.error.details.fields.files, 'invalid_file')
    const empty = await member.client.post(`/projects/${project.id}/files`, form([]))
    assert.equal(empty.status, 400)
  })

  it('excluir: quem enviou ou o gestor; vai para a lixeira do Storage; histórico do projeto', async () => {
    const [mine] = (await member.client.post(`/projects/${project.id}/files`, form([['ata.pdf', PDF]]))).body.data
    const [adminFile] = (await admin.post(`/projects/${project.id}/files`, form([['plano.pdf', PDF]]))).body.data
    assert.equal((await member.client.del(`/project-files/${adminFile.id}`)).status, 403)
    assert.equal((await member.client.del(`/project-files/${mine.id}`)).status, 200)
    assert.equal((await admin.del(`/project-files/${adminFile.id}`)).status, 200)
    assert.equal((await admin.get(`/project-files/${mine.id}/file`)).status, 404)
    const trash = await pb.query("SELECT key FROM storage_trash WHERE key LIKE 'project_files/%'")
    assert.ok(trash.some((row) => row.key.indexOf(`project_files/${mine.id}/`) === 0))

    const history = (await admin.get(`/projects/${project.id}/history`)).body.data.map((h) => h.action)
    assert.ok(history.includes('project.file_added'))
    assert.ok(history.includes('project.file_deleted'))
  })

  it('projeto arquivado: só leitura', async () => {
    const [kept] = (await admin.post(`/projects/${project.id}/files`, form([['fica.pdf', PDF]]))).body.data
    await admin.post(`/projects/${project.id}/archive`)
    assert.equal((await member.client.post(`/projects/${project.id}/files`, form([['x.pdf', PDF]]))).body.error.code, 'PROJECT_ARCHIVED')
    assert.equal((await admin.del(`/project-files/${kept.id}`)).body.error.code, 'PROJECT_ARCHIVED')
    assert.equal((await viewer.client.get(`/project-files/${kept.id}/file`, { raw: true })).status, 200)
  })
})
