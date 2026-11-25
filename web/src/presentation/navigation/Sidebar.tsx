import { useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { env } from '@/core/config/env'
import { cn } from '@/core/utils/cn'
import { AppBadge, AppTooltip } from '@/presentation/components'
import { useUiStore } from '@/presentation/state/ui-store'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { useResolvedTheme } from '@/presentation/common/use-theme'
import { logoFor } from '@/domain/platform'
import type { NavItem } from './nav-items'
import { stickyNavChild } from './nav-memory'

/** Logo e nome da plataforma (Configurador geral); sem logo enviado, a marca padrão do tema. */
export function BrandMark({ collapsed }: { collapsed?: boolean }) {
  const info = usePlatformInfo()
  const logo = logoFor(info, useResolvedTheme())
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[9px] border border-border bg-surface">
        <img src={logo} alt="" className="size-5 object-contain" />
      </span>
      {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight text-fg">{info.name}</span>}
    </div>
  )
}

const linkBase =
  'group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors ' +
  'text-muted hover:bg-surface-2 hover:text-fg aria-[current=page]:bg-primary-soft aria-[current=page]:font-semibold aria-[current=page]:text-primary-soft-fg'

/** Versão do produto e copyright no rodapé do menu (recolhido: só a versão, com o resto na dica). */
function SidebarFooterInfo({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation()
  const { name } = usePlatformInfo()
  const version = t('nav.version', { version: env.appVersion })
  const copyright = t('nav.copyright', { year: new Date().getFullYear(), name })
  if (collapsed) {
    return (
      <AppTooltip content={`${version} · ${copyright}`} side="right">
        <p className="mt-1 text-center text-[10px] tabular-nums text-subtle">v{env.appVersion}</p>
      </AppTooltip>
    )
  }
  return (
    <div className="mt-1 px-2.5 pb-1 text-[11px] leading-4 text-subtle">
      <p className="tabular-nums">{version}</p>
      <p className="truncate" title={copyright}>
        {copyright}
      </p>
    </div>
  )
}

function PhaseBadge({ phase }: { phase?: number }) {
  const { t } = useTranslation()
  if (!phase) return null
  return (
    <AppBadge tone="neutral" className="ml-auto px-1.5 text-[10px]">
      {t('nav.soon')}
    </AppBadge>
  )
}

function NavGroup({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation()
  const location = useLocation()
  const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  const [open, setOpen] = useState(active)
  // dentro de um projeto (/projects/:id) segue marcada a lista de onde a pessoa veio (Em andamento, Concluídos…)
  const sticky = stickyNavChild(location.pathname, item)
  const Icon = item.icon

  if (collapsed) {
    return (
      <AppTooltip content={t(item.labelKey)} side="right">
        <NavLink to={item.entry ?? item.children?.[0]?.to ?? item.to} onClick={onNavigate} className={cn(linkBase, 'justify-center px-0', active && 'bg-primary-soft text-primary-soft-fg')}>
          {Icon && <Icon className="size-[18px]" aria-hidden />}
          <span className="sr-only">{t(item.labelKey)}</span>
        </NavLink>
      </AppTooltip>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(linkBase, 'w-full', active && 'text-fg')}
      >
        {Icon && <Icon className="size-[18px]" aria-hidden />}
        <span className="flex-1 text-left">{t(item.labelKey)}</span>
        <ChevronDown className={cn('size-4 text-subtle transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-border pl-3 ml-[18px]">
          {item.children?.filter((child) => !child.hidden).map((child) => (
            <li key={child.id}>
              <NavLink
                to={child.to}
                end={child.end}
                onClick={onNavigate}
                className={cn(linkBase, 'h-8 font-normal', sticky === child.to && 'bg-primary-soft font-semibold text-primary-soft-fg')}
              >
                <span className="truncate">{t(child.labelKey)}</span>
                <PhaseBadge phase={child.phase} />
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export interface SidebarProps {
  items: NavItem[]
  collapsed: boolean
  /** Fecha o menu móvel ao navegar. */
  onNavigate?: () => void
  showCollapseToggle?: boolean
  /** Selo com um número ao lado do item (ex.: Tarefas = demandas recebidas sem atribuir, §45): { id do item: { count, label } }. */
  badges?: Partial<Record<string, { count: number; label: string }>>
}

/** Selo de contagem do item do menu (some com zero); recolhido, vira um ponto sobre o ícone. */
function NavCount({ badge, collapsed }: { badge?: { count: number; label: string }; collapsed: boolean }) {
  if (!badge || badge.count <= 0) return null
  if (collapsed) return <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" aria-label={badge.label} role="img" />
  return (
    <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-semibold tabular-nums text-primary-fg" title={badge.label} data-testid="nav-count">
      <span aria-hidden>{badge.count}</span>
      <span className="sr-only">{badge.label}</span>
    </span>
  )
}

export function Sidebar({ items, collapsed, onNavigate, showCollapseToggle = true, badges }: SidebarProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-14 shrink-0 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'px-4')}>
        <BrandMark collapsed={collapsed} />
      </div>
      <nav aria-label={t('nav.main')} className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-0.5">
          {items.filter((item) => !item.hidden).map((item) => {
            const Icon = item.icon
            // com `entry` (Tarefas → Caixa de entrada, ajuste 23/11) o clique vai para lá, mas o item segue marcado
            // em qualquer tela dele (a Lista inclusive)
            const to = item.entry ?? item.to
            const marked = !!item.entry && (location.pathname === item.to || location.pathname.startsWith(`${item.to}/`))
            const markedClass = marked && 'bg-primary-soft font-semibold text-primary-soft-fg'
            // grupo de uma lista só (Projetos do perfil, ajuste 25/11): "Projetos · Em andamento"
            const label = item.detailKey ? `${t(item.labelKey)} · ${t(item.detailKey)}` : t(item.labelKey)
            return (
              <li key={item.id}>
                {item.children ? (
                  <NavGroup item={item} collapsed={collapsed} onNavigate={onNavigate} />
                ) : collapsed ? (
                  <AppTooltip content={label} side="right">
                    <NavLink to={to} onClick={onNavigate} className={cn(linkBase, 'relative justify-center px-0', markedClass)}>
                      {Icon && <Icon className="size-[18px]" aria-hidden />}
                      <span className="sr-only">{label}</span>
                      <NavCount badge={badges?.[item.id]} collapsed />
                    </NavLink>
                  </AppTooltip>
                ) : (
                  <NavLink to={to} onClick={onNavigate} className={cn(linkBase, markedClass)}>
                    {Icon && <Icon className="size-[18px]" aria-hidden />}
                    <span className="truncate">{label}</span>
                    <PhaseBadge phase={item.phase} />
                    <NavCount badge={badges?.[item.id]} collapsed={false} />
                  </NavLink>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
      <div className={cn('border-t border-border p-2', collapsed && 'flex flex-col items-center')}>
        {showCollapseToggle && (
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(linkBase, 'w-full', collapsed && 'w-9 justify-center px-0')}
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          >
            {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            {!collapsed && <span>{t('nav.collapse')}</span>}
          </button>
        )}
        <SidebarFooterInfo collapsed={collapsed} />
      </div>
    </div>
  )
}
