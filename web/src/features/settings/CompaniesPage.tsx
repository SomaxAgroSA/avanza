import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Plus, Power, PowerOff } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { filterCompanies, normalizeShortCode, type Company } from '@/domain/companies'
import {
  AppBadge,
  AppButton,
  AppConfirmDialog,
  AppDataTable,
  AppDialog,
  AppEmptyState,
  AppTextField,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCompanyMutations, useManagedCompanies } from '@/features/companies/queries'

const EMPTY: Company[] = []

/**
 * Configurações → Empresas (platform.manage; regras §46): grade padrão com busca, ordenação e filtro de
 * estado. Não se exclui: desativa-se (a inativa continua nos projetos e demandas que já a usam).
 */
export function CompaniesPage() {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const companies = useManagedCompanies()
  const { update } = useCompanyMutations()
  const table = useDataTableState('companies', { sort: { id: 'name', direction: 'asc' } })
  const [editing, setEditing] = useState<Company | 'new' | null>(null)
  const [deactivating, setDeactivating] = useState<Company | null>(null)
  useDocumentTitle(t('companies.title'))

  const rows = useMemo(
    () => filterCompanies(companies.data ?? EMPTY, { search: table.state.search, state: table.state.filters.state, sort: table.state.sort }),
    [companies.data, table.state.search, table.state.filters.state, table.state.sort],
  )

  const setActive = (company: Company, active: boolean) =>
    update.mutate(
      { id: company.id, data: { active } },
      {
        onSuccess: () => {
          setDeactivating(null)
          notify.success(t(active ? 'companies.activated' : 'companies.deactivated', { name: company.name }))
        },
        onError: (error) => notify.error(errorMessage(error)),
      },
    )

  const columns = useMemo<DataTableColumn<Company>[]>(
    () => [
      { id: 'name', header: t('companies.columns.name'), sortable: true, hideable: false, cell: (c) => <span className="font-medium text-fg">{c.name}</span> },
      { id: 'shortCode', header: t('companies.columns.shortCode'), sortable: true, cell: (c) => (c.shortCode ? <span className="font-mono text-xs">{c.shortCode}</span> : '—') },
      { id: 'usage', header: t('companies.columns.usage'), sortable: true, sortDescFirst: true, align: 'end', cell: (c) => <span className="tabular-nums">{c.usageCount}</span> },
      {
        id: 'state',
        header: t('companies.columns.state'),
        sortable: true,
        cell: (c) => <AppBadge tone={c.active ? 'success' : 'neutral'}>{c.active ? t('companies.active') : t('companies.inactive')}</AppBadge>,
        filter: {
          label: t('companies.columns.state'),
          options: [
            { value: 'active', label: t('companies.active') },
            { value: 'inactive', label: t('companies.inactive') },
          ],
        },
      },
    ],
    [t],
  )

  return (
    <>
      <PageHeader
        title={t('companies.title')}
        actions={
          <AppButton leftIcon={<Plus />} onClick={() => setEditing('new')}>
            {t('companies.create')}
          </AppButton>
        }
      />
      <AppDataTable
        tableId="companies"
        caption={t('companies.title')}
        columns={columns}
        data={rows}
        total={rows.length}
        loading={companies.isPending}
        fetching={companies.isFetching}
        error={companies.isError ? { correlationId: isAppError(companies.error) ? companies.error.correlationId : undefined } : null}
        onRetry={() => void companies.refetch()}
        getRowId={(c) => c.id}
        table={table}
        paginated={false}
        searchPlaceholder={t('companies.searchPlaceholder')}
        actions={{
          onEdit: (c) => setEditing(c),
          onDelete: (c) => (c.active ? setDeactivating(c) : setActive(c, true)),
          deleteLabel: (c) => (c.active ? t('companies.deactivate') : t('companies.activate')),
          deleteName: t('companies.deactivate'),
          deleteIcon: (c) => (c.active ? <PowerOff /> : <Power />),
          deleteTone: (c) => (c.active ? 'danger' : 'ghost'),
          hideMore: true,
        }}
        emptyState={<AppEmptyState compact icon={<Building2 />} title={t('companies.empty')} />}
      />
      {editing && <CompanyDialog company={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <AppConfirmDialog
        open={!!deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={t('companies.deactivateTitle', { name: deactivating?.name ?? '' })}
        description={t('companies.deactivateDescription')}
        confirmLabel={t('companies.deactivate')}
        tone="danger"
        loading={update.isPending}
        onConfirm={() => deactivating && setActive(deactivating, false)}
      />
    </>
  )
}

function CompanyDialog({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { create, update } = useCompanyMutations()
  const [name, setName] = useState(company?.name ?? '')
  const [shortCode, setShortCode] = useState(company?.shortCode ?? '')
  const [errors, setErrors] = useState<{ name?: string; shortCode?: string }>({})
  const pending = create.isPending || update.isPending

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return setErrors({ name: 'required' })
    const data = { name: trimmed, shortCode: normalizeShortCode(shortCode) }
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'COMPANY_NAME_IN_USE') return setErrors({ name: t('companies.nameInUse') })
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
        const fields = error.fieldErrors()
        return setErrors({ name: fields.name, shortCode: fields.short_code })
      }
      notify.error(errorMessage(error))
    }
    const onSuccess = () => {
      notify.success(t(company ? 'companies.updated' : 'companies.created', { name: trimmed }))
      onClose()
    }
    if (company) update.mutate({ id: company.id, data }, { onSuccess, onError })
    else create.mutate(data, { onSuccess, onError })
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t(company ? 'companies.editTitle' : 'companies.createTitle')}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {t('common.save')}
          </AppButton>
        </>
      }
    >
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <AppTextField
          label={t('companies.name')}
          required
          autoComplete="off"
          maxLength={120}
          value={name}
          error={errors.name}
          onChange={(event) => {
            setName(event.target.value)
            setErrors((prev) => ({ ...prev, name: undefined }))
          }}
        />
        <AppTextField
          label={t('companies.shortCode')}
          autoComplete="off"
          maxLength={10}
          value={shortCode}
          error={errors.shortCode}
          onChange={(event) => {
            setShortCode(event.target.value.toUpperCase())
            setErrors((prev) => ({ ...prev, shortCode: undefined }))
          }}
        />
      </form>
    </AppDialog>
  )
}
