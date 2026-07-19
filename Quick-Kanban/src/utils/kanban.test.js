import { describe, expect, test, vi } from 'vitest'
import {
  attachColumnDisplayNames,
  clampColumnWidthForResize,
  collectLinkTitleTargets,
  DEFAULT_COLUMN_WIDTH_PX,
  formatCardField,
  getAddableColumnCandidates,
  getCardFieldDisplayValue,
  getCardLinkFieldMetas,
  getCardTagsHtml,
  getColumnDisplayName,
  getColumnKey,
  getColumnWidthBounds,
  getIndicatorClass,
  groupCardsByColumn,
  hydrateLinkTitles,
  isActiveColumn,
  isLinkLikeField,
  isNearScrollEnd,
  ensureCardFetchFields,
  normalizeBoardConfig,
  normalizeUserTagsForEditor,
  parseCardAccentColor,
  parseSelectOptions,
  resolveCardLinkTitles,
  resolveColorField,
  resolveColumnWidthPx,
  readMinimizeCardsPreference,
  minimizeCardsStorageKey,
  shouldTranslateFieldValue,
  toListUserTags,
  translateFieldLabel,
  translateFieldValue,
  writeMinimizeCardsPreference,
  CARD_DENSITY_ANIMATION_MS,
  collapsedColumnsStorageKey,
  readCollapsedColumnsPreference,
  writeCollapsedColumnsPreference,
  expandedLanesStorageKey,
  expandedLaneStorageKey,
  readExpandedLanesPreference,
  writeExpandedLanesPreference,
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

describe('normalizeUserTagsForEditor / toListUserTags', () => {
  test('strips leading commas and blank segments for the editor', () => {
    expect(normalizeUserTagsForEditor(',alpha,beta')).toBe('alpha,beta')
    expect(normalizeUserTagsForEditor('alpha, beta,')).toBe('alpha,beta')
    expect(normalizeUserTagsForEditor('')).toBe('')
    expect(normalizeUserTagsForEditor(null)).toBe('')
  })

  test('rebuilds list-style _user_tags with a leading comma', () => {
    expect(toListUserTags('alpha,beta')).toBe(',alpha,beta')
    expect(toListUserTags(',alpha,beta')).toBe(',alpha,beta')
    expect(toListUserTags('')).toBe('')
    expect(toListUserTags(null)).toBe('')
  })
})

describe('getCardTagsHtml', () => {
  test('delegates to list get_tags_html with a limit of three colored pills', () => {
    const list = {
      get_tags_html: vi.fn(() => '<div class="tag-pill">alpha</div>'),
    }
    expect(getCardTagsHtml(',alpha,beta', list)).toBe('<div class="tag-pill">alpha</div>')
    expect(list.get_tags_html).toHaveBeenCalledWith(',alpha,beta', 3, true)
  })

  test('falls back to ListView.prototype when cur_list helper is missing', () => {
    const previous = globalThis.frappe.views
    globalThis.frappe.views = {
      ListView: {
        prototype: {
          get_tags_html: vi.fn(() => '<div class="tag-pill">fallback</div>'),
        },
      },
    }
    try {
      expect(getCardTagsHtml(',alpha', null)).toBe('<div class="tag-pill">fallback</div>')
      expect(frappe.views.ListView.prototype.get_tags_html).toHaveBeenCalledWith(',alpha', 3, true)
    } finally {
      globalThis.frappe.views = previous
    }
  })

  test('returns empty string without tags or html helper', () => {
    const previous = globalThis.frappe.views
    globalThis.frappe.views = undefined
    try {
      expect(getCardTagsHtml('', { get_tags_html: vi.fn() })).toBe('')
      expect(getCardTagsHtml(',alpha', null)).toBe('')
    } finally {
      globalThis.frappe.views = previous
    }
  })
})

describe('getColumnKey', () => {
  test('prefers column_name over child row name', () => {
    expect(getColumnKey({ name: 'abc123', column_name: 'Open' })).toBe('Open')
    expect(getColumnKey({ name: 'xyz789', column_name: 'Done' })).toBe('Done')
  })
})

describe('isActiveColumn', () => {
  test('treats unset and Active as visible, Archived as hidden', () => {
    expect(isActiveColumn({ column_name: 'Open' })).toBe(true)
    expect(isActiveColumn({ column_name: 'Open', status: 'Active' })).toBe(true)
    expect(isActiveColumn({ column_name: 'Open', status: 'Archived' })).toBe(false)
    expect(isActiveColumn(null)).toBe(true)
  })
})

describe('parseSelectOptions', () => {
  test('splits Select options and ignores blank lines', () => {
    expect(parseSelectOptions({
      fieldtype: 'Select',
      options: '\nOpen\n\nDone\n ',
    })).toEqual(['Open', 'Done'])
  })

  test('returns empty for non-Select fields', () => {
    expect(parseSelectOptions({ fieldtype: 'Data', options: 'Open\nDone' })).toEqual([])
  })
})

describe('getAddableColumnCandidates', () => {
  const statusFieldMeta = {
    fieldname: 'status',
    fieldtype: 'Select',
    parent: 'Task',
    options: 'Open\nWorking\nDone',
  }

  test('lists unused options as add and archived as restore', () => {
    expect(getAddableColumnCandidates({
      options: parseSelectOptions(statusFieldMeta),
      activeNames: ['Open'],
      archivedColumns: [{ column_name: 'Done', status: 'Archived' }],
      statusFieldMeta,
      translate: mockTranslate,
    })).toEqual([
      { column_name: 'Working', display_name: 'Working', mode: 'add' },
      { column_name: 'Done', display_name: 'Готово', mode: 'restore' },
    ])
  })

  test('includes archived columns missing from Select options', () => {
    expect(getAddableColumnCandidates({
      options: ['Open'],
      activeNames: ['Open'],
      archivedColumns: [{ column_name: 'Legacy', status: 'Archived' }],
      statusFieldMeta: { fieldtype: 'Select', parent: 'Task' },
    })).toEqual([
      { column_name: 'Legacy', display_name: 'Legacy', mode: 'restore' },
    ])
  })
})

describe('ensureCardFetchFields', () => {
  test('prepends name/title/status and list std meta fields when board fields omit them', () => {
    expect(ensureCardFetchFields(
      ['exp_end_date', 'priority', 'project', 'type'],
      { titleField: 'subject', statusField: 'status' },
    )).toEqual([
      'name',
      'subject',
      'exp_end_date',
      'priority',
      'project',
      'type',
      'status',
      '_assign',
      '_user_tags',
      '_comments',
      '_liked_by',
    ])
  })

  test('does not duplicate identity fields already present', () => {
    expect(ensureCardFetchFields(
      ['name', 'subject', 'status', '_assign', '_user_tags', '_comments', '_liked_by'],
      { titleField: 'subject', statusField: 'status' },
    )).toEqual([
      'name',
      'subject',
      'status',
      '_assign',
      '_user_tags',
      '_comments',
      '_liked_by',
    ])
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
      fields: [
        'name',
        'subject',
        'priority',
        'status',
        '_assign',
        '_user_tags',
        '_comments',
        '_liked_by',
      ],
      highlighted_field: 'priority',
      highlight_table: [],
      show_labels: true,
      show_tags: false,
      show_extra_info: false,
      title_field_meta: { fieldname: 'subject', label: 'Subject', fieldtype: 'Data', parent: 'Task' },
      status_field_meta: { fieldname: 'status', label: 'Status', fieldtype: 'Select', parent: 'Task' },
      highlighted_field_meta: { fieldname: 'priority', label: 'Priority', fieldtype: 'Select', parent: 'Task' },
    })
  })

  test('always injects name and title even when board fields omit them', () => {
    const config = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['exp_end_date', 'priority', 'project', 'type'],
    }, {
      title_field: 'subject',
      fields: [
        { fieldname: 'subject', label: 'Subject', fieldtype: 'Data', parent: 'Task' },
        { fieldname: 'status', label: 'Status', fieldtype: 'Select', parent: 'Task' },
      ],
    })

    expect(config.fields).toEqual([
      'name',
      'subject',
      'exp_end_date',
      'priority',
      'project',
      'type',
      'status',
      '_assign',
      '_user_tags',
      '_comments',
      '_liked_by',
    ])
    expect(config.display_fields.map((field) => field.fieldname)).toEqual([
      'exp_end_date',
      'priority',
      'project',
      'type',
    ])
  })

  test('maps custom_show_tags to show_tags', () => {
    const enabled = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject'],
      custom_show_tags: 1,
    }, { title_field: 'subject', fields: [] })

    const disabled = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject'],
      custom_show_tags: 0,
    }, { title_field: 'subject', fields: [] })

    expect(enabled.show_tags).toBe(true)
    expect(disabled.show_tags).toBe(false)
  })

  test('maps custom_show_extra_info to show_extra_info', () => {
    const enabled = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject'],
      custom_show_extra_info: 1,
    }, { title_field: 'subject', fields: [] })

    const disabled = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject'],
      custom_show_extra_info: 0,
    }, { title_field: 'subject', fields: [] })

    expect(enabled.show_extra_info).toBe(true)
    expect(disabled.show_extra_info).toBe(false)
  })

  test('falls back to useful card fields when fields JSON is invalid', () => {
    const config = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: '{invalid',
    }, {})

    expect(config.fields).toEqual([
      'name',
      'status',
      '_assign',
      '_user_tags',
      '_comments',
      '_liked_by',
    ])
  })

  test('accepts fields already parsed by the native Frappe Kanban view', () => {
    const config = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject'],
    }, { title_field: 'subject' })

    expect(config.fields).toEqual([
      'name',
      'subject',
      'status',
      '_assign',
      '_user_tags',
      '_comments',
      '_liked_by',
    ])
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

    expect(config.fields).toEqual([
      'name',
      'subject',
      'color',
      'status',
      '_assign',
      '_user_tags',
      '_comments',
      '_liked_by',
    ])
    expect(config.color_field).toBe('color')
    expect(config.color_field_meta).toMatchObject({
      fieldname: 'color',
      fieldtype: 'Color',
    })
    expect(config.display_fields.map((field) => field.fieldname)).toEqual([])
  })

  test('resolves swimlane_link_field for Table MultiSelect swimlanes', () => {
    frappe.get_meta.mockImplementation((doctype) => {
      if (doctype === 'Task User') {
        return {
          fields: [
            { fieldname: 'user', fieldtype: 'Link', options: 'User' },
          ],
        }
      }
      return {
        title_field: 'subject',
        fields: [
          {
            fieldname: 'users',
            label: 'Users',
            fieldtype: 'Table MultiSelect',
            options: 'Task User',
            parent: 'Task',
          },
        ],
      }
    })

    const config = normalizeBoardConfig({
      name: 'Tasks',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject'],
      custom_swimlane_field: 'users',
    }, {
      title_field: 'subject',
      fields: [
        {
          fieldname: 'users',
          label: 'Users',
          fieldtype: 'Table MultiSelect',
          options: 'Task User',
          parent: 'Task',
        },
      ],
    })

    expect(config.swimlane_mode).toBe('multi')
    expect(config.swimlane_link_field).toBe('user')
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
    expect(result).toContain('class="progress kanban-card-progress"')
    expect(result).toContain('progress-bar-success')
    expect(result).toContain('width: 75%')
    expect(result).toContain('aria-valuenow="75"')
    expect(result).not.toContain('style="margin:')
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

  test('resolves Link display text via only_value formatter', () => {
    const formatter = vi.fn(() => 'Проект БалтХим')
    expect(getCardFieldDisplayValue(
      'PROJ-1',
      { fieldname: 'project', fieldtype: 'Link', options: 'Project' },
      mockTranslate,
      {},
      formatter,
    )).toBe('Проект БалтХим')
    expect(formatter).toHaveBeenCalledWith(
      'PROJ-1',
      expect.objectContaining({ fieldtype: 'Link' }),
      { only_value: true },
      {},
    )
  })
})

