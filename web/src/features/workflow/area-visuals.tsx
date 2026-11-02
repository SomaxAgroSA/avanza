import { useTranslation } from 'react-i18next'
import { Building2 } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { Area, AreaRef } from '@/domain/workflow'
import { AppDropdown } from '@/presentation/components'
import { LookupBadge } from './workflow-visuals'

/** Selo da área responsável na cor configurada; sem área = texto apagado. */
export function AreaBadge({ area, className, iconOnly = false }: { area: AreaRef | null; className?: string; iconOnly?: boolean }) {
  const { t } = useTranslation()
  if (!area) return <span className={cn('truncate text-subtle', className)}>{t('areas.none')}</span>
  return <LookupBadge item={area} icon={Building2} iconOnly={iconOnly} className={className} />
}

/**
 * Área com um clique: para quem edita, abre o menu com as áreas ativas e "Sem área".
 * Serve para tarefas e projetos; `areas` vem da tela (uma consulta só para a lista inteira).
 */
export function AreaPicker({
  value,
  areas,
  canEdit,
  pending,
  changeLabel,
  onChoose,
}: {
  value: AreaRef | null
  /** Áreas ativas. */
  areas: Area[]
  canEdit: boolean
  pending?: boolean
  /** Nome acessível do botão (ex.: "Mudar área de CRM-3 (agora: Dpto. TI)"). */
  changeLabel: string
  onChoose: (areaId: string | null) => void
}) {
  const { t } = useTranslation()
  if (!canEdit) return <AreaBadge area={value} />
  const choose = (next: string | null) => {
    if (next !== (value?.id ?? null)) onChoose(next)
  }
  return (
    <AppDropdown
      align="start"
      trigger={
        <button
          type="button"
          disabled={pending}
          aria-label={changeLabel}
          className="-mx-1.5 flex max-w-full items-center rounded-md px-1.5 py-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
        >
          <AreaBadge area={value} />
        </button>
      }
      items={[
        ...areas.map((area) => ({ key: area.id, label: area.name, icon: <Building2 />, onSelect: () => choose(area.id) })),
        { type: 'separator' as const, key: 'sep' },
        { key: 'none', label: t('areas.none'), onSelect: () => choose(null) },
      ]}
    />
  )
}
