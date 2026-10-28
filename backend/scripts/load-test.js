/**
 * Teste de carga (manual): sobe a API isolada (esquema novo no Supabase local), cria um cenário realista e mede vazão e
 * latência sob concorrência crescente. Uso: npm --prefix backend run load  (ou node scripts/load-test.js)
 *
 * Cenário: 30 pessoas, um projeto grande (400 tarefas, quadro de gestão com 60 elementos) e um pequeno.
 * Cada "usuário virtual" repete, sem pausa, uma mistura parecida com o uso real: Kanban, listas,
 * tarefa, comentários, sino, quadro da Gestão e ~10% de escritas (editar tarefa, comentar).
 *
 * Variáveis: LOAD_LEVELS=5,10,20,40,80  LOAD_SECONDS=20  LOAD_TASKS=400  KAMBAN_DB_POOL (conexões da API
 * com o Postgres; padrão 10, o mesmo da produção).
 */

const { startServer, createClient } = require('../tests/support/server-harness')

const LEVELS = (process.env.LOAD_LEVELS || '5,10,20,40,80').split(',').map(Number)
const SECONDS = Number(process.env.LOAD_SECONDS || 20)
const TASKS = Number(process.env.LOAD_TASKS || 400)
const USERS = 30
const PASSWORD = 'SenhaTeste123'

async function pool(items, size, fn) {
  let index = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (index < items.length) {
        const item = items[index++]
        await fn(item)
      }
    }),
  )
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function main() {
  const pb = await startServer()
  try {
    // rate limit alto: o teste mede o servidor, não o limitador
    await pb.updateSettings({ rateLimits: { enabled: false, rules: [] } })
    const admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const member = roles.find((r) => r.code === 'MEMBER').id
    const type = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO').id
    const big = (await admin.post('/projects', { name: 'Projeto grande', key: 'BIG' })).body.data
    const small = (await admin.post('/projects', { name: 'Projeto pequeno', key: 'SML' })).body.data

    console.log(`preparando: ${USERS} pessoas, ${TASKS} tarefas, quadro da Gestão…`)
    const people = []
    await pool(Array.from({ length: USERS }, (_, i) => i), 6, async (i) => {
      const email = `pessoa${i}@carga.test`
      const user = (await admin.post('/users', { name: `Pessoa ${i}`, email, password: PASSWORD, role_id: member })).body.data
      await admin.post(`/projects/${big.id}/members`, { user_id: user.id, role: 'member' })
      if (i % 3 === 0) await admin.post(`/projects/${small.id}/members`, { user_id: user.id, role: 'member' })
      const client = createClient(pb.api)
      await client.login(email, PASSWORD)
      people.push({ user, client })
    })
    const tasks = []
    await pool(Array.from({ length: TASKS }, (_, i) => i), 8, async (i) => {
      const owner = people[i % people.length]
      const task = (await admin.post('/tasks', { project_id: big.id, task_type_id: type, title: `Tarefa de carga ${i}`, assignee_id: owner.user.id })).body.data
      tasks.push(task)
    })
    const groups = []
    for (let g = 0; g < 6; g++) groups.push((await admin.post(`/projects/${big.id}/groups`, { name: `Fase ${g + 1}`, color: 'blue' })).body.data)
    await pool(Array.from({ length: 60 }, (_, i) => i), 6, async (i) => {
      await admin.post(`/projects/${big.id}/plan/items`, { group_id: groups[i % groups.length].id, name: `Elemento ${i}`, estimated_hours: 4 })
    })

    const pick = (list) => list[Math.floor(Math.random() * list.length)]
    /** Mistura de chamadas (peso, nome, função). */
    const MIX = [
      [30, 'kanban', (c) => c.get(`/projects/${big.id}/board`)],
      [20, 'lista de tarefas', (c) => c.get(`/tasks?project_id=${big.id}&perPage=25`)],
      [15, 'tarefa', (c) => c.get(`/tasks/${pick(tasks).id}`)],
      [10, 'sino', (c) => c.get('/notifications/unread-count')],
      [10, 'quadro da Gestão', (c) => c.get(`/projects/${big.id}/plan`)],
      [5, 'comentários', (c) => c.get(`/tasks/${pick(tasks).id}/comments`)],
      [7, 'editar tarefa', (c) => c.patch(`/tasks/${pick(tasks).id}`, { description: `Atualizada em ${Date.now()}` })],
      [3, 'comentar', (c) => c.post(`/tasks/${pick(tasks).id}/comments`, { content: 'Comentário do teste de carga' })],
    ]
    const total = MIX.reduce((sum, m) => sum + m[0], 0)
    const choose = () => {
      let r = Math.random() * total
      for (const m of MIX) {
        r -= m[0]
        if (r <= 0) return m
      }
      return MIX[0]
    }

    // aquecimento: conexões do pool abertas e o JIT do Node quente (mede o servidor já no ar há algum tempo)
    const warm = Number(process.env.KAMBAN_DB_POOL || 10)
    await pool(Array.from({ length: warm * 6 }, (_, i) => i), warm, async () => {
      const [, , fn] = choose()
      await fn(pick(people).client)
    })

    const results = []
    for (const level of LEVELS) {
      const latencies = []
      const byName = {}
      let errors = 0
      const deadline = Date.now() + SECONDS * 1000
      await Promise.all(
        Array.from({ length: level }, async (_, worker) => {
          const client = people[worker % people.length].client
          while (Date.now() < deadline) {
            const [, name, fn] = choose()
            const started = Date.now()
            const res = await fn(client).catch(() => ({ status: 0 }))
            const ms = Date.now() - started
            latencies.push(ms)
            ;(byName[name] = byName[name] || []).push(ms)
            if (res.status === 0 || res.status >= 500 || res.status === 429) errors++
          }
        }),
      )
      latencies.sort((a, b) => a - b)
      const row = {
        concorrencia: level,
        req_por_s: Math.round((latencies.length / SECONDS) * 10) / 10,
        p50_ms: percentile(latencies, 50),
        p95_ms: percentile(latencies, 95),
        p99_ms: percentile(latencies, 99),
        erros: errors,
      }
      results.push(row)
      const slowest = Object.entries(byName)
        .map(([name, list]) => [name, percentile(list.sort((a, b) => a - b), 95)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, p95]) => `${name} p95 ${p95} ms`)
        .join(' · ')
      console.log(`${String(level).padStart(3)} simultâneas → ${row.req_por_s} req/s · p50 ${row.p50_ms} ms · p95 ${row.p95_ms} ms · p99 ${row.p99_ms} ms · erros ${errors}  (${slowest})`)
    }
    console.log(JSON.stringify(results))
  } finally {
    await pb.stop()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
