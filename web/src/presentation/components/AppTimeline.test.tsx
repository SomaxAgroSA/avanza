import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { dayFromIso, headerTiers, isoFromDay, type DaySpan } from '@/domain/timeline'
import { AppTimeline, type AppTimelineMarker } from './AppTimeline'

const d = dayFromIso
const range: DaySpan = { start: d('2026-10-01'), end: d('2026-12-31') }

function marker(id: string, label: string, iso: string): AppTimelineMarker {
  return { id, label, day: d(iso), ariaLabel: `Marco ${label}, ${iso}`, done: false }
}

function setup(markers: AppTimelineMarker[], pxPerDay = 18) {
  const onMarkerClick = vi.fn()
  render(
    <AppTimeline
      label="Cronograma"
      groups={[]}
      showGroupHeaders={false}
      range={range}
      pxPerDay={pxPerDay}
      today={d('2026-11-02')}
      tiers={headerTiers(range, 'week')}
      formatTop={(seg) => isoFromDay(seg.start)}
      formatBottom={(seg) => isoFromDay(seg.start)}
      formatSpan={(span) => `${isoFromDay(span.start)} → ${isoFromDay(span.end)}`}
      leftHeader="Tarefa"
      todayLabel="Hoje"
      keyboardHint="Setas movem"
      markers={markers}
      onMarkerClick={onMarkerClick}
    />,
  )
  return { onMarkerClick, marker: (id: string) => screen.getByTestId(`timeline-marker-${id}`) }
}

describe('AppTimeline — marcos', () => {
  const names = ['MVP web', 'Validación del dominio de la empresa', 'Aceptación de usuarios', 'Puesta en producción', 'Capacitación de unidades', 'Cierre contable piloto']
  const close = names.map((name, i) => marker(`c${i}`, name, `2026-10-${20 + i}`))

  it('marcos próximos ganham faixas (até o máximo) em vez de sobrepor os nomes; o distante volta para a primeira', () => {
    const { marker: el } = setup([marker('far', 'Entrega final', '2026-12-18'), ...close])
    const lanes = names.map((_, i) => Number(el(`c${i}`).dataset.lane))
    expect(lanes.slice(0, 4)).toEqual([0, 1, 2, 3])
    expect(Math.max(...lanes)).toBe(3)
    expect(el('far').dataset.lane).toBe('0')
    // a ordem no DOM (e do Tab) segue as datas, não a ordem recebida
    expect(screen.getAllByTestId(/^timeline-marker-/).map((b) => b.dataset.testid)).toEqual([...names.map((_, i) => `timeline-marker-c${i}`), 'timeline-marker-far'])
  })

  it('além do máximo de faixas, o nome é encurtado e continua inteiro no nome acessível e na dica', () => {
    const { marker: el } = setup(close)
    const truncated = names.map((_, i) => el(`c${i}`)).filter((b) => b.dataset.truncated)
    expect(truncated.length).toBeGreaterThan(0)
    truncated.forEach((b) => {
      expect(b.style.maxWidth).not.toBe('')
      expect(b).toHaveAttribute('title', b.getAttribute('aria-label') as string)
    })
    names.forEach((name) => expect(screen.getByRole('button', { name: new RegExp(`^Marco ${name}`) })).toBeInTheDocument())
  })

  it('o losango fica na data exata, alinhado com a linha tracejada, em qualquer faixa', () => {
    const { marker: el } = setup(close)
    // botão começa 10 px antes da âncora (centro do dia); a linha de 2 px começa 1 px antes
    const guides = [...document.querySelectorAll<HTMLElement>('.inset-y-0.border-dashed')]
    names.forEach((_, i) => {
      const anchor = (d(`2026-10-${20 + i}`) - range.start) * 18 + 9
      expect(el(`c${i}`).style.left).toBe(`${anchor - 10}px`)
      expect(guides.some((g) => g.style.left === `${anchor - 1}px`)).toBe(true)
    })
  })

  it('clique e teclado continuam abrindo o marco', async () => {
    const { marker: el, onMarkerClick } = setup(close)
    await userEvent.click(el('c1'))
    expect(onMarkerClick).toHaveBeenLastCalledWith('c1')
    el('c4').focus()
    await userEvent.keyboard('{Enter}')
    expect(onMarkerClick).toHaveBeenLastCalledWith('c4')
  })

  it('marcos distantes ficam numa faixa só, sem cortar o nome', () => {
    const { marker: el } = setup([marker('a', 'Kickoff', '2026-10-01'), marker('b', 'Go-live', '2026-11-20')])
    expect([el('a').dataset.lane, el('b').dataset.lane]).toEqual(['0', '0'])
    expect(el('a').dataset.truncated).toBeUndefined()
    expect(el('a').style.maxWidth).toBe('')
  })
})
