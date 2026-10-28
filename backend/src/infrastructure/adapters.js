/**
 * Adaptadores de saída da aplicação: envio de e-mail (nodemailer, com o SMTP configurado no app), POST
 * dos webhooks (fetch com tempo limite) e HMAC. Antes: mailer, $http e $security do PocketBase.
 */

const crypto = require('node:crypto')
const nodemailer = require('nodemailer')

/** Envio pelo SMTP configurado em Integrações (lido a cada envio: mudanças valem na hora). */
function createMailer(db, secrets) {
  return {
    async send(message) {
      const settings = await db.one('SELECT * FROM email_settings WHERE id = $1', ['default'])
      if (!settings || !settings.host) throw new Error('SMTP não configurado')
      const transport = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        // "tls" do PocketBase = TLS implícito (465); sem ele, STARTTLS quando o servidor oferece
        secure: !!settings.tls,
        auth: settings.username ? { user: settings.username, pass: secrets.decrypt(settings.password_secret) } : undefined,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
      })
      try {
        await transport.sendMail({
          from: message.fromName ? { name: message.fromName, address: message.fromAddress } : message.fromAddress,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        })
      } finally {
        transport.close()
      }
    },
  }
}

/**
 * POST com tempo limite; falha de conexão lança. Redirecionamentos não são seguidos: um 3xx poderia
 * levar a entrega para um endereço interno que a validação da URL do webhook não aprovaria.
 */
function createHttpClient() {
  return {
    async post(url, body, headers, timeoutSeconds) {
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(1, Number(timeoutSeconds) || 10) * 1000),
      })
      let text = ''
      try {
        text = await res.text()
      } catch (_) {
        text = ''
      }
      return { status: res.status, body: text }
    },
  }
}

function createCrypto() {
  return {
    hmacSha256Hex(secret, data) {
      return crypto.createHmac('sha256', String(secret)).update(String(data)).digest('hex')
    },
  }
}

module.exports = { createMailer, createHttpClient, createCrypto }
