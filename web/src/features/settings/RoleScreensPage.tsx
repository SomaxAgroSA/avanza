import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, Eye, EyeOff, Lock, Save, ShieldCheck } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { ACCESS_MODULES } from '@/domain/access'
import type { Role } from '@/domain/entities'
import { PERMISSION_CODES, SUPER_ADMIN_ROLE, type PermissionCode } from '@/domain/permissions'
import { projectListsOf } from '@/domain/project-lists'
import { visibleProjectTabs } from '@/domain/project-routes'
import { PROJECT_PROFILE_SECTIONS } from '@/domain/projects'
import { SCREEN_MODULES, missingPermission, type ScreenModule } from '@/domain/screen-modules'
import {
  SCREEN_CATALOG,
  chooseStart,
  isLastVisible,
  isStartGroup,
  screenKey,
  shows,
  startItem,
  toggleScreen,
  visibleItems,
  type ScreenGroup,
  type ScreenItem,
  type ScreenSettings,
} from '@/domain/screens'
import { taskViewsOf, tasksEntryPath, visibleBoxes } from '@/domain/task-views'
import { AppBadge, AppButton, AppCard, AppEmptyState, AppSelect, AppSkeleton, notify } from '@/presentation/components'
import { SectionHeader } from '@/presentation/layouts/SectionHeader'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { platformNavItems, visibleNavItems, withNavEntry, withProjectLists, withScreens, type NavItem } from '@/presentation/navigation/nav-items'
import { useSession } from '@/features/auth/session'
import { useRoles, useUpdateRole } from './queries'
import { ROLES_PATH, roleScreensPath } from './role-screens-path'

/** Nome de um grupo ou de um item no i18n (`roles.screens.groups.projects.lists`, `roles.screens.items.projects.lists.all`). */
const groupKey = (group: ScreenGroup) => `roles.screens.groups.${group}`
const itemKey = (group: ScreenGroup, item: string) => `roles.screens.items.${group}.${item}`

/**
 * "O que aparece" de um perfil (Controle de acesso → Perfis, §48; demonstração aprovada 25/11): um cartão por módulo
 * do menu com o "Lo ve" e o "O que pode fazer" do perfil (como hoje; mudam em "Editar permissões") e o "O que
 * aparece" — uma caixa de marcar por parte (sempre fica ao menos uma por grupo) e o "Abre em" onde há escolha. À
 * direita, a prévia do menu lateral e das telas do perfil, com o rascunho. Só a tela: as permissões não mudam.
 */
export function RoleScreensPage({ roleId }: { roleId: string }) {
  const { t } = useTranslation()
  const roles = useRoles()
  const role = roles.data?.find((r) => r.id === roleId)
  return (
    <>
      <Link to={ROLES_PATH} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> {t('roles.screens.back')}
      </Link>
      {roles.isPending ? (
        <div className="flex flex-col gap-4">
          <AppSkeleton className="h-20 rounded-xl" />
          <AppSkeleton className="h-96 rounded-xl" />
        </div>
      ) : !role ? (
        <AppEmptyState icon={<ShieldCheck />} title={t('errors.ROLE_NOT_FOUND')} />
      ) : (
        <RoleScreensEditor key={role.id} role={role} roles={roles.data ?? []} />
      )}
    </>
  )
}