describe('link title hydration', () => {
  test('detects Link and Dynamic Link fieldtypes', () => {
    expect(isLinkLikeField({ fieldtype: 'Link' })).toBe(true)
    expect(isLinkLikeField({ fieldtype: 'Dynamic Link' })).toBe(true)
    expect(isLinkLikeField({ fieldtype: 'Data' })).toBe(false)
  })

  test('getCardLinkFieldMetas dedupes title, highlight, and display fields', () => {
    const metas = getCardLinkFieldMetas({
      title_field_meta: { fieldname: 'project', fieldtype: 'Link', options: 'Project' },
      highlighted_field_meta: { fieldname: 'priority', fieldtype: 'Select' },
      display_fields: [
        { fieldname: 'project', fieldtype: 'Link', options: 'Project' },
        { fieldname: 'customer', fieldtype: 'Link', options: 'Customer' },
      ],
    })
    expect(metas.map((meta) => meta.fieldname)).toEqual([
      'project',
      'priority',
      'customer',
    ])
  })

  test('collectLinkTitleTargets dedupes and skips cached titles', () => {
    const getLinkTitle = vi.fn((doctype, name) => (
      doctype === 'Project' && name === 'CACHED' ? 'Cached Title' : null
    ))
    const targets = collectLinkTitleTargets(
      [
        { project: 'CACHED', customer: 'CUST-1' },
        { project: 'PROJ-2', customer: 'CUST-1' },
        { project: '', customer: null },
      ],
      [
        { fieldname: 'project', fieldtype: 'Link', options: 'Project' },
        { fieldname: 'customer', fieldtype: 'Link', options: 'Customer' },
        { fieldname: 'subject', fieldtype: 'Data' },
      ],
      { getLinkTitle },
    )
    expect(targets).toEqual([
      { doctype: 'Customer', name: 'CUST-1' },
      { doctype: 'Project', name: 'PROJ-2' },
    ])
  })

  test('collectLinkTitleTargets resolves Dynamic Link doctype from the card', () => {
    const targets = collectLinkTitleTargets(
      [{ link: 'TASK-1', link_doctype: 'Task' }],
      [{
        fieldname: 'link',
        fieldtype: 'Dynamic Link',
        options: 'link_doctype',
      }],
      { getLinkTitle: () => null },
    )
    expect(targets).toEqual([{ doctype: 'Task', name: 'TASK-1' }])
  })

  test('hydrateLinkTitles fetches each missing target', async () => {
    const fetchLinkTitle = vi.fn(async (doctype, name) => `${doctype}:${name}`)
    await hydrateLinkTitles(
      [
        { doctype: 'Project', name: 'A' },
        { doctype: 'Project', name: 'B' },
      ],
      { fetchLinkTitle },
    )
    expect(fetchLinkTitle).toHaveBeenCalledTimes(2)
    expect(fetchLinkTitle).toHaveBeenCalledWith('Project', 'A')
    expect(fetchLinkTitle).toHaveBeenCalledWith('Project', 'B')
  })

  test('resolveCardLinkTitles returns false when nothing to fetch', async () => {
    const fetchLinkTitle = vi.fn()
    const didFetch = await resolveCardLinkTitles(
      [{ project: 'CACHED' }],
      {
        display_fields: [
          { fieldname: 'project', fieldtype: 'Link', options: 'Project' },
        ],
      },
      {
        getLinkTitle: () => 'Cached',
        fetchLinkTitle,
      },
    )
    expect(didFetch).toBe(false)
    expect(fetchLinkTitle).not.toHaveBeenCalled()
  })

  test('resolveCardLinkTitles fetches and returns true for misses', async () => {
    const fetchLinkTitle = vi.fn(async () => 'Title')
    const didFetch = await resolveCardLinkTitles(
      [{ project: 'PROJ-1' }],
      {
        display_fields: [
          { fieldname: 'project', fieldtype: 'Link', options: 'Project' },
        ],
      },
      {
        getLinkTitle: () => null,
        fetchLinkTitle,
      },
    )
    expect(didFetch).toBe(true)
    expect(fetchLinkTitle).toHaveBeenCalledWith('Project', 'PROJ-1')
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

describe('collapsed columns preference', () => {
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

    expect(collapsedColumnsStorageKey('Task Board')).toBe(
      'quick_kanban:collapsed_columns:Task Board',
    )
    expect(readCollapsedColumnsPreference('Task Board', storage)).toEqual({})

    writeCollapsedColumnsPreference('Task Board', { Open: true, Done: true }, storage)
    expect(readCollapsedColumnsPreference('Task Board', storage)).toEqual({
      Open: true,
      Done: true,
    })
    expect(storage.data['quick_kanban:collapsed_columns:Task Board']).toBe(
      JSON.stringify(['Open', 'Done']),
    )

    writeCollapsedColumnsPreference('Task Board', {}, storage)
    expect(readCollapsedColumnsPreference('Task Board', storage)).toEqual({})
    expect(storage.data['quick_kanban:collapsed_columns:Task Board']).toBeUndefined()
  })

  test('persists expanded lane keys as JSON and migrates legacy single key', () => {
    const storage = {
      data: {},
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null
      },
      setItem(key, value) {
        this.data[key] = String(value)
      },
      removeItem(key) {
        delete this.data[key]
      },
    }

    expect(expandedLanesStorageKey('Task Board')).toBe('quick_kanban:expanded_lanes:Task Board')
    expect(readExpandedLanesPreference('Task Board', storage)).toEqual([])

    storage.data[expandedLaneStorageKey('Task Board')] = 'alice'
    expect(readExpandedLanesPreference('Task Board', storage)).toEqual(['alice'])

    writeExpandedLanesPreference('Task Board', ['alice', 'bob', 'alice'], storage)
    expect(readExpandedLanesPreference('Task Board', storage)).toEqual(['alice', 'bob'])
    expect(storage.data[expandedLanesStorageKey('Task Board')]).toBe(
      JSON.stringify(['alice', 'bob']),
    )
    expect(storage.data[expandedLaneStorageKey('Task Board')]).toBeUndefined()

    writeExpandedLanesPreference('Task Board', [], storage)
    expect(readExpandedLanesPreference('Task Board', storage)).toEqual([])
  })
})

describe('column width helpers', () => {
  test('resolveColumnWidthPx uses stored width or default without clamping', () => {
    expect(resolveColumnWidthPx({ custom_column_width: 420 })).toBe(420)
    expect(resolveColumnWidthPx({})).toBe(DEFAULT_COLUMN_WIDTH_PX)
    expect(resolveColumnWidthPx({ custom_column_width: 40 })).toBe(40)
  })

  test('clampColumnWidthForResize clamps only against the current viewport', () => {
    expect(getColumnWidthBounds(1000)).toEqual({ min: 150, max: 500 })
    expect(clampColumnWidthForResize(100, 1000)).toBe(150)
    expect(clampColumnWidthForResize(800, 1000)).toBe(500)
    expect(clampColumnWidthForResize(320, 1000)).toBe(320)
  })
})
