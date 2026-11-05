import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Lock, Plus, ShieldCheck } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import type { Role } from '@/domain/entities'
import { permissionModule } from '@/domain/permissions'
import { roleSchema, type RoleInput } from '@/domain/validation'
import {
  AppBadge,
  AppButton,
  AppConfirmDialog,
  AppDataTable,
  AppDialog,
  AppDrawer,
  AppTextField,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { AccessTabActions } from './AccessControlPage'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCreateRole, useDeleteRole, useRoles, useUpdateRole } from './queries'

export function RolesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const roles = useRoles()
  const table = useDataTableState('roles', { sort: { id: 'name', direction: 'asc' } })
  const deleteRole = useDeleteRole()

  const [viewing, setViewing] = useState<Role | null>(null)
  const [editing, setEditing] = useState<Role | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Role | null>(null)

  // Lista pequena: busca e ordenação no cliente.
  const rows = useMemo(() => {
    const search = table.state.search.trim().toLowerCase()
    const filtered = (roles.data ?? []).filter(
      (r) => !search || r.name.toLowerCase().includes(search) || r.code.toLowerCase().includes(search),
    )
    const sort = table.state.sort
    if (!sort) return filtered
    const factor = sort.direction === 'asc' ? 1 : -1
    const value = (r: Role) => (sort.id === 'users' ? r.userCount : sort.id === 'permissions' ? r.permissions.length : r.name.toLowerCase())
    return [...filtered].sort((a, b) => (value(a) > value(b) ? factor : value(a) < value(b) ? -factor : 0))
  }, [roles.data, table.state.search, table.state.sort])

  const columns = useMemo<DataTableColumn<Role>[]>(
    () => [
      {
        id: 'name',
        header: t('roles.fields.name'),
        sortable: true,
        hideable: false,
        pinned: true,
        size: 260,
        cell: (role) => (
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium text-fg">
              {role.name}
              {role.code === 'SUPER_ADMIN' && <Lock className="size-3.5 text-subtle" aria-label={t('roles.immutable')} />}
            </p>
            <p className="font-mono text-xs text-muted">{role.code}</p>
          </div>
        ),
      },
      { id: 'description', header: t('roles.fields.description'), size: 300, cell: (role) => <span className="text-muted">{role.description || '—'}</span> },
      {
        id: 'permissions',
        header: t('roles.fields.permissions'),
        sortable: true,
        size: 140,
        align: 'end',
        cell: (role) => (role.code === 'SUPER_ADMIN' ? <AppBadge tone="primary">{t('roles.allPermissions')}</AppBadge> : role.permissions.length),
      },
      { id: 'users', header: t('roles.fields.users'), sortable: true, size: 110, align: 'end', cell: (role) => role.userCount },
      {
        id: 'type',
        header: t('roles.fields.type'),
        size: 120,
        cell: (role) => <AppBadge tone={role.isSystem ? 'neutral' : 'info'}>{role.isSystem ? t('roles.system') : t('roles.custom')}</AppBadge>,
      },
    ],
    [t],
  )

  return (
    <>
      <AccessTabActions>
        <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
          {t('roles.create')}
        </AppButton>
      </AccessTabActions>
      <p className="mb-3 text-sm text-muted">{t('roles.description')}</p>
      <AppDataTable
        caption={t('roles.title')}
        columns={columns}
        data={rows}
        total={rows.length}
        getRowId={(role) => role.id}
        table={table}
        paginated={false}
        loading={roles.isPending}
        fetching={roles.isFetching}
        error={roles.isError ? { correlationId: isAppError(roles.error) ? roles.error.correlationId : undefined } : null}
        onRetry={() => void roles.refetch()}
        searchPlaceholder={t('roles.searchPlaceholder')}
        actions={{
          onView: setViewing,
          onEdit: setEditing,
          canEdit: (role) => role.code !== 'SUPER_ADMIN',
          onDelete: setDeleting,
          canDelete: (role) => !role.isSystem,
          more: (role) => [
            {
              key: 'permissions',
              label: t('roles.editPermissions'),
              icon: <ShieldCheck />,
              onSelect: () => navigate(`/settings/access?tab=matrix&role=${encodeURIComponent(role.id)}`),
            },
          ],
        }}
      />

      <RoleDetailsDrawer role={viewing} onOpenChange={(open) => !open && setViewing(null)} />
      <RoleFormDialog
        open={creating || !!editing}
        role={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('roles.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('roles.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={deleteRole.isPending}
        onConfirm={() =>
          deleting &&
          deleteRole.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('roles.deleted'))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}

function RoleDetailsDrawer({ role, onOpenChange }: { role: Role | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const groups = useMemo(() => {
    const map = new Map<string, string[]>()
    role?.permissions.forEach((code) => {
      const module = permissionModule(code)
      map.set(module, [...(map.get(module) ?? []), code])
    })
    return [...map.entries()]
  }, [role])

  return (
    <AppDrawer open={!!role} onOpenChange={onOpenChange} title={role?.name ?? ''} description={role?.description}>
      {role && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            <AppBadge>{role.code}</AppBadge>
            <AppBadge tone={role.isSystem ? 'neutral' : 'info'}>{role.isSystem ? t('roles.system') : t('roles.custom')}</AppBadge>
            <AppBadge tone="primary">{t('roles.userCount', { count: role.userCount })}</AppBadge>
          </div>
          {role.code === 'SUPER_ADMIN' ? (
            <p className="text-sm text-muted">{t('roles.superAdminNote')}</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted">{t('roles.noPermissions')}</p>
          ) : (
            groups.map(([module, codes]) => (
              <section key={module}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{t(`permissions.modules.${module}`)}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {codes.map((code) => (
                    <li key={code}>
                      <AppBadge tone="primary">{t(`permissions.codes.${code}`)}</AppBadge>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </AppDrawer>
  )
}

function RoleFormDialog({ open, role, onOpenChange }: { open: boolean; role: Role | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const createRole = useCreateRole()
  const updateRole = useUpdateRole()
  const isEdit = !!role
  const pending = createRole.isPending || updateRole.isPending
  const { register, handleSubmit, reset, setError, formState } = useForm<RoleInput>({
    resolver: zodResolver(roleSchema),
    defaultValues: { code: '', name: '', description: '' },
  })

  useEffect(() => {
    if (open) reset({ code: role?.code ?? '', name: role?.name ?? '', description: role?.description ?? '' })
  }, [open, role, reset])

  const onSubmit = handleSubmit((values) => {
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'ROLE_CODE_IN_USE') return setError('code', { message: 'code_in_use' })
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
        return Object.entries(error.fieldErrors()).forEach(([field, code]) => setError(field as keyof RoleInput, { message: code }))
      }
      notify.error(errorMessage(error))
    }
    const onSuccess = () => {
      notify.success(isEdit ? t('roles.updated') : t('roles.created'))
      onOpenChange(false)
    }
    if (role) updateRole.mutate({ id: role.id, data: { name: values.name, description: values.description } }, { onSuccess, onError })
    else createRole.mutate({ code: values.code, name: values.name, description: values.description, permissions: [] }, { onSuccess, onError })
  })

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? t('roles.editTitle') : t('roles.createTitle')}
      description={isEdit ? undefined : t('roles.createDescription')}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" form="role-form" loading={pending}>
            {t('common.save')}
          </AppButton>
        </>
      }
    >
      <form id="role-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <AppTextField
          label={t('roles.fields.code')}
          required
          disabled={isEdit}
          hint={t('roles.codeHint')}
          className="font-mono uppercase"
          error={formState.errors.code?.message}
          {...register('code')}
        />
        <AppTextField label={t('roles.fields.name')} required error={formState.errors.name?.message} {...register('name')} />
        <AppTextField label={t('roles.fields.description')} error={formState.errors.description?.message} {...register('description')} />
      </form>
    </AppDialog>
  )
}
