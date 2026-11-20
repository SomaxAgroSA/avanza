import { Factory } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { CompanyRef } from '@/domain/companies'

/** Chip da empresa (§46) com o nome (a sigla no título); sem empresa = "—". */
export function CompanyChip({ company, className }: { company: CompanyRef | null | undefined; className?: string }) {
  if (!company) return <span className={cn('text-subtle', className)}>—</span>
  return (
    <span
      title={company.shortCode ? `${company.name} (${company.shortCode})` : company.name}
      className={cn('inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-fg', className)}
    >
      <Factory aria-hidden className="size-3 shrink-0 text-muted" />
      <span className="truncate">{company.name}</span>
    </span>
  )
}
