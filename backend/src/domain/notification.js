/**
 * Notificações internas (diretriz §41).
 *
 * Tipos: menção, tarefa atribuída, comentário em tarefa sua, mudança de status, prazo amanhã e prazo vencido;
 * no quadro de gerenciamento, menção e resposta numa atualização de elemento (plan_mention, plan_reply).
 * Regras: quem fez a ação nunca é notificado; cada pessoa recebe uma notificação por evento
 * (a primeira razão da lista vence — ex.: menção tem prioridade sobre "comentário").
 */

const TYPES = Object.freeze(['mention', 'assigned', 'comment', 'status_changed', 'due_soon', 'overdue', 'plan_mention', 'plan_reply'])

/** [{ userId, type }] -> sem vazios, sem o autor da ação e sem repetir pessoa. */
function recipients(entries, actorId) {
  const seen = []
  const result = []
  ;(entries || []).forEach((entry) => {
    if (!entry || !entry.userId || entry.userId === actorId || seen.indexOf(entry.userId) >= 0) return
    seen.push(entry.userId)
    result.push({ userId: entry.userId, type: entry.type })
  })
  return result
}

/** "AAAA-MM-DD" de uma data (UTC — prazos são gravados à meia-noite UTC). */
function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10)
}

/** Classifica o prazo em relação a hoje: 'due_soon' (amanhã), 'overdue' (antes de hoje) ou null. */
function dueReminderType(dueDate, now) {
  if (!dueDate) return null
  const due = dayKey(dueDate)
  const today = dayKey(now)
  const tomorrow = dayKey(new Date(new Date(`${today}T00:00:00Z`).getTime() + 86400000))
  if (due === tomorrow) return 'due_soon'
  if (due < today) return 'overdue'
  return null
}

module.exports = { TYPES, recipients, dayKey, dueReminderType }
