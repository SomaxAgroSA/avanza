import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { Dialog } from 'radix-ui'
import { Check, KeyRound, Languages, LogOut, Menu, Monitor, Moon, Search, Sun, UserRound, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { SUPPORTED_LANGUAGES } from '@/core/i18n'
import {
  AppAvatar,
  AppBreadcrumb,
  AppDropdown,
  AppIconButton,
  AppKbd,
  modKey,
  notify,
  type AppDropdownItem,
} from '@/presentation/components'
import { useUiStore } from '@/presentation/state/ui-store'
import { useLogout, useSession } from '@/features/auth/session'
import { usePreferences } from '@/features/preferences/use-preferences'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { Sidebar } from '@/presentation/navigation/Sidebar'
import { CommandPalette } from '@/presentation/navigation/CommandPalette'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { useLiveNotifications, useRealtimeResync, useRealtimeStatus } from '@/presentation/common/use-live'
import { findNavTrail, visibleNavItems } from '@/presentation/navigation/nav-items'
import { rememberNavChild } from '@/presentation/navigation/nav-memory'

/** Layout autenticado: sidebar, topbar, conteúdo e command palette. */
export function AppShell() {
  const { t } = useTranslation()
  const { current } = useSession()
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen)
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen)
  const items = visibleNavItems(current?.permissions ?? [])
  useLiveNotifications(current?.user.id)
  useRealtimeResync()

  return (
    <div className="flex h-dvh overflow-hidden bg-bg" data-print="flow">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        {t('common.skipToContent')}
      </a>

      <aside
        data-print="hide"
        className={cn(
          'hidden shrink-0 border-r border-border bg-surface transition-[width] duration-200 md:block',
          collapsed ? 'w-[60px]' : 'w-60',
        )}
      >
        <Sidebar items={items} collapsed={collapsed} />
      </aside>

      <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay animate-fade-in md:hidden" />
          <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-surface shadow-float focus:outline-none md:hidden">
            <Dialog.Title className="sr-only">{t('nav.main')}</Dialog.Title>
            <Sidebar items={items} collapsed={false} showCollapseToggle={false} onNavigate={() => setMobileNavOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col" data-print="flow">
        <Topbar />
        {/* `relative`: elementos absolutos (ex.: tabelas sr-only) ficam presos à rolagem do main; sem isso
            esticam o documento, surge uma 2ª barra de rolagem e a tela "treme" quando um menu trava o body */}
        <main id="main" tabIndex={-1} data-print="flow" className="relative min-h-0 flex-1 overflow-y-auto focus:outline-none">
          {/* ocupa toda a largura disponível (telas largas também); só o respiro lateral varia */}
          <div className="w-full px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}

function Topbar() {
  const { t } = useTranslation()
  const location = useLocation()
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen)
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const trail = findNavTrail(location.pathname)
  // a última lista aberta de cada grupo (Projetos → Em andamento + filtros): o "Voltar" e o menu voltam a ela
  useEffect(() => rememberNavChild(location.pathname, location.search), [location.pathname, location.search])

  return (
    <header data-print="hide" className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur sm:px-6">
      <AppIconButton className="md:hidden" label={t('nav.openMenu')} icon={<Menu />} onClick={() => setMobileNavOpen(true)} showTooltip={false} />
      <div className="min-w-0 flex-1">
        <AppBreadcrumb items={trail.map((item, i) => ({ label: t(item.labelKey), to: i < trail.length - 1 ? item.to : undefined }))} />
      </div>
      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="hidden h-8 w-64 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-sm text-subtle transition-colors hover:border-border-strong hover:text-muted sm:flex"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">{t('commandPalette.trigger')}</span>
        <AppKbd>{modKey}</AppKbd>
        <AppKbd>K</AppKbd>
      </button>
      <AppIconButton className="sm:hidden" label={t('commandPalette.trigger')} icon={<Search />} onClick={() => setCommandPaletteOpen(true)} />
      <RealtimeStatusBadge />
      <NotificationBell />
      <ThemeMenu />
      <UserMenu />
    </header>
  )
}

function ThemeMenu() {
  const { t } = useTranslation()
  const theme = useUiStore((s) => s.theme)
  const { changeTheme } = usePreferences()
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  const option = (value: 'light' | 'dark' | 'system', label: string, icon: React.ReactNode): AppDropdownItem => ({
    key: value,
    label,
    icon,
    shortcut: theme === value ? '✓' : undefined,
    onSelect: () => changeTheme(value),
  })
  return (
    <AppDropdown
      items={[
        { type: 'label', key: 'label', label: t('theme.label') },
        option('light', t('theme.light'), <Sun />),
        option('dark', t('theme.dark'), <Moon />),
        option('system', t('theme.system'), <Monitor />),
      ]}
      trigger={
        <button type="button" aria-label={t('theme.label')} className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
          <Icon className="size-4" />
        </button>
      }
    />
  )
}

function UserMenu() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { current } = useSession()
  const logout = useLogout()
  const { changeLanguage } = usePreferences()
  const errorMessage = useErrorMessage()
  if (!current) return null

  const languageItems: AppDropdownItem[] = SUPPORTED_LANGUAGES.map((lng) => ({
    key: `lang-${lng}`,
    label: t(`language.${lng}`),
    icon: i18n.language === lng ? <Check /> : <Languages />,
    onSelect: () => changeLanguage(lng),
  }))

  return (
    <AppDropdown
      items={[
        {
          type: 'label',
          key: 'who',
          label: (
            <div className="flex flex-col">
              <span className="text-sm font-medium text-fg">{current.user.name}</span>
              <span className="text-xs font-normal text-muted">{current.user.email}</span>
              {current.role && <span className="mt-1 text-[11px] font-medium text-primary-text">{current.role.name}</span>}
            </div>
          ),
        },
        { type: 'separator', key: 's1' },
        { key: 'account', label: t('account.title'), icon: <UserRound />, onSelect: () => navigate('/account') },
        { key: 'sessions', label: t('account.sessions'), icon: <KeyRound />, onSelect: () => navigate('/account/sessions') },
        { type: 'separator', key: 's2' },
        { type: 'label', key: 'lang', label: t('language.label') },
        ...languageItems,
        { type: 'separator', key: 's3' },
        {
          key: 'logout',
          label: t('auth.logout'),
          icon: <LogOut />,
          tone: 'danger',
          onSelect: () =>
            logout.mutate(undefined, {
              onError: (error) => notify.error(errorMessage(error)),
            }),
        },
      ]}
      trigger={
        <button type="button" aria-label={t('account.menu')} className="rounded-full focus-visible:outline-2 focus-visible:outline-ring">
          <AppAvatar name={current.user.name} src={current.user.avatarUrl} size="sm" />
        </button>
      }
    />
  )
}

/** Só aparece quando a conexão do tempo real caiu (as telas seguem funcionando; atualizam ao recarregar). */
function RealtimeStatusBadge() {
  const { t } = useTranslation()
  const status = useRealtimeStatus()
  if (status !== 'reconnecting') return null
  return (
    <span role="status" className="hidden items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-xs text-warning-soft-fg sm:inline-flex" title={t('realtime.reconnectingHint')}>
      <WifiOff className="size-3.5" aria-hidden />
      {t('realtime.reconnecting')}
    </span>
  )
}
