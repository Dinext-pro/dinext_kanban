const getErrorMessage = (error) =>
  error?.message || __('Unable to move the card.')

export function buildMoveFailureAlert(preflight, config, error = null) {
  if (error) {
    return {
      message: __('Could not move card: {0}', [getErrorMessage(error)]),
      indicator: 'red',
    }
  }

  if (!preflight) {
    return {
      message: __('This move is not allowed.'),
      indicator: 'red',
    }
  }

  switch (preflight.reason) {
    case 'missing_mandatory': {
      const labels = preflight.missingLabels || []
      if (labels.length) {
        return {
          message: __('Mandatory fields required: {0}', [labels.join(', ')]),
          indicator: 'red',
        }
      }
      return {
        message: __('Card move blocked. Required fields are missing.'),
        indicator: 'red',
      }
    }
    case 'workflow_denied':
      return {
        message: __('You are not allowed to edit this document in the current Workflow State.'),
        indicator: 'red',
      }
    case 'field_readonly':
      return {
        message: __('The Kanban status field cannot be updated.'),
        indicator: 'red',
      }
    case 'no_permission':
      return {
        message: __('You cannot update the Kanban status field.'),
        indicator: 'red',
      }
    case 'loading':
      return {
        message: __('Move permissions are still loading.'),
        indicator: 'orange',
      }
    case 'same_column':
      return {
        message: __('The card is already in this column.'),
        indicator: 'orange',
      }
    case 'invalid_column':
      return {
        message: __('Invalid Kanban column.'),
        indicator: 'red',
      }
    default:
      return {
        message: __('This move is not allowed.'),
        indicator: 'red',
      }
  }
}

export function showMoveFailureAlert(preflight, config, error = null) {
  const alert = buildMoveFailureAlert(preflight, config, error)
  if (globalThis.frappe?.show_alert) {
    frappe.show_alert(alert)
  }
  return alert
}

export function buildMoveFailureAnnouncement(preflight, error = null) {
  if (error) {
    return __('Card move failed. The previous position was restored.')
  }
  if (preflight?.reason === 'missing_mandatory') {
    return __('Card move blocked. Required fields are missing.')
  }
  return __('Card move failed. The previous position was restored.')
}
