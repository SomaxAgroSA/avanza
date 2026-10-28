const js = require('@eslint/js')
const globals = require('globals')

/** Globais expostos pelo JSVM do PocketBase (pb_hooks e pb_migrations). */
const pocketbaseGlobals = Object.fromEntries(
  [
    '$app', '$apis', '$os', '$security', '$dbx', '$http', '$filesystem', '$mails', '$template',
    '__hooks', 'routerAdd', 'routerUse', 'migrate', 'cronAdd', 'onBootstrap', 'onRealtimeSubscribeRequest', 'onRecordAfterCreateSuccess', 'onRecordAfterUpdateSuccess', 'onRecordAfterDeleteSuccess',
    'Record', 'Collection', 'Cookie', 'Command', 'Middleware', 'DynamicModel', 'MailerMessage', 'SubscriptionMessage', 'ForbiddenError', 'UnauthorizedError', 'BadRequestError',
    'SelectField', 'RelationField', 'DateField', 'TextField', 'BoolField', 'NumberField', 'JSONField',
    'arrayOf', 'unmarshal', 'toString', 'toBytes', 'sleep',
  ].map((name) => [name, 'readonly']),
)

module.exports = [
  { ignores: ['bin/**', 'pb_data/**', 'pb_public/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: Object.assign({}, globals.node, pocketbaseGlobals),
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Casos de uso assíncronos: nesses métodos de array a Promise de um callback async não é esperada
    // (o forEach segue sem esperar; filter/some/find recebem uma Promise, que é sempre "verdadeira").
    files: ['src/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^(forEach|filter|some|every|find|findIndex|sort|reduce|flatMap)$/] > :function[async=true]',
          message: 'Callback async aqui não é esperado: use for...of ou Promise.all.',
        },
      ],
    },
  },
  {
    // Código que roda no JSVM (goja): evitar sintaxe que ele não suporta com segurança.
    files: ['pb_hooks/**/*.js', 'pb_migrations/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ChainExpression', message: 'Evite optional chaining (?.) no JSVM.' },
        { selector: "LogicalExpression[operator='??']", message: 'Evite ?? no JSVM.' },
        { selector: 'AwaitExpression', message: 'O JSVM do PocketBase é síncrono.' },
      ],
    },
  },
]
