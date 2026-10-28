/**
 * Conversão de entidades para o formato público da API (snake_case, datas ISO 8601).
 * Campos sensíveis (hash de token, senha) nunca passam por aqui.
 */

function iso(date) {
  return date ? new Date(date).toISOString() : null
}

function toUserDto(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar_url: user.avatarUrl || null,
    status: user.status,
    role_id: user.roleId,
    locale: user.locale,
    theme: user.theme,
    email_notifications: user.emailNotifications !== false,
    created_at: iso(user.createdAt),
    updated_at: iso(user.updatedAt),
    last_login_at: iso(user.lastLoginAt),
  }
}

/** Resumo público de usuário (para listas, donos, autores). */
function toUserSummary(user) {
  return { id: user.id, name: user.name, email: user.email, avatar_url: user.avatarUrl || null }
}

function toRoleDto(role, extra) {
  const dto = {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description || '',
    is_system: !!role.isSystem,
  }
  if (extra && extra.permissions) dto.permissions = extra.permissions.slice().sort()
  if (extra && typeof extra.userCount === 'number') dto.user_count = extra.userCount
  return dto
}

function toSessionDto(session, currentSessionId) {
  return {
    id: session.id,
    ip: session.ip || '',
    user_agent: session.userAgent || '',
    remember: !!session.remember,
    created_at: iso(session.createdAt),
    last_seen_at: iso(session.lastSeenAt),
    expires_at: iso(session.expiresAt),
    current: session.id === currentSessionId,
  }
}

module.exports = { iso, toUserDto, toUserSummary, toRoleDto, toSessionDto }
