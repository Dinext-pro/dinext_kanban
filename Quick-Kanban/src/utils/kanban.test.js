import { describe, expect, test } from 'vitest'
import {
  attachColumnDisplayNames,
  formatCardField,
  getCardFieldDisplayValue,
  getColumnDisplayName,
  getColumnKey,
  getIndicatorClass,
  groupCardsByColumn,
  isNearScrollEnd,
  normalizeBoardConfig,
  parseCardAccentColor,
  resolveColorField,
  readMinimizeCardsPreference,
  minimizeCardsStorageKey,
  shouldTranslateFieldValue,
  translateFieldLabel,
  translateFieldValue,
  writeMinimizeCardsPreference,
  CARD_DENSITY_ANIMATION_MS,
} from './kanban'

const translationMap = {
  'Due date': 'Срок',
  'Task': 'Задача',
  Open: 'Открыто',
  Done: 'Готово',
  High: 'Высокий',
  'Custom note': 'Пользовательская заметка',
}

function mockTranslate(message, _values, context) {
  const key = context ? `${message}::${context}` : message
  return translationMap[key] || translationMap[message] || message
}

describe('getColumnKey', () => {
  test('prefers column_name over child row name', () => {
    expect(getColumnKey({ name: 'abc123', column_name: 'Open' })).toBe('Open')
    expect(getColumnKey({ name: 'xyz789', column_name: 'Done' })).toBe('Done')
  })
})

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
    }, {
      title_field: 'subject',
      fields: [
        { fieldname: 'subject', label: 'Subject', fieldtype: 'Data', parent: 'Task' },
        { fieldname: 'priority', label: 'Priority', fieldtype: 'Select', parent: 'Task' },
        { fieldname: 'status', label: 'Status', fieldtype: 'Select', parent: 'Task' },
      ],
    })

    expect(config).toMatchObject({
      board_name: 'Tasks',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'priority'],
      highlighted_field: 'priority',
      highlight_table: [],
      show_labels: true,
      title_field_meta: { fieldname: 'subject', label: 'Subject', fieldtype: 'Data', parent: 'Task' },
      status_field_meta: { fieldname: 'status', label: 'Status', fieldtype: 'Select', parent: 'Task' },
      highlighted_field_meta: { fieldname: 'priority', label: 'Priority', fieldtype: 'Select', parent: 'Task' },
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

  test('auto-includes color field and excludes it from display_fields', () => {
    const config = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject'],
    }, {
      title_field: 'subject',
      fields: [
        { fieldname: 'subject', label: 'Subject', fieldtype: 'Data', parent: 'Task' },
        { fieldname: 'color', label: 'Color', fieldtype: 'Color', parent: 'Task' },
        { fieldname: 'status', label: 'Status', fieldtype: 'Select', parent: 'Task' },
      ],
    })

    expect(config.fields).toEqual(['name', 'subject', 'color'])
    expect(config.color_field).toBe('color')
    expect(config.color_field_meta).toMatchObject({
      fieldname: 'color',
      fieldtype: 'Color',
    })
    expect(config.display_fields.map((field) => field.fieldname)).toEqual([])
  })

  test('ignores color fieldname when fieldtype is not Color', () => {
    const config = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject', 'color'],
    }, {
      title_field: 'subject',
      fields: [
        { fieldname: 'subject', label: 'Subject', fieldtype: 'Data', parent: 'Task' },
        { fieldname: 'color', label: 'Color', fieldtype: 'Data', parent: 'Task' },
      ],
    })

    expect(config.color_field).toBe('')
    expect(config.color_field_meta).toBeNull()
    expect(config.display_fields.map((field) => field.fieldname)).toEqual(['color'])
  })
})

describe('parseCardAccentColor', () => {
  test('accepts valid hex colors', () => {
    expect(parseCardAccentColor('#FF5733')).toBe('#FF5733')
    expect(parseCardAccentColor('#fff')).toBe('#fff')
    expect(parseCardAccentColor('#11223344')).toBe('#11223344')
  })

  test('rejects empty and unsafe values', () => {
    expect(parseCardAccentColor('')).toBeNull()
    expect(parseCardAccentColor(null)).toBeNull()
    expect(parseCardAccentColor('red')).toBeNull()
    expect(parseCardAccentColor('#12')).toBeNull()
    expect(parseCardAccentColor('javascript:alert(1)')).toBeNull()
  })
})

