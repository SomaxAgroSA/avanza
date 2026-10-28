import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChartGantt, KanbanSquare, RefreshCw, type LucideIcon } from 'lucide-react'
import { cn } from '@/core/utils/cn'

/** Cartão de mentira do quadro: faixa da etiqueta, duas linhas de título e o responsável. */
interface MockCard {
  tag: string
  title: string
  avatar: string
  progress?: string
  done?: boolean
}

const COLUMNS: { key: 'todo' | 'doing' | 'done'; cards: MockCard[] }[] = [
  {
    key: 'todo',
    cards: [
      { tag: 'bg-warning', title: 'w-4/5', avatar: 'bg-primary-soft' },
      { tag: 'bg-primary', title: 'w-3/5', avatar: 'bg-success-soft' },
    ],
  },
  {
    key: 'doing',
    cards: [
      { tag: 'bg-danger', title: 'w-full', avatar: 'bg-warning-soft', progress: 'w-2/3' },
      { tag: 'bg-primary', title: 'w-2/3', avatar: 'bg-primary-soft', progress: 'w-1/3' },
    ],
  },
  {
    key: 'done',
    cards: [
      { tag: 'bg-success', title: 'w-3/4', avatar: 'bg-success-soft', done: true },
      { tag: 'bg-warning', title: 'w-1/2', avatar: 'bg-primary-soft', done: true },
    ],
  },
]

const FEATURES: { key: 'kanban' | 'plan' | 'live'; icon: LucideIcon }[] = [
  { key: 'kanban', icon: KanbanSquare },
  { key: 'plan', icon: ChartGantt },
  { key: 'live', icon: RefreshCw },
]

/** Prévia ilustrativa do produto no painel da marca (decorativa: fica fora da árvore de acessibilidade). */
function ProductPreview() {
  const { t } = useTranslation()
  return (
    <div aria-hidden className="relative pb-8 motion-safe:animate-float">
      <div className="rounded-xl border border-border bg-surface p-3.5 text-fg shadow-float">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex gap-1">
              <span className="size-2 rounded-full bg-danger" />
              <span className="size-2 rounded-full bg-warning" />
              <span className="size-2 rounded-full bg-success" />
            </span>
            <span className="text-xs font-semibold">{t('auth.hero.board')}</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-soft-fg">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full rounded-full bg-success opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            {t('auth.hero.live')}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {COLUMNS.map((column) => (
            <div key={column.key} className="rounded-lg bg-surface-2 p-2">
              <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-muted">
                <span className="truncate">{t(`auth.hero.columns.${column.key}`)}</span>
                <span className="rounded bg-surface-3 px-1.5 tabular-nums">{column.cards.length}</span>
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {column.cards.map((card, index) => (
                  <div key={index} className="rounded-md border border-border bg-surface p-2 shadow-card">
                    <span className={cn('block h-1.5 w-7 rounded-full', card.tag)} />
                    <span className="mt-2 block h-1.5 w-full rounded-full bg-surface-3" />
                    <span className={cn('mt-1 block h-1.5 rounded-full bg-surface-3', card.title)} />
                    {card.progress && (
                      <span className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-3">
                        <span className={cn('block h-full rounded-full bg-primary', card.progress)} />
                      </span>
                    )}
                    <span className="mt-2 flex items-center justify-between">
                      {card.done ? <CheckCircle2 className="size-3.5 text-success" /> : <span className="h-1.5 w-5 rounded-full bg-surface-3" />}
                      <span className={cn('size-4 rounded-full ring-2 ring-surface', card.avatar)} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
          <span className="text-[11px] font-semibold text-muted">{t('auth.hero.health')}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full w-[72%] rounded-full bg-success" />
          </span>
          <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-soft-fg">{t('auth.hero.onTrack')}</span>
        </div>
      </div>

      <div className="absolute bottom-0 -right-3 flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg shadow-float xl:-right-6">
        <span className="flex size-7 items-center justify-center rounded-full bg-success-soft text-success-soft-fg">
          <CheckCircle2 className="size-4" />
        </span>
        <span>
          <span className="block font-semibold">{t('auth.hero.moved')}</span>
          <span className="block text-muted">{t('auth.hero.now')}</span>
        </span>
      </div>
    </div>
  )
}

/** Painel da marca das telas sem sessão: proposta, prévia do produto e o que ele faz. */
export function AuthHero() {
  const { t } = useTranslation()
  return (
    <div className="relative flex flex-col gap-8">
      <div className="max-w-lg 2xl:max-w-xl">
        <h2 className="font-display text-[clamp(34px,3.6vw,52px)] font-extrabold leading-[1.12] tracking-[-0.025em]">{t('auth.heroTitle')}</h2>
        <p className="mt-4 text-lg text-on-cover-muted xl:text-[19px]">{t('auth.heroSubtitle')}</p>
      </div>
      <div className="max-w-xl pr-3 xl:pr-6 2xl:max-w-2xl [@media(max-height:820px)]:hidden">
        <ProductPreview />
      </div>
      <ul className="grid max-w-2xl gap-4 xl:grid-cols-3 2xl:max-w-3xl">
        {FEATURES.map(({ key, icon: Icon }) => (
          <li key={key} className="flex gap-3 xl:flex-col xl:gap-2">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[11px] border border-on-cover/20 bg-on-cover/15 xl:mb-1">
              <Icon className="size-5" aria-hidden />
            </span>
            <span>
              <span className="block text-[15px] font-semibold">{t(`auth.hero.features.${key}.title`)}</span>
              <span className="mt-0.5 block text-[15px] leading-snug text-on-cover-muted">{t(`auth.hero.features.${key}.description`)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
