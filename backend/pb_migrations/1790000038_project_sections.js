/// <reference path="../pb_data/types.d.ts" />

/**
 * Seções do projeto (regras de negócio §26): permissões projects.charter, projects.history,
 * projects.members e projects.report. Todo perfil que já vê projetos recebe as quatro, para nada
 * mudar até o administrador desligar alguma (idempotente).
 */

const CODES = ['projects.charter', 'projects.history', 'projects.members', 'projects.report']

migrate(
  (app) => {
    const view = app.findFirstRecordByData('permissions', 'code', 'projects.view')
    const holders = app.findRecordsByFilter('role_permissions', 'permission_id = {:p}', '', 0, 0, { p: view.id }).map((r) => r.get('role_id'))
    CODES.forEach((code) => {
      let permission
      try {
        permission = app.findFirstRecordByData('permissions', 'code', code)
      } catch (_) {
        permission = new Record(app.findCollectionByNameOrId('permissions'))
        permission.set('code', code)
        permission.set('module', 'projects')
        app.save(permission)
      }
      holders.forEach((roleId) => {
        const existing = app.findRecordsByFilter('role_permissions', 'role_id = {:r} && permission_id = {:p}', '', 1, 0, { r: roleId, p: permission.id })
        if (existing.length > 0) return
        const link = new Record(app.findCollectionByNameOrId('role_permissions'))
        link.set('role_id', roleId)
        link.set('permission_id', permission.id)
        app.save(link)
      })
    })
  },
  (app) => {
    CODES.forEach((code) => {
      try {
        const permission = app.findFirstRecordByData('permissions', 'code', code)
        app.findRecordsByFilter('role_permissions', 'permission_id = {:p}', '', 0, 0, { p: permission.id }).forEach((r) => app.delete(r))
        app.delete(permission)
      } catch (_) {
        // permissão ausente
      }
    })
  },
)
