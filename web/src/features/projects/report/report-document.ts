/**
 * Documento do informe do projeto (aba Informe): HTML completo e autocontido, pensado para A4 — a mesma
 * página vira a prévia (iframe) e o PDF (impressão do navegador → "Salvar como PDF").
 * As cores são do documento impresso (fundo branco em qualquer tema), não tokens da interface.
 */
import type { ChronologyItem } from '@/domain/project-chronology'
import { REPORT_SECTIONS, type ProjectReport, type ReportOptions, type ReportPhase, type ReportSection } from '@/domain/project-report'
import type { TaskSummary } from '@/domain/tasks'
import { cssString, esc, paragraphs, printFontFaces, type Translate } from '../print-document'

export interface ReportDocumentContext {
  t: Translate
  locale: string
  project: { key: string; name: string }
  platformName: string
  /** URL absoluta do ícone da plataforma (capa). */
  iconUrl: string
  /** Origem para resolver as fontes (o iframe da prévia não tem endereço próprio). */
  origin: string
}

/** Paleta do documento impresso. */
const C = {
  brand: '#00843d',
  brandDark: '#0b5a2e',
  brandDeep: '#083d20',
  accent: '#8dc63f',
  accentText: '#c9f08f',
  ink: '#1e2b24',
  inkSoft: '#33443a',
  muted: '#5d6b63',
  line: '#e3e8e4',
  lineStrong: '#9aa59f',
  card: '#f6faf7',
  cardBorder: '#d7e2da',
  warn: '#e08a00',
} as const

const utc = (day: string) => new Date(`${day}T00:00:00Z`)

function formatters(locale: string) {
  const make = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options })
  const numeric = make({ day: '2-digit', month: '2-digit', year: 'numeric' })
  const short = make({ day: 'numeric', month: 'short' })
  const dayMonth = make({ day: '2-digit', month: '2-digit' })
  const long = make({ weekday: 'long', day: 'numeric', month: 'long' })
  return {
    numeric: (day: string) => numeric.format(utc(day)),
    short: (day: string) => short.format(utc(day)).replace('.', ''),
    dayMonth: (day: string) => dayMonth.format(utc(day)),
    long: (day: string) => {
      const text = long.format(utc(day))
      return text.charAt(0).toUpperCase() + text.slice(1)
    },
  }
}

const dayOf = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)
const statusTone = (category: string | undefined) => (category === 'done' ? 'ok' : category === 'in_progress' ? 'info' : category === 'cancelled' ? 'neutral' : 'warn')

