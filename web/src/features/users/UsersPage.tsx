import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Copy, KeyRound, Mail, UserCheck, UserPlus } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDate, formatDateTime, formatRelative } from '@/core/utils/format'
import type { User } from '@/domain/entities'
import { userActions } from '@/domain/rbac'
import {
  AppAvatar,
  AppBadge,
  AppButton,
  AppConfirmDialog,
  AppDataTable,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCopy } from '@/presentation/common/use-copy'
import { useCan, useSession } from '@/features/auth/session'
import { useRoles } from '@/features/settings/queries'
import { useResendInvite, useSetUserStatus, useUsersList } from './queries'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { UserDetailsDrawer } from './UserDetailsDrawer'
import { UserFormDialog } from './UserFormDialog'
import { UserStatusBadge } from './UserStatusBadge'
import { ResetPasswordDialog } from './ResetPasswordDialog'

export function UsersPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { current } = useSession()
  const canCreate = useCan('users.create')
  const errorMessage = useErrorMessage()
  const copy = useCopy()
  const [params, setParams] = useSearchParams()

  const table = useDataTableState('users', { sort: { id: 'name', direction: 'asc' } })
  const users = useUsersList(table.query)
  const roles = useRoles()
  const setStatus = useSetUserStatus()
  const resendInvite = useResendInvite()
  const emailEnabled = usePlatformInfo().passwordReset

  const [viewing, setViewing] = useState<User | null>(null)
  const [editing, setEditing] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const [disabling, setDisabling] = useState<User | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)

  // Busca vinda da command palette (/users?search=...)
  const { setSearch } = table
  useEffect(() => {
    const search = params.get('search')
    if (search !== null) {
      setSearch(search)
      setParams({}, { replace: true })
    }
  }, [params, setParams, setSearch])

  const roleList = useMemo(() => roles.data ?? [], [roles.data])
  const roleById = useMemo(() => new Map(roleList.map((r) => [r.id, r])), [roleList])
  const actionsFor = (user: User) => userActions(current, user, roleById.get(user.roleId)?.code ?? null)

  function changeStatus(user: User, status: User['status'], options?: { withUndo?: boolean }) {
    setStatus.mutate(
      { id: user.id, status },
      {
        onSuccess: () => {
          setDisabling(null)
          notify.success(status === 'disabled' ? t('users.disabled', { name: user.name }) : t('users.enabled', { name: user.name }), {
            undo: options?.withUndo ? { label: t('common.undo'), onClick: () => changeStatus(user, 'active') } : undefined,
          })
        },
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  }

  const columns = useMemo<DataTableColumn<User>[]>(
    () => [
      {
        id: 'name',
        header: t('users.fields.name'),
        sortable: true,
        hideable: false,
        pinned: true,
        size: 280,
        minSize: 200,
        cell: (user) => (
          <div className="flex min-w-0 items-center gap-3">
            <AppAvatar name={user.name} src={user.avatarUrl} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
          </div>
        ),
      },
      {
        id: 'role_id',
        header: t('users.fields.role'),
        size: 160,
        cell: (user) => {
          const role = roleById.get(user.roleId)
          return role ? <AppBadge tone={role.code === 'SUPER_ADMIN' ? 'primary' : 'neutral'}>{role.name}</AppBadge> : '—'
        },
        filter: { label: t('users.fields.role'), options: roleList.map((r) => ({ value: r.id, label: r.name })) },
      },
      {
        id: 'status',
        header: t('users.fields.status'),
        sortable: true,
        size: 130,
        cell: (user) => <UserStatusBadge status={user.status} />,
        filter: {
          label: t('users.fields.status'),
          options: [
            { value: 'active', label: t('users.status.active') },
            { value: 'disabled', label: t('users.status.disabled') },
          ],
        },
      },
      {
        id: 'last_login_at',
        header: t('users.fields.lastLogin'),
        sortable: true,
        size: 170,
        cell: (user) =>
          user.lastLoginAt ? (
            <time className="text-muted" dateTime={user.lastLoginAt.toISOString()} title={formatDateTime(user.lastLoginAt, locale)}>
              {formatRelative(user.lastLoginAt, locale)}
            </time>
          ) : (
            <span className="text-subtle">{t('users.neverLoggedIn')}</span>
          ),
      },
      {
        id: 'created_at',
        header: t('users.fields.createdAt'),
        sortable: true,
        size: 170,
        cell: (user) => (
          <time className="text-muted" dateTime={user.createdAt?.toISOString()} title={formatDateTime(user.createdAt, locale)}>
            {formatDate(user.createdAt, locale)}
          </time>
        ),
      },
    ],
    [t, locale, roleById, roleList],
  )

  const correlationId = isAppError(users.error) ? users.error.correlationId : undefined

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.description')}
        actions={
          canCreate && (
            <AppButton leftIcon={<UserPlus />} onClick={() => setCreating(true)} disabled={!roles.data}>
              {t('users.create')}
            </AppButton>
          )
        }
      />

      <AppDataTable
        caption={t('users.title')}
        columns={columns}
        data={users.data?.items ?? EMPTY}
        total={users.data?.total ?? 0}
        getRowId={(user) => user.id}
        table={table}
        loading={users.isPending}
        fetching={users.isFetching}
        error={users.isError ? { correlationId } : null}
        onRetry={() => void users.refetch()}
        searchPlaceholder={t('users.searchPlaceholder')}
        actions={{
          onView: setViewing,
          onEdit: setEditing,
          canEdit: (user) => actionsFor(user).includes('edit'),
          onDelete: setDisabling,
          canDelete: (user) => actionsFor(user).includes('disable'),
          deleteLabel: () => t('users.disable'),
          more: (user) => [
            {
              key: 'copy',
              label: t('users.copyEmail'),
              icon: <Copy />,
              onSelect: () => void copy(user.email),
            },
            ...(actionsFor(user).includes('reset_password')
              ? [{ key: 'reset', label: t('users.resetPassword'), icon: <KeyRound />, onSelect: () => setResetting(user) }]
              : []),
            ...(actionsFor(user).includes('enable')
              ? [{ key: 'enable', label: t('users.enable'), icon: <UserCheck />, onSelect: () => changeStatus(user, 'active') }]
              : []),
            ...(emailEnabled && actionsFor(user).includes('resend_invite')
              ? [
                  {
                    key: 'invite',
                    label: t('users.resendInvite'),
                    icon: <Mail />,
                    onSelect: () =>
                      resendInvite.mutate(user.id, {
                        onSuccess: () => notify.success(t('users.inviteResent', { email: user.email })),
                        onError: (error) => notify.error(errorMessage(error)),
                      }),
                  },
                ]
              : []),
          ],
        }}
      />

      <UserDetailsDrawer
        user={viewing}
        role={viewing ? roleById.get(viewing.roleId) : undefined}
        roles={roleList}
        onOpenChange={(open) => !open && setViewing(null)}
        onEdit={
          viewing && actionsFor(viewing).includes('edit')
            ? (user) => {
                setViewing(null)
                setEditing(user)
              }
            : undefined
        }
      />

      <UserFormDialog
        open={creating || !!editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
        user={editing}
        roles={roleList}
        canChangeAccess={!editing || actionsFor(editing).includes('change_role')}
      />

      <ResetPasswordDialog user={resetting} onOpenChange={(open) => !open && setResetting(null)} />

      <AppConfirmDialog
        open={!!disabling}
        onOpenChange={(open) => !open && setDisabling(null)}
        title={t('users.disableTitle', { name: disabling?.name ?? '' })}
        description={t('users.disableDescription')}
        confirmLabel={t('users.disable')}
        loading={setStatus.isPending}
        onConfirm={() => disabling && changeStatus(disabling, 'disabled', { withUndo: true })}
      />
    </>
  )
}

const EMPTY: User[] = []
