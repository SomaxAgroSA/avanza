/**
 * Segredos guardados no banco (hoje: a senha do SMTP) cifrados com AES-256-GCM e a chave do servidor
 * (KAMBAN_SECRET_KEY). Formato: "v1:<iv>:<tag>:<cifrado>" em base64url. Sem a chave certa, nada abre.
 */

const crypto = require('node:crypto')

// fora de produção, uma chave fixa de desenvolvimento (a API recusa subir em produção sem KAMBAN_SECRET_KEY)
const DEV_KEY = 'avanza-dev-secret-key-not-for-production'

function createSecrets(secretKey) {
  const key = crypto.createHash('sha256').update(String(secretKey || DEV_KEY)).digest()
  return {
    encrypt(plain) {
      if (plain === undefined || plain === null || plain === '') return ''
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
      return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':')
    },
    decrypt(value) {
      if (!value) return ''
      const [version, iv, tag, data] = String(value).split(':')
      if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Segredo em formato desconhecido')
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
    },
  }
}

module.exports = { createSecrets }
