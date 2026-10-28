/**
 * Carga (Fase 9): 1.500 tarefas num projeto (com relações e subtarefas) e os endpoints mais
 * pesados medidos contra um PocketBase real. Limites folgados para máquina de desenvolvimento;
 * o objetivo é pegar regressões grosseiras (N+1, falta de índice, carga de tudo na memória).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 100000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 100000 },
]
const TOTAL = 1500
const LIMIT_MS = 2000

async function pool(items, size, fn) {
  let index = 0
  const workers = Array.from({ length: size }, async () => {
    while (index < items.length) {
      const item = items[index++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

describe('API — carga', { timeout: 600000 }, () => {
  let pb
  let admin
  let project
  const timings = {}

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    project = (await admin.post('/projects', { name: 'Carga', key: 'LOAD' })).body.data
    const doc = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
    const statuses = (await admin.get('/statuses')).body.data
    const ids = []
    await pool(
      Array.from({ length: TOTAL }, (_, i) => i),
      12,
      async (i) => {
        const status = statuses[i % statuses.length]
        const res = await admin.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: `Tarefa de carga ${i}`, status_id: status.id, due_date: i % 7 === 0 ? '2020-01-01' : undefined })
        if (res.status !== 201) throw new Error(JSON.stringify(res.body))
        ids.push(res.body.data.id)
      },
    )
    // algumas relações e subtarefas para exercitar "bloqueada" e progresso
    await pool(
      Array.from({ length: 150 }, (_, i) => i),
      8,
      async (i) => {
        await admin.post(`/tasks/${ids[i]}/relations`, { type: 'blocks', target_id: ids[i + 200] })
        await admin.patch(`/tasks/${ids[i + 400]}`, { parent_task_id: ids[i + 600] })
      },
    )
  })

  after(async () => {
    if (pb) await pb.stop()
    console.log('tempos (ms):', JSON.stringify(timings))
  })

  async function measure(name, path) {
    // primeira chamada aquece caches do SQLite; mede a segunda
    await admin.get(path)
    const start = Date.now()
    const res = await admin.get(path)
    const ms = Date.now() - start
    timings[name] = ms
    assert.equal(res.status, 200, `${name}: ${JSON.stringify(res.body).slice(0, 200)}`)
    assert.ok(ms < LIMIT_MS, `${name} levou ${ms} ms (limite ${LIMIT_MS})`)
    return res.body
  }

  it('lista paginada, busca e ordenação', async () => {
    const page = await measure('tasks', `/tasks?project_id=${project.id}&perPage=50&sort=-updated_at`)
    assert.equal(page.meta.total, TOTAL)
    await measure('search', `/tasks?project_id=${project.id}&perPage=50&search=carga%2014`)
    await measure('sortPriority', `/tasks?perPage=100&sort=priority`)
  })

  it('quadro, planejamento e relatórios', async () => {
    const board = await measure('board', `/projects/${project.id}/board`)
    assert.ok(board.data.columns.length > 0)
    await measure('backlog', `/projects/${project.id}/backlog`)
    const report = await measure('reports', `/reports?project_id=${project.id}&group_by=status`)
    assert.equal(report.data.indicators.total, TOTAL)
    assert.ok(report.data.indicators.blocked > 0)
  })
})
