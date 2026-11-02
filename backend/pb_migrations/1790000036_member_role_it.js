/// <reference path="../pb_data/types.d.ts" />

/**
 * Papel "Responsável TI" no projeto (regras de negócio §24): `project_members.role` aceita `it`.
 */

migrate(
  (app) => {
    const { MEMBER_ROLES } = require(`${__hooks}/src/domain/project.js`)
    const members = app.findCollectionByNameOrId('project_members')
    const field = members.fields.getByName('role')
    field.values = MEMBER_ROLES.slice()
    app.save(members)
  },
  (app) => {
    const members = app.findCollectionByNameOrId('project_members')
    const field = members.fields.getByName('role')
    field.values = ['manager', 'member', 'viewer']
    app.save(members)
  },
)
