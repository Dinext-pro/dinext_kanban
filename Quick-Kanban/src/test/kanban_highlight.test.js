import { expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(process.cwd(), '../quick_kanban/public/js/kanban_highlight.js'),
  'utf8',
)

test('populates highlighted fields on form refresh and doctype change', () => {
  const on = vi.fn()
  const context = {
    frappe: {
      ui: { form: { on } },
      model: {
        with_doctype: vi.fn(),
        no_value_type: [],
      },
      get_meta: vi.fn(),
    },
    $: { map: vi.fn() },
  }

  new Function('frappe', '$', source)(context.frappe, context.$)

  expect(on).toHaveBeenCalledWith('Kanban Board', expect.objectContaining({
    refresh: expect.any(Function),
    reference_doctype: expect.any(Function),
  }))
})
