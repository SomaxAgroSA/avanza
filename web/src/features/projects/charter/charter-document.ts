/**
 * Ficha do projeto impressa (A4): o mesmo conteúdo da aba Ficha num documento limpo, com a paleta
 * do informe. Sai pela impressão do navegador ("Salvar como PDF"), com rodapé e número de página.
 */
import { formatMeasure, itemsOf, type ProjectCharter } from '@/domain/charter'
import figtreeLatin from '@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url'
import figtreeLatinExt from '@fontsource-variable/figtree/files/figtree-latin-ext-wght-normal.woff2?url'
import jakarta800 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff2?url'

type Translate = (key: string, options?: Record<string, unknown>) => string

export interface CharterDocumentContext {
  t: Translate
  locale: string
  project: { key: string; name: string }
  platformName: string
  /** Origem para resolver as fontes (o iframe de impressão não tem endereço próprio). */
  origin: string
  /** Data de emissão AAAA-MM-DD. */
  today: string
}

const C = { brand: '#00843d', brandDeep: '#083d20', accent: '#8dc63f', ink: '#1e2b24', muted: '#5d6b63', line: '#e3e8e4', card: '#f6faf7', cardBorder: '#d7e2da' } as const

const TONE: Record<string, { bg: string; fg: string }> = {
  success: { bg: '#e3f4ea', fg: '#11643a' },
  info: { bg: '#e6eff8', fg: '#2c5c8a' },
  warning: { bg: '#fdf0dc', fg: '#8a5606' },
  danger: { bg: '#fbe6e6', fg: '#9c2b2b' },
  neutral: { bg: '#eef2ef', fg: '#55635a' },
}
const OBJECTIVE_TONE: Record<string, string> = { pending: 'neutral', in_progress: 'info', achieved: 'success', at_risk: 'warning' }
const FEATURE_TONE: Record<string, string> = { planned: 'neutral', in_progress: 'info', late: 'warning', delivered: 'success', cancelled: 'danger' }
const SITUATION_TONE: Record<string, string> = { achieved: 'success', on_track: 'info', late: 'warning', no_data: 'neutral' }

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
/** Texto dentro de `content: "…"` do CSS (sem < nem >: não fecha o <style>). */
const cssString = (value: string) =>
  `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3c ')
    .replace(/>/g, '\\3e ')
    .replace(/\n/g, ' ')}"`
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
const NEUTRAL = { bg: '#eef2ef', fg: '#55635a' }
const pill = (label: string, tone: string | undefined) => {
  const c = (tone && TONE[tone]) || NEUTRAL
  return `<span class="pill" style="background:${c.bg};color:${c.fg}">${esc(label)}</span>`
}

