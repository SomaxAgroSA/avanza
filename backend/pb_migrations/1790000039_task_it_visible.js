/// <reference path="../pb_data/types.d.ts" />

/**
 * Tarefa visível para TI (regras de negócio §24): o Responsável TI do projeto vê as tarefas
 * marcadas, além das atribuídas a ele. Padrão: desmarcada.
 */

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks')
    if (!tasks.fields.getByName('it_visible')) {
      tasks.fields.add(new BoolField({ name: 'it_visible' }))
      app.save(tasks)
    }
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks')
    if (tasks.fields.getByName('it_visible')) {
      tasks.fields.removeByName('it_visible')
      app.save(tasks)
    }
  },
)
