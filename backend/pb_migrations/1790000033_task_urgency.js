/// <reference path="../pb_data/types.d.ts" />

/**
 * Urgência da tarefa (regras de negócio §22): semáforo alta / média / baixa; vazio = não definida
 * (as tarefas que já existem ficam sem urgência).
 */

migrate(
  (app) => {
    const { URGENCY_LEVELS } = require(`${__hooks}/src/domain/task.js`)
    const tasks = app.findCollectionByNameOrId('tasks')
    if (!tasks.fields.getByName('urgency')) {
      tasks.fields.add(new SelectField({ name: 'urgency', maxSelect: 1, values: URGENCY_LEVELS }))
      app.save(tasks)
    }
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks')
    if (tasks.fields.getByName('urgency')) {
      tasks.fields.removeByName('urgency')
      app.save(tasks)
    }
  },
)
