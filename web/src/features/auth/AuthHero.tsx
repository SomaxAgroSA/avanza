import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChartGantt, KanbanSquare, RefreshCw, type LucideIcon } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { logoFor } from '@/domain/platform'
import { usePlatformInfo } from '@/presentation/common/use-platform'

/** Cartão de mentira do quadro: faixa da etiqueta, duas linhas de título e o responsável. */
interface MockCard {
  tag: string
  title: string
  avatar: string
  progress?: string
  done?: boolean
  /** O cartão que a animação leva de "Em andamento" para "Concluído". */
  moving?: boolean
}

/** O cartão que a animação arrasta para "Concluído" (a vaga de lá tem a altura dele). */
const MOVING: MockCard = { tag: 'bg-danger', title: 'w-full', avatar: 'bg-warning-soft', progress: 'w-2/3', moving: true }

const COLUMNS: { key: 'todo' | 'doing' | 'done'; cards: MockCard[] }[] = [
  {
    key: 'todo',
    cards: [
      { tag: 'bg-warning', title: 'w-4/5', avatar: 'bg-primary-soft' },
      { tag: 'bg-accent', title: 'w-3/5', avatar: 'bg-success-soft' },
    ],
  },
  {
    key: 'doing',
    cards: [
      MOVING,
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

function MockCardView({ card, className }: { card: MockCard; className?: string }) {
  return (
    <div className={cn('rounded-md border border-border bg-surface p-2 shadow-card', className)}>
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
  )
}

/**
 * Prévia ilustrativa do produto na capa: o quadro flutua, um cartão é arrastado de "Em andamento" para a
 * vaga em "Concluído", o aviso de cartão movido aparece e a saúde do projeto sobe — em ciclo, com o "ao
 * vivo" pulsando. Decorativa (fora da árvore de acessibilidade); parada para quem pede menos movimento.
 */
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
                {/* a vaga onde o cartão arrastado cai (mesma altura dele) */}
                {column.key === 'done' && (
                  <div className="rounded-md border border-dashed border-primary-border">
                    <MockCardView card={MOVING} className="invisible" />
                  </div>
                )}
                {column.cards.map((card, index) => (
                  <MockCardView key={index} card={card} className={card.moving ? 'relative z-10 motion-safe:animate-card-move' : undefined} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
          <span className="text-[11px] font-semibold text-muted">{t('auth.hero.health')}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full w-[72%] rounded-full bg-success motion-safe:animate-health" />
          </span>
          <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-soft-fg">{t('auth.hero.onTrack')}</span>
        </div>
      </div>

      <div className="absolute bottom-0 -right-3 flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg shadow-float motion-safe:animate-toast-cycle xl:-right-6">
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

/** Versão compacta da prévia (celular): o aviso de cartão movido aparece e some em ciclo, com o "ao vivo" pulsando. */
function LiveToast() {
  const { t } = useTranslation()
  return (
    <div aria-hidden className="inline-flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg shadow-float motion-safe:animate-toast-cycle">
      <span className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex size-full rounded-full bg-success opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2.5 rounded-full bg-success" />
      </span>
      <span>
        <span className="block font-semibold">{t('auth.hero.moved')}</span>
        <span className="block text-muted">{t('auth.hero.now')}</span>
      </span>
    </div>
  )
}

/**
 * Capa das telas sem sessão: marca, proposta, a prévia animada do quadro, o que o produto faz e o rodapé,
 * sobre o gradiente da marca. No celular fica compacta (marca e título) para o formulário aparecer logo
 * abaixo, com uma versão compacta da animação; em telas baixas, a prévia diminui e as funcionalidades
 * saem antes dela (só abaixo de 600 px de altura a prévia some).
 */
export function AuthHero() {
  const { t } = useTranslation()
  const platform = usePlatformInfo()
  // a capa tem fundo da marca (escuro): usa a versão escura do logo
  const logo = logoFor(platform, 'dark')

  return (
    <aside className="relative flex flex-col overflow-hidden bg-brand-gradient px-5 py-7 text-on-cover lg:px-10 lg:py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(color-mix(in_oklch,var(--kb-on-cover)_13%,transparent)_1px,transparent_1.5px)] [background-size:26px_26px]"
      />
      {/* marca d'água: o próprio logo, chapado em branco */}
      <img
        src={logo}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -bottom-10 -right-16 hidden w-[340px] opacity-[0.07] [filter:brightness(0)_invert(1)] lg:block"
      />

      <div className="relative flex items-center gap-3 text-[21px] font-bold">
        <span className="grid size-[42px] shrink-0 place-items-center rounded-[11px] border border-on-cover/20 bg-on-cover/10">
          <img src={logo} alt="" className="size-[26px] object-contain" />
        </span>
        <span className="truncate">{platform.name}</span>
      </div>

      <div className="relative mt-8 lg:my-auto">
        <h2 className="max-w-[600px] font-display text-[clamp(28px,3.6vw,52px)] font-extrabold leading-[1.12] tracking-[-0.025em]">
          {t('auth.heroTitle')}
        </h2>
        <p className="mt-4 hidden text-[19px] text-on-cover/90 lg:block">{t('auth.heroSubtitle')}</p>
        <div className="mt-8 hidden max-w-[520px] pr-3 lg:block xl:pr-6 [@media(max-height:860px)]:mt-5 [@media(max-height:860px)]:[zoom:0.8] [@media(max-height:760px)]:[zoom:0.62] [@media(max-height:600px)]:hidden">
          <ProductPreview />
        </div>
        {/* no celular: só o "ao vivo" e o aviso de cartão movido, para o formulário continuar logo abaixo */}
        <div className="mt-5 lg:hidden">
          <LiveToast />
        </div>
        <ul className="mt-8 hidden max-w-[880px] grid-cols-3 gap-6 lg:grid [@media(max-height:860px)]:mt-5 [@media(max-height:760px)]:!hidden">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key} className="grid content-start gap-1.5 text-[15.5px] leading-[1.45]">
              <span className="mb-2.5 grid size-11 place-items-center rounded-[11px] border border-on-cover/20 bg-on-cover/15">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="font-bold">{t(`auth.hero.features.${key}.title`)}</span>
              <span className="text-on-cover/85 [@media(max-height:900px)]:hidden">{t(`auth.hero.features.${key}.description`)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative hidden text-[15px] text-on-cover/75 lg:block">
        {t('auth.footer', { year: new Date().getFullYear(), name: platform.name })}
      </p>
    </aside>
  )
}
