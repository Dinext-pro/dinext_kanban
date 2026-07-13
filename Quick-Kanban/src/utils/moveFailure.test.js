import { beforeEach, describe, expect, test } from 'vitest'
import {
  buildMoveFailureAlert,
  buildMoveFailureAnnouncement,
  showMoveFailureAlert,
} from './moveFailure'

beforeEach(() => {
  frappe.show_alert.mockReset()
})

describe('move failure messages', () => {
  test('builds mandatory field toast with labels', () => {
    const alert = buildMoveFailureAlert({
      reason: 'missing_mandatory',
      missingLabels: ['Priority', 'Due Date'],
    })

    expect(alert).toEqual({
      message: 'Mandatory fields required: Priority, Due Date',
      indicator: 'red',
    })
  })

  test('maps workflow and permission reasons to user-facing text', () => {
    expect(buildMoveFailureAlert({ reason: 'workflow_denied' }).message).toContain(
      'Workflow State',
    )
    expect(buildMoveFailureAlert({ reason: 'field_readonly' }).message).toContain(
      'cannot be updated',
    )
    expect(buildMoveFailureAlert({ reason: 'no_permission' }).message).toContain(
      'cannot update',
    )
    expect(buildMoveFailureAlert({ reason: 'loading' }).indicator).toBe('orange')
  })

  test('uses server error text for persistence failures', () => {
    const alert = buildMoveFailureAlert(null, {}, new Error('Not permitted'))

    expect(alert).toEqual({
      message: 'Could not move card: Not permitted',
      indicator: 'red',
    })
  })

  test('shows a single alert through frappe.show_alert', () => {
    showMoveFailureAlert({ reason: 'invalid_column' })

    expect(frappe.show_alert).toHaveBeenCalledTimes(1)
    expect(frappe.show_alert).toHaveBeenCalledWith({
      message: 'Invalid Kanban column.',
      indicator: 'red',
    })
  })

  test('builds screen-reader announcements for failed moves', () => {
    expect(buildMoveFailureAnnouncement({ reason: 'missing_mandatory' }))
      .toContain('Required fields')
    expect(buildMoveFailureAnnouncement(null, new Error('Conflict')))
      .toContain('restored')
  })
})
