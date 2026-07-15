import { describe, expect, test, beforeEach, vi } from 'vitest'
import {
  INLINE_EDIT_CLICK_DELAY_MS,
  canOpenInlineEditor,
  evaluateReadOnlyDependsOn,
  getInlineEditClickDelayMs,
  getInlineFieldDisplayStatus,
  isInlineFieldTypeSupported,
  openInlineSelectOptions,
  resolveDoubleClickNavigation,
  sanitizeDisplayHtmlForInlineEdit,
  valuesEqual,
} from './inlineEditing'

beforeEach(() => {
  frappe.model.is_non_std_field.mockClear()
  frappe.perm.get_field_display_status.mockReturnValue('Write')
  frappe.workflow.is_read_only.mockReturnValue(false)
  frappe.meta.get_field.mockImplementation((doctype, fieldname) => ({
    fieldname,
    fieldtype: 'Data',
    label: fieldname,
    parent: doctype,
  }))
  frappe.utils.eval.mockImplementation((expression, context) => {
    if (expression.includes('status == "Done"')) {
      return context.doc.status === 'Done'
    }
    return false
  })
})

describe('isInlineFieldTypeSupported', () => {
  test('allows common editable field types', () => {
    expect(isInlineFieldTypeSupported({
      fieldname: 'subject',
      fieldtype: 'Data',
    })).toBe(true)
    expect(isInlineFieldTypeSupported({
      fieldname: 'status',
      fieldtype: 'Select',
    })).toBe(true)
    expect(isInlineFieldTypeSupported({
      fieldname: 'due_date',
      fieldtype: 'Date',
    })).toBe(true)
    expect(isInlineFieldTypeSupported({
      fieldname: 'project',
      fieldtype: 'Link',
      options: 'Project',
    })).toBe(true)
  })

  test('rejects presentation, table, name, and read_only fields', () => {
    expect(isInlineFieldTypeSupported({
      fieldname: 'name',
      fieldtype: 'Data',
    })).toBe(false)
    expect(isInlineFieldTypeSupported({
      fieldname: 'html',
      fieldtype: 'HTML',
    })).toBe(false)
    expect(isInlineFieldTypeSupported({
      fieldname: 'items',
      fieldtype: 'Table',
    })).toBe(false)
    expect(isInlineFieldTypeSupported({
      fieldname: 'subject',
      fieldtype: 'Data',
      read_only: 1,
    })).toBe(false)
  })
})

describe('read_only_depends_on and field status', () => {
  test('evaluates eval expressions against the loaded document', () => {
    expect(evaluateReadOnlyDependsOn('eval:doc.status == "Done"', {
      status: 'Done',
    })).toBe(true)
    expect(evaluateReadOnlyDependsOn('eval:doc.status == "Done"', {
      status: 'Open',
    })).toBe(false)
  })

  test('downgrades Write to Read when read_only_depends_on is true', () => {
    frappe.meta.get_field.mockReturnValue({
      fieldname: 'subject',
      fieldtype: 'Data',
      read_only_depends_on: 'eval:doc.status == "Done"',
    })
    frappe.perm.get_field_display_status.mockReturnValue('Write')

    expect(getInlineFieldDisplayStatus('Task', 'TASK-1', 'subject', {
      status: 'Done',
    })).toBe('Read')
  })

  test('blocks editor when workflow is read-only or status is not Write', () => {
    const fieldMeta = { fieldname: 'subject', fieldtype: 'Data' }
    frappe.workflow.is_read_only.mockReturnValue(true)
    expect(canOpenInlineEditor({
      doctype: 'Task',
      docname: 'TASK-1',
      fieldMeta,
      doc: { name: 'TASK-1' },
    })).toBe(false)

    frappe.workflow.is_read_only.mockReturnValue(false)
    frappe.perm.get_field_display_status.mockReturnValue('Read')
    expect(canOpenInlineEditor({
      doctype: 'Task',
      docname: 'TASK-1',
      fieldMeta,
      doc: { name: 'TASK-1' },
    })).toBe(false)
  })
})

