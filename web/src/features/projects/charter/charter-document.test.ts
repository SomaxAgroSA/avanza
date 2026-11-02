import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/core/i18n'
import type { ProjectCharter } from '@/domain/charter'
import { renderCharterDocument } from './charter-document'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const base = { projectId: 'p1', description: '', position: 1, owner: null, createdAt: null, updatedAt: null }
const charter: ProjectCharter = {
  projectId: 'p1',
  objective: 'Vender <directo> al cliente',
  updatedAt: null,
  updatedBy: null,
  capabilities: { edit: true },
  completeness: { sections: { objectives: true, features: true, scope: true, results: true }, done: 4, total: 4, percent: 100 },
  summary: { featuresTotal: 1, featuresDelivered: 0, tasksTotal: 2, tasksDone: 1, resultsTotal: 1, resultsOnTrack: 1, resultsLate: 0, resultsStale: 0 },
  items: [
    { ...base, id: 'o1', kind: 'objective', title: 'Elegir a los mejores clientes', state: 'auto', effectiveState: 'in_progress', linkIds: [] },
    { ...base, id: 'f1', kind: 'feature', title: 'Ofertas directas', state: 'auto', effectiveState: 'in_progress', taskIds: [], tasks: [], progress: { done: 1, total: 2 } },
    { ...base, id: 's1', kind: 'scope_out', title: 'Cobro y facturación' },
    { ...base, id: 'r1', kind: 'result', title: 'Ofertas aceptadas', unit: '%', baseline: 0, target: 30, current: 12, startDate: null, dueDate: '2026-12-31', frequency: 'weekly', measuredAt: null, situation: 'on_track', percent: 40, stale: false },
  ],
}

describe('charter-document', () => {
  it('arma la ficha impresa con las cuatro secciones y escapa el texto', () => {
    const html = renderCharterDocument(charter, { t: (k, v) => i18n.t(k, v), locale: 'es', project: { key: 'ADP', name: 'Aplicación del productor' }, platformName: 'Avanza', origin: 'http://localhost', today: '2026-11-01' })
    expect(html).toContain('<title>ADP - Ficha del proyecto - 2026-11-01</title>')
    expect(html).toContain('Vender &lt;directo&gt; al cliente')
    expect(html).not.toContain('<directo>')
    ;['Objetivos', 'Funcionalidades', 'Alcance', 'Resultados esperados', 'Elegir a los mejores clientes', 'Ofertas directas', '1 de 2 hechas', 'Cobro y facturación', '12 %', 'En camino'].forEach((text) => expect(html).toContain(text))
  })
})