/** Cronograma em SVG: fases como barras e marcos como losangos, do início ao fim do informe. */
function gantt(report: ProjectReport, ctx: ReportDocumentContext): string {
  const f = formatters(ctx.locale)
  const start = report.start
  if (!start) return ''
  const phases = report.phases.filter((p): p is ReportPhase & { start: string } => !!p.start)
  const rows = [
    ...phases.map((p) => ({ kind: 'phase' as const, name: p.name, from: p.start, to: p.end ?? report.end, open: !p.end, done: p.done })),
    ...report.milestones.map((m) => ({ kind: 'milestone' as const, name: m.name, from: m.dueDate.slice(0, 10), to: m.dueDate.slice(0, 10), open: false, done: m.state === 'done' })),
  ]
  if (rows.length === 0) return ''
  const lo = Math.min(utc(start).getTime(), ...rows.map((r) => utc(r.from).getTime()))
  const hi = Math.max(utc(report.end).getTime(), ...rows.map((r) => utc(r.to).getTime()), lo + 86_400_000)
  const x0 = 262
  const w = 418
  const X = (day: string) => x0 + ((utc(day).getTime() - lo) / (hi - lo)) * w
  const height = 70 + rows.length * 26 + 16
  const spanDays = (hi - lo) / 86_400_000
  // no máximo ~8 marcas na régua (418 px): os rótulos não se sobrepõem em nenhum idioma
  const step = [7, 14, 30, 61, 91, 182].find((days) => spanDays / days <= 8) ?? 365
  let svg = `<svg viewBox="0 0 700 ${height}" xmlns="http://www.w3.org/2000/svg" font-family="Figtree Variable, sans-serif" font-size="10.5">`
  for (let t = lo; t <= hi; t += step * 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10)
    svg += `<line x1="${X(day)}" x2="${X(day)}" y1="40" y2="${height - 10}" stroke="${C.line}"/><text x="${X(day)}" y="32" text-anchor="middle" fill="${C.muted}">${esc(f.dayMonth(day))}</text>`
  }
  svg += `<line x1="${x0}" x2="${x0 + w}" y1="40" y2="40" stroke="${C.lineStrong}"/>`
  svg += `<line x1="${X(report.end)}" x2="${X(report.end)}" y1="40" y2="${height - 10}" stroke="${C.warn}" stroke-dasharray="4 3"/>`
  rows.forEach((row, i) => {
    const y = 60 + i * 26
    const previous = rows[i - 1]
    if (previous && row.kind === 'milestone' && previous.kind === 'phase') svg += `<line x1="8" x2="692" y1="${y - 13}" y2="${y - 13}" stroke="#cfd8d2"/>`
    const name = row.name.length > 46 ? `${row.name.slice(0, 45)}…` : row.name
    svg += `<text x="8" y="${y + 4}" fill="${C.ink}" font-weight="${row.kind === 'phase' ? 600 : 400}" font-size="${row.kind === 'phase' ? 10.5 : 9.8}">${esc(name)}</text>`
    if (row.kind === 'phase') {
      const width = Math.max(X(row.to) - X(row.from), 5)
      const stroke = row.open ? ` stroke="#5f8f1c" stroke-dasharray="3 2"` : ''
      svg += `<rect x="${X(row.from)}" y="${y - 7}" width="${width}" height="14" rx="7" fill="${row.done ? C.brand : C.accent}" fill-opacity="${row.done ? 0.85 : 0.55}"${stroke}/>`
      const label = row.open ? ctx.t('projects.report.doc.openSpan', { start: f.short(row.from) }) : `${f.short(row.from)} – ${f.short(row.to)}`
      const right = X(row.to) + 80 < x0 + w
      svg += `<text x="${right ? X(row.to) + 6 : X(row.from) - 6}" y="${y + 4}" text-anchor="${right ? 'start' : 'end'}" fill="${C.muted}" font-size="9.5">${esc(label)}</text>`
    } else {
      svg += `<path d="M${X(row.from)} ${y - 7}l7 7l-7 7l-7 -7z" fill="${row.done ? C.brand : C.warn}"/>`
      const right = X(row.from) + 50 < x0 + w
      svg += `<text x="${right ? X(row.from) + 11 : X(row.from) - 11}" y="${y + 4}" text-anchor="${right ? 'start' : 'end'}" fill="${C.muted}" font-size="9.5">${esc(f.short(row.from))}</text>`
    }
  })
  return `${svg}</svg>`
}

function pill(text: string, tone: string) {
  return `<span class="pill ${tone}">${esc(text)}</span>`
}

function chronologyItem(item: ChronologyItem, ctx: ReportDocumentContext): string {
  const { t } = ctx
  const f = formatters(ctx.locale)
  const tag = `<span class="tag">${esc(t(`projects.chronology.kinds.${item.kind}`))}</span>`
  if (item.kind === 'journal') return `<div class="ev">${tag}${paragraphs(item.content)}</div>`
  if (item.kind === 'milestone') {
    const state = pill(t(`timeline.milestones.states.${item.state}`), item.state === 'done' ? 'ok' : 'warn')
    return `<div class="ev hito">${tag}<p><b>${esc(item.name)}</b> ${state}</p>${item.description ? `<p class="sub">${esc(item.description)}</p>` : ''}</div>`
  }
  const span = item.start && item.due && item.start !== item.due ? ` <span class="sub">${esc(f.short(item.start))} – ${esc(f.short(item.due))}</span>` : ''
  const who = item.assignee ? ` <span class="sub">· ${esc(item.assignee.name)}</span>` : ''
  const status = item.status ? ` ${pill(item.status.name, statusTone(item.status.category))}` : ''
  return `<div class="ev">${tag}<p><span class="code">${esc(item.code)}</span> ${esc(item.title)}${status}${span}${who}</p></div>`
}

