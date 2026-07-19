import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  buildSwimlaneCreateDefaults,
  resolveSwimlaneLinkField,
} from './swimlaneCreate'
import { SWIMLANE_UNASSIGNED } from './kanban'

beforeEach(() => {
  frappe.model.can_write = vi.fn(() => true)
})

describe('resolveSwimlaneLinkField', () => {
  test('returns first Link field on child DocType', () => {
    const linkField = resolveSwimlaneLinkField(
      { fieldname: 'users', options: 'Task User' },
      () => ({
        fields: [
          { fieldname: 'user', fieldtype: 'Link', options: 'User' },
          { fieldname: 'role', fieldtype: 'Data' },
        ],
      }),
    )
    expect(linkField).toBe('user')
  })

  test('returns empty string when child has no Link field', () => {
    expect(resolveSwimlaneLinkField(
      { fieldname: 'users', options: 'Task User' },
      () => ({ fields: [{ fieldname: 'role', fieldtype: 'Data' }] }),
    )).toBe('')
  })
})

describe('buildSwimlaneCreateDefaults', () => {
  test('field mode prefills swimlane field', () => {
    const result = buildSwimlaneCreateDefaults(
      {
        swimlane_mode: 'field',
        swimlane_field: 'project',
        swimlane_field_meta: { fieldname: 'project', read_only: 0 },
        ref_doctype: 'Task',
      },
      'PROJ-1',
    )
    expect(result).toEqual({
      defaults: { project: 'PROJ-1' },
      assignTo: null,
    })
  })

  test('field mode skips Unassigned and read_only', () => {
    expect(buildSwimlaneCreateDefaults(
      {
        swimlane_mode: 'field',
        swimlane_field: 'project',
        swimlane_field_meta: { fieldname: 'project', read_only: 0 },
        ref_doctype: 'Task',
      },
      SWIMLANE_UNASSIGNED,
    )).toEqual({ defaults: {}, assignTo: null })

    expect(buildSwimlaneCreateDefaults(
      {
        swimlane_mode: 'field',
        swimlane_field: 'project',
        swimlane_field_meta: { fieldname: 'project', read_only: 1 },
        ref_doctype: 'Task',
      },
      'PROJ-1',
    )).toEqual({ defaults: {}, assignTo: null })
  })

  test('field mode skips when doctype is not writable', () => {
    expect(buildSwimlaneCreateDefaults(
      {
        swimlane_mode: 'field',
        swimlane_field: 'project',
        swimlane_field_meta: { fieldname: 'project', read_only: 0 },
        ref_doctype: 'Task',
      },
      'PROJ-1',
      { canWrite: false },
    )).toEqual({ defaults: {}, assignTo: null })
  })

  test('multi mode prefills child row via link field', () => {
    const result = buildSwimlaneCreateDefaults(
      {
        swimlane_mode: 'multi',
        swimlane_field: 'users',
        swimlane_link_field: 'user',
        swimlane_field_meta: {
          fieldname: 'users',
          fieldtype: 'Table MultiSelect',
          read_only: 0,
        },
        ref_doctype: 'Task',
      },
      'user@example.com',
    )
    expect(result).toEqual({
      defaults: { users: [{ user: 'user@example.com' }] },
      assignTo: null,
    })
  })

  test('assign mode sets assignTo without document defaults', () => {
    const result = buildSwimlaneCreateDefaults(
      {
        swimlane_mode: 'assign',
        swimlane_field: '__assign',
        ref_doctype: 'Task',
      },
      'alice@example.com',
    )
    expect(result).toEqual({
      defaults: {},
      assignTo: 'alice@example.com',
    })
  })

  test('assign mode skips Unassigned', () => {
    expect(buildSwimlaneCreateDefaults(
      {
        swimlane_mode: 'assign',
        swimlane_field: '__assign',
        ref_doctype: 'Task',
      },
      SWIMLANE_UNASSIGNED,
    )).toEqual({ defaults: {}, assignTo: null })
  })

  test('off mode and missing laneKey yield empty plan', () => {
    expect(buildSwimlaneCreateDefaults(
      { swimlane_mode: 'off', ref_doctype: 'Task' },
      'x',
    )).toEqual({ defaults: {}, assignTo: null })

    expect(buildSwimlaneCreateDefaults(
      {
        swimlane_mode: 'field',
        swimlane_field: 'project',
        swimlane_field_meta: { read_only: 0 },
        ref_doctype: 'Task',
      },
      null,
    )).toEqual({ defaults: {}, assignTo: null })
  })
})
