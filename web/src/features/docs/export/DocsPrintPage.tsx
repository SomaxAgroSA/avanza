import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, BookX, FileX, Printer } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDate } from '@/core/utils/format'
import { coverTitle, parsePrintSearch, printSearch, selectExport, targetOf, validScope, type DocExport, type DocExportPage, type DocExportSpace, type ExportOptions, type ExportOrigin, type ExportSelection } from '@/domain/doc-export'
import { DEFAULT_BRANDING } from '@/domain/platform'
import { AppButton, AppEmptyState, AppErrorState, AppSkeleton, AppToolbar } from '@/presentation/components'
import { AppRichTextView } from '@/presentation/components/rich-text'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { useSession } from '@/features/auth/session'
import { pagePath } from '../docs-paths'
import { useDocExport } from '../queries'
import { ExportPdfDialog } from './ExportPdfDialog'

/**
 * Vista de impressão da documentação (`/print/docs?…`, §43, ADR-059): dentro do app autenticado, sem menu nem
 * barra; folhas A4 — capa, índice e cada página numa folha nova, com o mesmo leitor da página — e o navegador
 * imprime ou salva em PDF. Só o publicado. A escolha fica no endereço (o "voltar" e o recarregar funcionam).
 */
export function DocsPrintPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const request = useMemo(() => parsePrintSearch(params), [params])
  usePaperTheme()
  if (!request) {
    return (
      <PrintDesk>
        <AppEmptyState
          icon={<BookX />}
          title={t('docs.space.notFound')}
          action={
            <AppButton asChild variant="secondary">
              <Link to="/docs">{t('docs.backToDocs')}</Link>
            </AppButton>
          }
        />
      </PrintDesk>
    )
  }
  return <PrintView origin={request.origin} options={request.options} />
}

/** Volta para onde a exportação foi pedida. */
function backPath(origin: ExportOrigin): string {
  if (origin.kind === 'page') return pagePath(origin.spaceKey, origin.pageId)
  if (origin.kind === 'module') return `/docs?module=${encodeURIComponent(origin.moduleId)}`
  return '/docs'
}

