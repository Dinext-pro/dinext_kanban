import { describe, expect, test } from 'vitest'
import {
  formatCardField,
  getIndicatorClass,
  groupCardsByColumn,
  isNearScrollEnd,
  normalizeBoardConfig,
} from './kanban'

describe('normalizeBoardConfig', () => {
  test('normalizes missing optional values and includes the highlighted field', () => {
    const config = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: '["name", "subject"]',
      custom_highlighted_field: 'priority',
      custom_highlight_table: null,
      show_labels: 1,
    }, { title_field: 'subject' })

    expect(config).toMatchObject({
      board_name: 'Tasks',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'priority'],
      highlighted_field: 'priority',
      highlight_table: [],
      show_labels: true,
    })
  })

  test('falls back to useful card fields when fields JSON is invalid', () => {
    const config = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: '{invalid',
    }, {})

    expect(config.fields).toEqual(['name'])
  })

  test('accepts fields already parsed by the native Frappe Kanban view', () => {
    const config = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject'],
    }, { title_field: 'subject' })

    expect(config.fields).toEqual(['name', 'subject'])
  })
})

describe('isNearScrollEnd', () => {
  test('returns true inside the loading threshold', () => {
    expect(isNearScrollEnd({
      scrollTop: 850,
      clientHeight: 100,
      scrollHeight: 980,
    }, 48)).toBe(true)
  })

  test('returns false away from the loading threshold', () => {
    expect(isNearScrollEnd({
      scrollTop: 200,
      clientHeight: 100,
      scrollHeight: 980,
    }, 48)).toBe(false)
  })
})

describe('groupCardsByColumn', () => {
  test('groups records in one pass and preserves empty columns', () => {
    const columns = [
      { name: 'open', column_name: 'Open' },
      { name: 'done', column_name: 'Done' },
    ]

    const grouped = groupCardsByColumn({
      columns,
      keys: ['name', 'status', '_assign'],
      values: [
        ['TASK-1', 'Done', '["one@example.com"]'],
        ['TASK-2', 'Done', null],
      ],
      statusField: 'status',
      userInfo: {
        'one@example.com': { name: 'one@example.com', fullname: 'One User' },
      },
    })

    expect(grouped[0].cards).toEqual([])
    expect(grouped[1].cards).toHaveLength(2)
    expect(grouped[1].cards[0]._assign).toEqual({
      'one@example.com': 'One User',
    })
  })

  test('returns empty cards when the response has no values', () => {
    const grouped = groupCardsByColumn({
      columns: [{ name: 'open', column_name: 'Open', cards: [{ name: 'stale' }] }],
      keys: ['name', 'status'],
      values: [],
      statusField: 'status',
      userInfo: {},
    })

    expect(grouped[0].cards).toEqual([])
  })
})

test('getIndicatorClass returns gray for unknown indicators', () => {
  expect(getIndicatorClass('not-configured')).toBe('gray')
})

describe('formatCardField', () => {
  test('delegates formatting to Frappe metadata when available', () => {
    const meta = { fieldtype: 'Date', fieldname: 'due_date' }
    const formatter = vi.fn(() => '10 Jul 2026')
    const card = { name: 'TASK-1', due_date: '2026-07-10' }

    expect(formatCardField('2026-07-10', meta, formatter, card)).toBe('10 Jul 2026')
    expect(formatter).toHaveBeenCalledWith('2026-07-10', meta, {}, card)
  })

  test('returns an em dash for empty values', () => {
    expect(formatCardField(null, null)).toBe('—')
  })

  test('sanitizes hostile formatter output while preserving safe Frappe markup', () => {
    const formatter = () => [
      '<a href="javascript:alert(1)" onclick="alert(1)">Unsafe</a>',
      '<img src=x onerror="alert(1)">',
      '<span class="indicator green">Safe</span>',
    ].join('')

    const result = formatCardField('value', { fieldtype: 'Data' }, formatter, {})

    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('<img')
    expect(result).toContain('<span class="indicator green">Safe</span>')
  })
})
