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

function normalizeFieldtypeName(fieldtype) {
  return String(fieldtype || '').replace(/ /g, '')
}

const PARENT_CREATE_SKIP_TYPES = new Set([
  'Table',
  'TableMultiSelect',
  'Attach',
  'AttachImage',
  'Password',
  'Image',
  'Button',
  'HTML',
  'Heading',
  'SectionBreak',
  'ColumnBreak',
  'TabBreak',
  'Fold',
])

const PARENT_CREATE_SYSTEM_FIELDS = new Set([
  'name',
  'owner',
  'creation',
  'modified',
  'modified_by',
  'docstatus',
  'idx',
  'lft',
  'rgt',
  'old_parent',
  'is_group',
])

/** Board / swimlane fieldnames that may be copied onto a child create form. */
export function listParentCreateCandidateFields(config) {
  const fields = []
  const seen = new Set()
  for (const field of config?.fields || []) {
    const name = String(field || '').trim()
    if (!name || seen.has(name)) {
      continue
    }
    seen.add(name)
    fields.push(name)
  }
  const swimlaneMode = config?.swimlane_mode
  if (
    (swimlaneMode === 'field' || swimlaneMode === 'multi')
    && config?.swimlane_field
  ) {
    const name = String(config.swimlane_field).trim()
    if (name && !seen.has(name)) {
      fields.push(name)
    }
  }
  return fields
}

/**
 * Copy scalar parent values into create defaults (project, etc.).
 * Skips status / parent / title / system / no_copy / set_only_once / non-scalar fieldtypes.
 */
export function buildParentCreateDefaults(parentDoc, config, { getMeta } = {}) {
  if (!parentDoc || !config) {
    return {}
  }

  const exclude = new Set(
    [
      ...PARENT_CREATE_SYSTEM_FIELDS,
      config.field_name,
      config.parent_field,
      config.title_field,
      config.title_field_meta?.fieldname,
    ]
      .filter(Boolean)
      .map((name) => String(name)),
  )

  const resolveMeta = typeof getMeta === 'function'
    ? getMeta
    : (doctype) => (
      typeof frappe?.get_meta === 'function' ? frappe.get_meta(doctype) : null
    )
  const meta = resolveMeta(config.ref_doctype)
  const fieldsByName = Object.fromEntries(
    (meta?.fields || []).map((field) => [field.fieldname, field]),
  )

  const defaults = {}
  for (const fieldname of listParentCreateCandidateFields(config)) {
    if (exclude.has(fieldname)) {
      continue
    }
    const df = fieldsByName[fieldname]
    if (df?.no_copy || df?.set_only_once) {
      continue
    }
    const fieldtype = normalizeFieldtypeName(df?.fieldtype)
    if (df && (PARENT_CREATE_SKIP_TYPES.has(fieldtype) || fieldtype.startsWith('Attach'))) {
      continue
    }
    const value = parentDoc[fieldname]
    if (value == null || value === '') {
      continue
    }
    const valueType = typeof value
    if (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
      continue
    }
    defaults[fieldname] = value
  }
  return defaults
}

/**
 * Apply create defaults onto a new doc. Table / Table MultiSelect values are
 * applied as child rows via frappe.model.add_child when available.
 */
export function applyCreateDefaults(doc, defaults = {}) {
  if (!doc || !defaults) {
    return doc
  }

  const meta = typeof frappe?.get_meta === 'function'
    ? frappe.get_meta(doc.doctype)
    : null
  const fieldsByName = Object.fromEntries(
    (meta?.fields || []).map((field) => [field.fieldname, field]),
  )

  for (const [fieldname, value] of Object.entries(defaults)) {
    const df = fieldsByName[fieldname]
    const fieldtype = normalizeFieldtypeName(df?.fieldtype)
    if (
      (fieldtype === 'Table' || fieldtype === 'TableMultiSelect')
      && Array.isArray(value)
    ) {
      if (!Array.isArray(doc[fieldname])) {
        doc[fieldname] = []
      }
      for (const row of value) {
        if (typeof frappe?.model?.add_child === 'function' && df?.options) {
          const child = frappe.model.add_child(doc, df.options, fieldname)
          Object.assign(child, row)
        } else {
          doc[fieldname].push({ ...row })
        }
      }
      continue
    }
    doc[fieldname] = value
  }
  return doc
}

/** Flat route_options cannot carry child-table rows. */
export function routeOptionsFromDefaults(defaults = {}) {
  const options = {}
  for (const [fieldname, value] of Object.entries(defaults || {})) {
    if (Array.isArray(value)) {
      continue
    }
    options[fieldname] = value
  }
  return options
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
      frappe.route_options = routeOptionsFromDefaults(defaults)
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
