import { describe, expect, it } from 'vitest'
import { executiveDuration, executivePeriodRange, localDay, mainHealthFactor, totalDeliveries } from './executive'

describe('painel executivo', () => {
  const now = new Date(2026, 9, 29, 10, 42) // 29/10/2026 (local)

  it('"Desde o início" não manda datas; os atalhos terminam hoje (dias locais)', () => {
    expect(executivePeriodRange('all', now)).toEqual({ from: null, to: null })
    expect(executivePeriodRange('year', now)).toEqual({ from: '2026-01-01', to: '2026-10-29' })
    expect(executivePeriodRange('month', now)).toEqual({ from: '2026-10-01', to: '2026-10-29' })
    // 90 dias contando hoje
    expect(executivePeriodRange('90d', now)).toEqual({ from: '2026-08-01', to: '2026-10-29' })
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('personalizado: as duas datas e o fim não antes do início', () => {
    expect(executivePeriodRange('custom', now, { from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-03-01', to: '2026-03-31' })
    expect(executivePeriodRange('custom', now, { from: '2026-03-31', to: '2026-03-01' })).toBeNull()
    expect(executivePeriodRange('custom', now, { from: '2026-03-01', to: '' })).toBeNull()
    expect(executivePeriodRange('custom', now)).toBeNull()
  })

  it('motivo da saúde: o pior fator (crítico antes de atenção; empate fica com o primeiro)', () => {
    const factors = [
      { key: 'progress' as const, level: 'attention' as const, value: 12 },
      { key: 'schedule' as const, level: 'critical' as const, value: 35 },
      { key: 'issues' as const, level: 'critical' as const, value: 4 },
    ]
    expect(mainHealthFactor({ level: 'critical', factors })?.key).toBe('schedule')
    expect(mainHealthFactor({ level: 'attention', factors: [factors[0]!] })?.key).toBe('progress')
    expect(mainHealthFactor({ level: 'ok', factors })).toBeNull()
    expect(mainHealthFactor({ level: 'none', factors: [] })).toBeNull()
  })

  it('tempo médio: dias a partir de 24 h; entregas somam os três tipos', () => {
    expect(executiveDuration(null)).toBeNull()
    expect(executiveDuration(23.94)).toEqual({ value: 23.9, unit: 'hours' })
    expect(executiveDuration(96.5)).toEqual({ value: 4, unit: 'days' })
    expect(totalDeliveries({ tasks: 120, planItems: 25, milestones: 3 })).toBe(148)
  })
})
