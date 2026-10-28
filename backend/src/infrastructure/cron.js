/**
 * Expressões cron de 5 campos (minuto hora dia mês dia-da-semana), no horário do servidor — as mesmas
 * que o PocketBase aceitava nas rotinas: `*`, números, listas (1,15), faixas (1-5) e passos (*\/3, 0-30/10).
 */

const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
]

function parseField(text, range) {
  const values = new Set()
  text.split(',').forEach((part) => {
    const [base, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    let from = range.min
    let to = range.max
    if (base !== '*') {
      const [a, b] = base.split('-')
      from = Number(a)
      to = b === undefined ? (stepText === undefined ? from : range.max) : Number(b)
    }
    if (![from, to, step].every(Number.isInteger) || step < 1 || from < range.min || to > range.max || from > to) {
      throw new Error(`Campo cron inválido: "${text}"`)
    }
    for (let v = from; v <= to; v += step) values.add(v)
  })
  return values
}

function parseCron(expression) {
  const parts = String(expression).trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Expressão cron inválida: "${expression}"`)
  const sets = parts.map((part, i) => parseField(part, FIELDS[i]))
  return {
    matches(date) {
      return (
        sets[0].has(date.getMinutes()) &&
        sets[1].has(date.getHours()) &&
        sets[2].has(date.getDate()) &&
        sets[3].has(date.getMonth() + 1) &&
        sets[4].has(date.getDay())
      )
    },
  }
}

module.exports = { parseCron }
