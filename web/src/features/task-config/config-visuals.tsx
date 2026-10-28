import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { isHexColor, parseHexInput, type HexColor } from '@/domain/colors'
import { OPTION_COLORS, type FieldType, type OptionColor, type TaskTypeIcon } from '@/domain/task-config'
import { AppFormField, AppPopover, AppTextField } from '@/presentation/components'
import { FIELD_TYPE_ICONS, TASK_TYPE_ICON_COMPONENTS, optionColor, optionTint } from './config-theme'

/**
 * Escolha de cor: a paleta (radiogroup acessível) e a cor personalizada (regras §24). `onPick` avisa só
 * a escolha de uma cor da paleta (o ColorButton fecha); a personalizada muda enquanto a pessoa ajusta.
 */
export function ColorPicker({ label, value, onChange, onPick }: { label: string; value: OptionColor; onChange: (color: OptionColor) => void; onPick?: (color: OptionColor) => void }) {
  const { t } = useTranslation()
  return (
    <AppFormField label={label}>
      {({ id }) => (
        <div id={id} role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
          {OPTION_COLORS.map((color) => {
            const selected = value === color
            return (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t(`colors.${color}`)}
                title={t(`colors.${color}`)}
                onClick={() => {
                  onChange(color)
                  onPick?.(color)
                }}
                style={{ backgroundColor: optionColor(color) }}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-surface transition-transform hover:scale-110',
                  selected && 'ring-2 ring-primary',
                )}
              >
                {selected && <Check className="size-3.5" />}
              </button>
            )
          })}
          <CustomColorSwatch value={isHexColor(value) ? value : null} onChange={onChange} swatchStyle={(hex) => ({ backgroundColor: optionColor(hex) })} />
        </div>
      )}
    </AppFormField>
  )
}

/**
 * Cor personalizada ao lado da paleta: o seletor de cor do navegador e o código (#rrggbb, para colar a
 * cor da marca). A cor mostrada já é a ajustada ao tema (`swatchStyle`), como vai aparecer nas telas.
 */
export function CustomColorSwatch({
  value,
  onChange,
  swatchStyle,
  className,
}: {
  value: HexColor | null
  onChange: (color: HexColor) => void
  swatchStyle: (hex: HexColor) => CSSProperties
  className?: string
}) {
  const { t } = useTranslation()
  const [code, setCode] = useState(value ?? '')
  const [synced, setSynced] = useState(value)
  // cor vinda de fora (outra escolha ou o item carregado): ajuste durante a renderização, sem efeito
  if (synced !== value) {
    setSynced(value)
    setCode(value ?? '')
  }
  const selected = value !== null
  const label = selected ? t('colors.customNamed', { hex: value }) : t('colors.custom')
  return (
    <AppPopover
      label={t('colors.custom')}
      className="flex w-56 flex-col gap-2 p-3"
      trigger={
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={label}
          title={label}
          style={selected ? swatchStyle(value) : { backgroundImage: 'conic-gradient(oklch(0.65 0.2 25), oklch(0.65 0.2 100), oklch(0.65 0.2 160), oklch(0.65 0.2 250), oklch(0.65 0.2 320), oklch(0.65 0.2 25))' }}
          className={cn(
            'flex size-7 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-surface transition-transform hover:scale-110',
            selected && 'ring-2 ring-primary',
            className,
          )}
        >
          {selected ? <Check className="size-3.5" /> : <Plus className="size-3.5 drop-shadow" />}
        </button>
      }
    >
      <span className="text-sm font-medium text-fg">{t('colors.custom')}</span>
      <input
        type="color"
        aria-label={t('colors.customPicker')}
        value={value ?? '#3b82f6'}
        onChange={(event) => onChange(event.target.value.toLowerCase() as HexColor)}
        className="h-10 w-full cursor-pointer rounded-md border border-border bg-surface"
      />
      <AppTextField
        label={t('colors.customCode')}
        value={code}
        placeholder="#1a7f37"
        maxLength={7}
        className="font-mono"
        hint={t('colors.customHint')}
        onChange={(event) => {
          setCode(event.target.value)
          // enquanto digita, só o código completo (6 dígitos); o curto (#abc) vale ao sair do campo
          if (/^#?[0-9a-f]{6}$/i.test(event.target.value.trim())) onChange(parseHexInput(event.target.value) as HexColor)
        }}
        onBlur={() => {
          const hex = parseHexInput(code)
          if (hex) onChange(hex)
          else setCode(value ?? '')
        }}
      />
    </AppPopover>
  )
}

/** Bolinha que abre a escolha de cor (listas compactas: opções, status e recursos). */
export function ColorButton({ color, label, onChange }: { color: OptionColor; label: string; onChange: (color: OptionColor) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(color)
  // cor da paleta: salva e fecha; personalizada: salva uma vez só, ao fechar (não a cada ajuste)
  const toggle = (next: boolean) => {
    if (next) setDraft(color)
    else if (draft !== color) onChange(draft)
    setOpen(next)
  }
  return (
    <AppPopover
      label={label}
      open={open}
      onOpenChange={toggle}
      className="w-auto p-3"
      trigger={
        <button type="button" aria-label={label} className="size-7 shrink-0 rounded-full ring-offset-2 ring-offset-surface hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring" style={{ backgroundColor: optionColor(open ? draft : color) }} />
      }
    >
      <ColorPicker
        label={label}
        value={draft}
        onChange={setDraft}
        onPick={(picked) => {
          setOpen(false)
          if (picked !== color) onChange(picked)
        }}
      />
    </AppPopover>
  )
}

/** Bolinha colorida de opção. */
export function ColorDot({ color, className }: { color: OptionColor; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ backgroundColor: optionColor(color) }} />
}

/** Ícone do tipo de tarefa, com fundo na cor do tipo. */
export function TaskTypeIconBadge({ icon, color, size = 'md' }: { icon: TaskTypeIcon; color: OptionColor; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = TASK_TYPE_ICON_COMPONENTS[icon]
  const sizes = { sm: 'size-6 rounded-md [&_svg]:size-3.5', md: 'size-9 rounded-lg [&_svg]:size-4', lg: 'size-12 rounded-xl [&_svg]:size-6' }
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center', sizes[size])} style={{ backgroundColor: optionTint(color), color: optionColor(color) }}>
      <Icon />
    </span>
  )
}

/** Tipo do campo com ícone ("Seleção única"). */
export function FieldTypeLabel({ type, className }: { type: FieldType; className?: string }) {
  const { t } = useTranslation()
  const Icon = FIELD_TYPE_ICONS[type]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-fg', className)}>
      <Icon className="size-4 text-subtle" aria-hidden />
      {t(`fields.types.${type}`)}
    </span>
  )
}
