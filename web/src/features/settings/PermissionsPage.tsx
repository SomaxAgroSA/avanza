import { Fragment, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Lock, RotateCcw, Save } from 'lucide-react'
import type { Role } from '@/domain/entities'
import { PERMISSION_CODES, type PermissionCode } from '@/domain/permissions'
import { sortRolesByHierarchy } from '@/domain/rbac'
import { canGrantPermission, roleLockReason } from '@/domain/rbac'
import {
  AppButton,
  AppCard,
  AppCheckbox,
  AppErrorState,
  AppLoading,
  AppTooltip,
  notify,
} from '@/presentation/components'
import { SectionHeader } from '@/presentation/layouts/SectionHeader'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useSession } from '@/features/auth/session'
import { cn } from '@/core/utils/cn'
import { usePermissionCatalog, useRoles, useUpdateRolePermissions } from './queries'

type Draft = Record<string, PermissionCode[]>

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((x) => b.includes(x))
}

/** Matriz perfil × permissão. Alterações ficam em rascunho até "Salvar". */
export function PermissionsPage() {
  const { t } = useTranslation()
  const { current } = useSession()
  const errorMessage = useErrorMessage()
  const [params] = useSearchParams()
  const highlighted = params.get('role')
  const roles = useRoles()
  const catalog = usePermissionCatalog()
  const updatePermissions = useUpdateRolePermissions()
  const [draft, setDraft] = useState<Draft>({})
  const [saving, setSaving] = useState(false)

  const roleList = useMemo(() => sortRolesByHierarchy(roles.data ?? []), [roles.data])
  const modules = useMemo(() => {
    const map = new Map<string, PermissionCode[]>()
    const ordered = [...(catalog.data ?? [])].sort((a, b) => PERMISSION_CODES.indexOf(a.code) - PERMISSION_CODES.indexOf(b.code))
    ordered.forEach((p) => map.set(p.module, [...(map.get(p.module) ?? []), p.code]))
    return [...map.entries()]
  }, [catalog.data])

  const valueFor = (role: Role) => draft[role.id] ?? role.permissions
  const dirtyRoles = roleList.filter((role) => draft[role.id] && !sameSet(draft[role.id] ?? [], role.permissions))

  function toggle(role: Role, code: PermissionCode, checked: boolean) {
    setDraft((prev) => {
      const base = prev[role.id] ?? role.permissions
      const next = checked ? [...new Set([...base, code])] : base.filter((c) => c !== code)
      return { ...prev, [role.id]: next }
    })
  }

  function toggleModule(role: Role, codes: PermissionCode[], checked: boolean) {
    const grantable = codes.filter((code) => canGrantPermission(current, code))
    setDraft((prev) => {
      const base = prev[role.id] ?? role.permissions
      const next = checked ? [...new Set([...base, ...grantable])] : base.filter((c) => !grantable.includes(c))
      return { ...prev, [role.id]: next }
    })
  }

  async function save() {
    setSaving(true)
    let failed = 0
    for (const role of dirtyRoles) {
      try {
        await updatePermissions.mutateAsync({ id: role.id, permissions: draft[role.id] ?? [] })
      } catch (error) {
        failed++
        notify.error(`${role.name}: ${errorMessage(error)}`)
      }
    }
    setSaving(false)
    if (failed === 0) {
      setDraft({})
      notify.success(t('permissions.saved'))
    }
  }

  if (roles.isPending || catalog.isPending) return <AppLoading />
  if (roles.isError || catalog.isError) {
    return <AppErrorState onRetry={() => void Promise.all([roles.refetch(), catalog.refetch()])} />
  }

  const lockMessage = (role: Role) => {
    const reason = roleLockReason(current, role)
    return reason ? t(`permissions.lock.${reason}`) : null
  }

  return (
    <>
      {/* aba Permissões por perfil do Controle de acesso: Descartar e Salvar na linha das abas */}
      <SectionHeader
        actions={
          <>
            <AppButton variant="secondary" leftIcon={<RotateCcw />} disabled={dirtyRoles.length === 0 || saving} onClick={() => setDraft({})}>
              {t('common.discard')}
            </AppButton>
            <AppButton leftIcon={<Save />} disabled={dirtyRoles.length === 0} loading={saving} onClick={() => void save()}>
              {dirtyRoles.length > 0 ? t('permissions.saveCount', { count: dirtyRoles.length }) : t('common.save')}
            </AppButton>
          </>
        }
      />
      <p className="mb-3 text-sm text-muted">{t('permissions.description')}</p>

      <AppCard padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <caption className="sr-only">{t('permissions.title')}</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 min-w-56 border-b border-border bg-surface-2 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  {t('permissions.permission')}
                </th>
                {roleList.map((role) => {
                  const lock = lockMessage(role)
                  return (
                    <th
                      key={role.id}
                      scope="col"
                      className={cn(
                        'min-w-28 border-b border-border bg-surface-2 px-3 py-3 text-center text-xs font-semibold text-fg',
                        highlighted === role.id && 'bg-primary-soft',
                      )}
                    >
                      <AppTooltip content={lock} enabled={!!lock}>
                        <span className="inline-flex items-center gap-1">
                          {role.name}
                          {lock && <Lock className="size-3 text-subtle" aria-label={lock} />}
                        </span>
                      </AppTooltip>
                      {draft[role.id] && !sameSet(draft[role.id] ?? [], role.permissions) && (
                        <span className="ml-1 inline-block size-1.5 rounded-full bg-warning align-middle" aria-label={t('permissions.unsaved')} />
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {modules.map(([module, codes]) => (
                <Fragment key={module}>
                  <tr>
                    <th scope="rowgroup" className="sticky left-0 z-10 border-b border-border bg-surface px-4 pb-2 pt-4 text-left text-xs font-semibold uppercase tracking-wide text-primary-text">
                      {t(`permissions.modules.${module}`)}
                    </th>
                    {roleList.map((role) => {
                      const locked = !!roleLockReason(current, role)
                      const value = role.code === 'SUPER_ADMIN' ? codes : valueFor(role)
                      const selected = codes.filter((c) => value.includes(c)).length
                      return (
                        <td key={role.id} className={cn('border-b border-border px-3 pb-2 pt-4 text-center', highlighted === role.id && 'bg-primary-soft/40')}>
                          <div className="flex justify-center">
                            <AppCheckbox
                              aria-label={t('permissions.toggleModule', { module: t(`permissions.modules.${module}`), role: role.name })}
                              checked={selected === codes.length ? true : selected > 0 ? 'indeterminate' : false}
                              disabled={locked}
                              onCheckedChange={(checked) => toggleModule(role, codes, checked)}
                            />
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                  {codes.map((code) => (
                    <tr key={code} className="hover:bg-surface-2">
                      <th scope="row" className="sticky left-0 z-10 border-b border-border bg-surface px-4 py-2 pl-7 text-left font-normal text-fg">
                        <span className="block">{t(`permissions.codes.${code}`)}</span>
                        <span className="block font-mono text-[11px] text-subtle">{code}</span>
                      </th>
                      {roleList.map((role) => {
                        const isSuper = role.code === 'SUPER_ADMIN'
                        const locked = !!roleLockReason(current, role)
                        const grantable = canGrantPermission(current, code)
                        const checked = isSuper || valueFor(role).includes(code)
                        return (
                          <td key={role.id} className={cn('border-b border-border px-3 py-2 text-center', highlighted === role.id && 'bg-primary-soft/40')}>
                            <div className="flex justify-center">
                              <AppCheckbox
                                aria-label={t('permissions.toggle', { permission: t(`permissions.codes.${code}`), role: role.name })}
                                checked={checked}
                                disabled={locked || (!grantable && !checked)}
                                onCheckedChange={(value) => toggle(role, code, value)}
                              />
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </AppCard>
      <p className="mt-3 text-xs text-subtle">{t('permissions.footnote')}</p>
    </>
  )
}
