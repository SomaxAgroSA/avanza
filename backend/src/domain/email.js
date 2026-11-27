/**
 * E-mail (regras de negócio §16): configurações do envio (SMTP), novas tentativas da fila e os modelos
 * das mensagens nos três idiomas. Todo texto vindo de pessoas é escapado no HTML.
 */

const { localize } = require('./content-locale')
const { plainText } = require('./mentions')

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  host: '',
  port: 587,
  username: '',
  tls: false,
  sender_name: '',
  sender_address: '',
  app_url: '',
})

const HOST_PATTERN = /^[A-Za-z0-9.-]+$|^\[[0-9A-Fa-f:.]+\]$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const KEYS = Object.keys(DEFAULT_SETTINGS)
const MAX = { host: 255, username: 200, password: 200, sender_name: 80, sender_address: 254, app_url: 300 }

function cleanUrl(value) {
  return value.trim().replace(/\/+$/, '')
}

function urlIssue(value) {
  const url = cleanUrl(value)
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(url)) return 'invalid_url'
  return url.length > MAX.app_url ? 'too_long' : null
}

function valueIssue(key, value) {
  if (key === 'enabled' || key === 'tls') return typeof value === 'boolean' ? null : 'invalid_type'
  if (key === 'port') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid_type'
    if (value < 1) return 'too_small'
    return value > 65535 ? 'too_large' : null
  }
  if (typeof value !== 'string') return 'invalid_type'
  const text = value.trim()
  if (text.length > MAX[key]) return 'too_long'
  if (!text) return null
  if (key === 'host') return HOST_PATTERN.test(text) ? null : 'invalid_format'
  if (key === 'sender_address') return EMAIL_PATTERN.test(text) ? null : 'invalid_email'
  if (key === 'app_url') return urlIssue(text)
  return null
}

function clean(key, value) {
  if (typeof value !== 'string') return value
  if (key === 'app_url') return cleanUrl(value)
  if (key === 'sender_address') return value.trim().toLowerCase()
  return value.trim()
}

/**
 * Alteração parcial. Retorna { values, fields, password } — `password` só quando uma nova foi enviada
 * (vazia ou ausente mantém a atual; `null` remove — servidor sem autenticação; a senha nunca volta
 * na leitura).
 */
function validateEmailSettings(patch, current) {
  const fields = {}
  const values = Object.assign({}, DEFAULT_SETTINGS, current || {})
  let password
  Object.keys(patch || {}).forEach((key) => {
    const value = patch[key]
    if (key === 'password') {
      if (value === null) {
        password = ''
        return
      }
      if (value === undefined || value === '') return
      if (typeof value !== 'string') fields.password = 'invalid_type'
      else if (value.length > MAX.password) fields.password = 'too_long'
      else password = value
      return
    }
    if (KEYS.indexOf(key) < 0) {
      fields[key] = 'unknown_field'
      return
    }
    const issue = valueIssue(key, value)
    if (issue) fields[key] = issue
    else values[key] = clean(key, value)
  })
  if (values.enabled) {
    ;['host', 'sender_address', 'app_url'].forEach((key) => {
      if (!fields[key] && !values[key]) fields[key] = 'required'
    })
  }
  return { values, fields, password }
}

// ------------------------------------------------------------------ fila

const RETRY_MINUTES = [1, 5, 15, 60]
const MAX_ATTEMPTS = 5

/** Próxima tentativa depois de `attempts` falhas; null = desiste (marca como falha). */
function nextAttemptAt(attempts, now) {
  if (attempts >= MAX_ATTEMPTS) return null
  const minutes = RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length) - 1] || RETRY_MINUTES[0]
  return new Date(now.getTime() + minutes * 60000)
}

// ------------------------------------------------------------------ modelos

const LOCALES = ['pt-BR', 'en', 'es']

