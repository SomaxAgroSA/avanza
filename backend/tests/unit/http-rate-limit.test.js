const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createRateLimiter } = require('../../src/http/rate-limit')

const RULES = [
  { label: 'POST /api/v1/auth/login', duration: 60, maxRequests: 2 },
  { label: '/api/v1/', duration: 60, maxRequests: 3 },
  { label: '/api/', duration: 10, maxRequests: 100 },
]

describe('limite por IP', () => {
  it('vale a regra mais específica (método + caminho antes do prefixo)', () => {
    const limiter = createRateLimiter(RULES)
    assert.equal(limiter.hit('POST', '/api/v1/auth/login', '1.1.1.1').rule, 'POST /api/v1/auth/login')
    assert.equal(limiter.hit('GET', '/api/v1/auth/login', '1.1.1.1').rule, '/api/v1/')
    assert.equal(limiter.hit('GET', '/api/realtime', '1.1.1.1').rule, '/api/')
    assert.equal(limiter.hit('GET', '/dashboard', '1.1.1.1').rule, undefined)
  })

  it('bloqueia acima do máximo na janela, por IP, e libera na janela seguinte', () => {
    let clock = 0
    const limiter = createRateLimiter(RULES, { now: () => clock })
    assert.equal(limiter.hit('POST', '/api/v1/auth/login', '1.1.1.1').allowed, true)
    assert.equal(limiter.hit('POST', '/api/v1/auth/login', '1.1.1.1').allowed, true)
    const blocked = limiter.hit('POST', '/api/v1/auth/login', '1.1.1.1')
    assert.equal(blocked.allowed, false)
    assert.equal(blocked.retryAfter, 60)
    assert.equal(limiter.hit('POST', '/api/v1/auth/login', '2.2.2.2').allowed, true)
    clock = 60000
    assert.equal(limiter.hit('POST', '/api/v1/auth/login', '1.1.1.1').allowed, true)
  })

  it('pode ser reconfigurado ou desligado', () => {
    const limiter = createRateLimiter(RULES)
    limiter.configure([{ label: '/api/', duration: 60, maxRequests: 0 }])
    assert.equal(limiter.hit('GET', '/api/v1/x', 'ip').allowed, false)
    limiter.configure(RULES, false)
    assert.equal(limiter.hit('GET', '/api/v1/x', 'ip').allowed, true)
  })

  it('descarta as janelas vencidas', () => {
    let clock = 0
    const limiter = createRateLimiter(RULES, { now: () => clock })
    limiter.hit('GET', '/api/v1/a', 'ip')
    assert.equal(limiter.size(), 1)
    clock = 61000
    limiter.sweep()
    assert.equal(limiter.size(), 0)
  })
})
