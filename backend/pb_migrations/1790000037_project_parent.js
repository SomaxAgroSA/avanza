/// <reference path="../pb_data/types.d.ts" />

/**
 * Projeto pai (regras de negócio §25): `projects.parent_id` vazio = projeto sem pai.
 * Um só nível: o pai não tem pai e o filho não tem filhos (validado na aplicação).
 */

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('projects')
    if (!collection.fields.getByName('parent_id')) {
      collection.fields.add(new TextField({ name: 'parent_id', max: 15 }))
      collection.addIndex('idx_projects_parent', false, 'parent_id', '')
      app.save(collection)
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('projects')
    if (collection.fields.getByName('parent_id')) {
      collection.removeIndex('idx_projects_parent')
      collection.fields.removeByName('parent_id')
      app.save(collection)
    }
  },
)
