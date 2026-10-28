import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Download, File as FileIcon, FileArchive, FileSpreadsheet, FileText, Loader2, Paperclip, Trash2, X } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatDateTime, formatRelative } from '@/core/utils/format'
import { extensionOf, formatBytes, type FileItem } from '@/domain/attachments'
import { AppIconButton, AppImageViewer } from '@/presentation/components'
import type { PendingUpload } from './use-attachment-uploader'

/** Arquivos em envio / recusados (um por linha, com o motivo). */
export function PendingUploads({ items, onDismiss }: { items: PendingUpload[]; onDismiss: (key: string) => void }) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-1.5" aria-live="polite">
      {items.map((item) => (
        <li
          key={item.key}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
            item.error ? 'bg-danger-soft text-danger-soft-fg' : 'bg-surface-2 text-muted',
          )}
        >
          {item.error ? <AlertCircle className="size-4 shrink-0" aria-hidden /> : <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />}
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{item.name}</span> — {item.error ? t(`validation.${item.error}`, { defaultValue: item.error }) : t('attachments.uploading')}
          </span>
          {item.error && <AppIconButton size="sm" label={t('common.close')} icon={<X />} onClick={() => onDismiss(item.key)} />}
        </li>
      ))}
    </ul>
  )
}

/**
 * Endereços temporários das imagens (miniatura antes do envio): cada arquivo ganha o seu uma vez; o de
 * quem sai da lista é liberado, e todos ao desmontar. Sem suporte, a miniatura não aparece (fica o nome).
 */
function usePreviewUrls(files: File[]): Map<File, string> {
  const cache = useRef(new Map<File, string>())
  const [urls, setUrls] = useState<Map<File, string>>(() => new Map())
  useEffect(() => {
    const current = cache.current
    let alive = true
    let changed = false
    current.forEach((url, file) => {
      if (files.includes(file)) return
      URL.revokeObjectURL(url)
      current.delete(file)
      changed = true
    })
    files.forEach((file) => {
      if (current.has(file) || !file.type.startsWith('image/')) return
      try {
        current.set(file, URL.createObjectURL(file))
        changed = true
      } catch {
        // sem miniatura: o arquivo aparece pelo nome
      }
    })
    // o estado muda fora do efeito (no próximo tique)
    if (changed) void Promise.resolve().then(() => alive && setUrls(new Map(current)))
    return () => {
      alive = false
    }
  }, [files])
  useEffect(() => {
    const current = cache.current
    return () => {
      current.forEach((url) => URL.revokeObjectURL(url))
      current.clear()
    }
  }, [])
  return urls
}

/**
 * Arquivos que vão junto ao salvar (colados, soltos ou escolhidos): imagens em miniatura, documentos
 * em linha; cada um sai pelo X.
 */