function PrintView({ origin, options }: { origin: ExportOrigin; options: ExportOptions }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [, setParams] = useSearchParams()
  const [changing, setChanging] = useState(false)
  const query = useDocExport(targetOf(origin))
  const selection = useMemo(() => (query.data ? selectExport(query.data, origin, options) : null), [query.data, origin, options])
  const title = query.data ? coverTitle(query.data, origin, validScope(origin, query.data, options.scope)) : ''
  useDocumentTitle(selection?.total === 1 ? (selection.groups[0]?.pages[0]?.title ?? title) : title)
  usePageRules(!!selection?.cover)
  const sheets = useRef<HTMLDivElement>(null)
  const ready = useImagesReady(sheets, selection)

  const scopeLabel = selection && query.data ? labelOf(t, origin, options, query.data) : ''
  const pages = t('docs.export.pages', { count: selection?.total ?? 0 })

  return (
    <PrintDesk>
      <div data-print="hide" className="sticky top-0 z-20 border-b border-border bg-surface px-4 py-2.5 sm:px-6">
        <AppToolbar>
          <AppButton variant="ghost" leftIcon={<ArrowLeft />} onClick={() => void navigate(backPath(origin))}>
            {t('docs.export.back')}
          </AppButton>
          {selection && (
            <span className="min-w-0 truncate text-sm">
              <span className="font-semibold text-fg">{scopeLabel}</span>{' '}
              <span className="text-muted">{selection.cover ? t('docs.export.summaryCover', { pages }) : pages}</span>
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <AppButton variant="secondary" onClick={() => setChanging(true)} disabled={!query.data}>
              {t('docs.export.change')}
            </AppButton>
            <AppButton leftIcon={<Printer />} loading={!!selection && selection.total > 0 && !ready} disabled={!selection || selection.total === 0 || !ready} onClick={() => window.print()}>
              {t('docs.export.print')}
            </AppButton>
          </span>
        </AppToolbar>
      </div>

      {query.isPending ? (
        <div className="kb-sheet space-y-4">
          <AppSkeleton className="h-6 w-1/3" />
          <AppSkeleton className="h-10 w-2/3" />
          <AppSkeleton className="h-96" />
        </div>
      ) : query.isError ? (
        isAppError(query.error) && (query.error.code === 'DOC_SPACE_NOT_FOUND' || query.error.code === 'DOC_MODULE_NOT_FOUND') ? (
          <div className="py-16">
            <AppEmptyState icon={<BookX />} title={t('docs.space.notFound')} />
          </div>
        ) : (
          <div className="py-16">
            <AppErrorState onRetry={() => void query.refetch()} />
          </div>
        )
      ) : selection && selection.total === 0 ? (
        <div className="py-16">
          <AppEmptyState icon={<FileX />} title={t('docs.export.empty')} />
        </div>
      ) : (
        selection && (
          <div ref={sheets} data-testid="print-sheets">
            <Sheets data={query.data} origin={origin} options={options} selection={selection} title={title} />
          </div>
        )
      )}

      <ExportPdfDialog
        origin={changing ? origin : null}
        initial={options}
        onOpenChange={setChanging}
        onConfirm={(next) => setParams(new URLSearchParams(printSearch(origin, next)), { replace: true })}
      />
    </PrintDesk>
  )
}

/** Nome da escolha na barra (a mesma regra da janela: o que não vale para a origem vira a primeira opção). */
function labelOf(t: ReturnType<typeof useTranslation>['t'], origin: ExportOrigin, options: ExportOptions, data: DocExport): string {
  const scope = validScope(origin, data, options.scope)
  return scope === 'module' ? t('docs.export.scope.module', { name: data.module?.name ?? '' }) : t(`docs.export.scope.${scope}`)
}

/** Fundo da "mesa" onde ficam as folhas (no papel, branco). */
function PrintDesk({ children }: { children: React.ReactNode }) {
  return <div className="kb-print-desk">{children}</div>
}

interface SheetsProps {
  data: DocExport
  origin: ExportOrigin
  options: ExportOptions
  selection: ExportSelection
  title: string
}

/** Capa e índice (com mais de uma página), as aberturas dos espaços (módulo) e uma folha por página. */
function Sheets({ data, origin, options, selection, title }: SheetsProps) {
  const { t, i18n } = useTranslation()
  const today = formatDate(new Date(), i18n.language)
  const numbered = selection.total > 1
  let number = 0
  const numberOf = new Map<string, number>()
  selection.groups.forEach((g) => g.pages.forEach((p) => numberOf.set(p.id, ++number)))
  return (
    <>
      {selection.cover && <CoverSheet data={data} origin={origin} options={options} selection={selection} title={title} today={today} />}
      {selection.cover && <IndexSheet selection={selection} title={title} numberOf={numberOf} />}
      {selection.groups.map((group) => (
        <Fragment key={group.space.id}>
          {selection.dividers && <SpaceDivider space={group.space} pages={group.pages.length} today={today} />}
          {group.pages.map((page) => (
            <PageSheet key={page.id} space={group.space} page={page} number={numbered ? numberOf.get(page.id) : undefined} today={today} />
          ))}
        </Fragment>
      ))}
      <span className="sr-only">{t('docs.export.pages', { count: selection.total })}</span>
    </>
  )
}

function CoverSheet({ data, origin, selection, title, today }: SheetsProps & { today: string }) {
  const { t } = useTranslation()
  const platform = usePlatformInfo()
  const me = useSession().current?.user.name ?? ''
  const isModule = origin.kind === 'module'
  const space = data.spaces[0]
  const moduleName = isModule ? data.module?.name : space?.module?.name
  const pages = t('docs.export.pages', { count: selection.total })
  return (
    <section className="kb-sheet kb-sheet-cover" aria-label={title}>
      <div className="kb-cover-band" />
      <div className="kb-cover-body">
        <p className="kb-cover-brand">
          <img src={platform.faviconUrl ?? DEFAULT_BRANDING.favicon} alt="" className="size-[26px] rounded-[7px]" />
          {t('docs.export.brand', { name: platform.name })}
        </p>
        <p className="kb-cover-kind">{isModule ? t('docs.export.kindModule', { name: data.module?.name ?? '' }) : t('docs.export.kindDocs')}</p>
        <h1 className="kb-cover-title">{title}</h1>
        {!isModule && space?.description && <p className="kb-cover-description">{space.description}</p>}
        <dl className="kb-cover-facts">
          {moduleName && (
            <>
              <dt>{t('docs.export.fields.module')}</dt>
              <dd>{moduleName}</dd>
            </>
          )}
          {isModule ? (
            <>
              <dt>{t('docs.export.fields.spaces')}</dt>
              <dd>{selection.groups.map((g) => g.space.name).join(' · ')}</dd>
            </>
          ) : (
            space?.project && (
              <>
                <dt>{t('docs.export.fields.project')}</dt>
                <dd>
                  {space.project.key} · {space.project.name}
                </dd>
              </>
            )
          )}
          <dt>{t('docs.export.fields.content')}</dt>
          <dd>{t('docs.export.contentValue', { pages })}</dd>
          <dt>{t('docs.export.fields.exported')}</dt>
          <dd>{t('docs.export.exportedValue', { date: today, name: me })}</dd>
        </dl>
      </div>
    </section>
  )
}

function IndexSheet({ selection, title, numberOf }: { selection: ExportSelection; title: string; numberOf: Map<string, number> }) {
  const { t, i18n } = useTranslation()
  return (
    <section className="kb-sheet" aria-labelledby="print-index-title">
      <RunningHeader left={title} right={t('docs.export.index')} />
      <h2 id="print-index-title" className="kb-index-title">
        {t('docs.export.index')}
      </h2>
      {selection.groups.map((group) => (
        <Fragment key={group.space.id}>
          {selection.dividers && <p className="kb-index-space">{group.space.name}</p>}
          <ol className="kb-index">
            {group.pages.map((page) => (
              <li key={page.id}>
                <span className="kb-index-number">{numberOf.get(page.id)}</span>
                <span>
                  {page.title}
                  <span className="block text-xs text-muted">{t('docs.export.versionLine', { version: page.version, date: formatDate(page.publishedAt, i18n.language) })}</span>
                </span>
              </li>
            ))}
          </ol>
        </Fragment>
      ))}
    </section>
  )
}

/** Abertura de cada espaço na exportação de um módulo. */
function SpaceDivider({ space, pages, today }: { space: DocExportSpace; pages: number; today: string }) {
  const { t } = useTranslation()
  return (
    <section className="kb-sheet kb-sheet-divider" aria-label={space.name}>
      <RunningHeader left={space.name} right={[space.module?.name, today].filter(Boolean).join(' · ')} />
      <p className="kb-cover-kind">{t('docs.export.kindSpace')}</p>
      <h2 className="kb-divider-title">{space.name}</h2>
      {space.description && <p className="kb-cover-description">{space.description}</p>}
      <p className="text-sm text-muted">{t('docs.export.pages', { count: pages })}</p>
    </section>
  )
}

function PageSheet({ space, page, number, today }: { space: DocExportSpace; page: DocExportPage; number?: number; today: string }) {
  const { t, i18n } = useTranslation()
  const date = formatDate(page.publishedAt, i18n.language)
  return (
    <section className="kb-sheet" aria-labelledby={`print-page-${page.id}`} data-page-id={page.id}>
      <RunningHeader left={space.name} right={[space.module?.name, today].filter(Boolean).join(' · ')} />
      {number !== undefined && <p className="kb-page-number">{number}</p>}
      <h1 id={`print-page-${page.id}`} className="kb-page-title">
        {page.title}
      </h1>
      <p className="kb-page-meta">
        {page.publishedBy
          ? t('docs.export.pageMeta', { version: page.version, date, name: page.publishedBy.name })
          : t('docs.export.pageMetaAnonymous', { version: page.version, date })}
      </p>
      {/* o mesmo leitor da página: destaques, tabelas, imagens, código e links iguais à tela */}
      <AppRichTextView content={page.content} />
    </section>
  )
}

function RunningHeader({ left, right }: { left: string; right: string }) {
  return (
    <div className="kb-sheet-run">
      <b>{left}</b>
      <span>{right}</span>
    </div>
  )
}

/** Folhas sempre claras: enquanto a vista está aberta, o tema escuro sai (o papel é branco). */
function usePaperTheme() {
  useEffect(() => {
    const root = document.documentElement
    const dark = root.classList.contains('dark')
    root.classList.remove('dark')
    return () => {
      if (dark) root.classList.add('dark')
    }
  }, [])
}

/** Escapa um texto para o `content` do CSS. */
const cssString = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * Regras da folha (só enquanto a vista está aberta): A4 com margens, "marca" embaixo à esquerda e "n / total"
 * embaixo à direita; com capa, a primeira folha sem margens nem rodapé.
 */
function usePageRules(cover: boolean) {
  const { t } = useTranslation()
  const { name } = usePlatformInfo()
  const brand = t('docs.export.brand', { name })
  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.printRules = ''
    const foot = 'font: 9pt "Figtree Variable", system-ui, sans-serif; color: var(--kb-text-muted, #5f6e65);'
    style.textContent = [
      `@page { size: A4; margin: 16mm 15mm 18mm; @bottom-left { content: ${cssString(brand)}; ${foot} } @bottom-right { content: counter(page) " / " counter(pages); ${foot} } }`,
      cover ? '@page :first { margin: 0; @bottom-left { content: none } @bottom-right { content: none } }' : '',
    ].join('\n')
    document.head.appendChild(style)
    return () => style.remove()
  }, [brand, cover])
}

