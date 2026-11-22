import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import {
  coverTitle,
  defaultOptions,
  scopeChoices,
  selectExport,
  sheetEstimate,
  targetOf,
  validScope,
  type DocExport,
  type ExportOptions,
  type ExportOrigin,
  type ExportScope,
  type ScopeChoice,
} from '@/domain/doc-export'
import { AppButton, AppDialog, AppErrorState, AppSkeleton, AppSwitch } from '@/presentation/components'
import { printPath } from '../docs-paths'
import { useDocExport } from '../queries'

export interface ExportPdfDialogProps {
  /** De onde veio o pedido; null = fechada. */
  origin: ExportOrigin | null
  onOpenChange: (open: boolean) => void
  /** Escolha com que a janela abre (na vista de impressão, "Alterar seleção" reabre com a atual). */
  initial?: ExportOptions
  /** Sem ele, "Ver e imprimir" abre a vista de impressão. */
  onConfirm?: (options: ExportOptions) => void
}

/**
 * "Exportar PDF" (§43): à esquerda, o que exportar (cartões de escolha) e, com mais de uma página, "Capa e
 * índice" e "Incluir anexos"; à direita, a pilha de folhas e a estimativa (≈ folhas A4). "Ver e imprimir" leva
 * à vista de impressão, onde o navegador gera o PDF.
 */
export function ExportPdfDialog({ origin, onOpenChange, initial, onConfirm }: ExportPdfDialogProps) {
  const { t } = useTranslation()
  return (
    <AppDialog open={!!origin} onOpenChange={onOpenChange} title={t('docs.export.title')} size="xl" className="max-w-[57.5rem]">
      {origin && <DialogBody key={JSON.stringify(origin)} origin={origin} initial={initial} onClose={() => onOpenChange(false)} onConfirm={onConfirm} />}
    </AppDialog>
  )
}

function DialogBody({ origin, initial, onClose, onConfirm }: { origin: ExportOrigin; initial?: ExportOptions; onClose: () => void; onConfirm?: (options: ExportOptions) => void }) {
  const query = useDocExport(targetOf(origin))
  if (query.isPending) {
    return (
      <div className="space-y-2" aria-busy>
        <AppSkeleton className="h-16 rounded-xl" />
        <AppSkeleton className="h-16 rounded-xl" />
        <AppSkeleton className="h-16 rounded-xl" />
      </div>
    )
  }
  if (query.isError) return <AppErrorState onRetry={() => void query.refetch()} />
  return <Choices origin={origin} data={query.data} initial={initial ?? defaultOptions(origin)} onClose={onClose} onConfirm={onConfirm} />
}

function Choices({ origin, data, initial, onClose, onConfirm }: { origin: ExportOrigin; data: DocExport; initial: ExportOptions; onClose: () => void; onConfirm?: (options: ExportOptions) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [options, setOptions] = useState<ExportOptions>(() => ({ ...initial, scope: validScope(origin, data, initial.scope) }))
  const choices = scopeChoices(origin, data)
  const selection = selectExport(data, origin, options)
  const sheets = sheetEstimate(selection)
  const pages = t('docs.export.pages', { count: selection.total })
  const confirm = () => {
    if (onConfirm) onConfirm(options)
    else void navigate(printPath(origin, options))
    onClose()
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="flex min-w-0 flex-col">
        <div role="radiogroup" aria-label={t('docs.export.scopeLabel')} className="flex flex-col gap-2">
          {choices.map((choice) => (
            <ScopeCard
              key={choice.scope}
              choice={choice}
              data={data}
              origin={origin}
              checked={options.scope === choice.scope}
              onSelect={(scope) => setOptions((o) => ({ ...o, scope }))}
            />
          ))}
        </div>
        {selection.multiple && (
          <div className="mt-5 flex flex-col divide-y divide-border">
            <div className="py-2.5">
              <AppSwitch checked={options.cover} onCheckedChange={(cover) => setOptions((o) => ({ ...o, cover }))} label={t('docs.export.cover')} />
            </div>
            {selection.hasAnnexes && (
              <div className="py-2.5">
                <AppSwitch checked={options.annex} onCheckedChange={(annex) => setOptions((o) => ({ ...o, annex }))} label={t('docs.export.annex')} />
              </div>
            )}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <AppButton variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton leftIcon={<Printer />} onClick={confirm} disabled={selection.total === 0}>
            {t('docs.export.preview')}
          </AppButton>
        </div>
      </div>
      {/* a prévia: a pilha de folhas e quantas sairão (some em telas estreitas) */}
      <div aria-hidden className="hidden flex-col items-center justify-center gap-4 rounded-xl bg-surface-3 px-5 py-7 md:flex">
        <PaperStack many={selection.total > 1} cover={selection.cover} title={coverTitle(data, origin, options.scope)} />
        <p className="text-center text-sm text-fg">
          <span className="block font-display text-[1.375rem] font-bold" data-testid="export-sheets">
            {t('docs.export.sheets', { count: sheets })}
          </span>
          {selection.cover ? t('docs.export.withCover', { pages }) : pages}
        </p>
      </div>
    </div>
  )
}

function ScopeCard({ choice, data, origin, checked, onSelect }: { choice: ScopeChoice; data: DocExport; origin: ExportOrigin; checked: boolean; onSelect: (scope: ExportScope) => void }) {
  const { t } = useTranslation()
  const space = data.spaces[0]
  const title = choice.scope === 'module' ? t('docs.export.scope.module', { name: data.module?.name ?? '' }) : t(`docs.export.scope.${choice.scope}`)
  const subtitle =
    choice.scope === 'page'
      ? (space?.pages.find((p) => origin.kind === 'page' && p.id === origin.pageId)?.title ?? '')
      : choice.scope === 'branch'
        ? t('docs.export.pages', { count: choice.pages })
        : choice.scope === 'space'
          ? t('docs.export.spacePages', { count: choice.pages, space: space?.name ?? '' })
          : t('docs.export.moduleSummary', { spaces: t('docs.modules.spaces', { count: data.spaces.length }), pages: t('docs.export.pages', { count: choice.pages }) })
  return (
    <label
      className={cn(
        'grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 rounded-xl border-[1.5px] px-3.5 py-3 transition-colors',
        checked ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong',
      )}
    >
      <input type="radio" name="export-scope" value={choice.scope} checked={checked} onChange={() => onSelect(choice.scope)} className="row-span-2 mt-1 size-4 accent-primary" />
      <span className="min-w-0 font-semibold text-fg">{title}</span>
      <span className="col-start-2 min-w-0 truncate text-xs text-muted">{subtitle}</span>
    </label>
  )
}

/** Miniatura: a folha de cima (capa ou página) e, com várias páginas, mais duas por baixo. */
function PaperStack({ many, cover, title }: { many: boolean; cover: boolean; title: string }) {
  return (
    <div className="relative h-[17.7rem] w-[12.5rem]">
      {many && (
        <>
          <div className="kb-mini-sheet translate-x-5 translate-y-[1.1rem] rotate-[4deg]" />
          <div className="kb-mini-sheet translate-x-2.5 translate-y-2.5 rotate-[2deg]" />
        </>
      )}
      <div className="kb-mini-sheet">
        {cover ? (
          <div className="kb-mini-cover">
            <span className="kb-mini-cover-title">{title}</span>
            <span className="kb-mini-line" />
            <span className="kb-mini-line w-[70%]" />
          </div>
        ) : (
          <div className="flex h-full flex-col gap-1.5 px-[1.1rem] py-5">
            <span className="mb-2 h-[7px] w-3/5 rounded-sm bg-fg" />
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} className="kb-mini-line" />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
