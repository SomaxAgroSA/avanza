import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, FolderKanban, ShieldCheck, UserRound } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { ACCESS_MODULES, accessSummary, moduleVisible, personalRoleCode, projectAccessOf, togglePermission, type ProjectAccess } from '@/domain/access'
import type { Role, User } from '@/domain/entities'
import { PERMISSION_CODES, SUPER_ADMIN_ROLE, type PermissionCode } from '@/domain/permissions'
import { MEMBER_ROLES, type MemberRole, type Project } from '@/domain/projects'
import {
  AppAvatar,
  AppBadge,
  AppButton,
  AppCard,
  AppDataTable,
  AppDialog,
  AppEmptyState,
  AppSelect,
  AppSkeleton,
  AppSwitch,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useSession } from '@/features/auth/session'
import { projectKeys, useMemberMutations, useProjects } from '@/features/projects/queries'
import { useUpdateUser, useUsersList } from '@/features/users/queries'
import { useCreateRole, useRoles, useUpdateRolePermissions } from './queries'

const USERS_QUERY = { page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' as const }, search: '', filters: {} }
const PROJECTS_QUERY = { view: 'all' as const, page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' as const }, search: '', filters: {} }
const NONE = 'none'

/**
 * Controle de acesso (Configurações): escolhe-se uma pessoa e se vê num só lugar o perfil, os módulos que
 * ela vê e o que pode fazer em cada um, e em quais projetos entra — com os interruptores para mudar ali.
 * Usa o sistema de perfis e de membros de projeto que já existe (o servidor valida tudo).
 */
export function AccessControlPage() {
  const { t } = useTranslation()
  const users = useUsersList(USERS_QUERY)
  const roles = useRoles()
  const [userId, setUserId] = useState<string | null>(null)
  const list = users.data?.items ?? []
  const selected = list.find((u) => u.id === userId) ?? list[0] ?? null

  return (
    <>
      <PageHeader title={t('access.title')} description={t('access.description')} />
      {users.isPending || roles.isPending ? (
        <div className="flex flex-col gap-4">
          <AppSkeleton className="h-24 rounded-xl" />
          <AppSkeleton className="h-80 rounded-xl" />
        </div>
      ) : !selected ? (
        <AppEmptyState icon={<UserRound />} title={t('access.noUsers')} />
      ) : (
        <div className="flex flex-col gap-4">
          <AppCard>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <AppSelect
                className="lg:w-96"
                searchable
                label={t('access.user')}
                value={selected.id}
                onValueChange={setUserId}
                options={list.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }))}
              />
              <UserHeader user={selected} roles={roles.data ?? []} />
            </div>
          </AppCard>
          <UserAccess key={selected.id} user={selected} roles={roles.data ?? []} />
        </div>
      )}
    </>
  )
}

function UserHeader({ user, roles }: { user: User; roles: Role[] }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const me = useSession().current?.user.id
  const update = useUpdateUser()
  const role = roles.find((r) => r.id === user.roleId)
  const isMe = user.id === me
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-end gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <AppAvatar name={user.name} src={user.avatarUrl} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-fg">{user.name}</p>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
        {user.status !== 'active' && <AppBadge tone="warning">{t(`users.status.${user.status}`)}</AppBadge>}
      </div>
      <AppSelect
        className="sm:w-64"
        label={t('access.role')}
        hint={isMe ? t('access.ownRoleHint') : role ? t('access.roleUsers', { count: role.userCount }) : undefined}
        disabled={isMe || update.isPending}
        value={user.roleId}
        onValueChange={(roleId) =>
          update.mutate(
            { id: user.id, data: { roleId } },
            {
              onSuccess: () => notify.success(t('access.roleChanged', { name: user.name, role: roles.find((r) => r.id === roleId)?.name ?? '' })),
              onError: (error) => notify.error(errorMessage(error)),
            },
          )
        }
        options={roles.map((r) => ({ value: r.id, label: r.name }))}
      />
    </div>
  )
}