function taskRow(task: TaskSummary, f: ReturnType<typeof formatters>) {
  const start = dayOf(task.startDate)
  const due = dayOf(task.dueDate)
  return `<tr><td class="code">${esc(task.code)}</td><td>${esc(task.title)}</td><td class="num">${start ? esc(f.dayMonth(start)) : '—'}</td><td class="num">${due ? esc(f.dayMonth(due)) : '—'}</td><td>${esc(task.assignee?.name ?? '—')}</td><td>${task.status ? pill(task.status.name, statusTone(task.status.category)) : '—'}</td></tr>`
}

function styles(ctx: ReportDocumentContext, footer: string) {
  return `
${printFontFaces(ctx.origin)}
@page{size:A4;margin:18mm 16mm;@bottom-left{content:${cssString(footer)};font:7.5pt sans-serif;color:#7a867f}@bottom-right{content:counter(page) " / " counter(pages);font:7.5pt sans-serif;color:#7a867f}}
@page:first{@bottom-left{content:none}@bottom-right{content:none}}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html{background:#fff}
body{font-family:'Figtree Variable',sans-serif;color:${C.ink};font-size:10.5pt;line-height:1.45;margin:0}
@media screen{body{max-width:210mm;margin:0 auto;padding:12mm 14mm}.page{margin-top:14mm;padding-top:10mm;border-top:1px dashed ${C.cardBorder}}}
h1,h2{font-family:'Jakarta',sans-serif;font-weight:800;letter-spacing:-.02em;margin:0}
h2{font-size:17pt;color:${C.brand};margin:0 0 4mm;padding-bottom:2mm;border-bottom:2px solid ${C.accent}}
h3{font-size:11.5pt;margin:5mm 0 2mm}
p{margin:0 0 2mm}
.lead{font-size:11.5pt;color:${C.inkSoft};margin-bottom:5mm}
.page{break-before:page}
.cover{min-height:255mm;display:flex;flex-direction:column;justify-content:space-between;gap:10mm;background:linear-gradient(150deg,${C.brand} 0%,${C.brandDark} 70%,${C.brandDeep} 100%);color:#fff;border-radius:6mm;padding:16mm 14mm;position:relative;overflow:hidden}
.cover .marca{display:flex;align-items:center;gap:3mm;font-weight:700;font-size:13pt}
.cover .marca .ico{width:11mm;height:11mm;border-radius:3mm;background:#fff;display:flex;align-items:center;justify-content:center}
.cover .marca img{width:7mm;height:7mm;object-fit:contain}
.cover h1{font-size:34pt;line-height:1.08;margin:0 0 5mm}
.cover .kicker{text-transform:uppercase;letter-spacing:.14em;font-size:9pt;color:${C.accentText};font-weight:700;margin-bottom:4mm}
.cover .sub{font-size:13pt;color:#e3f1e8;max-width:150mm}
.cover .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;font-size:9.5pt;border-top:1px solid rgba(255,255,255,.3);padding-top:5mm}
.cover .meta b{display:block;font-size:11pt}
.cover .meta span{color:#cfe6d7}
.cover .barras{position:absolute;right:-14mm;bottom:40mm;opacity:.08;width:110mm}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin:4mm 0 6mm}
.kpi{border:1px solid ${C.cardBorder};border-radius:3mm;padding:3.5mm;background:${C.card}}
.kpi b{font-family:'Jakarta',sans-serif;font-size:19pt;color:${C.brand};display:block;line-height:1.1}
.kpi span{font-size:8.8pt;color:${C.muted}}
table{width:100%;border-collapse:collapse;font-size:9.4pt;margin:2mm 0 5mm}
th{text-align:left;font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:${C.muted};border-bottom:1.5px solid ${C.lineStrong};padding:2mm}
td{border-bottom:1px solid ${C.line};padding:2mm;vertical-align:top}
tr{break-inside:avoid}
td.num{white-space:nowrap;font-variant-numeric:tabular-nums}
.code{color:${C.muted};font-weight:600;white-space:nowrap}
tr.grupo td{background:#eef6f0;font-weight:700;color:${C.brandDark};border-bottom:none;padding-top:2.5mm}
.pill{display:inline-block;border-radius:99px;padding:.3mm 2.2mm;font-size:8pt;font-weight:600;white-space:nowrap}
.pill.ok{background:#e1f3e7;color:#00632e}.pill.info{background:#eef7dc;color:#4a6f12}.pill.warn{background:#fff1d6;color:#8a5300}.pill.neutral{background:#eceeed;color:#55605a}
.bar{height:2mm;background:${C.line};border-radius:2mm;overflow:hidden;margin-bottom:1mm;width:30mm}.bar i{display:block;height:100%;background:${C.brand}}
.sub{color:${C.muted};font-size:8.8pt}
.gantt{border:1px solid ${C.cardBorder};border-radius:3mm;padding:3mm;margin:2mm 0 3mm}
.leyenda{font-size:8.5pt;color:${C.muted};display:flex;flex-wrap:wrap;gap:5mm;margin-bottom:5mm}
.leyenda i{display:inline-block;width:6mm;height:2.6mm;border-radius:2mm;vertical-align:middle;margin-right:1.5mm}
.dia{display:grid;grid-template-columns:30mm 1fr;gap:4mm;padding:3mm 0;border-bottom:1px solid ${C.line};break-inside:avoid}
.fecha b{display:block;font-family:'Jakarta',sans-serif;font-size:12pt;color:${C.brand}}
.fecha span{display:block;font-size:8.6pt;color:${C.muted}}
.eventos{border-left:2px solid ${C.accent};padding-left:4mm;display:flex;flex-direction:column;gap:1.8mm}
.ev p{margin:0}
.ev .tag{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${C.muted}}
.ev.hito .tag{color:${C.brand}}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:6mm}
.box{border:1px solid ${C.cardBorder};border-radius:3mm;padding:4mm;background:#fbfdfb;break-inside:avoid}
.box h3{margin-top:0}
ul{margin:0 0 2mm;padding-left:5mm}li{margin-bottom:1mm}
.vazio{color:${C.muted};font-style:italic}
.texto p{margin-bottom:2.5mm}
.rodape{margin-top:8mm;font-size:8.6pt;color:${C.muted}}
`
}