const TEXTS = {
  'pt-BR': {
    test: { subject: 'Teste de e-mail — {platform}', intro: 'Se você recebeu esta mensagem, o envio de e-mails do {platform} está funcionando.' },
    password_reset: {
      subject: 'Redefinir sua senha — {platform}',
      intro: 'Olá, {name}. Recebemos um pedido para redefinir a senha da sua conta no {platform}.',
      button: 'Definir nova senha',
      note: 'O link vale por 60 minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail — sua senha continua a mesma.',
    },
    invite: {
      subject: 'Você foi convidado para o {platform}',
      intro: 'Olá, {name}. {inviter} convidou você para o {platform}.',
      button: 'Criar minha senha',
      note: 'O link vale por 7 dias e só pode ser usado uma vez.',
    },
  },
  en: {
    test: { subject: 'Test email — {platform}', intro: 'If you got this message, email delivery from {platform} is working.' },
    password_reset: {
      subject: 'Reset your password — {platform}',
      intro: 'Hi, {name}. We received a request to reset the password of your {platform} account.',
      button: 'Set a new password',
      note: "The link is valid for 60 minutes and can be used only once. If it wasn't you, ignore this email — your password stays the same.",
    },
    invite: {
      subject: "You've been invited to {platform}",
      intro: 'Hi, {name}. {inviter} invited you to {platform}.',
      button: 'Create my password',
      note: 'The link is valid for 7 days and can be used only once.',
    },
  },
  es: {
    test: { subject: 'Prueba de correo — {platform}', intro: 'Si recibiste este mensaje, el envío de correos de {platform} funciona.' },
    password_reset: {
      subject: 'Restablecer tu contraseña — {platform}',
      intro: 'Hola, {name}. Recibimos una solicitud para restablecer la contraseña de tu cuenta en {platform}.',
      button: 'Definir nueva contraseña',
      note: 'El enlace vale 60 minutos y solo se puede usar una vez. Si no fuiste tú, ignora este correo — tu contraseña sigue igual.',
    },
    invite: {
      subject: 'Te invitaron a {platform}',
      intro: 'Hola, {name}. {inviter} te invitó a {platform}.',
      button: 'Crear mi contraseña',
      note: 'El enlace vale 7 días y solo se puede usar una vez.',
    },
  },
}

/**
 * Avisos por e-mail (ajuste 23/11/2026, aprovado em demonstração): sem códigos de tarefa ou projeto.
 * Assunto "Rótulo no {platform} | Projeto | Prioridade"; corpo com a frase de quem fez, o título em
 * destaque, os dados (pedida por, projeto, prioridade, urgência, empresa, prazo), o próximo passo e o botão.
 */
