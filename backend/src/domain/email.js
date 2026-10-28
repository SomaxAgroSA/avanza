/**
 * E-mail (regras de negócio §16): configurações do envio (SMTP), novas tentativas da fila e os modelos
 * das mensagens nos três idiomas. Todo texto vindo de pessoas é escapado no HTML.
 */

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
    notification: { button: 'Abrir', footer: 'Você recebe estes e-mails porque as notificações por e-mail estão ligadas na sua conta. Para desligar, acesse Minha conta.' },
    types: {
      mention: '{actor} mencionou você em {code}',
      assigned: '{actor} atribuiu {code} a você',
      comment: '{actor} comentou em {code}',
      status_changed: '{actor} mudou o status de {code} para {status}',
      due_soon: '{code} vence amanhã',
      overdue: '{code} está com o prazo vencido',
      plan_mention: '{actor} mencionou você em “{name}”',
      plan_reply: '{actor} respondeu sua atualização em “{name}”',
    },
    someone: 'Alguém',
    planIn: 'Quadro de {project}',
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
    notification: { button: 'Open', footer: 'You get these emails because email notifications are on in your account. To turn them off, go to My account.' },
    types: {
      mention: '{actor} mentioned you in {code}',
      assigned: '{actor} assigned {code} to you',
      comment: '{actor} commented on {code}',
      status_changed: '{actor} changed the status of {code} to {status}',
      due_soon: '{code} is due tomorrow',
      overdue: '{code} is overdue',
      plan_mention: '{actor} mentioned you in “{name}”',
      plan_reply: '{actor} replied to your update in “{name}”',
    },
    someone: 'Someone',
    planIn: '{project} board',
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
    notification: { button: 'Abrir', footer: 'Recibes estos correos porque las notificaciones por correo están activadas en tu cuenta. Para desactivarlas, ve a Mi cuenta.' },
    types: {
      mention: '{actor} te mencionó en {code}',
      assigned: '{actor} te asignó {code}',
      comment: '{actor} comentó en {code}',
      status_changed: '{actor} cambió el estado de {code} a {status}',
      due_soon: '{code} vence mañana',
      overdue: '{code} está vencida',
      plan_mention: '{actor} te mencionó en “{name}”',
      plan_reply: '{actor} respondió tu actualización en “{name}”',
    },
    someone: 'Alguien',
    planIn: 'Tablero de {project}',
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

/** Mensagem simples: título, parágrafos, botão opcional e rodapé; estilos em linha (clientes de e-mail). */
function layout(platform, opts) {
  const paragraphs = (opts.paragraphs || [])
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.5">${escapeHtml(p)}</p>`)
    .join('')
  const quote = opts.quote
    ? `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #6366f1;color:#475569;font-size:14px">${escapeHtml(opts.quote)}</blockquote>`
    : ''
  const button = opts.link
    ? `<p style="margin:20px 0"><a href="${escapeHtml(opts.link)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(opts.button)}</a></p>`
    : ''
  const note = opts.note ? `<p style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.5">${escapeHtml(opts.note)}</p>` : ''
  const html =
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Helvetica,Arial,sans-serif">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">' +
    `<p style="margin:0 0 18px;font-weight:700;font-size:16px;color:#4f46e5">${escapeHtml(platform)}</p>` +
    `<h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${escapeHtml(opts.title)}</h1>` +
    paragraphs +
    quote +
    button +
    note +
    '</div></body></html>'
  const text = [opts.title, '']
    .concat((opts.paragraphs || []).filter(Boolean))
    .concat(opts.quote ? ['', `> ${opts.quote}`] : [])
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
  if (notification.planItemId) return `${appUrl}/project-management/${encodeURIComponent(notification.projectId || '')}?item=${encodeURIComponent(notification.planItemId)}`
  if (notification.taskId) return `${appUrl}/tasks/${encodeURIComponent(notification.taskId)}`
  return `${appUrl}/notifications`
}

/**
 * E-mail de uma notificação: `notification` { type, taskId?, planItemId?, projectId?, data };
 * `ctx` { locale, actorName, platform, appUrl }.
 */
function renderNotificationEmail(notification, ctx) {
  const all = textsFor(ctx.locale)
  const data = notification.data || {}
  const values = Object.assign({}, data, { actor: ctx.actorName || all.someone })
  const sentence = fill(all.types[notification.type] || '{code}', values)
  const context = notification.planItemId ? fill(all.planIn, { project: data.project || '' }) : data.title
  const quote = data.comment || data.update || ''
  const body = layout(ctx.platform, {
    title: sentence,
    paragraphs: [context],
    quote,
    link: notificationLink(notification, ctx.appUrl),
    button: all.notification.button,
    note: all.notification.footer,
  })
  return { subject: sentence, html: body.html, text: body.text }
}

module.exports = {
  DEFAULT_SETTINGS,
  MAX_ATTEMPTS,
  validateEmailSettings,
  nextAttemptAt,
  renderEmail,
  renderNotificationEmail,
  escapeHtml,
}
