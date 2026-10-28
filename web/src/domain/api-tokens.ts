import type { UserSummary } from './projects'

/**
 * Tokens de API pessoais (regras de negócio §17): acesso à API sem o navegador. O valor aparece uma
 * única vez, na criação; depois só o prefixo identifica o token.
 */

export type ApiTokenState = 'active' | 'expired' | 'revoked'

/** Prazos oferecidos, em dias; 0 = sem prazo. */
export const API_TOKEN_EXPIRY_DAYS = [30, 90, 365, 0] as const
export type ApiTokenExpiry = (typeof API_TOKEN_EXPIRY_DAYS)[number]

export interface ApiToken {
  id: string
  name: string
  prefix: string
  state: ApiTokenState
  createdAt: Date | null
  expiresAt: Date | null
  lastUsedAt: Date | null
  lastUsedIp: string | null
  revokedAt: Date | null
  /** Só na lista do Admin (todos os tokens). */
  user: UserSummary | null
}

export interface CreatedApiToken extends ApiToken {
  /** O valor completo — só existe na resposta da criação. */
  token: string
}

/** Exemplo de uso para a pessoa copiar logo após criar. */
export function curlExample(baseUrl: string, token: string): string {
  return `curl -H "Authorization: Bearer ${token}" ${baseUrl}/api/v1/auth/me`
}

/** Comando que conecta o Claude Code ao MCP do Avanza (`/api/mcp`) com o mesmo token. */
export function claudeMcpCommand(baseUrl: string, token: string): string {
  return `claude mcp add --transport http avanza ${baseUrl}/api/mcp --header "Authorization: Bearer ${token}"`
}