const NOTICE = {
  'pt-BR': {
    item: { task: 'uma tarefa', demand: 'uma demanda' },
    types: {
      mention: '{actor} mencionou você em {item}.',
      assigned: '{actor} atribuiu {item} a você.',
      comment: '{actor} comentou em {item}.',
      status_changed: '{actor} mudou o status de {item} para {status}.',
      due_soon: 'Você tem {item} que vence amanhã.',
      overdue: 'Você tem {item} com o prazo vencido.',
      plan_mention: '{actor} mencionou você na gestão do projeto.',
      plan_reply: '{actor} respondeu sua atualização na gestão do projeto.',
      demand_received: '{actor} enviou uma nova demanda para você.',
      demand_passed: '{actor} passou uma demanda para {assignee}.',
      demand_concluded: '{actor} concluiu uma demanda e falta validar.',
      demand_validated: '{actor} validou uma demanda.',
      demand_returned: '{actor} devolveu uma demanda.',
      doc_shared: '{actor} pediu que você olhe uma página da documentação.',
    },
    subjects: {
      mention: 'Menção no {platform}',
      assigned: 'Nova atribuição no {platform}',
      comment: 'Novo comentário no {platform}',
      status_changed: 'Mudança de status no {platform}',
      due_soon: 'Vence amanhã no {platform}',
      overdue: 'Prazo vencido no {platform}',
      plan_mention: 'Menção no {platform}',
      plan_reply: 'Resposta no {platform}',
      demand_received: 'Nova demanda no {platform}',
      demand_passed: 'Demanda repassada no {platform}',
      demand_concluded: 'Demanda para validar no {platform}',
      demand_validated: 'Demanda validada no {platform}',
      demand_returned: 'Demanda devolvida no {platform}',
      doc_shared: 'Documentação no {platform}',
    },
    next: {
      demand_received: 'Para avançar, atribua a uma pessoa da sua equipe com o prazo.',
      demand_concluded: 'Revise a entrega e valide, ou devolva com um comentário.',
      demand_returned: 'Veja o comentário e retome o trabalho.',
      overdue: 'Atualize o status ou ajuste o prazo.',
    },
    labels: { requester: 'Pedida por', project: 'Projeto', priority: 'Prioridade', urgency: 'Urgência', company: 'Empresa', due: 'Prazo', responsible: 'Responsável', look: 'O que olhar' },
    copy: {
      task: '{actor} abriu uma tarefa e colocou você em cópia.',
      demand: '{actor} abriu uma demanda e colocou você em cópia.',
      taskLater: '{actor} colocou você em cópia nesta tarefa.',
      demandLater: '{actor} colocou você em cópia nesta demanda.',
    },
    urgency: { high: 'Alta', medium: 'Média', low: 'Baixa' },
    internal: 'Demanda interna',
    button: { task: 'Ver tarefa', demand: 'Ver demanda', plan: 'Ver na gestão', doc: 'Ver página', other: 'Abrir' },
    someone: 'Alguém',
  },
  en: {
    item: { task: 'a task', demand: 'a request' },
    types: {
      mention: '{actor} mentioned you in {item}.',
      assigned: '{actor} assigned {item} to you.',
      comment: '{actor} commented on {item}.',
      status_changed: '{actor} changed the status of {item} to {status}.',
      due_soon: 'You have {item} due tomorrow.',
      overdue: 'You have {item} that is overdue.',
      plan_mention: '{actor} mentioned you in the project management.',
      plan_reply: '{actor} replied to your update in the project management.',
      demand_received: '{actor} sent you a new request.',
      demand_passed: '{actor} passed a request to {assignee}.',
      demand_concluded: '{actor} completed a request and it awaits validation.',
      demand_validated: '{actor} validated a request.',
      demand_returned: '{actor} returned a request.',
      doc_shared: '{actor} asked you to look at a documentation page.',
    },
    subjects: {
      mention: 'Mention in {platform}',
      assigned: 'New assignment in {platform}',
      comment: 'New comment in {platform}',
      status_changed: 'Status change in {platform}',
      due_soon: 'Due tomorrow in {platform}',
      overdue: 'Overdue in {platform}',
      plan_mention: 'Mention in {platform}',
      plan_reply: 'Reply in {platform}',
      demand_received: 'New request in {platform}',
      demand_passed: 'Request reassigned in {platform}',
      demand_concluded: 'Request to validate in {platform}',
      demand_validated: 'Request validated in {platform}',
      demand_returned: 'Request returned in {platform}',
      doc_shared: 'Documentation in {platform}',
    },
    next: {
      demand_received: 'To move forward, assign it to someone on your team with a deadline.',
      demand_concluded: 'Review the delivery and validate it, or return it with a comment.',
      demand_returned: 'Read the comment and pick the work back up.',
      overdue: 'Update the status or adjust the deadline.',
    },
    labels: { requester: 'Requested by', project: 'Project', priority: 'Priority', urgency: 'Urgency', company: 'Company', due: 'Due', responsible: 'Owner', look: 'What to look at' },
    copy: {
      task: '{actor} opened a task and copied you.',
      demand: '{actor} opened a request and copied you.',
      taskLater: '{actor} copied you on this task.',
      demandLater: '{actor} copied you on this request.',
    },
    urgency: { high: 'High', medium: 'Medium', low: 'Low' },
    internal: 'Internal request',
    button: { task: 'View task', demand: 'View request', plan: 'View in management', doc: 'View page', other: 'Open' },
    someone: 'Someone',
  },
  es: {
    item: { task: 'una tarea', demand: 'una demanda' },
    types: {
      mention: '{actor} te mencionó en {item}.',
      assigned: '{actor} te asignó {item}.',
      comment: '{actor} comentó en {item}.',
      status_changed: '{actor} cambió el estado de {item} a {status}.',
      due_soon: 'Tienes {item} que vence mañana.',
      overdue: 'Tienes {item} con el plazo vencido.',
      plan_mention: '{actor} te mencionó en la gestión del proyecto.',
      plan_reply: '{actor} respondió tu actualización en la gestión del proyecto.',
      demand_received: '{actor} te envió una nueva demanda.',
      demand_passed: '{actor} pasó una demanda a {assignee}.',
      demand_concluded: '{actor} concluyó una demanda y falta validarla.',
      demand_validated: '{actor} validó una demanda.',
      demand_returned: '{actor} devolvió una demanda.',
      doc_shared: '{actor} te pidió que mires una página de la documentación.',
    },
    subjects: {
      mention: 'Mención en {platform}',
      assigned: 'Nueva asignación en {platform}',
      comment: 'Nuevo comentario en {platform}',
      status_changed: 'Cambio de estado en {platform}',
      due_soon: 'Vence mañana en {platform}',
      overdue: 'Plazo vencido en {platform}',
      plan_mention: 'Mención en {platform}',
      plan_reply: 'Respuesta en {platform}',
      demand_received: 'Nueva demanda en {platform}',
      demand_passed: 'Demanda reasignada en {platform}',
      demand_concluded: 'Demanda para validar en {platform}',
      demand_validated: 'Demanda validada en {platform}',
      demand_returned: 'Demanda devuelta en {platform}',
      doc_shared: 'Documentación en {platform}',
    },
    next: {
      demand_received: 'Para avanzar, asígnala a una persona de tu equipo con su plazo.',
      demand_concluded: 'Revisa la entrega y valídala, o devuélvela con un comentario.',
      demand_returned: 'Revisa el comentario y retoma el trabajo.',
      overdue: 'Actualiza el estado o ajusta el plazo.',
    },
    labels: { requester: 'Pedida por', project: 'Proyecto', priority: 'Prioridad', urgency: 'Urgencia', company: 'Empresa', due: 'Plazo', responsible: 'Responsable', look: 'Qué mirar' },
    copy: {
      task: '{actor} abrió una tarea y te puso en copia.',
      demand: '{actor} abrió una demanda y te puso en copia.',
      taskLater: '{actor} te puso en copia en esta tarea.',
      demandLater: '{actor} te puso en copia en esta demanda.',
    },
    urgency: { high: 'Alta', medium: 'Media', low: 'Baja' },
    internal: 'Demanda interna',
    button: { task: 'Ver tarea', demand: 'Ver demanda', plan: 'Ver en la gestión', doc: 'Ver página', other: 'Abrir' },
    someone: 'Alguien',
  },
}

