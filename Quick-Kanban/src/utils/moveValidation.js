const SKIP_FIELD_TYPES = new Set([
  'Section Break',
  'Column Break',
  'Tab Break',
  'HTML',
  'Heading',
  'Fold',
])

const TABLE_FIELD_TYPES = new Set(['Table', 'Table MultiSelect'])

function isNullish(value) {
  return value === null || value === undefined || value === ''
}

function hasTextContent(value, field) {
  const text = String(value ?? '')
  const stripped = text.replace(/<[^>]*>/g, '').trim()
  const hasImg = text.includes('<img')
  if (field.fieldtype === 'Text Editor' && (stripped || hasImg)) {
    return true
  }
  if (field.fieldtype === 'Code' && field.options === 'HTML' && (stripped || hasImg)) {
    return true
  }
  return Boolean(stripped)
}

export function hasFieldValue(doc, field) {
  const value = doc[field.fieldname]
  if (TABLE_FIELD_TYPES.has(field.fieldtype)) {
    return Array.isArray(value) && value.length > 0
  }
  if (isNullish(value) || (Array.isArray(value) && !value.length)) {
    return false
  }
  return hasTextContent(value, field)
}

export function isFieldMandatory(doc, field, parentDoc = doc) {
  if (field.mandatory_depends_on && doc) {
    const expression = field.mandatory_depends_on
    if (typeof expression === 'boolean') {
      return expression
    }
    if (typeof expression === 'function') {
      return Boolean(expression(doc))
    }
    if (typeof expression === 'string' && expression.startsWith('eval:')) {
      try {
        return Boolean(
          frappe.utils.eval(expression.slice(5), { doc, parent: parentDoc }),
        )
      } catch {
        return true
      }
    }
    const value = doc[expression]
    if (Array.isArray(value)) {
      return Boolean(value.length)
    }
    return Boolean(value)
  }
  return Boolean(field.reqd)
}

function getDocFields(meta, doctype) {
  return frappe.meta.docfield_list?.[doctype]
    || meta.fields
    || []
}

export function getMissingMandatoryFields(doc, meta, parentDoc = doc) {
  if (doc.docstatus === 2) {
    return []
  }

  const missing = []
  const fields = getDocFields(meta, doc.doctype || meta.name)

  for (const field of fields) {
    if (!field?.fieldname || SKIP_FIELD_TYPES.has(field.fieldtype)) {
      continue
    }
    if (!isFieldMandatory(doc, field, parentDoc)) {
      continue
    }
    if (hasFieldValue(doc, field)) {
      continue
    }
    missing.push(__(field.label || field.fieldname, null, field.parent))
  }

  for (const field of fields) {
    if (!TABLE_FIELD_TYPES.has(field.fieldtype)) {
      continue
    }
    const rows = doc[field.fieldname]
    if (!Array.isArray(rows)) {
      continue
    }
    const childMeta = frappe.get_meta(field.options)
    rows.forEach((row) => {
      const childDoc = {
        doctype: field.options,
        parent: doc.name,
        parenttype: doc.doctype || meta.name,
        parentfield: field.fieldname,
        ...row,
      }
      missing.push(...getMissingMandatoryFields(childDoc, childMeta, doc))
    })
  }

  return missing
}

export function buildPreviewDoc(card, destination, config, workflowAction = null) {
  const preview = { ...card }
  const destinationName = destination.column_name || destination
  const moveOptions = destination.moveOptions || destination

  if (moveOptions?.mode === 'workflow') {
    const action = workflowAction
      || (moveOptions.actions?.length === 1 ? moveOptions.actions[0].action : null)
    const transition = moveOptions.actions?.find((row) => row.action === action)
      || moveOptions.actions?.[0]
    if (transition?.next_state) {
      preview[config.field_name] = transition.next_state
      const workflow = frappe.workflow?.workflows?.[config.ref_doctype]
      const nextState = workflow?.states?.find((row) => row.state === transition.next_state)
      if (nextState?.update_field) {
        preview[nextState.update_field] = nextState.update_value
      }
    } else {
      preview[config.field_name] = destinationName
    }
  } else {
    preview[config.field_name] = destinationName
  }

  return preview
}

export function validateMoveMandatory(
  card,
  destination,
  config,
  workflowAction = null,
  serverMissingMandatory = null,
) {
  if (Array.isArray(serverMissingMandatory)) {
    return {
      valid: serverMissingMandatory.length === 0,
      missingLabels: serverMissingMandatory,
    }
  }

  const meta = frappe.get_meta(config.ref_doctype)
  const preview = buildPreviewDoc(card, destination, config, workflowAction)
  const missingLabels = getMissingMandatoryFields(
    { ...preview, doctype: config.ref_doctype },
    meta,
  )

  return {
    valid: missingLabels.length === 0,
    missingLabels,
  }
}

export function showMandatoryMessage(missingLabels, doctype) {
  if (!missingLabels.length) {
    return
  }
  const message = `${__('Mandatory fields required in {0}', [__(doctype)])}<br><br><ul><li>${missingLabels.join('</li><li>')}</li></ul>`
  frappe.msgprint({
    message,
    indicator: 'red',
    title: __('Missing Fields'),
  })
}