describe('resolveColorField', () => {
  test('returns color field only when fieldtype is Color', () => {
    expect(resolveColorField({
      color: { fieldname: 'color', fieldtype: 'Color' },
    })).toMatchObject({ fieldname: 'color', fieldtype: 'Color' })
    expect(resolveColorField({
      color: { fieldname: 'color', fieldtype: 'Data' },
    })).toBeNull()
    expect(resolveColorField({})).toBeNull()
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

  test('translates translatable text fields before formatting', () => {
    const meta = {
      fieldtype: 'Data',
      fieldname: 'custom_note',
      translatable: 1,
      parent: 'Task',
    }
    const formatter = vi.fn((value) => `formatted:${value}`)

    expect(formatCardField(
      'Custom note',
      meta,
      formatter,
      {},
      mockTranslate,
    )).toBe('formatted:Пользовательская заметка')
    expect(formatter).toHaveBeenCalledWith(
      'Пользовательская заметка',
      meta,
      {},
      {},
    )
  })

  test('does not pre-translate Select values because Frappe formatter handles them', () => {
    const meta = {
      fieldtype: 'Select',
      fieldname: 'priority',
      parent: 'Task',
    }
    const formatter = vi.fn((value) => `formatted:${value}`)

    formatCardField('High', meta, formatter, {}, mockTranslate)
    expect(formatter).toHaveBeenCalledWith('High', meta, {}, {})
  })

  test('returns an em dash for empty values', () => {
    expect(formatCardField(null, null)).toBe('—')
  })

  test('renders Percent fields as a Frappe progress bar', () => {
    const meta = { fieldtype: 'Percent', fieldname: 'progress' }
    const formatter = vi.fn()

    const result = formatCardField(75, meta, formatter, {})

    expect(formatter).not.toHaveBeenCalled()
    expect(result).toContain('class="progress"')
    expect(result).toContain('progress-bar-success')
    expect(result).toContain('width: 75%')
    expect(result).toContain('aria-valuenow="75"')
  })

  test('clamps Percent progress bar width between 0 and 100', () => {
    const meta = { fieldtype: 'Percent', fieldname: 'progress' }

    expect(formatCardField(150, meta, vi.fn(), {})).toContain('width: 100%')
    expect(formatCardField(-5, meta, vi.fn(), {})).toContain('width: 0%')
  })

  test('returns an em dash for invalid Percent values', () => {
    const meta = { fieldtype: 'Percent', fieldname: 'progress' }

    expect(formatCardField('not-a-number', meta, vi.fn(), {})).toBe('—')
    expect(formatCardField(null, meta, vi.fn(), {})).toBe('—')
    expect(formatCardField('', meta, vi.fn(), {})).toBe('—')
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

describe('translation helpers', () => {
  test('translates field labels with DocType context', () => {
    expect(translateFieldLabel({
      fieldname: 'due_date',
      label: 'Due date',
      parent: 'Task',
    }, mockTranslate)).toBe('Срок')
  })

  test('translates Select values and column names', () => {
    const statusField = {
      fieldname: 'status',
      fieldtype: 'Select',
      parent: 'Task',
    }

    expect(shouldTranslateFieldValue({ fieldtype: 'Select' })).toBe(true)
    expect(translateFieldValue('High', {
      fieldtype: 'Select',
      parent: 'Task',
    }, mockTranslate)).toBe('Высокий')
    expect(getColumnDisplayName('Open', statusField, mockTranslate)).toBe('Открыто')
    expect(attachColumnDisplayNames([
      { name: 'open', column_name: 'Open' },
      { name: 'done', column_name: 'Done' },
    ], statusField, mockTranslate)).toEqual([
      { name: 'open', column_name: 'Open', display_name: 'Открыто' },
      { name: 'done', column_name: 'Done', display_name: 'Готово' },
    ])
  })

  test('translates translatable Data values but leaves plain Data untouched', () => {
    expect(translateFieldValue('Custom note', {
      fieldtype: 'Data',
      translatable: 1,
      parent: 'Task',
    }, mockTranslate)).toBe('Пользовательская заметка')
    expect(translateFieldValue('Plain value', {
      fieldtype: 'Data',
      translatable: 0,
      parent: 'Task',
    }, mockTranslate)).toBe('Plain value')
  })

  test('returns translated plain display values for card fields', () => {
    expect(getCardFieldDisplayValue('High', {
      fieldtype: 'Select',
      parent: 'Task',
    }, mockTranslate)).toBe('Высокий')
  })
})

describe('minimize cards preference', () => {
  test('exports density animation duration for CSS transitions', () => {
    expect(CARD_DENSITY_ANIMATION_MS).toBe(200)
  })

  test('reads and writes board-scoped localStorage preference', () => {
    const storage = {
      data: {},
      getItem(key) {
        return Object.hasOwn(this.data, key) ? this.data[key] : null
      },
      setItem(key, value) {
        this.data[key] = String(value)
      },
      removeItem(key) {
        delete this.data[key]
      },
    }

    expect(minimizeCardsStorageKey('Task Board')).toBe('quick_kanban:minimize_cards:Task Board')
    expect(readMinimizeCardsPreference('Task Board', storage)).toBe(false)

    writeMinimizeCardsPreference('Task Board', true, storage)
    expect(readMinimizeCardsPreference('Task Board', storage)).toBe(true)
    expect(storage.data['quick_kanban:minimize_cards:Task Board']).toBe('1')

    writeMinimizeCardsPreference('Task Board', false, storage)
    expect(readMinimizeCardsPreference('Task Board', storage)).toBe(false)
    expect(storage.data['quick_kanban:minimize_cards:Task Board']).toBeUndefined()
  })
})
