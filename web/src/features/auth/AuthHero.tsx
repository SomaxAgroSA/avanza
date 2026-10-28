import { useTranslation } from 'react-i18next'
import { ChartGantt, KanbanSquare, RefreshCw, type LucideIcon } from 'lucide-react'
import { logoFor } from '@/domain/platform'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { useResolvedTheme } from '@/presentation/common/use-theme'
import { cn } from '@/core/utils/cn'
import { GrowingField } from './GrowingField'

/**
 * Cores da capa por tema (todas dos tokens): fundo, texto, texto secundário e linhas. O halo das letras e o
 * fundo da logo e dos ícones usam a cor do fundo, para o campo nunca passar por trás deles. Misturas em sRGB
 * (como os tokens da referência): em OKLCH o branco tem matiz 0 e a mistura com o lima passaria pelo rosa.
 */
const COVER = {
  // Modelo G — verde quase preto da marca, texto claro
  dark: '[--cover-bg:var(--kb-brand-ink)] [--cover-fg:var(--kb-on-cover)] [--cover-muted:color-mix(in_srgb,var(--kb-on-cover)_86%,transparent)] [--cover-line:color-mix(in_srgb,var(--kb-on-cover)_30%,transparent)] bg-[var(--cover-bg)]',
  // Modelo H — branco com um toque do verde da marca embaixo (o lima deixava o fundo amarelado), texto
  // verde quase preto (AA com folga)
  light:
    '[--cover-bg:var(--kb-surface)] [--cover-fg:var(--kb-brand-ink)] [--cover-muted:color-mix(in_srgb,var(--kb-brand-ink)_80%,var(--kb-surface))] [--cover-line:color-mix(in_srgb,var(--kb-brand-ink)_16%,transparent)] bg-[linear-gradient(170deg,var(--kb-surface)_45%,color-mix(in_srgb,var(--kb-brand-primary)_7%,var(--kb-surface)))] lg:border-r lg:border-[var(--cover-line)]',
}

const FEATURES: { key: 'kanban' | 'plan' | 'live'; icon: LucideIcon }[] = [
  { key: 'kanban', icon: KanbanSquare },
  { key: 'plan', icon: ChartGantt },
  { key: 'live', icon: RefreshCw },
]

/**
 * Capa das telas sem sessão ("Campo que responde" da referência: Modelo G no tema escuro, Modelo H no claro):
 * marca, proposta, o que o produto faz e o rodapé, com o campo de brotos que cresce onde o cursor passa
 * (GrowingField). No celular fica compacta (marca e título) para o formulário aparecer logo abaixo.
 */
export function AuthHero() {
  const { t } = useTranslation()
  const platform = usePlatformInfo()
  const theme = useResolvedTheme()
  // a capa segue o tema: fundo escuro com o logo escuro, fundo claro com o logo claro
  const logo = logoFor(platform, theme)

  return (
    <aside data-cover={theme} className={cn('relative flex flex-col overflow-hidden px-5 py-7 text-[var(--cover-fg)] lg:px-10 lg:py-10', COVER[theme])}>
      <GrowingField />

      <div data-field-clear className="pointer-events-none relative flex items-center gap-3 self-start text-[21px] font-bold [text-shadow:0_1px_10px_var(--cover-bg)]">
        <span className="grid size-[42px] shrink-0 place-items-center rounded-[11px] border border-[var(--cover-line)] bg-[var(--cover-bg)] shadow-[0_0_0_4px_var(--cover-bg)]">
          <img src={logo} alt="" className="size-[26px] object-contain" />
        </span>
        <span className="truncate">{platform.name}</span>
      </div>

      <div className="pointer-events-none relative mt-8 lg:my-auto">
        <h2 data-field-clear className="max-w-[600px] font-display text-[clamp(28px,3.6vw,52px)] font-extrabold leading-[1.12] tracking-[-0.025em] [text-shadow:0_2px_18px_var(--cover-bg)]">
          {t('auth.heroTitle')}
        </h2>
        <p data-field-clear className="mt-4 hidden max-w-[640px] text-[19px] [text-shadow:0_1px_12px_var(--cover-bg)] lg:block">{t('auth.heroSubtitle')}</p>
        <ul className="mt-10 hidden max-w-[880px] grid-cols-3 gap-6 lg:grid">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key} data-field-clear className="grid content-start gap-1.5 text-[15.5px] leading-[1.45] [text-shadow:0_1px_10px_var(--cover-bg)]">
              <span className="mb-2.5 grid size-11 place-items-center rounded-[11px] border border-[var(--cover-line)] bg-[var(--cover-bg)]">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="font-bold">{t(`auth.hero.features.${key}.title`)}</span>
              <span className="text-[var(--cover-muted)]">{t(`auth.hero.features.${key}.description`)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p data-field-clear className="pointer-events-none relative hidden self-start text-[15px] text-[var(--cover-muted)] lg:block">
        {t('auth.footer', { year: new Date().getFullYear(), name: platform.name })}
      </p>
    </aside>
  )
}
