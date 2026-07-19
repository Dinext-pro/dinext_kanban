import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  applyCreateDefaults,
  buildCreatePreviewDoc,
  frappeAllowsQuickEntry,
  getQuickEntryFieldnames,
  openCreateForm,
  resolveCreateFormMode,
  routeOptionsFromDefaults,
} from './createValidation'

beforeEach(() => {
  frappe.get_meta.mockReturnValue({
    name: 'Task',
    quick_entry: 1,
    fields: [
      {
        fieldname: 'subject',
        label: 'Subject',
        fieldtype: 'Data',
        reqd: 1,
        parent: 'Task',
      },
      {
        fieldname: 'status',
        label: 'Status',
        fieldtype: 'Select',
        reqd: 1,
        parent: 'Task',
      },
      {
        fieldname: 'priority',
        label: 'Priority',
        fieldtype: 'Select',
        reqd: 0,
        mandatory_depends_on: 'eval:doc.status == "Working"',
        parent: 'Task',
      },
      {
        fieldname: 'description',
        label: 'Description',
        fieldtype: 'Text Editor',
        reqd: 0,
        mandatory_depends_on: 'eval:doc.status == "Working"',
        parent: 'Task',
      },
    ],
  })
  frappe.utils.eval = (expression, context) => {
    const status = context.doc.status
    if (expression.includes('status == "Working"')) {
      return status === 'Working'
    }
    return false
  }
  frappe.model.can_create = vi.fn(() => true)
  frappe.route_hooks = {}
  frappe.meta.has_field = vi.fn(() => ({ no_copy: 0 }))
})

describe('createValidation', () => {
  test('buildCreatePreviewDoc sets column status', () => {
    const preview = buildCreatePreviewDoc(
      { column_name: 'Open' },
      { ref_doctype: 'Task', field_name: 'status' },
    )
    expect(preview.status).toBe('Open')
  })

  test('uses quick_entry when mandatory fields fit the dialog', () => {
    const result = resolveCreateFormMode(
      { column_name: 'Open' },
      { ref_doctype: 'Task', field_name: 'status' },
    )
    expect(result.mode).toBe('quick_entry')
    expect(result.missingFieldnames).toContain('subject')
  })

  test('uses full_form when mandatory fields are outside quick entry', () => {
    const result = resolveCreateFormMode(
      { column_name: 'Working' },
      { ref_doctype: 'Task', field_name: 'status' },
    )
    expect(result.mode).toBe('full_form')
    expect(result.missingFieldnames).toContain('description')
  })

  test('uses server form_mode when create options are provided', () => {
    const result = resolveCreateFormMode(
      { column_name: 'Open' },
      { ref_doctype: 'Task', field_name: 'status' },
      {
        Open: {
          allowed: true,
          form_mode: 'full_form',
          missing_mandatory: ['Description'],
          missing_fieldnames: ['description'],
        },
      },
    )
    expect(result.mode).toBe('full_form')
  })

  test('blocks creation when server policy denies column', () => {
    const result = resolveCreateFormMode(
      { column_name: 'Open' },
      { ref_doctype: 'Task', field_name: 'status' },
      {
        Open: {
          allowed: false,
          reason: 'workflow_denied',
          missing_mandatory: [],
          missing_fieldnames: [],
          form_mode: 'blocked',
        },
      },
    )
    expect(result.mode).toBe('blocked')
    expect(result.reason).toBe('workflow_denied')
  })

  test('collects quick entry fieldnames from meta', () => {
    const fieldnames = getQuickEntryFieldnames('Task')
    expect(fieldnames.has('subject')).toBe(true)
    expect(fieldnames.has('status')).toBe(true)
    expect(fieldnames.has('description')).toBe(false)
  })

  test('detects when frappe allows quick entry', () => {
    expect(frappeAllowsQuickEntry('Task')).toBe(true)
    frappe.get_meta.mockReturnValueOnce({
      name: 'Task',
      quick_entry: 0,
      fields: [],
    })
    expect(frappeAllowsQuickEntry('Task')).toBe(false)
  })

  test('applyCreateDefaults assigns no_copy fields', () => {
    const doc = { doctype: 'Task', name: 'new-Task-1' }
    applyCreateDefaults(doc, { status: 'Overdue', subject: 'Test' })
    expect(doc.status).toBe('Overdue')
    expect(doc.subject).toBe('Test')
  })

  test('applyCreateDefaults appends Table MultiSelect child rows', () => {
    frappe.get_meta.mockReturnValue({
      name: 'Task',
      fields: [
        {
          fieldname: 'users',
          fieldtype: 'Table MultiSelect',
          options: 'Task User',
        },
      ],
    })
    frappe.model.add_child = vi.fn((doc, childDoctype, fieldname) => {
      const row = { doctype: childDoctype, parentfield: fieldname }
      if (!Array.isArray(doc[fieldname])) {
        doc[fieldname] = []
      }
      doc[fieldname].push(row)
      return row
    })

    const doc = { doctype: 'Task', name: 'new-Task-1', users: [] }
    applyCreateDefaults(doc, { users: [{ user: 'alice@example.com' }] })

    expect(frappe.model.add_child).toHaveBeenCalledWith(doc, 'Task User', 'users')
    expect(doc.users).toEqual([
      expect.objectContaining({ user: 'alice@example.com' }),
    ])
  })

  test('routeOptionsFromDefaults omits array values', () => {
    expect(routeOptionsFromDefaults({
      status: 'Open',
      users: [{ user: 'a' }],
    })).toEqual({ status: 'Open' })
  })

  test('openCreateForm quick_entry pre-fills doc including no_copy status', async () => {
    const doc = { doctype: 'Task', name: 'new-Task-1' }
    frappe.model.get_new_doc.mockReturnValue(doc)
    let capturedDoc = null
    frappe.ui.form.make_quick_entry.mockImplementation(
      (doctype, afterInsert, initCallback, passedDoc) => {
        capturedDoc = passedDoc
        return { setup: () => Promise.resolve({}) }
      },
    )

    await openCreateForm({
      doctype: 'Task',
      defaults: { status: 'Overdue' },
      mode: 'quick_entry',
    })

    expect(capturedDoc.status).toBe('Overdue')
    expect(frappe.ui.form.make_quick_entry).toHaveBeenCalledWith(
      'Task',
      expect.any(Function),
      null,
      expect.objectContaining({ status: 'Overdue' }),
    )
  })

  test('openCreateForm full_form registers route_hooks.after_save', async () => {
    const doc = { doctype: 'Task', name: 'new-Task-1' }
    frappe.model.get_new_doc.mockReturnValue(doc)
    const onCreated = vi.fn()
    frappe.route_hooks = {}

    await openCreateForm({
      doctype: 'Task',
      defaults: { status: 'Overdue' },
      mode: 'full_form',
      onCreated,
    })

    expect(doc.status).toBe('Overdue')
    expect(typeof frappe.route_hooks.after_save).toBe('function')
    frappe.route_hooks.after_save({ doc: { name: 'TASK-1', status: 'Overdue' } })
    expect(onCreated).toHaveBeenCalledWith({ name: 'TASK-1', status: 'Overdue' })
  })
})