export function FilesToSend({ files, label, onRemove }: { files: File[]; label: string; onRemove: (index: number) => void }) {
  const { t, i18n } = useTranslation()
  const urls = usePreviewUrls(files)
  if (files.length === 0) return null
  return (
    <ul className="flex flex-wrap items-start gap-2" aria-label={label}>
      {files.map((file, index) => {
        const remove = <AppIconButton size="sm" label={t('comments.removeFile', { name: file.name })} icon={<X />} onClick={() => onRemove(index)} />
        const url = urls.get(file)
        return url ? (
          <li key={`${file.name}-${index}`} className="relative size-20 overflow-hidden rounded-lg border border-border bg-surface-2" title={file.name}>
            <img src={url} alt={file.name} className="size-full object-cover" />
            <span className="absolute right-1 top-1 rounded-md bg-surface/90">{remove}</span>
          </li>
        ) : (
          <li key={`${file.name}-${index}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 py-1 pl-2 pr-1 text-xs text-fg">
            <Paperclip className="size-3.5 shrink-0 text-muted" aria-hidden />
            <span className="truncate">{file.name}</span>
            <span className="text-muted">{formatBytes(file.size, i18n.language)}</span>
            {remove}
          </li>
        )
      })}
    </ul>
  )
}

function DocumentIcon({ name }: { name: string }) {
  const ext = extensionOf(name)
  const Icon = ['xlsx', 'xls', 'csv'].includes(ext) ? FileSpreadsheet : ext === 'zip' ? FileArchive : ['pdf', 'doc', 'docx', 'txt', 'md', 'log'].includes(ext) ? FileText : FileIcon
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
      <Icon className="size-4" aria-hidden />
    </span>
  )
}

/**
 * Imagens em galeria (abrem no visualizador) e documentos em lista.
 * `compact`: versão menor para dentro dos comentários.
 */
export function AttachmentGallery<T extends FileItem>({
  attachments,
  onDelete,
  compact = false,
  showHeadings = !compact,
}: {
  attachments: T[]
  onDelete?: (attachment: T) => void
  compact?: boolean
  showHeadings?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const [viewing, setViewing] = useState<number | null>(null)
  const images = attachments.filter((a) => a.kind === 'image')
  const documents = attachments.filter((a) => a.kind === 'document')
  const canDelete = (a: T) => !!onDelete && a.capabilities.delete

  return (
    <div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-5')}>
      {images.length > 0 && (
        <section aria-label={t('attachments.images')}>
          {showHeadings && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{t('attachments.imagesCount', { count: images.length })}</h3>}
          <ul className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'}>
            {images.map((image, index) => (
              <li key={image.id} className={cn('group relative overflow-hidden border border-border bg-surface-2', compact ? 'size-20 rounded-lg' : 'rounded-xl')}>
                <button
                  type="button"
                  onClick={() => setViewing(index)}
                  className={cn('block w-full focus-visible:outline-2 focus-visible:outline-ring', compact ? 'size-full' : 'aspect-square')}
                  aria-label={t('attachments.open', { name: image.name })}
                >
                  <img src={image.url} alt={image.name} loading="lazy" decoding="async" className="size-full object-cover transition-transform group-hover:scale-105" />
                </button>
                {!compact && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6">
                    <p className="truncate text-xs text-white">{image.name}</p>
                  </div>
                )}
                {canDelete(image) && (
                  <AppIconButton
                    size="sm"
                    variant="danger"
                    label={t('attachments.delete', { name: image.name })}
                    icon={<Trash2 />}
                    onClick={() => onDelete?.(image)}
                    className="absolute right-1 top-1 bg-surface/90 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {documents.length > 0 && (
        <section aria-label={t('attachments.documents')}>
          {showHeadings && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{t('attachments.documentsCount', { count: documents.length })}</h3>}
          <ul className={cn('divide-y divide-border rounded-xl border border-border bg-surface', compact && 'rounded-lg')}>
            {documents.map((doc) => (
              <li key={doc.id} className={cn('flex items-center gap-3', compact ? 'px-2 py-1.5' : 'px-3 py-2.5')}>
                <DocumentIcon name={doc.name} />
                <div className="min-w-0 flex-1">
                  <a href={`${doc.url}?download=1`} className="block truncate text-sm font-medium text-fg hover:text-primary-text" download={doc.name}>
                    {doc.name}
                  </a>
                  <p className="truncate text-xs text-muted">
                    {formatBytes(doc.size, locale)}
                    {!compact && (
                      <>
                        {' '}
                        · {doc.uploadedBy?.name ?? '—'} ·{' '}
                        <time dateTime={doc.createdAt?.toISOString()} title={formatDateTime(doc.createdAt, locale)}>
                          {formatRelative(doc.createdAt, locale)}
                        </time>
                      </>
                    )}
                  </p>
                </div>
                {doc.mime === 'application/pdf' && (
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary-text hover:underline">
                    {t('attachments.view')}
                  </a>
                )}
                <a
                  href={`${doc.url}?download=1`}
                  download={doc.name}
                  aria-label={t('attachments.download', { name: doc.name })}
                  title={t('attachments.download', { name: doc.name })}
                  className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                >
                  <Download className="size-4" />
                </a>
                {canDelete(doc) && (
                  <AppIconButton size="sm" variant="danger" label={t('attachments.delete', { name: doc.name })} icon={<Trash2 />} onClick={() => onDelete?.(doc)} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <AppImageViewer
        images={images.map((image) => ({ id: image.id, src: image.url, name: image.name, downloadUrl: `${image.url}?download=1` }))}
        index={viewing}
        onIndexChange={setViewing}
      />
    </div>
  )
}
