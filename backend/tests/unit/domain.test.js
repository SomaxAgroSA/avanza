const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { PERMISSIONS, ROLE_CODES, DEFAULT_ROLE_PERMISSIONS, isKnownPermission } = require('../../src/domain/permissions')
const rbac = require('../../src/domain/rbac')
const session = require('../../src/domain/session')
const user = require('../../src/domain/user')

const principal = (roleCode, permissions, extra) =>
  rbac.createPrincipal(Object.assign({ userId: 'u1', roleId: 'r-' + roleCode, roleCode, permissions }, extra))

describe('domain/permissions', () => {
  it('catálogo contém as permissões da diretriz', () => {
    const codes = PERMISSIONS.map((p) => p.code)
    for (const code of ['projects.view', 'tasks.fork', 'kanban.manage', 'users.disable', 'permissions.manage']) {
      assert.ok(codes.includes(code), code)
    }
    assert.equal(new Set(codes).size, codes.length, 'códigos duplicados')
  })

  it('perfis padrão só referenciam permissões conhecidas', () => {
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS)) {
      for (const code of DEFAULT_ROLE_PERMISSIONS[role]) assert.ok(isKnownPermission(code), `${role}: ${code}`)
    }
  })

  it('VIEWER não pode editar nada', () => {
    const viewer = DEFAULT_ROLE_PERMISSIONS[ROLE_CODES.VIEWER]
    // seções do projeto (§35) também são só de leitura
    const sections = ['projects.charter', 'projects.history', 'projects.members', 'projects.report']
    assert.ok(viewer.every((code) => code.endsWith('.view') || sections.includes(code)))
    assert.deepEqual(sections.filter((code) => !viewer.includes(code)), [])
  })
})

describe('domain/rbac', () => {
  it('SUPER_ADMIN possui todas as permissões implicitamente', () => {
    const p = principal(ROLE_CODES.SUPER_ADMIN, [])
    assert.equal(rbac.can(p, 'tasks.delete'), true)
    assert.equal(rbac.can(p, 'permissions.manage'), true)
  })

  it('demais perfis dependem das permissões atribuídas', () => {
    const p = principal(ROLE_CODES.MEMBER, ['tasks.view'])
    assert.equal(rbac.can(p, 'tasks.view'), true)
    assert.equal(rbac.can(p, 'tasks.delete'), false)
  })

  it('assertCan lança FORBIDDEN sem permissão e UNAUTHENTICATED sem principal', () => {
    assert.throws(() => rbac.assertCan(principal(ROLE_CODES.VIEWER, ['tasks.view']), 'tasks.edit'), { code: 'FORBIDDEN' })
    assert.throws(() => rbac.assertCan(null, 'tasks.view'), { code: 'UNAUTHENTICATED' })
  })

  describe('alteração de permissões de perfil', () => {
    const admin = principal(ROLE_CODES.ADMIN, ['permissions.manage', 'tasks.view', 'tasks.edit'])
    const memberRole = { id: 'r-MEMBER', code: ROLE_CODES.MEMBER }

    it('exige permissions.manage', () => {
      const p = principal(ROLE_CODES.MANAGER, ['tasks.view'])
      assert.throws(() => rbac.assertCanUpdateRolePermissions(p, memberRole, ['tasks.view']), { code: 'FORBIDDEN' })
    })

    it('SUPER_ADMIN é imutável', () => {
      const root = principal(ROLE_CODES.SUPER_ADMIN, [])
      assert.throws(
        () => rbac.assertCanUpdateRolePermissions(root, { id: 'r-SA', code: ROLE_CODES.SUPER_ADMIN }, []),
        { code: 'ROLE_IMMUTABLE' },
      )
    })

    it('ninguém (exceto SUPER_ADMIN) altera o próprio perfil', () => {
      assert.throws(
        () => rbac.assertCanUpdateRolePermissions(admin, { id: admin.roleId, code: ROLE_CODES.ADMIN }, ['tasks.view']),
        { code: 'CANNOT_EDIT_OWN_ROLE' },
      )
    })

    it('rejeita permissões desconhecidas', () => {
      assert.throws(() => rbac.assertCanUpdateRolePermissions(admin, memberRole, ['tasks.hack']), {
        code: 'VALIDATION_ERROR',
      })
    })

    it('impede conceder permissão que o próprio usuário não possui (escalonamento)', () => {
      assert.throws(() => rbac.assertCanUpdateRolePermissions(admin, memberRole, ['tasks.view', 'users.disable']), {
        code: 'PRIVILEGE_ESCALATION',
      })
    })

    it('permite quando todas as regras são atendidas', () => {
      assert.doesNotThrow(() => rbac.assertCanUpdateRolePermissions(admin, memberRole, ['tasks.view', 'tasks.edit']))
    })
  })

  describe('atribuição de perfil a usuário', () => {
    const admin = principal(ROLE_CODES.ADMIN, ['users.edit', 'tasks.view'])

    it('somente SUPER_ADMIN atribui SUPER_ADMIN', () => {
      assert.throws(() => rbac.assertCanAssignRole(admin, { code: ROLE_CODES.SUPER_ADMIN }, []), { code: 'PRIVILEGE_ESCALATION' })
      assert.doesNotThrow(() => rbac.assertCanAssignRole(principal(ROLE_CODES.SUPER_ADMIN, []), { code: ROLE_CODES.SUPER_ADMIN }, []))
    })

    it('não atribui perfil com permissões que o usuário não possui', () => {
      assert.throws(() => rbac.assertCanAssignRole(admin, { code: 'MANAGER' }, ['tasks.view', 'tasks.delete']), {
        code: 'PRIVILEGE_ESCALATION',
      })
      assert.doesNotThrow(() => rbac.assertCanAssignRole(admin, { code: 'VIEWER' }, ['tasks.view']))
    })
  })
})

