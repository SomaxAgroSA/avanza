import { Tag as TagIcon } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { TagRef } from '@/domain/tasks'
import { optionText, optionTint } from '@/features/task-config/config-theme'

/** Selo de tag na cor configurada. */
export function TagBadge({ tag, className }: { tag: Pick<TagRef, 'name' | 'color'>; className?: string }) {
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', className)}
      style={{ color: optionText(tag.color), backgroundColor: optionTint(tag.color) }}
    >
      <TagIcon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{tag.name}</span>
    </span>
  )
}

/** Lista compacta de tags (mostra as primeiras e "+N"). */
export function TagList({ tags, max = 3, className, compact = false }: { tags: TagRef[]; max?: number; className?: string; compact?: boolean }) {
  if (tags.length === 0) return null
  const shown = tags.slice(0, max)
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((tag) => (
        <TagBadge key={tag.id} tag={tag} className={compact ? 'gap-0.5 px-1 py-0 text-[10px] [&>svg]:size-2.5' : undefined} />
      ))}
      {tags.length > max && (
        <span className="text-[11px] text-muted" title={tags.slice(max).map((t) => t.name).join(', ')}>
          +{tags.length - max}
        </span>
      )}
    </span>
  )
}
