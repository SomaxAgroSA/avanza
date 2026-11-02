import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router'
import { can, canAny, type PermissionCode } from '@/domain/permissions'
import { AppLoading } from '@/presentation/components'
import { ForbiddenPage } from '@/features/errors/ErrorPages'
import { safeRedirect, useCan, useSession } from './session'
import { useSessionStore } from './session-store'

/** Protege rotas autenticadas; redireciona ao login preservando o destino. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession()
  const location = useLocation()
  const endReason = useSessionStore((s) => s.endReason)
  if (status === 'loading') return <AppLoading fullscreen />
  if (status === 'anonymous') {
    // saiu por conta própria: login "limpo" (o próximo acesso começa no dashboard)
    if (endReason === 'signed_out') return <Navigate to="/login" replace />
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return <>{children}</>
}

/** Rotas só para visitantes (ex.: login). */
export function GuestOnly({ children }: { children?: ReactNode }) {
  const { status } = useSession()
  const location = useLocation()
  if (status === 'loading') return <AppLoading fullscreen />
  if (status === 'authenticated') {
    const next = new URLSearchParams(location.search).get('next')
    return <Navigate to={safeRedirect(next)} replace />
  }
  return children ? <>{children}</> : <Outlet />
}

/**
 * Rota de layout que exige permissão(ões). A autorização real continua no backend. Repassa o contexto
 * da rota de cima (ex.: o projeto aberto, para as abas da página do projeto).
 */
export function PermissionGate({ permission, anyOf }: { permission?: PermissionCode; anyOf?: PermissionCode[] }) {
  const { current } = useSession()
  const context: unknown = useOutletContext()
  const allowed = !!current && (permission ? can(current.permissions, permission) : true) && (anyOf ? canAny(current.permissions, anyOf) : true)
  return allowed ? <Outlet context={context} /> : <ForbiddenPage />
}

/** Renderiza `children` apenas com a permissão. */
export function Can({ permission, children, fallback = null }: { permission: PermissionCode; children: ReactNode; fallback?: ReactNode }) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>
}
