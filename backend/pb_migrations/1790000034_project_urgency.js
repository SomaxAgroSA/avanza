/// <reference path="../pb_data/types.d.ts" />

/**
 * Urgência do projeto (regras de negócio §22): o mesmo semáforo das tarefas (alta / média / baixa);
 * vazio = não definida (os projetos que já existem ficam sem urgência).
 */

migrate(
  (app) => {
    const { URGENCY_LEVELS } = require(`${__hooks}/src/domain/task.js`)
    const projects = app.findCollectionByNameOrId('projects')
    if (!projects.fields.getByName('urgency')) {
      projects.fields.add(new SelectField({ name: 'urgency', maxSelect: 1, values: URGENCY_LEVELS }))
      app.save(projects)
    }
  },
  (app) => {
    const projects = app.findCollectionByNameOrId('projects')
    if (projects.fields.getByName('urgency')) {
      projects.fields.removeByName('urgency')
      app.save(projects)
    }
  },
)
