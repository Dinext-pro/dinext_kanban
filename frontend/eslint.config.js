import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

const vitestGlobals = {
  afterEach: 'readonly',
  beforeEach: 'readonly',
  describe: 'readonly',
  expect: 'readonly',
  test: 'readonly',
  vi: 'readonly',
}

export default [
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['src/**/*.{js,vue}', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        __: 'readonly',
        frappe: 'readonly',
        $: 'readonly',
        cur_list: 'readonly',
      },
    },
    rules: {
      'no-console': 'error',
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['src/**/*.test.js', 'src/test/**/*.js', 'vite.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...vitestGlobals,
        frappe: 'readonly',
        cur_list: 'readonly',
        $: 'readonly',
      },
    },
  },
]
