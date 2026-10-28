const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeColor, isColor, colorRule } = require('../../src/domain/color')
const { OPTION_COLORS } = require('../../src/domain/custom-field')
const { PROJECT_COVERS } = require('../../src/domain/project')

describe('domain/color', () => {
  it('aceita a paleta do lugar e a cor livre #rrggbb (normalizada em minúsculas)', () => {
    assert.equal(normalizeColor('violet', OPTION_COLORS), 'violet')
    assert.equal(normalizeColor('slate', PROJECT_COVERS), 'slate')
    assert.equal(normalizeColor('#1A7F37', OPTION_COLORS), '#1a7f37')
    assert.equal(normalizeColor(' #00aaff ', OPTION_COLORS), '#00aaff')
    assert.equal(isColor('#000000', PROJECT_COVERS), true)
  })

  it('recusa o que não é da paleta nem hex de 6 dígitos', () => {
    for (const value of ['slate', '#fff', '#12345g', 'rgb(0,0,0)', '1a7f37', '', null, 42, '#1a7f37ff']) {
      assert.equal(isColor(value, OPTION_COLORS), false, String(value))
    }
    assert.deepEqual(colorRule(OPTION_COLORS)('purple'), { error: 'invalid_option' })
    assert.deepEqual(colorRule(OPTION_COLORS)('#ABCDEF'), { value: '#abcdef' })
  })
})
