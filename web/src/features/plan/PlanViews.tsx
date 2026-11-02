import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChartGantt, ClipboardList, Table2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { PLAN_VIEWS, type PlanView } from '@/domain/plan-view'
import { AppNavTabs } from '@/presentation/components'

const ICONS: Record<PlanView, ReactNode> = {
  board: <Table2 />,
  timeline: <ChartGantt />,
  management: <ClipboardList />,
}

/** Barra de visões (como as abas de visão do Monday); a escolhida fica no endereço (`?view=`). */
export function PlanViewNav({ value }: { value: PlanView }) {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const hrefOf = (view: PlanView) => {
    const next = new URLSearchParams(params)
    if (view === 'board') next.delete('view')
    else next.set('view', view)
    return `?${next.toString()}`
  }
  return (
    <AppNavTabs
      aria-label={t('plan.views.label')}
      variant="pill"
      replace
      items={PLAN_VIEWS.map((view) => ({ key: view, to: hrefOf(view), label: t(`plan.views.${view}`), icon: ICONS[view], active: view === value }))}
    />
  )
}