function textsFor(locale) {
  return TEXTS[LOCALES.indexOf(locale) >= 0 ? locale : 'pt-BR']
}

function fill(template, data) {
  return template.replace(/\{(\w+)\}/g, (_m, key) => (data[key] === undefined || data[key] === null ? '' : String(data[key])))
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const FONT = "'Segoe UI',Helvetica,Arial,sans-serif"
const GREEN = '#038831'

/**
 * Mensagem (estilos em linha e tabelas: é o que o Outlook respeita). `opts`: { header?, intro?, title,
 * paragraphs?, rows? [[rótulo, valor]], quote?, next?, link?, button?, note? }. O botão é uma célula de
 * tabela com fundo (o Outlook ignora o preenchimento de links).
 */
function layout(platform, opts) {
  const td = (style, content) => `<tr><td style="${style}">${content}</td></tr>`
  const header = td(`padding:22px 32px 0;font-family:${FONT};font-size:12px;color:#6b7280`, escapeHtml(opts.header || platform))
  const intro = opts.intro ? `<p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#4b5563">${escapeHtml(opts.intro)}</p>` : ''
  const title = `<p style="margin:0;font-size:18px;line-height:1.4;font-weight:600;color:#111827">${escapeHtml(opts.title)}</p>`
  const paragraphs = (opts.paragraphs || [])
    .filter(Boolean)
    .map((p) => `<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#374151">${escapeHtml(p)}</p>`)
    .join('')
  const rows = (opts.rows || []).filter((r) => r && r[1])
  const table = rows.length
    ? td(
        'padding:22px 32px 0',
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT};font-size:13px;border-top:1px solid #eceef1">` +
          rows
            .map(
              (r) =>
                `<tr><td style="padding:9px 0;width:130px;color:#6b7280;border-bottom:1px solid #eceef1">${escapeHtml(r[0])}</td>` +
                `<td style="padding:9px 0;color:#111827;border-bottom:1px solid #eceef1">${escapeHtml(r[1])}</td></tr>`,
            )
            .join('') +
          '</table>',
      )
    : ''
  const quote = opts.quote
    ? td(
        'padding:18px 32px 0',
        // as quebras de linha do texto (listas, tabelas e parágrafos já sem marcação) continuam no e-mail (<br>: o Outlook ignora white-space)
        `<p style="margin:0;padding:8px 12px;border-left:2px solid #d1d5db;font-family:${FONT};font-size:13px;line-height:1.5;color:#4b5563">${escapeHtml(opts.quote).replace(/\n/g, '<br>')}</p>`,
      )
    : ''
  const next = opts.next ? td(`padding:18px 32px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:#4b5563`, escapeHtml(opts.next)) : ''
  const button = opts.link
    ? td(
        'padding:22px 32px 0',
        `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${GREEN}" style="border-radius:4px">` +
          `<a href="${escapeHtml(opts.link)}" style="display:inline-block;padding:10px 22px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${escapeHtml(opts.button)}</a>` +
          '</td></tr></table>',
      )
    : ''
  const note = opts.note
    ? td(`padding:14px 32px;border-top:1px solid #eceef1;font-family:${FONT};font-size:11px;line-height:1.5;color:#9ca3af`, escapeHtml(opts.note))
    : ''
  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f8">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f8"><tr><td align="center" style="padding:32px 16px">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e3e6ea;border-top:3px solid ${GREEN}">` +
    header +
    td(`padding:18px 32px 0;font-family:${FONT}`, intro + title + paragraphs) +
    table +
    quote +
    next +
    button +
    td('padding:0 0 28px', '') +
    note +
    '</table></td></tr></table></body></html>'
  const text = []
    .concat(opts.intro ? [opts.intro] : [])
    .concat([opts.title])
    .concat((opts.paragraphs || []).filter(Boolean))
    .concat(rows.length ? [''].concat(rows.map((r) => `${r[0]}: ${r[1]}`)) : [])
    .concat(opts.quote ? ['', `> ${opts.quote}`] : [])
    .concat(opts.next ? ['', opts.next] : [])
    .concat(opts.link ? ['', `${opts.button}: ${opts.link}`] : [])
    .concat(opts.note ? ['', opts.note] : [])
    .concat(['', `— ${platform}`])
    .join('\n')
  return { html, text }
}

