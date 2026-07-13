import {
  getMissingMandatoryFields,
  showMandatoryMessage,
} from './moveValidation'

const SKIP_FIELD_TYPES = new Set([
  'Section Break',
  'Column Break',
  'Tab Break',
  'HTML',
  'Heading',
  'Fold',
])

const TABLE_FIELD_TYPES = new Set(['Table', 'Table MultiSelect'])

function getDocFields(meta, doctype) {
  return frappe.meta.docfield_list?.[doctype]
    || meta.fields
    || []
}

function isFieldMandatory(doc, field, parentDoc = doc) {
  if (field.mandatory_depends_on && doc) {
    const expression = field.mandatory_depends_on
    if (typeof expression === 'boolean') {
      return expression
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

function hasFieldValue(doc, field) {
  const value = doc[field.fieldname]
  if (TABLE_FIELD_TYPES.has(field.fieldtype)) {
    return Array.isArray(value) && value.length > 0
  }
  if (value === null || value === undefined || value === '') {
    return false
  }
  if (Array.isArray(value) && !value.length) {
    return false
  }
  const text = String(value ?? '').replace(/<[^>]*>/g, '').trim()
  const hasImg = String(value ?? '').includes('<img')
  if (field.fieldtype === 'Text Editor' && (text || hasImg)) {
    return true
  }
  if (field.fieldtype === 'Code' && field.options === 'HTML' && (text || hasImg)) {
    return true
  }
  return Boolean(text)
}

export function getMissingMandatoryFieldnames(doc, meta, parentDoc = doc) {
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
    missing.push(field.fieldname)
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
      missing.push(...getMissingMandatoryFieldnames(childDoc, childMeta, doc))
    })
  }

  return missing
}

export function buildCreatePreviewDoc(column, config) {
  const columnName = column.column_name || column
  const preview = {
    doctype: config.ref_doctype,
    [config.field_name]: columnName,
  }
  const workflow = frappe.workflow?.workflows?.[config.ref_doctype]
  if (workflow?.workflow_state_field === config.field_name) {
    const nextState = workflow.states?.find((row) => row.state === columnName)
    if (nextState?.update_field) {
      preview[nextState.update_field] = nextState.update_value
    }
  }
  return preview
}

export function getQuickEntryFieldnames(doctype) {
  const meta = frappe.get_meta(doctype)
  const fieldnames = new Set()
  for (const field of meta.fields || []) {
    if (field.fieldtype === 'Tab Break') {
      continue
    }
    if (field.read_only || field.is_virtual) {
      continue
    }
    if (field.reqd || field.allow_in_quick_entry) {
      fieldnames.add(field.fieldname)
    }
  }
  if ((meta.autoname || '').toLowerCase() === 'prompt') {
    fieldnames.add('__newname')
  }
  return fieldnames
}

export function frappeAllowsQuickEntry(doctype) {
  const meta = frappe.get_meta(doctype)
  if (meta.quick_entry != 1) {
    return false
  }

  const mandatory = (meta.fields || []).filter((field) =>
    (field.reqd || field.allow_in_quick_entry)
    && !field.read_only
    && !field.is_virtual
    && field.fieldtype !== 'Tab Break',
  )
  if (mandatory.some((field) => TABLE_FIELD_TYPES.has(field.fieldtype))) {
    return false
  }
  if (!mandatory.length) {
    return false
  }
  if (mandatory.length > 7) {
    return false
  }
  return true
}

function resolveFormModeFromMissing(doctype, missingFieldnames) {
  if (!frappeAllowsQuickEntry(doctype)) {
    return 'full_form'
  }
  const quickEntryFields = getQuickEntryFieldnames(doctype)
  if (missingFieldnames.some((fieldname) => !quickEntryFields.has(fieldname))) {
    return 'full_form'
  }
  return 'quick_entry'
}

export function resolveCreateFormMode(column, config, createOptions = null) {
  const columnName = column.column_name || column
  const serverPolicy = createOptions?.[columnName]
  if (serverPolicy) {
    if (!serverPolicy.allowed) {
      return {
        mode: 'blocked',
        reason: serverPolicy.reason || 'no_permission',
        missingLabels: serverPolicy.missing_mandatory || [],
        missingFieldnames: serverPolicy.missing_fieldnames || [],
      }
    }
    return {
      mode: serverPolicy.form_mode || 'quick_entry',
      reason: null,
      missingLabels: serverPolicy.missing_mandatory || [],
      missingFieldnames: serverPolicy.missing_fieldnames || [],
    }
  }

  if (!frappe.model.can_create(config.ref_doctype)) {
    return {
      mode: 'blocked',
      reason: 'no_permission',
      missingLabels: [],
      missingFieldnames: [],
    }
  }

  const meta = frappe.get_meta(config.ref_doctype)
  const preview = buildCreatePreviewDoc(column, config)
  const missingFieldnames = getMissingMandatoryFieldnames(
    { ...preview, doctype: config.ref_doctype },
    meta,
  )
  const missingLabels = getMissingMandatoryFields(
    { ...preview, doctype: config.ref_doctype },
    meta,
  )
  const mode = resolveFormModeFromMissing(config.ref_doctype, missingFieldnames)

  return {
    mode,
    reason: null,
    missingLabels,
    missingFieldnames,
  }
}

export function applyCreateDefaults(doc, defaults = {}) {
  if (!doc || !defaults) {
    return doc
  }
  Object.assign(doc, defaults)
  return doc
}

function registerFullFormAfterSave(onCreated) {
  if (typeof onCreated !== 'function') {
    return
  }
  frappe.route_hooks = frappe.route_hooks || {}
  frappe.route_hooks.after_save = (frm) => {
    onCreated(frm.doc)
  }
}

export function showCreateBlockedMessage(reason, doctype, missingLabels = []) {
  if (reason === 'missing_mandatory' && missingLabels.length) {
    showMandatoryMessage(missingLabels, doctype)
    return
  }

  const messages = {
    no_permission: __('You cannot create this document type.'),
    workflow_denied: __('You are not allowed to edit this document in the current Workflow State.'),
    invalid_column: __('Invalid Kanban column.'),
  }
  const message = messages[reason] || __('Unable to create the record.')
  frappe.msgprint({
    message,
    indicator: 'red',
    title: __('Missing Fields'),
  })
}

export function openCreateForm({
  doctype,
  defaults,
  mode,
  onCreated = null,
}) {
  const handleCreated = (doc) => {
    if (typeof onCreated === 'function') {
      onCreated(doc)
    }
  }

  if (mode === 'full_form') {
    return frappe.model.with_doctype(doctype, () => {
      frappe.route_options = { ...defaults }
      const doc = frappe.model.get_new_doc(doctype)
      applyCreateDefaults(doc, defaults)
      registerFullFormAfterSave(handleCreated)
      return frappe.set_route('Form', doctype, doc.name).then(() => doc)
    })
  }

  return frappe.model.with_doctype(doctype, () => {
    const doc = frappe.model.get_new_doc(doctype)
    applyCreateDefaults(doc, defaults)
    return frappe.ui.form.make_quick_entry(doctype, handleCreated, null, doc)
  })
}
