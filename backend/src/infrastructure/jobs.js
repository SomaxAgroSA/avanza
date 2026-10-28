/**
 * Rotinas agendadas (antes cronAdd do PocketBase): uma verificação por minuto, no horário do servidor.
 * As que mexem em dados rodam com trava no Postgres (withLock) — com várias instâncias da API, só
 * uma executa; o sinal de vida do tempo real é de cada instância (cada uma tem as suas conexões).
 */

const { parseCron } = require('./cron')
const { withLock } = require('./locks')
const { WINDOW_MINUTES } = require('../domain/lockout')

const JOBS = [
  {
    // lembretes de prazo todo dia às 08:00
    name: 'due-reminders',
    cron: '0 8 * * *',
    run: async ({ container }) => {
      const result = await container.notifications.sendDueReminders(new Date())
      return { created: result.created }
    },
  },
  {
    // tentativas de login fora da janela do bloqueio
    name: 'login-attempts-cleanup',
    cron: '30 3 * * *',
    run: async ({ container }) => ({ removed: await container.deps.loginAttemptRepository.purgeBefore(new Date(Date.now() - WINDOW_MINUTES * 60000)) }),
  },
  {
    // retenção do histórico de auditoria (Configurador geral)
    name: 'audit-retention',
    cron: '45 3 * * *',
    run: async ({ container }) => ({ removed: (await container.platformSettings.purgeAuditLogs()).removed }),
  },
  {
    // fila de e-mails (a mesma trava do "Enviar agora")
    name: 'email-outbox',
    cron: '* * * * *',
    quietUnless: (r) => r.sent || r.failed || r.retrying,
    run: ({ container }) => container.email.flushOutbox(),
  },
  {
    name: 'webhooks',
    cron: '* * * * *',
    quietUnless: (r) => r.sent || r.failed || r.retrying,
    run: ({ container }) => container.webhooks.flush(),
  },
  {
    // arquivos de registros apagados (ou de gravações desfeitas) saem do Storage; só depois de 10 min,
    // para nunca pegar um upload cuja transação ainda está aberta
    name: 'storage-trash',
    cron: '* * * * *',
    quietUnless: (r) => r.removed,
    run: ({ runtime }) => emptyStorageTrash(runtime),
  },
  {
    // o navegador e os proxies derrubam conexões SSE paradas; cada instância avisa as suas
    name: 'realtime-keepalive',
    cron: '*/3 * * * *',
    local: true,
    quietUnless: () => false,
    run: ({ runtime }) => ({ sent: runtime.realtime ? runtime.realtime.keepAlive() : 0 }),
  },
]

const TRASH_BATCH = 500

/** Apaga do Storage as chaves da lixeira com mais de `minutes` minutos. */
async function emptyStorageTrash(runtime, minutes) {
  const age = minutes === undefined ? 10 : minutes
  const rows = await runtime.db.query(
    "SELECT \"key\" FROM storage_trash WHERE created <= clock_timestamp() - make_interval(mins => $1) ORDER BY created LIMIT $2",
    [age, TRASH_BATCH],
  )
  if (rows.length === 0) return { removed: 0 }
  const keys = rows.map((row) => row.key)
  await runtime.storage.remove(keys)
  await runtime.db.exec('DELETE FROM storage_trash WHERE "key" = ANY($1::text[])', [keys])
  return { removed: keys.length }
}

/** Executa uma rotina agora (testes e a verificação por minuto). */
async function runJob(runtime, job) {
  const { createContainer } = require('./container')
  const exec = () => job.run({ runtime, container: createContainer(runtime) })
  const outcome = job.local ? { busy: false, result: await exec() } : await withLock(runtime.db, `job:${job.name}`, exec)
  if (!outcome.busy && (!job.quietUnless || job.quietUnless(outcome.result || {}))) {
    runtime.log.info({ job: job.name, result: outcome.result }, 'rotina executada')
  }
  return outcome
}

/** Liga o agendador; devolve `stop()`. */
function startScheduler(runtime, options) {
  const jobs = ((options && options.jobs) || JOBS).map((job) => Object.assign({ schedule: parseCron(job.cron) }, job))
  let timer = null
  let stopped = false

  function tick() {
    const now = new Date()
    jobs
      .filter((job) => job.schedule.matches(now))
      .forEach((job) => {
        runJob(runtime, job).catch((err) => runtime.log.error({ job: job.name, err }, 'rotina falhou'))
      })
    schedule()
  }

  function schedule() {
    if (stopped) return
    // no começo de cada minuto (+50 ms de folga)
    const delay = 60000 - (Date.now() % 60000) + 50
    timer = setTimeout(tick, delay)
    timer.unref()
  }

  schedule()
  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}

module.exports = { JOBS, runJob, startScheduler, emptyStorageTrash }
