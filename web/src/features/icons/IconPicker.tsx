import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { iconLabel } from '@/domain/icons'
import { AppFormField, AppIcon } from '@/presentation/components'
import { useCan } from '@/features/auth/session'
import { useIconLibrary } from './queries'

export interface IconPickerProps {
  label: string
  value: string
  onChange: (icon: string) => void
  /** Ícones padrão do lugar (projeto, tipo de tarefa, espaço) e os componentes deles. */
  builtins: readonly string[]
  components: Partial<Record<string, LucideIcon>>
  fallback: LucideIcon
  builtinLabel: (icon: string) => string
  /** Colunas da grade (cada lugar tem a sua largura). */
  gridClassName?: string
}

/**
 * Escolha de ícone (regras §25): os padrões do lugar e os da biblioteca da plataforma. Quem gerencia as
 * configurações vê o atalho para importar mais da galeria (abre em outra aba: o formulário não se perde).
 */
export function IconPicker({ label, value, onChange, builtins, components, fallback, builtinLabel, gridClassName }: IconPickerProps) {
  const { t } = useTranslation()
  const library = useIconLibrary()
  const canImport = useCan('settings.manage')
  const imported = (library.data ?? []).map((icon) => icon.name).filter((name) => !builtins.includes(name))
  const icons = [...builtins, ...imported]
  // o ícone atual sempre aparece, mesmo enquanto a biblioteca carrega
  if (value && !icons.includes(value)) icons.push(value)
  return (
    <AppFormField
      label={label}
      hint={
        canImport ? (
          <Link to="/settings/icons" target="_blank" rel="noopener" className="text-primary-text hover:underline">
            {t('icons.importMore')}
          </Link>
        ) : undefined
      }
    >
      {({ id }) => (
        <div id={id} role="radiogroup" aria-label={label} className={cn('grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1.5', gridClassName)}>
          {icons.map((icon) => {
            const selected = value === icon
            const name = builtins.includes(icon) ? builtinLabel(icon) : iconLabel(icon)
            return (
              <button
                key={icon}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={name}
                title={name}
                onClick={() => onChange(icon)}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-lg border text-muted transition-colors hover:bg-surface-2 hover:text-fg',
                  selected ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border',
                )}
              >
                <AppIcon name={icon} builtins={components} fallback={fallback} className="size-4" aria-hidden />
              </button>
            )
          })}
        </div>
      )}
    </AppFormField>
  )
}
