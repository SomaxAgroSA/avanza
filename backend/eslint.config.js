const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
  { ignores: ['bin/**', 'pb_data/**', 'public/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
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
]
