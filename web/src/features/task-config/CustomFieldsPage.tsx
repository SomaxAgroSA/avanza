import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { acceptsNewOptions, FIELD_FLAGS, FIELD_TYPES, FIELD_TYPE_INFO, type CustomField, type FieldValue } from '@/domain/task-config'
import {
  AppBadge,
  AppButton,
  AppConfirmDialog,
  AppDataTable,
  AppDrawer,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { ColorDot, FieldTypeLabel } from './config-visuals'
import { CustomFieldFormDialog } from './CustomFieldFormDialog'
import { CustomFieldInput } from './CustomFieldInput'
import { useCustomFieldMutations, useCustomFields } from './queries'

const EMPTY: CustomField[] = []

/** Resumo da configuração do campo ("3 opções", "até 255 caracteres"…). */
function useSummary() {
  const { t } = useTranslation()
  return (field: CustomField): string => {
    if (FIELD_TYPE_INFO[field.type].options) return t('fields.optionsCount', { count: field.options.length })
    const c = field.config
    if (c.max_length !== undefined) return t('fields.config.upTo', { max: c.max_length })
    if (c.min !== undefined && c.max !== undefined) return t('fields.range', { min: c.min, max: c.max })
    if (c.min !== undefined) return t('fields.min', { min: c.min })
    if (c.max !== undefined) return t('fields.max', { max: c.max })
    return '—'
  }
}

export function CustomFieldsPage() {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const fields = useCustomFields()
  const { remove } = useCustomFieldMutations()
  const table = useDataTableState('custom-fields', { sort: { id: 'label', direction: 'asc' } })
  const summary = useSummary()

  const [viewing, setViewing] = useState<CustomField | null>(null)
  const [editing, setEditing] = useState<CustomField | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<CustomField | null>(null)

  // Biblioteca pequena: busca, filtro e ordenação no cliente.
  const rows = useMemo(() => {
    const search = table.state.search.trim().toLowerCase()
    const type = table.state.filters.type
    const list = (fields.data ?? []).filter(
      (f) => (!type || f.type === type) && (!search || f.label.toLowerCase().includes(search) || f.name.includes(search)),
    )
    const factor = table.state.sort?.direction === 'desc' ? -1 : 1
    return [...list].sort((a, b) => a.label.localeCompare(b.label) * factor)
  }, [fields.data, table.state.search, table.state.filters.type, table.state.sort])

  const columns = useMemo<DataTableColumn<CustomField>[]>(
    () => [
      {
        id: 'label',
        header: t('fields.fields.label'),
        sortable: true,
        hideable: false,
        pinned: true,
        size: 260,
        cell: (field) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{field.label}</p>
            <p className="truncate font-mono text-xs text-muted">{field.name}</p>
          </div>
        ),
      },
      {
        id: 'type',
        header: t('fields.fields.type'),
        size: 190,
        cell: (field) => <FieldTypeLabel type={field.type} />,
        filter: { label: t('fields.fields.type'), options: FIELD_TYPES.map((type) => ({ value: type, label: t(`fields.types.${type}`) })) },
      },
      {
        id: 'config',
        header: t('fields.details'),
        size: 200,
        cell: (field) =>
          FIELD_TYPE_INFO[field.type].options ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {field.options.slice(0, 4).map((o) => (
                <ColorDot key={o.id} color={o.color} />
              ))}
              <span className="truncate text-muted">{summary(field)}</span>
            </span>
          ) : (
            <span className="text-muted">{summary(field)}</span>
          ),
      },
      {
        id: 'flags',
        header: t('fields.behavior'),
        size: 240,
        cell: (field) => (
          <span className="flex flex-wrap gap-1">
            {FIELD_FLAGS.filter((flag) => field[flag]).map((flag) => (
              <AppBadge key={flag}>{t(`fields.flagsShort.${flag}`)}</AppBadge>
            ))}
            {acceptsNewOptions(field) && <AppBadge>{t('fields.allowCreateOptionsShort')}</AppBadge>}
            {!FIELD_FLAGS.some((flag) => field[flag]) && !acceptsNewOptions(field) && <span className="text-subtle">—</span>}
          </span>
        ),
      },
      {
        id: 'used_by',
        header: t('fields.usedBy'),
        size: 220,
        cell: (field) =>
          field.usedBy.length === 0 ? (
            <span className="text-subtle">{t('fields.unused')}</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {field.usedBy.map((type) => (
                <Link key={type.id} to={`/settings/task-types/${type.id}`} className="rounded-full focus-visible:outline-2 focus-visible:outline-ring">
                  <AppBadge tone="primary">{type.name}</AppBadge>
                </Link>
              ))}
            </span>
          ),
      },
    ],
    [t, summary],
  )

  return (
    <>
      <PageHeader
        title={t('fields.title')}
        description={t('fields.description')}
        actions={
          <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
            {t('fields.create')}
          </AppButton>
        }
      />
      <AppDataTable
        caption={t('fields.title')}
        columns={columns}
        data={rows.length ? rows : EMPTY}
        total={rows.length}
        getRowId={(field) => field.id}
        table={table}
        paginated={false}
        loading={fields.isPending}
        fetching={fields.isFetching}
        error={fields.isError ? { correlationId: isAppError(fields.error) ? fields.error.correlationId : undefined } : null}
        onRetry={() => void fields.refetch()}
        searchPlaceholder={t('fields.searchPlaceholder')}
        actions={{
          onView: setViewing,
          onEdit: setEditing,
          onDelete: setDeleting,
          canDelete: (field) => field.usedBy.length === 0,
          deleteLabel: (field) => (field.usedBy.length === 0 ? t('common.delete') : t('fields.cannotDeleteUsed')),
        }}
      />

      <FieldDetailsDrawer
        field={viewing}
        onOpenChange={(open) => !open && setViewing(null)}
        onEdit={(field) => {
          setViewing(null)
          setEditing(field)
        }}
      />
      <CustomFieldFormDialog
        open={creating || !!editing}
        field={editing}
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
        title={t('fields.deleteTitle', { name: deleting?.label ?? '' })}
        description={t('fields.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('fields.deleted', { name: deleting.label }))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-fg">{children}</dd>
    </div>
  )
}

function FieldDetailsDrawer({ field, onOpenChange, onEdit }: { field: CustomField | null; onOpenChange: (open: boolean) => void; onEdit: (field: CustomField) => void }) {
  const { t } = useTranslation()
  const summary = useSummary()
  const [preview, setPreview] = useState<FieldValue>(null)
  return (
    <AppDrawer
      open={!!field}
      onOpenChange={(open) => {
        onOpenChange(open)
        setPreview(null)
      }}
      title={field?.label ?? ''}
      description={field?.name}
      footer={
        field && (
          <AppButton variant="secondary" onClick={() => onEdit(field)}>
            {t('common.edit')}
          </AppButton>
        )
      }
    >
      {field && (
        <div className="flex flex-col gap-5">
          <dl className="divide-y divide-border rounded-lg border border-border px-4">
            <Row label={t('fields.fields.type')}>
              <FieldTypeLabel type={field.type} />
            </Row>
            <Row label={t('fields.details')}>{summary(field)}</Row>
            <Row label={t('fields.behavior')}>
              {[
                ...FIELD_FLAGS.filter((flag) => field[flag]).map((flag) => t(`fields.flagsShort.${flag}`)),
                ...(acceptsNewOptions(field) ? [t('fields.allowCreateOptionsShort')] : []),
              ].join(', ') || '—'}
            </Row>
            <Row label={t('fields.usedBy')}>{field.usedBy.map((type) => type.name).join(', ') || t('fields.unused')}</Row>
          </dl>
          {field.options.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{t('fields.optionsTitle')}</h3>
              <ul className="flex flex-wrap gap-1.5">
                {field.options.map((o) => (
                  <li key={o.id}>
                    <AppBadge className={o.isActive ? undefined : 'line-through opacity-60'}>
                      <ColorDot color={o.color} /> {o.label}
                    </AppBadge>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="rounded-xl border border-dashed border-border p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">{t('fields.preview')}</h3>
            <CustomFieldInput field={field} value={preview ?? field.defaultValue} onChange={setPreview} />
          </section>
        </div>
      )}
    </AppDrawer>
  )
}