describe('domain/session', () => {
  const policy = session.createPolicy({ ttlHours: 12, rememberTtlDays: 30, idleMinutes: 120, touchIntervalSeconds: 300 })
  const now = new Date('2026-01-10T12:00:00.000Z')
  const minutes = (m) => new Date(now.getTime() + m * 60000)

  it('calcula expiração conforme "lembrar-me"', () => {
    assert.equal(session.computeExpiry(now, false, policy).toISOString(), '2026-01-11T00:00:00.000Z')
    assert.equal(session.computeExpiry(now, true, policy).toISOString(), '2026-02-09T12:00:00.000Z')
  })

  const base = { remember: false, expiresAt: session.computeExpiry(now, false, policy), lastSeenAt: now, revokedAt: null }

  it('sessão recente é válida e não precisa de touch', () => {
    assert.deepEqual(session.evaluate(base, minutes(1), policy), { valid: true, reason: null, shouldTouch: false })
  })

  it('pede touch após o intervalo configurado', () => {
    assert.equal(session.evaluate(base, minutes(6), policy).shouldTouch, true)
  })

  it('expira por inatividade quando não é persistente', () => {
    assert.deepEqual(session.evaluate(base, minutes(121), policy), { valid: false, reason: 'idle', shouldTouch: false })
  })

  it('sessão persistente não expira por inatividade', () => {
    const remembered = Object.assign({}, base, { remember: true, expiresAt: session.computeExpiry(now, true, policy) })
    assert.equal(session.evaluate(remembered, minutes(24 * 60), policy).valid, true)
  })

  it('expira pelo prazo absoluto', () => {
    assert.equal(session.evaluate(base, minutes(12 * 60 + 1), policy).reason, 'expired')
  })

  it('sessão revogada é inválida', () => {
    const revoked = Object.assign({}, base, { revokedAt: now })
    assert.equal(session.evaluate(revoked, minutes(1), policy).reason, 'revoked')
  })

  it('renovação estende apenas sessões persistentes', () => {
    const remembered = Object.assign({}, base, { remember: true })
    assert.equal(session.renewedExpiry(remembered, minutes(60), policy).toISOString(), '2026-02-09T13:00:00.000Z')
    assert.equal(session.renewedExpiry(base, minutes(60), policy).toISOString(), base.expiresAt.toISOString())
  })

  it('policy rejeita valores inválidos usando padrões', () => {
    const p = session.createPolicy({ ttlHours: 'abc', idleMinutes: -5 })
    assert.equal(p.ttlHours, 12)
    assert.equal(p.idleMinutes, 120)
  })
})

describe('domain/user', () => {
  it('normaliza e-mail', () => {
    assert.equal(user.normalizeEmail('  Ana@Example.COM '), 'ana@example.com')
  })

  it('valida força da senha', () => {
    assert.equal(user.passwordIssue('curta1'), 'too_short')
    assert.equal(user.passwordIssue('somenteletras'), 'weak_password')
    assert.equal(user.passwordIssue('1234567890'), 'weak_password')
    assert.equal(user.passwordIssue('senhaForte123'), null)
    assert.equal(user.passwordIssue('a1'.repeat(40)), 'too_long')
  })

  it('usuário desativado não pode autenticar', () => {
    assert.throws(() => user.assertCanAuthenticate({ status: 'disabled' }), { code: 'ACCOUNT_DISABLED' })
    assert.doesNotThrow(() => user.assertCanAuthenticate({ status: 'active' }))
  })

  it('não permite desativar a si mesmo', () => {
    const actor = rbac.createPrincipal({ userId: 'u1', roleId: 'r', roleCode: 'ADMIN', permissions: ['users.disable'] })
    assert.throws(() => user.assertCanChangeStatus(actor, { id: 'u1', roleCode: 'MEMBER' }, 'disabled'), {
      code: 'CANNOT_DISABLE_SELF',
    })
  })

  it('somente SUPER_ADMIN altera status de SUPER_ADMIN', () => {
    const actor = rbac.createPrincipal({ userId: 'u1', roleId: 'r', roleCode: 'ADMIN', permissions: ['users.disable'] })
    assert.throws(() => user.assertCanChangeStatus(actor, { id: 'u2', roleCode: 'SUPER_ADMIN' }, 'disabled'), {
      code: 'FORBIDDEN',
    })
  })

  it('exige users.disable para alterar status', () => {
    const actor = rbac.createPrincipal({ userId: 'u1', roleId: 'r', roleCode: 'MANAGER', permissions: ['users.view'] })
    assert.throws(() => user.assertCanChangeStatus(actor, { id: 'u2', roleCode: 'MEMBER' }, 'disabled'), { code: 'FORBIDDEN' })
  })
})