export function renderCharterDocument(charter: ProjectCharter, ctx: CharterDocumentContext): string {
  const { t, locale } = ctx
  const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${iso}T00:00:00Z`)) : '—')
  const title = t('charter.doc.title')
  const footer = `${ctx.project.key} · ${ctx.project.name} · ${title} · ${day(ctx.today)}`
  const objectives = itemsOf(charter, 'objective')
  const features = itemsOf(charter, 'feature')
  const scopeIn = itemsOf(charter, 'scope_in')
  const scopeOut = itemsOf(charter, 'scope_out')
  const results = itemsOf(charter, 'result')
  const s = charter.summary

  const section = (n: number, heading: string, body: string) => `<section><h2><span>${n}</span>${esc(heading)}</h2>${body}</section>`
  const empty = `<p class="muted">${esc(t('charter.doc.empty'))}</p>`

  const objectivesHtml =
    (charter.objective ? `<div class="goal"><div class="label">${esc(t('charter.general.title'))}</div>${paragraphs(charter.objective)}</div>` : '') +
    (objectives.length
      ? `<ol class="objectives">${objectives
          .map((o) => `<li><div><strong>${esc(o.title)}</strong>${o.description ? `<div class="muted">${esc(o.description)}</div>` : ''}</div>${pill(t(`charter.objectiveState.${o.effectiveState}`), OBJECTIVE_TONE[o.effectiveState])}</li>`)
          .join('')}</ol>`
      : '')

  const featuresHtml = features.length
    ? `<table><thead><tr><th>${esc(t('charter.columns.feature'))}</th><th>${esc(t('charter.columns.state'))}</th><th>${esc(t('charter.columns.tasks'))}</th><th>${esc(t('charter.columns.owner'))}</th></tr></thead><tbody>${features
        .map(
          (f) =>
            `<tr><td><strong>${esc(f.title)}</strong>${f.description ? `<div class="muted">${esc(f.description)}</div>` : ''}</td><td>${pill(t(`charter.featureState.${f.effectiveState}`), FEATURE_TONE[f.effectiveState])}</td><td class="num">${f.progress.total ? esc(t('charter.tasksDone', { done: f.progress.done, total: f.progress.total })) : '—'}</td><td>${esc(f.owner?.name ?? '—')}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : empty

  const scopeList = (items: Array<{ title: string; description: string }>, mark: string) =>
    items.length ? `<ul class="scope">${items.map((i) => `<li><span class="mark">${mark}</span><div>${esc(i.title)}${i.description ? `<div class="muted">${esc(i.description)}</div>` : ''}</div></li>`).join('')}</ul>` : `<p class="muted">—</p>`
  const scopeHtml =
    scopeIn.length || scopeOut.length
      ? `<div class="cols"><div class="box"><h3>${esc(t('charter.kinds.scope_in'))}</h3>${scopeList(scopeIn, '✓')}</div><div class="box"><h3>${esc(t('charter.kinds.scope_out'))}</h3>${scopeList(scopeOut, '✕')}</div></div>`
      : empty

  const resultsHtml = results.length
    ? `<table><thead><tr><th>${esc(t('charter.columns.indicator'))}</th><th class="r">${esc(t('charter.fields.baseline'))}</th><th class="r">${esc(t('charter.fields.target'))}</th><th class="r">${esc(t('charter.fields.current'))}</th><th>${esc(t('charter.fields.dueDate'))}</th><th>${esc(t('charter.columns.situation'))}</th></tr></thead><tbody>${results
        .map(
          (r) =>
            `<tr><td><strong>${esc(r.title)}</strong>${r.description ? `<div class="muted">${esc(r.description)}</div>` : ''}</td><td class="r num">${esc(formatMeasure(r.baseline, r.unit, locale))}</td><td class="r num">${esc(formatMeasure(r.target, r.unit, locale))}</td><td class="r num"><strong>${esc(formatMeasure(r.current, r.unit, locale))}</strong><div class="bar"><i style="width:${r.percent}%"></i></div></td><td class="num">${day(r.dueDate)}</td><td>${pill(t(`charter.situation.${r.situation}`), SITUATION_TONE[r.situation])}${r.stale ? ` ${pill(t('charter.stale'), 'warning')}` : ''}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : empty

  const kpi = (value: string, label: string) => `<div class="kpi"><b>${esc(value)}</b><span>${esc(label)}</span></div>`
  const font = (file: string) => new URL(file, ctx.origin).href

  return `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8"><title>${esc(`${ctx.project.key} - ${title} - ${ctx.today}`)}</title><style>
@font-face{font-family:'Figtree';src:url('${font(figtreeLatin)}') format('woff2');font-weight:300 900}
@font-face{font-family:'Figtree';src:url('${font(figtreeLatinExt)}') format('woff2');font-weight:300 900;unicode-range:U+0100-02AF}
@font-face{font-family:'Jakarta';src:url('${font(jakarta800)}') format('woff2');font-weight:800}
@page{size:A4;margin:16mm 15mm 18mm;@bottom-left{content:${cssString(footer)};font:8pt Figtree,sans-serif;color:${C.muted}}@bottom-right{content:counter(page) " / " counter(pages);font:8pt Figtree,sans-serif;color:${C.muted}}}
*{box-sizing:border-box}html,body{margin:0}body{font:10pt/1.5 Figtree,'Segoe UI',sans-serif;color:${C.ink};-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{background:linear-gradient(135deg,${C.brandDeep},${C.brand});color:#fff;border-radius:10px;padding:16px 18px;margin-bottom:14px}
header .eyebrow{font-size:8pt;letter-spacing:.12em;text-transform:uppercase;color:${C.accent};font-weight:700}
header h1{font:800 20pt/1.15 Jakarta,Figtree,sans-serif;margin:4px 0 2px}header p{margin:0;color:#d6ead9;font-size:9pt}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
.kpi{border:1px solid ${C.cardBorder};background:${C.card};border-radius:8px;padding:8px 10px}.kpi b{display:block;font:800 15pt Jakarta,Figtree,sans-serif;color:${C.brand}}.kpi span{font-size:8pt;color:${C.muted};text-transform:uppercase;letter-spacing:.05em}
section{margin-bottom:14px;break-inside:auto}h2{font:800 12pt Jakarta,Figtree,sans-serif;margin:0 0 8px;display:flex;align-items:center;gap:8px;break-after:avoid}
h2 span{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;background:${C.brand};color:#fff;font-size:9pt}
h3{font-size:9.5pt;margin:0 0 6px}p{margin:0 0 6px}.muted{color:${C.muted};font-size:8.5pt}
.goal{border-left:3px solid ${C.brand};background:${C.card};padding:8px 12px;border-radius:0 8px 8px 0;margin-bottom:8px}.goal .label{font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};font-weight:700;margin-bottom:2px}
.objectives{margin:0;padding:0;list-style:none;counter-reset:o;display:grid;gap:5px}.objectives li{counter-increment:o;display:flex;justify-content:space-between;gap:10px;align-items:flex-start;border:1px solid ${C.line};border-radius:8px;padding:6px 10px;break-inside:avoid}
.objectives li>div::before{content:counter(o) ". ";font-weight:700;color:${C.brand}}
table{width:100%;border-collapse:collapse;font-size:9pt}th{text-align:left;font-size:7.5pt;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};border-bottom:1.5px solid ${C.ink};padding:5px 6px}
td{border-bottom:1px solid ${C.line};padding:6px;vertical-align:top}tr{break-inside:avoid}.r{text-align:right}.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.pill{display:inline-block;border-radius:999px;padding:1px 8px;font-size:7.5pt;font-weight:700;white-space:nowrap}
.bar{height:4px;background:${C.line};border-radius:4px;margin-top:3px;min-width:60px}.bar i{display:block;height:100%;background:${C.brand};border-radius:4px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}.box{border:1px solid ${C.line};border-radius:8px;padding:8px 10px;break-inside:avoid}
.scope{margin:0;padding:0;list-style:none;display:grid;gap:4px}.scope li{display:flex;gap:6px}.mark{font-weight:700;color:${C.brand};width:12px;flex:none}.box:last-child .mark{color:#b23a3a}
</style></head><body>
<header><div class="eyebrow">${esc(ctx.platformName)} · ${esc(ctx.project.key)}</div><h1>${esc(ctx.project.name)}</h1><p>${esc(title)} · ${esc(t('charter.doc.issued', { date: day(ctx.today) }))}</p></header>
<div class="kpis">${kpi(`${charter.completeness.percent}%`, t('charter.summary.completeness'))}${kpi(`${s.featuresDelivered} / ${s.featuresTotal}`, t('charter.summary.features'))}${kpi(`${s.resultsOnTrack} / ${s.resultsTotal}`, t('charter.summary.results'))}</div>
${section(1, t('charter.sections.objectives'), objectivesHtml || empty)}
${section(2, t('charter.sections.features'), featuresHtml)}
${section(3, t('charter.sections.scope'), scopeHtml)}
${section(4, t('charter.sections.results'), resultsHtml)}
</body></html>`
}