function RoleScreensEditor({ role, roles }: { role: Role; roles: Role[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const update = useUpdateRole()
  const [draft, setDraft] = useState<ScreenSettings>(role.screens)
  const locked = role.code === SUPER_ADMIN_ROLE
  const perms: PermissionCode[] = locked ? [...PERMISSION_CODES] : role.permissions
  const dirty = JSON.stringify(draft) !== JSON.stringify(role.screens)

  const save = () =>
    update.mutate(
      { id: role.id, data: { name: role.name, description: role.description, screens: draft } },
      { onSuccess: () => notify.success(t('roles.screens.saved', { role: role.name })), onError: (error) => notify.error(errorMessage(error)) },
    )

  return (
    <div className="flex flex-col gap-4">
      {/* Salvar e Descartar na linha das abas do Controle de acesso */}
      <SectionHeader
        actions={
          <>
            {dirty && (
              <AppButton variant="secondary" onClick={() => setDraft(role.screens)} disabled={update.isPending}>
                {t('roles.screens.discard')}
              </AppButton>
            )}
            <AppButton leftIcon={<Save />} onClick={save} disabled={!dirty || locked} loading={update.isPending}>
              {t('roles.screens.save')}
            </AppButton>
          </>
        }
      />
      <AppCard>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <AppSelect
            className="lg:w-80"
            label={t('roles.screens.role')}
            value={role.id}
            onValueChange={(id) => navigate(roleScreensPath(id))}
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
          />
          <Link to={`${ROLES_PATH}&role=${encodeURIComponent(role.id)}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline">
            <ShieldCheck className="size-4" aria-hidden /> {t('roles.screens.editPermissions')}
          </Link>
        </div>
        <p className="mt-3 max-w-[100ch] text-sm text-muted">{locked ? t('roles.screens.immutable') : t('roles.screens.intro')}</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {(['profile', 'screen', 'one', 'all'] as const).map((rule) => (
            <li key={rule} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
              <b className="block text-[13px] text-fg">{t(`roles.screens.rules.${rule}.title`)}</b>
              {t(`roles.screens.rules.${rule}.text`)}
            </li>
          ))}
        </ul>
      </AppCard>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="flex min-w-0 flex-col gap-3">
          {SCREEN_MODULES.map((mod) => (
            <ModuleCard key={mod.module} mod={mod} perms={perms} draft={draft} locked={locked} onChange={setDraft} />
          ))}
        </div>
        <ScreensPreview perms={perms} draft={draft} />
      </div>
    </div>
  )
}

/** As permissões de "O que pode fazer" do módulo (o "ver" e as ações dos módulos de acesso dele), na ordem da tela. */
function moduleCodes(mod: ScreenModule): PermissionCode[] {
  return ACCESS_MODULES.filter((m) => mod.accessModules.includes(m.module)).flatMap((m) => [...(m.view ? [m.view] : []), ...(m.sections ?? []), ...m.actions])
}

function ModuleCard({ mod, perms, draft, locked, onChange }: { mod: ScreenModule; perms: PermissionCode[]; draft: ScreenSettings; locked: boolean; onChange: (next: ScreenSettings) => void }) {
  const { t } = useTranslation()
  const sees = mod.sees(perms)
  const codes = moduleCodes(mod)
  const name = t(`roles.screens.modules.${mod.module}`)
  return (
    <AppCard
      aria-label={name}
      title={<span className="text-[15px]">{name}</span>}
      actions={
        <AppBadge tone={sees ? 'primary' : 'neutral'}>
          {sees ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
          {sees ? t('roles.screens.sees') : t('roles.screens.doesNotSee')}
        </AppBadge>
      }
      className={cn(!sees && 'opacity-60')}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">{t('roles.screens.canDo')}</span>
          {codes.length === 0 ? (
            <span className="text-xs text-subtle">{t('roles.screens.noActions')}</span>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {codes.map((code) => (
                <li
                  key={code}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs',
                    perms.includes(code) ? 'border-primary-border bg-primary-soft text-primary-soft-fg' : 'border-border text-subtle line-through decoration-subtle/60',
                  )}
                >
                  {t(`permissions.codes.${code}`)}
                </li>
              ))}
            </ul>
          )}
        </div>
        {mod.groups.length === 0 ? (
          <p className="text-xs text-muted">{t('roles.screens.onlySees')}</p>
        ) : (
          mod.groups.map((group) => <GroupEditor key={group} group={group} perms={perms} draft={draft} disabled={locked} onChange={onChange} />)
        )}
      </div>
    </AppCard>
  )
}

function GroupEditor<G extends ScreenGroup>({ group, perms, draft, disabled, onChange }: { group: G; perms: PermissionCode[]; draft: ScreenSettings; disabled: boolean; onChange: (next: ScreenSettings) => void }) {
  const { t } = useTranslation()
  const label = t(groupKey(group))
  const visible = visibleItems(draft, group)
  const items = SCREEN_CATALOG[group] as readonly ScreenItem<G>[]
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5 border-t border-dashed border-border pt-3">
      <span className="text-xs font-medium text-muted">{t('roles.screens.shows', { group: label })}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const key = screenKey(group, item)
          const on = shows(draft, key)
          const last = on && isLastVisible(draft, group, item)
          const missing = missingPermission(perms, key)
          const name = t(itemKey(group, item))
          const title = last ? t('roles.screens.last') : missing ? t('roles.screens.missing', { permission: t(`permissions.codes.${missing}`) }) : undefined
          return (
            <button
              key={item}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={name}
              title={title}
              disabled={disabled || last}
              onClick={() => onChange(toggleScreen(draft, group, item, !on))}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border py-1 pl-2 pr-3 text-xs font-medium transition-colors duration-150 motion-reduce:transition-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed',
                on ? 'border-primary-border bg-primary-soft text-primary-soft-fg' : 'border-border bg-surface text-muted hover:border-border-strong',
                missing && 'border-dashed',
              )}
            >
              <span aria-hidden className={cn('flex size-3.5 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong')}>
                {on && <Check className="size-2.5" strokeWidth={3} />}
              </span>
              {name}
              {missing && <Lock aria-hidden className="size-3 text-subtle" />}
            </button>
          )
        })}
      </div>
      {isStartGroup(group) &&
        (visible.length > 1 ? (
          <AppSelect
            size="sm"
            className="sm:w-72"
            label={t('roles.screens.opensIn')}
            disabled={disabled}
            value={startItem(draft, group) ?? visible[0]!}
            onValueChange={(value) => onChange(chooseStart(draft, group, value as ScreenItem<typeof group>))}
            options={visible.map((item) => ({ value: item, label: t(itemKey(group, item)) }))}
          />
        ) : (
          <p className="text-xs text-muted">{t('roles.screens.single', { item: t(itemKey(group, visible[0]!)) })}</p>
        ))}
    </div>
  )
}

/** Prévia com o rascunho: o menu lateral do perfil e as partes das telas que mais mudam (como na demonstração). */
function ScreensPreview({ perms, draft }: { perms: PermissionCode[]; draft: ScreenSettings }) {
  const { t } = useTranslation()
  const platform = useSession().current?.platform
  const lists = projectListsOf(draft)
  const views = taskViewsOf(draft)
  const seesAll = perms.includes('projects.view_all')
  const menu = useMemo(
    () => withScreens(withProjectLists(withNavEntry(visibleNavItems(perms, platformNavItems(platform)), 'tasks', tasksEntryPath(views, seesAll)), lists), draft),
    [perms, platform, views, seesAll, lists, draft],
  )
  const sees = (module: string) => SCREEN_MODULES.find((m) => m.module === module)?.sees(perms) ?? false
  const sections = PROJECT_PROFILE_SECTIONS.filter((section) => perms.includes(`projects.${section}` as PermissionCode))
  const tabs = visibleProjectTabs(perms, { manage: perms.includes('projects.edit'), sections, screens: draft })
  const entryList = `/projects${lists[0] === 'all' ? '' : `/${lists[0]}`}`

  return (
    <aside aria-label={t('roles.screens.preview.title')} className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-4">
      <PreviewCard title={t('roles.screens.preview.menu')}>
        {menu.length === 0 ? (
          <span className="text-xs text-subtle">{t('roles.screens.preview.none')}</span>
        ) : (
          <ul className="flex flex-col text-sm">
            {menu.map((item) => (
              <MenuLine key={item.id} item={item} entryList={entryList} />
            ))}
          </ul>
        )}
      </PreviewCard>
      <PreviewCard title={t('roles.screens.preview.tasks')}>
        {!sees('tasks') ? <span className="text-xs text-subtle">{t('roles.screens.preview.noTasks')}</span> : <TasksLine perms={perms} draft={draft} boxes={visibleBoxes(views, seesAll)} />}
      </PreviewCard>
      <PreviewCard title={t('roles.screens.preview.ongoing')}>
        {!sees('projects') || !lists.includes('ongoing') ? (
          <span className="text-xs text-subtle">{t('roles.screens.preview.noOngoing')}</span>
        ) : (
          <Names names={visibleItems(draft, 'projects.blocks').map((block) => t(itemKey('projects.blocks', block)))} />
        )}
      </PreviewCard>
      <PreviewCard title={t('roles.screens.preview.project')}>
        {!sees('projects') ? <span className="text-xs text-subtle">{t('roles.screens.preview.noProjects')}</span> : <Names names={tabs.map((tab) => t(itemKey('projects.tabs', tab)))} />}
      </PreviewCard>
    </aside>
  )
}

function PreviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-surface p-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  )
}

function MenuLine({ item, entryList }: { item: NavItem; entryList: string }) {
  const { t } = useTranslation()
  const label = item.detailKey ? `${t(item.labelKey)} · ${t(item.detailKey)}` : t(item.labelKey)
  const children = item.children?.filter((child) => !child.hidden) ?? []
  return (
    <li>
      <span className={cn('block rounded-md px-2.5 py-1', item.detailKey && 'bg-primary-soft font-semibold text-primary-soft-fg')}>{label}</span>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <li
              key={child.id}
              className={cn('rounded-md py-0.5 pl-7 pr-2.5 text-[13px] text-muted', item.id === 'projects' && child.to === entryList && 'bg-primary-soft font-semibold text-primary-soft-fg')}
            >
              {t(child.labelKey)}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function Names({ names }: { names: string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
      {names.map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  )
}

/** A linha de cima de Tarefas com o rascunho: telas, visões, caixas, filtros e botões de criar. */
function TasksLine({ perms, draft, boxes }: { perms: PermissionCode[]; draft: ScreenSettings; boxes: string[] }) {
  const { t } = useTranslation()
  const screens = visibleItems(draft, 'tasks.screens')
  const start = startItem(draft, 'tasks.screens')
  const inbox = start === 'inbox' && boxes.length > 0
  const seg = (group: ScreenGroup, items: readonly string[], active: string | null) =>
    items.length > 1 ? (
      <span className="inline-flex gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
        {items.map((item) => (
          <span key={item} className={cn('rounded-md px-2 py-0.5 text-xs', item === active ? 'bg-surface font-semibold text-fg shadow-card' : 'text-muted')}>
            {t(itemKey(group, item))}
          </span>
        ))}
      </span>
    ) : null
  const boxStart = startItem(draft, 'tasks.boxes', boxes as ScreenItem<'tasks.boxes'>[])
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {seg('tasks.screens', screens, start)}
      {inbox ? (
        <>
          {seg('tasks.views', visibleItems(draft, 'tasks.views'), startItem(draft, 'tasks.views'))}
          {boxes.length > 1 ? (
            seg('tasks.boxes', boxes, boxStart)
          ) : (
            <span className="px-1 text-xs font-bold text-fg">
              {t(itemKey('tasks.screens', 'inbox'))} · {t(itemKey('tasks.boxes', boxes[0]!))}
            </span>
          )}
        </>
      ) : (
        screens.length === 1 && <span className="px-1 text-xs font-bold text-fg">{t(itemKey('tasks.screens', 'list'))}</span>
      )}
      {visibleItems(draft, 'tasks.filters').map((filter) => (
        <span key={filter} className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-muted">
          {t(itemKey('tasks.filters', filter))} ▾
        </span>
      ))}
      {perms.includes('tasks.create') &&
        visibleItems(draft, 'tasks.create').map((button) => (
          <span key={button} className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-fg">
            {t(itemKey('tasks.create', button))}
          </span>
        ))}
    </div>
  )
}
