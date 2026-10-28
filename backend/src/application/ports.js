/**
 * Portas (contratos) que a camada de aplicação espera receber por injeção.
 * As implementações PocketBase ficam em ../infrastructure; os testes usam fakes em memória.
 * Este arquivo é só documentação (JSDoc) — não exporta código executável.
 *
 * Entidades usam camelCase; datas são objetos Date.
 *
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {string|null} avatarUrl
 * @property {'active'|'disabled'} status
 * @property {string} roleId
 * @property {string} locale
 * @property {string} theme
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {Date|null} lastLoginAt
 *
 * @typedef {Object} Role
 * @property {string} id
 * @property {string} code
 * @property {string} name
 * @property {string} description
 * @property {boolean} isSystem
 *
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} userId
 * @property {string} tokenHash
 * @property {string} ip
 * @property {string} userAgent
 * @property {boolean} remember
 * @property {Date} expiresAt
 * @property {Date} lastSeenAt
 * @property {Date|null} revokedAt
 * @property {Date} createdAt
 *
 * @typedef {Object} UserRepository
 * @property {(id: string) => User|null} findById
 * @property {(email: string) => User|null} findByEmail
 * @property {(email: string, exceptId?: string) => boolean} emailExists
 * @property {(query: {search?: string, status?: string, roleId?: string, sort: Array<{column: string, direction: string}>, pagination: {offset: number, perPage: number}}) => {items: User[], total: number}} list
 * @property {(data: Object) => User} create
 * @property {(id: string, patch: Object) => User} update
 * @property {(id: string, password: string) => boolean} verifyPassword
 * @property {(roleId: string) => number} countByRole
 *
 * @typedef {Object} RoleRepository
 * @property {(id: string) => Role|null} findById
 * @property {(code: string) => Role|null} findByCode
 * @property {() => Role[]} list
 * @property {(roleId: string) => string[]} getPermissionCodes
 * @property {(roleId: string, codes: string[]) => void} setPermissionCodes
 * @property {(data: Object) => Role} create
 * @property {(id: string, patch: Object) => Role} update
 * @property {(id: string) => void} delete
 *
 * @typedef {Object} SessionRepository
 * @property {(data: Object) => Session} create
 * @property {(id: string) => Session|null} findById
 * @property {(hash: string) => Session|null} findByTokenHash
 * @property {(id: string, lastSeenAt: Date, expiresAt: Date) => Session} touch
 * @property {(id: string, at: Date) => void} revoke
 * @property {(userId: string, at: Date) => void} revokeAllForUser
 * @property {(userId: string, now: Date) => Session[]} listActiveForUser
 *
 * @typedef {Object} AuditRepository
 * @property {(entry: Object) => void} record
 *
 * @typedef {Object} UnitOfWork
 * @property {(fn: (repos: Object) => any) => any} run  Executa `fn` numa transação com repositórios transacionais.
 */

module.exports = {}