const BARS =
  '<svg class="barras" viewBox="0 0 100 100" fill="#fff"><rect x="22" y="8" width="72" height="12" rx="6"/><rect x="63" y="26" width="31" height="12" rx="6"/><rect x="16" y="44" width="78" height="12" rx="6"/><rect x="35" y="62" width="59" height="12" rx="6"/><rect x="41" y="80" width="53" height="12" rx="6"/></svg>'

/** HTML completo do informe (documento A4). */
export function renderReportDocument(report: ProjectReport, options: ReportOptions, ctx: ReportDocumentContext): string {
  const { t } = ctx
  const f = formatters(ctx.locale)
  const title = options.title.trim() || t('projects.report.doc.defaultTitle')
  const subtitle = options.subtitle.trim() || t('projects.report.doc.defaultSubtitle')
  const enabled = REPORT_SECTIONS.filter((s) => options.sections[s])
  const number = (section: ReportSection) => enabled.indexOf(section) + 1
  const heading = (section: ReportSection) => `<h2>${number(section)}. ${esc(t(`projects.report.doc.sections.${section}`))}</h2>`
  const empty = `<p class="vazio">${esc(t('projects.report.doc.empty'))}</p>`
  const k = report.kpis
  const parts: string[] = []

  parts.push(`<div class="cover">
  <div class="marca"><span class="ico"><img src="${esc(ctx.iconUrl)}" alt=""></span>${esc(ctx.platformName)}</div>
  <div>
    <div class="kicker">${esc(t('projects.report.doc.kicker', { key: ctx.project.key, name: ctx.project.name }))}</div>
    <h1>${esc(ctx.project.name)}<br>${esc(title)}</h1>
    <p class="sub">${esc(subtitle)}</p>
  </div>
  <div class="meta">
    <div><span>${esc(t('projects.report.doc.start'))}</span><b>${report.start ? esc(f.numeric(report.start)) : '—'}</b></div>
    <div><span>${esc(t('projects.report.doc.cutoff'))}</span><b>${esc(f.numeric(report.end))}</b></div>
    <div><span>${esc(t('projects.report.doc.team'))}</span><b>${esc(report.team.join(' · ') || '—')}</b></div>
  </div>
  ${BARS}
</div>`)

  if (options.sections.summary) {
    const kpi = (value: string, label: string) => `<div class="kpi"><b>${esc(value)}</b><span>${esc(label)}</span></div>`
    const of = (done: number, total: number) => t('projects.report.doc.of', { done, total })
    const kpis = [
      k.days !== null && report.start
        ? kpi(t('projects.report.doc.kpiDays', { count: k.days }), t('projects.report.doc.kpiDaysHint', { date: f.numeric(report.start), count: k.workdays ?? 0 }))
        : '',
      kpi(of(k.tasksDone, k.tasksTotal), t('projects.report.doc.kpiTasks')),
      kpi(of(k.milestonesDone, k.milestonesTotal), t('projects.report.doc.kpiMilestones')),
      k.phasesTotal ? kpi(of(k.phasesDone, k.phasesTotal), t('projects.report.doc.kpiPhases')) : '',
    ].filter(Boolean)
    const chart = gantt(report, ctx)
    parts.push(`<div class="page">${heading('summary')}
  ${options.summary.trim() ? `<div class="lead texto">${paragraphs(options.summary)}</div>` : ''}
  <div class="kpis" style="grid-template-columns:repeat(${kpis.length},1fr)">${kpis.join('')}</div>
  ${
    chart
      ? `<h3>${esc(t('projects.report.doc.schedule'))}</h3><div class="gantt">${chart}</div>
  <div class="leyenda"><span><i style="background:${C.brand}"></i>${esc(t('projects.report.doc.legendDone'))}</span><span><i style="background:${C.accent};opacity:.7"></i>${esc(t('projects.report.doc.legendOpen'))}</span><span>◆ ${esc(t('projects.report.doc.legendMilestone'))}</span><span><i style="background:none;border-top:2px dashed ${C.warn};height:0"></i>${esc(t('projects.report.doc.legendCutoff'))}</span></div>`
      : ''
  }
</div>`)
  }

  if (options.sections.phases) {
    const rows = report.phases
      .map((p) => {
        const days = p.days === null ? '—' : p.end ? String(p.days) : t('projects.report.doc.daysOpen', { count: p.days })
        const status = p.statusName ? pill(p.statusName, p.done ? 'ok' : p.statusCategory === 'in_progress' ? 'info' : 'neutral') : '—'
        return `<tr><td><b>${esc(p.name)}</b></td><td class="num">${p.start ? esc(f.dayMonth(p.start)) : '—'}</td><td class="num">${p.end ? esc(f.dayMonth(p.end)) : p.start ? esc(t('projects.report.doc.inProgress')) : '—'}</td><td class="num">${esc(days)}</td><td>${status}</td><td><div class="bar"><i style="width:${p.progress}%"></i></div><span class="sub">${p.progress}%</span></td></tr>`
      })
      .join('')
    const cols = ['phase', 'start', 'end', 'days', 'status', 'progress'].map((c) => `<th>${esc(t(`projects.report.doc.cols.${c}`))}</th>`).join('')
    parts.push(
      `<div class="page">${heading('phases')}${rows ? `<table><thead><tr>${cols}</tr></thead><tbody>${rows}</tbody></table>` : `<p class="vazio">${esc(t('projects.report.doc.noPhases'))}</p>`}</div>`,
    )
  }

  if (options.sections.milestones) {
    const rows = report.milestones
      .map(
        (m) =>
          `<tr><td class="num">${esc(f.numeric(m.dueDate.slice(0, 10)))}</td><td><b>${esc(m.name)}</b>${m.description ? `<br><span class="sub">${esc(m.description)}</span>` : ''}</td><td>${pill(t(`timeline.milestones.states.${m.state}`), m.state === 'done' ? 'ok' : 'warn')}</td></tr>`,
      )
      .join('')
    const cols = ['date', 'milestone', 'status'].map((c) => `<th>${esc(t(`projects.report.doc.cols.${c}`))}</th>`).join('')
    // marcos cabem na página das fases quando as duas seções saem
    const breakClass = options.sections.phases ? '' : ' class="page"'
    parts.push(`<div${breakClass}${options.sections.phases ? ' style="margin-top:8mm"' : ''}>${heading('milestones')}${rows ? `<table><thead><tr>${cols}</tr></thead><tbody>${rows}</tbody></table>` : empty}</div>`)
  }

  if (options.sections.chronology) {
    const days = report.chronology.days
      .map(
        (d) =>
          `<section class="dia"><div class="fecha"><b>${esc(f.numeric(d.date))}</b><span>${esc(f.long(d.date))}</span></div><div class="eventos">${d.items.map((i) => chronologyItem(i, ctx)).join('')}</div></section>`,
      )
      .join('')
    parts.push(`<div class="page">${heading('chronology')}<p class="lead">${esc(t('projects.report.doc.chronologyLead'))}</p>${days || empty}</div>`)
  }

  if (options.sections.tasks) {
    const total = report.tasks.reduce((sum, g) => sum + g.tasks.length, 0)
    const cols = ['code', 'task', 'start', 'due', 'assignee', 'status'].map((c) => `<th>${esc(t(`projects.report.doc.cols.${c}`))}</th>`).join('')
    const body = report.tasks
      .map((g) => `<tr class="grupo"><td colspan="6">${esc(t(`projects.report.doc.taskStates.${g.state}`))} · ${g.tasks.length}</td></tr>${g.tasks.map((task) => taskRow(task, f)).join('')}`)
      .join('')
    parts.push(
      `<div class="page">${heading('tasks')}<p class="lead">${esc(t('projects.report.doc.tasksLead', { count: total }))}</p>${total ? `<table><thead><tr>${cols}</tr></thead><tbody>${body}</tbody></table>` : empty}</div>`,
    )
  }

  if (options.sections.next) {
    const milestones = report.next.milestones.map((m) => `<li><b>${esc(f.numeric(m.dueDate.slice(0, 10)))}</b> · ${esc(m.name)}</li>`).join('')
    const tasks = report.next.tasks
      .slice(0, 15)
      .map((task) => {
        const due = dayOf(task.dueDate)
        return `<li><span class="code">${esc(task.code)}</span> ${esc(task.title)}${due ? ` <span class="sub">· ${esc(f.dayMonth(due))}</span>` : ''}${task.assignee ? ` <span class="sub">· ${esc(task.assignee.name)}</span>` : ''}</li>`
      })
      .join('')
    const more = report.next.tasks.length > 15 ? `<li class="sub">${esc(t('projects.report.doc.more', { count: report.next.tasks.length - 15 }))}</li>` : ''
    const nothing = `<p class="vazio">${esc(t('projects.report.doc.nothingPending'))}</p>`
    parts.push(`<div class="page">${heading('next')}
  <div class="cols">
    <div class="box"><h3>${esc(t('projects.report.doc.nextMilestones'))}</h3>${milestones ? `<ul>${milestones}</ul>` : nothing}</div>
    <div class="box"><h3>${esc(t('projects.report.doc.nextTasks'))}</h3>${tasks ? `<ul>${tasks}${more}</ul>` : nothing}</div>
  </div>
  ${options.notes.trim() ? `<h3 style="margin-top:8mm">${esc(t('projects.report.doc.notes'))}</h3><div class="texto">${paragraphs(options.notes)}</div>` : ''}
  <p class="rodape">${esc(t('projects.report.doc.generated', { platform: ctx.platformName, date: f.numeric(report.end) }))}</p>
</div>`)
  }

  const footer = t('projects.report.doc.footer', { name: ctx.project.name, title, date: f.numeric(report.end) })
  const docTitle = `${ctx.project.key} - ${title} - ${report.end}`
  return `<!doctype html><html lang="${esc(ctx.locale)}"><head><meta charset="utf-8"><title>${esc(docTitle)}</title><style>${styles(ctx, footer)}</style></head><body>${parts.join('\n')}</body></html>`
}