function UserAccess({ user, roles }: { user: User; roles: Role[] }) {
  const { t } = useTranslation()
  const { projects: repo } = useRepositories()
  const projects = useProjects(PROJECTS_QUERY)
  const projectList = useMemo(() => projects.data?.items ?? [], [projects.data])
  const membersQueries = useQueries({
    queries: projectList.map((p) => ({ queryKey: projectKeys.members(p.id), queryFn: () => repo.listMembers(p.id), staleTime: 30_000 })),
  })
  const role = roles.find((r) => r.id === user.roleId)
  // Super Admin tem acesso total sem listar as permissões uma a uma
  const perms: PermissionCode[] = role?.code === SUPER_ADMIN_ROLE ? [...PERMISSION_CODES] : (role?.permissions ?? [])
  const access: ProjectAccess[] = projectList.map((_, i) => projectAccessOf(membersQueries[i]?.data ?? [], user.id))
  const summary = accessSummary(perms, access)
  const rows = projectList.map((project, i) => ({ project, access: access[i] ?? 'none' }))

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<Eye />} label={t('access.summary.modules')} value={`${summary.modulesVisible} / ${summary.modulesTotal}`} />
        <Stat icon={<FolderKanban />} label={t('access.summary.projects')} value={`${summary.projectsWithAccess} / ${summary.projectsTotal}`} detail={summary.seesAllProjects ? t('access.summary.allProjects') : undefined} />
        <Stat icon={<ShieldCheck />} label={t('access.summary.role')} value={role?.name ?? '—'} />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ModulesCard user={user} role={role} roles={roles} perms={perms} />
        <ProjectsCard user={user} rows={rows} loading={projects.isPending} seesAll={summary.seesAllProjects} />
      </div>
    </>
  )
}