describe('double-click navigation', () => {
  test('opens the linked record for Link fields including title', () => {
    expect(resolveDoubleClickNavigation({
      role: 'title',
      fieldMeta: { fieldname: 'project', fieldtype: 'Link', options: 'Project' },
      card: { name: 'TASK-1' },
      refDoctype: 'Task',
      value: 'PROJ-1',
    })).toEqual({ doctype: 'Project', name: 'PROJ-1' })
  })

  test('opens the card document for a non-Link title', () => {
    expect(resolveDoubleClickNavigation({
      role: 'title',
      fieldMeta: { fieldname: 'subject', fieldtype: 'Data' },
      card: { name: 'TASK-1' },
      refDoctype: 'Task',
      value: 'First task',
    })).toEqual({ doctype: 'Task', name: 'TASK-1' })
  })

  test('opens the card document for non-title non-Link fields', () => {
    expect(resolveDoubleClickNavigation({
      role: 'display',
      fieldMeta: { fieldname: 'due_date', fieldtype: 'Date' },
      card: { name: 'TASK-1' },
      refDoctype: 'Task',
      value: '2026-07-10',
    })).toEqual({ doctype: 'Task', name: 'TASK-1' })
  })

  test('opens the card document for highlight fields', () => {
    expect(resolveDoubleClickNavigation({
      role: 'highlight',
      fieldMeta: { fieldname: 'priority', fieldtype: 'Select' },
      card: { name: 'TASK-1' },
      refDoctype: 'Task',
      value: 'High',
    })).toEqual({ doctype: 'Task', name: 'TASK-1' })
  })
})

test('valuesEqual compares nullish and stringified values', () => {
  expect(valuesEqual(null, undefined)).toBe(true)
  expect(valuesEqual(1, '1')).toBe(true)
  expect(valuesEqual('a', 'b')).toBe(false)
})

describe('sanitizeDisplayHtmlForInlineEdit', () => {
  test('removes href and target from anchors while keeping text', () => {
    const html = sanitizeDisplayHtmlForInlineEdit(
      '<a href="/app/project/TEST-PROJECT" target="_blank">TEST-PROJECT</a>',
    )
    expect(html).toContain('TEST-PROJECT')
    expect(html).not.toContain('href=')
    expect(html).not.toContain('target=')
    expect(html).toContain('role="presentation"')
  })

  test('returns empty string for empty input', () => {
    expect(sanitizeDisplayHtmlForInlineEdit('')).toBe('')
    expect(sanitizeDisplayHtmlForInlineEdit(null)).toBe('')
  })
})

describe('getInlineEditClickDelayMs', () => {
  test('uses zero delay for Select to keep user activation', () => {
    expect(getInlineEditClickDelayMs({ fieldtype: 'Select' })).toBe(0)
    expect(getInlineEditClickDelayMs({ fieldtype: 'Data' })).toBe(INLINE_EDIT_CLICK_DELAY_MS)
  })
})

describe('openInlineSelectOptions', () => {
  test('calls showPicker when available', () => {
    const select = document.createElement('select')
    ;['Low', 'Medium', 'High'].forEach((label) => {
      const option = document.createElement('option')
      option.value = label
      option.textContent = label
      select.appendChild(option)
    })
    select.showPicker = vi.fn()
    const result = openInlineSelectOptions({ $input: { 0: select } })
    expect(select.showPicker).toHaveBeenCalled()
    expect(result).toEqual({ opened: true, mode: 'showPicker' })
  })

  test('falls back to size listbox without showPicker', () => {
    const select = document.createElement('select')
    ;['Low', 'Medium', 'High'].forEach((label) => {
      const option = document.createElement('option')
      option.value = label
      option.textContent = label
      select.appendChild(option)
    })
    const result = openInlineSelectOptions({ $input: { 0: select } })
    expect(result).toEqual({ opened: true, mode: 'size' })
    expect(select.size).toBe(3)
  })
})