/**
 * Imprimir só com tudo carregado: as fontes e as imagens das páginas (o leitor monta o conteúdo depois do
 * primeiro desenho, então a lista de imagens é conferida de novo a cada mudança nas folhas). Uma imagem que
 * falha não segura a impressão; depois de 20 s, libera de qualquer jeito.
 */
function useImagesReady(container: React.RefObject<HTMLDivElement | null>, selection: ExportSelection | null): boolean {
  // pronta para esta seleção (trocar a seleção volta a esperar)
  const [readyFor, setReadyFor] = useState<ExportSelection | null>(null)
  useEffect(() => {
    const root = container.current
    if (!root || !selection) return
    let done = false
    let fontsReady = !document.fonts
    const finish = () => {
      if (done) return
      done = true
      setReadyFor(selection)
    }
    // cada página tem o seu leitor: espera todos aparecerem antes de olhar as imagens
    const expected = selection.total
    const check = () => {
      if (done || !fontsReady) return
      if (root.querySelectorAll('.kb-rich').length < expected) return
      // as imagens do conteúdo (a marca da capa é a mesma do app, já carregada)
      const images = Array.from(root.querySelectorAll<HTMLImageElement>('.kb-rich img'))
      if (images.every((img) => img.complete)) finish()
    }
    const onLoad = (event: Event) => {
      if ((event.target as HTMLElement).tagName === 'IMG') check()
    }
    root.addEventListener('load', onLoad, true)
    root.addEventListener('error', onLoad, true)
    const observer = new MutationObserver(check)
    observer.observe(root, { childList: true, subtree: true })
    void document.fonts?.ready.then(() => {
      fontsReady = true
      check()
    })
    const timer = window.setTimeout(finish, 20_000)
    // o leitor desenha as páginas logo depois: confere na próxima volta
    const tick = window.setTimeout(check, 0)
    return () => {
      done = true
      observer.disconnect()
      root.removeEventListener('load', onLoad, true)
      root.removeEventListener('error', onLoad, true)
      window.clearTimeout(timer)
      window.clearTimeout(tick)
    }
  }, [container, selection])
  return !!selection && readyFor === selection
}
