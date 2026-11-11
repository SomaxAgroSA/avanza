import { NAV_ITEMS, type NavItem } from './nav-items'

/**
 * Última lista aberta de cada grupo do menu (ex.: Projetos → Em andamento, com os filtros da URL).
 * Ao abrir um projeto e voltar, a pessoa cai na mesma lista, e o menu segue marcando essa lista
 * enquanto ela está dentro do projeto. Fica na sessionStorage: vale para a aba, sem ir ao servidor.
 */
const KEY = 'avanza.nav.last.'

/** Grupo do menu cujo filho tem exatamente este caminho (a página de uma lista). */
function groupOfChild(pathname: string, items: NavItem[] = NAV_ITEMS): NavItem | undefined {
  return items.find((item) => item.children?.some((child) => child.to === pathname))
}

/** Guarda a lista aberta (caminho + query) quando o caminho é um filho de um grupo do menu. */
export function rememberNavChild(pathname: string, search = '', items: NavItem[] = NAV_ITEMS): void {
  const group = groupOfChild(pathname, items)
  if (!group) return
  try {
    sessionStorage.setItem(KEY + group.id, pathname + search)
  } catch {
    // navegação privada / armazenamento bloqueado: segue sem lembrar
  }
}

/** Última lista aberta do grupo (caminho + query), se ainda for um filho válido do menu. */
export function lastNavChild(groupId: string, items: NavItem[] = NAV_ITEMS): string | null {
  try {
    const value = sessionStorage.getItem(KEY + groupId)
    if (!value) return null
    const path = value.split('?')[0]
    const group = items.find((item) => item.id === groupId)
    return group?.children?.some((child) => child.to === path) ? value : null
  } catch {
    return null
  }
}

/**
 * Filho a marcar no menu quando o caminho está dentro do grupo mas não é uma das listas
 * (ex.: /projects/:id): a última lista aberta do grupo.
 */
export function stickyNavChild(pathname: string, group: NavItem): string | null {
  if (!group.children || !pathname.startsWith(`${group.to}/`)) return null
  if (group.children.some((child) => pathname === child.to || (child.to !== group.to && pathname.startsWith(`${child.to}/`)))) return null
  return lastNavChild(group.id)?.split('?')[0] ?? null
}
