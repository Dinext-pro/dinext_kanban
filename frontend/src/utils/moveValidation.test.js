import { beforeEach, describe, expect, test } from 'vitest'
import {
  getMissingMandatoryFields,
  isFieldMandatory,
  validateMoveMandatory,
} from './moveValidation'

beforeEach(() => {
  frappe.get_meta.mockReturnValue({
    name: 'Task',
    fields: [
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
    ],
  })
  frappe.utils.eval = (expression, context) => {
    const status = context.doc.status
    if (expression.includes('status == "Working"')) {
      return status === 'Working'
    }
    return false
  }
})

describe('moveValidation', () => {
  test('detects static required fields', () => {
    const field = { reqd: 1 }
    expect(isFieldMandatory({}, field)).toBe(true)
  })

  test('evaluates mandatory_depends_on expressions', () => {
    const field = {
      mandatory_depends_on: 'eval:doc.status == "Working"',
    }
    expect(isFieldMandatory({ status: 'Working' }, field)).toBe(true)
    expect(isFieldMandatory({ status: 'Open' }, field)).toBe(false)
  })

  test('returns missing labels for preview state', () => {
    const config = {
      ref_doctype: 'Task',
      field_name: 'status',
    }
    const card = { name: 'TASK-1', status: 'Open' }
    const destination = { column_name: 'Working', moveOptions: { mode: 'field_update' } }
    const result = validateMoveMandatory(card, destination, config)
    expect(result.valid).toBe(false)
    expect(result.missingLabels).toContain('Priority')
  })

  test('uses server missing_mandatory when provided', () => {
    const config = {
      ref_doctype: 'Task',
      field_name: 'status',
    }
    const card = { name: 'TASK-1', status: 'Open', priority: 'High' }
    const destination = { column_name: 'Working', moveOptions: { mode: 'field_update' } }
    const result = validateMoveMandatory(
      card,
      destination,
      config,
      null,
      ['Custom Field'],
    )
    expect(result.valid).toBe(false)
    expect(result.missingLabels).toEqual(['Custom Field'])
  })

  test('trusts an empty server missing_mandatory list', () => {
    const config = {
      ref_doctype: 'Task',
      field_name: 'status',
    }
    const card = { name: 'TASK-1', status: 'Open' }
    const destination = { column_name: 'Working', moveOptions: { mode: 'field_update' } }
    const result = validateMoveMandatory(
      card,
      destination,
      config,
      null,
      [],
    )
    expect(result.valid).toBe(true)
    expect(result.missingLabels).toEqual([])
  })

  test('collects missing mandatory fields from meta', () => {
    const missing = getMissingMandatoryFields(
      { doctype: 'Task', status: '' },
      frappe.get_meta('Task'),
    )
    expect(missing).toContain('Status')
  })
})
