/// <reference path="../pb_data/types.d.ts" />

/**
 * Informe do projeto (aba Informe, regras de negócio §20).
 * - tasks.report_excluded: a tarefa ficou fora do informe (padrão: entra). Gravado ao contrário para
 *   que as tarefas que já existem entrem sem precisar preencher nada.
 */

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks')
    if (!tasks.fields.getByName('report_excluded')) {
      tasks.fields.add(new BoolField({ name: 'report_excluded' }))
      app.save(tasks)
    }
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks')
    if (tasks.fields.getByName('report_excluded')) {
      tasks.fields.removeByName('report_excluded')
      app.save(tasks)
    }
  },
)