function Stat({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return (
    <AppCard>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-fg [&_svg]:size-4">{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
          <p className="truncate text-lg font-bold tabular-nums text-fg">{value}</p>
          {detail && <p className="text-xs text-muted">{detail}</p>}
        </div>
      </div>
    </AppCard>
  )
}

type PendingChange = { perms: PermissionCode[]; label: string }

function ModulesCard({ user, role, roles, perms }: { user: User; role: Role | undefined; roles: Role[]; perms: PermissionCode[] }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const me = useSession().current?.user.id
  const updatePermissions = useUpdateRolePermissions()
  const createRole = useCreateRole()
  const updateUser = useUpdateUser()
  const [pending, setPending] = useState<PendingChange | null>(null)
  const locked = !role || role.code === SUPER_ADMIN_ROLE || user.id === me
  const busy = updatePermissions.isPending || createRole.isPending || updateUser.isPending

  const fail = (error: unknown) => notify.error(errorMessage(error))
  const applyToRole = (next: PermissionCode[], label: string) =>
    role &&
    updatePermissions.mutate(
      { id: role.id, permissions: next },
      { onSuccess: () => notify.success(t('access.roleUpdated', { role: role.name, change: label })), onError: fail },
    )

  function change(code: PermissionCode, on: boolean) {
    if (!role) return
    const next = togglePermission(perms, code, on)
    const label = `${t(`permissions.codes.${code}`)}: ${on ? t('access.on') : t('access.off')}`
    // perfil só desta pessoa: muda direto; compartilhado: pergunta se cria um perfil próprio
    if (role.userCount <= 1 && !role.isSystem) applyToRole(next, label)
    else setPending({ perms: next, label })
  }

  function personalRole() {
    if (!pending || !role) return
    const code = personalRoleCode(user.name, roles.map((r) => r.code))
    createRole.mutate(
      { code, name: t('access.personalRoleName', { name: user.name }), description: t('access.personalRoleDescription', { role: role.name }), permissions: pending.perms },
      {
        onSuccess: (created) =>
          updateUser.mutate(
            { id: user.id, data: { roleId: created.id } },
            {
              onSuccess: () => {
                notify.success(t('access.personalRoleCreated', { name: user.name }))
                setPending(null)
              },
              onError: fail,
            },
          ),
        onError: fail,
      },
    )
  }

  return (
    <AppCard title={t('access.modules.title')} description={locked ? t(user.id === me ? 'access.modules.ownLocked' : 'access.modules.superLocked') : t('access.modules.hint')}>
      <ul className="flex flex-col divide-y divide-border">
        {ACCESS_MODULES.map((mod) => {
          const visible = moduleVisible(perms, mod)
          return (
            <li key={mod.module} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium text-fg">
                  {visible ? <Eye className="size-4 text-primary-text" aria-hidden /> : <EyeOff className="size-4 text-subtle" aria-hidden />}
                  {t(`permissions.modules.${mod.module}`)}
                </span>
                {mod.view ? (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted" aria-hidden>
                      {perms.includes(mod.view) ? t('access.sees') : t('access.doesNotSee')}
                    </span>
                    <AppSwitch
                      size="sm"
                      checked={perms.includes(mod.view)}
                      disabled={locked || busy}
                      onCheckedChange={(on) => change(mod.view as PermissionCode, on)}
                      aria-label={t('access.toggleView', { module: t(`permissions.modules.${mod.module}`) })}
                    />
                  </span>
                ) : (
                  <span className="text-xs text-muted">{visible ? t('access.sees') : t('access.doesNotSee')}</span>
                )}
              </div>
              {mod.actions.length > 0 && (
                <div className={cn('flex flex-wrap gap-1.5', mod.view && !perms.includes(mod.view) && 'opacity-50')}>
                  {mod.actions.map((code) => {
                    const on = perms.includes(code)
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        disabled={locked || busy}
                        onClick={() => change(code, !on)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed',
                          on ? 'border-primary-border bg-primary-soft text-primary-soft-fg' : 'border-border bg-surface text-muted hover:border-border-strong',
                        )}
                      >
                        {t(`permissions.codes.${code}`)}
                      </button>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <AppDialog
        open={!!pending}
        onOpenChange={(open) => !open && !busy && setPending(null)}
        size="md"
        title={t('access.shared.title', { role: role?.name ?? '' })}
        description={t('access.shared.description', { role: role?.name ?? '', count: role?.userCount ?? 0, change: pending?.label ?? '' })}
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              {t('common.cancel')}
            </AppButton>
            <AppButton variant="secondary" onClick={() => pending && (applyToRole(pending.perms, pending.label), setPending(null))} disabled={busy || role?.code === SUPER_ADMIN_ROLE}>
              {t('access.shared.everyone', { count: role?.userCount ?? 0 })}
            </AppButton>
            <AppButton onClick={personalRole} loading={createRole.isPending || updateUser.isPending}>
              {t('access.shared.personal', { name: user.name.split(' ')[0] })}
            </AppButton>
          </>
        }
      >
        <p className="text-sm text-muted">{t('access.shared.hint')}</p>
      </AppDialog>
    </AppCard>
  )
}

type ProjectRow = { project: Project; access: ProjectAccess }

function ProjectsCard({ user, rows, loading, seesAll }: { user: User; rows: ProjectRow[]; loading: boolean; seesAll: boolean }) {
  const { t } = useTranslation()
  const table = useDataTableState('access-projects', { sort: null })
  const q = table.state.search.trim().toLowerCase()
  const data = rows.filter((r) => !q || `${r.project.key} ${r.project.name}`.toLowerCase().includes(q))
  const columns = useMemo<DataTableColumn<ProjectRow>[]>(
    () => [
      {
        id: 'project',
        header: t('access.projects.project'),
        hideable: false,
        size: 300,
        cell: (r) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-fg">{r.project.name}</span>
            <span className="text-xs text-muted">{r.project.key}</span>
          </span>
        ),
      },
      { id: 'access', header: t('access.projects.access'), hideable: false, size: 200, cell: (r) => <ProjectAccessCell user={user} row={r} /> },
    ],
    [t, user],
  )
  return (
    <AppCard title={t('access.projects.title')} description={seesAll ? t('access.projects.seesAll') : t('access.projects.hint')}>
      <AppDataTable
        caption={t('access.projects.title')}
        columns={columns}
        data={data}
        total={data.length}
        getRowId={(r) => r.project.id}
        table={table}
        loading={loading}
        paginated={false}
        bordered={false}
        searchPlaceholder={t('access.projects.search')}
      />
    </AppCard>
  )
}

function ProjectAccessCell({ user, row }: { user: User; row: ProjectRow }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const members = useMemberMutations(row.project.id)
  const busy = members.add.isPending || members.changeRole.isPending || members.remove.isPending
  if (row.access === 'owner') return <AppBadge tone="primary">{t('projects.roles.owner')}</AppBadge>
  const done = (value: string) => ({
    onSuccess: () => notify.success(t('access.projects.changed', { name: user.name, project: row.project.name, access: value === NONE ? t('access.projects.none') : t(`projects.roles.${value}`) })),
    onError: (error: unknown) => notify.error(isAppError(error) ? errorMessage(error) : String(error)),
  })
  return (
    <AppSelect
      size="sm"
      aria-label={t('access.projects.accessFor', { project: row.project.name })}
      disabled={busy}
      value={row.access}
      onValueChange={(value) => {
        if (value === row.access) return
        if (value === NONE) members.remove.mutate(user.id, done(value))
        else if (row.access === 'none') members.add.mutate({ userId: user.id, role: value as MemberRole }, done(value))
        else members.changeRole.mutate({ userId: user.id, role: value as MemberRole }, done(value))
      }}
      options={[{ value: NONE, label: t('access.projects.none') }, ...MEMBER_ROLES.map((r) => ({ value: r, label: t(`projects.roles.${r}`) }))]}
      triggerClassName={cn(row.access === 'none' && 'text-subtle')}
    />
  )
}
