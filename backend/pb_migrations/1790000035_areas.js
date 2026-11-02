/// <reference path="../pb_data/types.d.ts" />

/**
 * Áreas responsáveis (regras de negócio §23): lista configurável (Configurações → Áreas), sem padrão;
 * `tasks.area_id` e `projects.area_id` vazios = sem área (o que já existia fica sem área).
 * A carga inicial é DADO editável pelo administrador.
 */

const LOCKED_RULES = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null }

/** [chave, nome, cor] */
const AREAS = [
  ['INTELIGENCIA', 'Inteligencia Estratégica', 'violet'],
  ['TI', 'Dpto. TI', 'blue'],
  ['DESARROLLO', 'Desarrollo e Innovación', 'indigo'],
  ['MARKETING', 'Marketing', 'pink'],
  ['CONTABILIDAD', 'Contabilidad', 'teal'],
  ['ADMINISTRACION', 'Administración', 'gray'],
  ['FERTILIZANTES', 'Fertilizantes', 'green'],
  ['LOGISTICA', 'Logística', 'orange'],
  ['SUPPLY', 'Supply', 'amber'],
  ['COMEX', 'Comex', 'blue'],
  ['CREDITOS', 'Créditos', 'red'],
]

migrate(
  (app) => {
    const areas = new Collection(
      Object.assign({}, LOCKED_RULES, {
        type: 'base',
        name: 'areas',
        fields: [
          { name: 'key', type: 'text', required: true, max: 30 },
          { name: 'name', type: 'text', required: true, max: 60, presentable: true },
          { name: 'description', type: 'text', max: 255 },
          { name: 'color', type: 'text', max: 20 },
          { name: 'order', type: 'number', onlyInt: true },
          { name: 'is_active', type: 'bool' },
          { name: 'is_default', type: 'bool' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_areas_key ON areas (key)', 'CREATE INDEX idx_areas_order ON areas ("order")'],
      }),
    )
    app.save(areas)
    AREAS.forEach((def, order) => {
      const record = new Record(areas)
      record.set('key', def[0])
      record.set('name', def[1])
      record.set('color', def[2])
      record.set('is_default', false)
      record.set('is_active', true)
      record.set('order', order)
      app.save(record)
    })

    ;['tasks', 'projects'].forEach((name) => {
      const collection = app.findCollectionByNameOrId(name)
      if (!collection.fields.getByName('area_id')) {
        collection.fields.add(new TextField({ name: 'area_id', max: 15 }))
        collection.addIndex(`idx_${name}_area`, false, 'area_id', '')
        app.save(collection)
      }
    })
  },
  (app) => {
    ;['tasks', 'projects'].forEach((name) => {
      const collection = app.findCollectionByNameOrId(name)
      if (collection.fields.getByName('area_id')) {
        collection.removeIndex(`idx_${name}_area`)
        collection.fields.removeByName('area_id')
        app.save(collection)
      }
    })
    app.delete(app.findCollectionByNameOrId('areas'))
  },
)
