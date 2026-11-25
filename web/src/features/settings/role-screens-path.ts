/** Endereço do "O que aparece" de um perfil (§48) dentro de Controle de acesso → Perfis. */
export const ROLES_PATH = '/settings/access?tab=roles'
export const roleScreensPath = (roleId: string) => `${ROLES_PATH}&screens=${encodeURIComponent(roleId)}`
