const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { parseCron } = require('../../src/infrastructure/cron')

const at = (h, m, day) => new Date(2026, 9, day || 28, h, m)

describe('cron', () => {
  it('casa as rotinas do Avanza no horário do servidor', () => {
    assert.equal(parseCron('0 8 * * *').matches(at(8, 0)), true)
    assert.equal(parseCron('0 8 * * *').matches(at(8, 1)), false)
    assert.equal(parseCron('45 3 * * *').matches(at(3, 45)), true)
    assert.equal(parseCron('* * * * *').matches(at(13, 37)), true)
    assert.equal(parseCron('*/3 * * * *').matches(at(10, 9)), true)
    assert.equal(parseCron('*/3 * * * *').matches(at(10, 10)), false)
  })

  it('aceita listas, faixas e dia da semana', () => {
    const weekdays = parseCron('0-30/10 9,18 * * 1-5')
    assert.equal(weekdays.matches(at(9, 20, 28)), true) // quarta-feira
    assert.equal(weekdays.matches(at(18, 0, 31)), false) // sábado
    assert.equal(weekdays.matches(at(9, 40, 28)), false)
  })

  it('recusa expressões inválidas', () => {
    assert.throws(() => parseCron('0 8 * *'), /inválida/)
    assert.throws(() => parseCron('61 * * * *'), /inválido/)
    assert.throws(() => parseCron('*/0 * * * *'), /inválido/)
  })
})