/** kind: 'test' | 'password_reset' | 'invite'; data: { platform, name?, inviter?, link? }. */
function renderEmail(kind, locale, data) {
  const t = textsFor(locale)[kind]
  const subject = fill(t.subject, data)
  const body = layout(data.platform, { title: subject, paragraphs: [fill(t.intro, data)], link: data.link, button: t.button, note: t.note })
  return { subject, html: body.html, text: body.text }
}

function notificationLink(notification, appUrl) {
  if (notification.docPageId) {
    const key = (notification.data && notification.data.space_key) || ''
    return `${appUrl}/docs/${encodeURIComponent(key)}/${encodeURIComponent(notification.docPageId)}`
  }
  if (notification.planItemId) return `${appUrl}/projects/${encodeURIComponent(notification.projectId || '')}/management?item=${encodeURIComponent(notification.planItemId)}`
  if (notification.taskId) return `${appUrl}/tasks/${encodeURIComponent(notification.taskId)}`
  return `${appUrl}/notifications`
}

/** Prazo AAAA-MM-DD (texto ou Date) no formato do idioma (dd/mm/aaaa; em inglês mm/dd/yyyy). */
function formatDay(value, locale) {
  if (!value) return ''
  const day = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return ''
  return locale === 'en' ? `${m[2]}/${m[3]}/${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * E-mail de uma notificação: `notification` { type, taskId?, planItemId?, docPageId?, projectId?, data };
 * página da Documentação (`doc_shared`, §47): projeto e "O que olhar" (`data.note`), botão para a página.
 * `ctx` { locale, actorName, platform, appUrl, details? }. `details` (opcional, montado por quem notifica):
 * { demand, internal, project, priority: { name, translations }, urgency, company, requester, requesterArea, dueDate }.
 * Sem códigos: o título da tarefa (ou o nome do elemento da gestão) vai em destaque e o projeto pelo nome.
 */
function renderNotificationEmail(notification, ctx) {
  const n = NOTICE[LOCALES.indexOf(ctx.locale) >= 0 ? ctx.locale : 'pt-BR']
  const data = notification.data || {}
  const d = ctx.details || {}
  const isPlan = !!notification.planItemId
  const isDoc = !!notification.docPageId
  const isDemand = !!d.demand || notification.type.indexOf('demand_') === 0
  const values = Object.assign({}, data, { actor: ctx.actorName || n.someone, item: isDemand ? n.item.demand : n.item.task })
  const intro = fill(n.types[notification.type] || '', values)
  const project = isPlan || isDoc ? data.project || '' : d.internal ? n.internal : d.project || ''
  const priority = d.priority ? localize(d.priority, ctx.locale, ['name']).name : ''
  const subject = [fill(n.subjects[notification.type] || '{platform}', { platform: ctx.platform }), project, priority].filter(Boolean).join(' | ')
  const rows = isDoc
    ? [
        [n.labels.project, project],
        [n.labels.look, data.note || ''],
      ]
    : isPlan
    ? [[n.labels.project, project]]
    : [
        [n.labels.requester, isDemand && d.requester ? [d.requester, d.requesterArea].filter(Boolean).join(' · ') : ''],
        [n.labels.project, project],
        [n.labels.priority, priority],
        [n.labels.urgency, d.urgency ? n.urgency[d.urgency] : ''],
        [n.labels.company, d.company || ''],
        [n.labels.due, formatDay(d.dueDate, ctx.locale)],
      ]
  const body = layout(ctx.platform, {
    header: [ctx.platform, d.company].filter(Boolean).join('  ·  '),
    intro,
    title: (isPlan ? data.name : data.title) || ctx.platform,
    rows,
    quote: data.comment || data.update || '',
    next: n.next[notification.type] || '',
    link: notificationLink(notification, ctx.appUrl),
    button: isDoc ? n.button.doc : isPlan ? n.button.plan : notification.taskId ? (isDemand ? n.button.demand : n.button.task) : n.button.other,
  })
  return { subject, html: body.html, text: body.text }
}

/** Cópia por e-mail da tarefa nova (ajuste 24/11/2026): quantos endereços cabem em "Com cópia". */
const MAX_COPY_EMAILS = 5
/** Quanto da descrição vai no e-mail da cópia (o resto fica na tarefa). */
const COPY_DESCRIPTION = 2000

/**
 * Lê `cc_emails` do corpo de `POST /tasks`, `POST /demands` e `POST /tasks/{id}/copy`: ausente = sem cópia. Devolve `{ emails }` (sem
 * espaços, em minúsculas, sem repetidos) ou `{ error }` com o código de validação.
 */
function parseCopyEmails(value) {
  if (value === undefined || value === null) return { emails: [] }
  if (!Array.isArray(value)) return { error: 'invalid_type' }
  if (value.length > MAX_COPY_EMAILS) return { error: 'too_many' }
  const emails = []
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') return { error: 'invalid_type' }
    const email = value[i].trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email) || email.length > 254) return { error: 'invalid_email' }
    if (emails.indexOf(email) < 0) emails.push(email)
  }
  return { emails }
}

/**
 * E-mail de quem está em cópia numa tarefa nova (ajuste 24/11/2026): um aviso só, na abertura. O assunto leva o
 * código e o título — quem recebe costuma ser a caixa de um sistema de chamados, que abre o chamado com o assunto
 * e o corpo; por isso a descrição vai junto (o aviso de quem recebe a tarefa não a leva).
 * `task` { id, code, title, description }; `ctx` { locale, actorName, platform, appUrl, details, responsible }.
 * Tarefa que já existia (`ctx.later`, ajuste 24/11): o texto diz "colocou você em cópia nesta tarefa" e quem pediu
 * é `ctx.requester` (quem abriu a tarefa, que pode não ser quem manda a cópia agora).
 */
function renderTaskCopyEmail(task, ctx) {
  const n = NOTICE[LOCALES.indexOf(ctx.locale) >= 0 ? ctx.locale : 'pt-BR']
  const d = ctx.details || {}
  const actor = ctx.actorName || n.someone
  const priority = d.priority ? localize(d.priority, ctx.locale, ['name']).name : ''
  // a descrição é Markdown (§53): no e-mail vai o texto limpo, sem marcas (títulos, tabelas, imagens…)
  const description = plainText(task.description)
  const body = layout(ctx.platform, {
    header: [ctx.platform, d.company].filter(Boolean).join('  ·  '),
    intro: fill(ctx.later ? (d.internal ? n.copy.demandLater : n.copy.taskLater) : d.internal ? n.copy.demand : n.copy.task, { actor }),
    title: task.title,
    rows: [
      [n.labels.requester, ctx.later ? ctx.requester || '' : actor],
      [n.labels.responsible, ctx.responsible || ''],
      [n.labels.project, d.internal ? n.internal : d.project || ''],
      [n.labels.priority, priority],
      [n.labels.urgency, d.urgency ? n.urgency[d.urgency] : ''],
      [n.labels.company, d.company || ''],
      [n.labels.due, formatDay(d.dueDate, ctx.locale)],
    ],
    quote: description.length > COPY_DESCRIPTION ? `${description.slice(0, COPY_DESCRIPTION)}…` : description,
    link: `${ctx.appUrl}/tasks/${encodeURIComponent(task.id)}`,
    button: d.internal ? n.button.demand : n.button.task,
  })
  return { subject: `[${task.code}] ${task.title}`, html: body.html, text: body.text }
}

module.exports = {
  DEFAULT_SETTINGS,
  MAX_COPY_EMAILS,
  parseCopyEmails,
  renderTaskCopyEmail,
  MAX_ATTEMPTS,
  validateEmailSettings,
  nextAttemptAt,
  renderEmail,
  renderNotificationEmail,
  escapeHtml,
}
