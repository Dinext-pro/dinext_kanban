export const QUICK_KANBAN_INLINE_TRANSLATION_CONTEXT = 'QuickKanban.Inline'
export const INLINE_EDIT_CLICK_DELAY_MS = 250

const PRESENTATION_FIELD_TYPES = new Set([
  'Section Break',
  'Column Break',
  'Tab Break',
  'HTML',
  'Heading',
  'Fold',
  'Button',
  'Image',
  'Attach',
  'Attach Image',
  'Signature',
  'Geolocation',
  'HTML Editor',
  'Markdown Editor',
  'Code',
  'JSON',
  'Barcode',
  'Icon',
])

const TABLE_FIELD_TYPES = new Set(['Table', 'Table MultiSelect'])

const HEAVY_EDITOR_TYPES = new Set(['Text Editor'])

export function normalizeFieldtype(fieldMeta) {
  return fieldMeta?.fieldtype?.replace(/ /g, '') || ''
}

export function getInlineEditClickDelayMs(fieldMeta) {
  return normalizeFieldtype(fieldMeta) === 'Select' ? 0 : INLINE_EDIT_CLICK_DELAY_MS
}

/**
 * Open Select options after control mount. Prefer showPicker(); fall back to size listbox.
 */
export function openInlineSelectOptions(control) {
  const el = control?.$input?.get?.(0)
    || control?.$input?.[0]
    || control?.input
    || null
  if (!el || el.tagName !== 'SELECT') {
    return { opened: false, mode: null }
  }

  el.focus?.()

  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker()
      return { opened: true, mode: 'showPicker' }
    } catch {
      // Lost user activation or unsupported — use size fallback.
    }
  }

  const optionsCount = el.options?.length || 0
  if (optionsCount <= 1) {
    return { opened: false, mode: null }
  }
  el.size = Math.min(Math.max(optionsCount, 2), 8)
  const collapse = () => {
    el.size = 1
  }
  el.addEventListener('change', collapse, { once: true })
  el.addEventListener('blur', collapse, { once: true })
  return { opened: true, mode: 'size' }
}

/**
 * Fast skip without loading the document. Final Write/Read is decided after with_doc.
 */
export function isInlineFieldTypeSupported(fieldMeta) {
  if (!fieldMeta?.fieldname || !fieldMeta?.fieldtype) {
    return false
  }
  if (fieldMeta.fieldname === 'name') {
    return false
  }
  if (frappe.model?.is_non_std_field && !frappe.model.is_non_std_field(fieldMeta.fieldname)) {
    return false
  }
  if (fieldMeta.is_virtual || fieldMeta.read_only || fieldMeta.hidden) {
    return false
  }
  if (PRESENTATION_FIELD_TYPES.has(fieldMeta.fieldtype)) {
    return false
  }
  if (TABLE_FIELD_TYPES.has(fieldMeta.fieldtype)) {
    return false
  }
  if (HEAVY_EDITOR_TYPES.has(fieldMeta.fieldtype)) {
    return false
  }
  return true
}

export function evaluateReadOnlyDependsOn(expression, doc, parentDoc = doc) {
  if (expression === null || expression === undefined || expression === '') {
    return false
  }
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
  const value = doc?.[expression]
  if (Array.isArray(value)) {
    return Boolean(value.length)
  }
  return Boolean(value)
}

export function getInlineFieldDisplayStatus(doctype, docname, fieldname, doc) {
  const df = frappe.meta.get_field?.(doctype, fieldname, docname)
    || frappe.meta.get_docfield?.(doctype, fieldname, docname)
    || null
  if (!df) {
    return 'None'
  }
  let status = frappe.perm.get_field_display_status(df, doc, null, false)
  if (
    status === 'Write'
    && df.read_only_depends_on
    && evaluateReadOnlyDependsOn(df.read_only_depends_on, doc)
  ) {
    status = 'Read'
  }
  return status
}

export function isWorkflowReadOnly(doctype, docname) {
  const isReadOnly = frappe.workflow?.is_read_only
  if (typeof isReadOnly !== 'function') {
    return false
  }
  try {
    return Boolean(isReadOnly.call(frappe.workflow, doctype, docname))
  } catch {
    return false
  }
}

/**
 * Final editability after full document load (TreeView V6 createControl pattern).
 *
 * Permission matrix (card mutations):
 * - Inline field edit: this helper + frappe.client.set_value (not move_policy).
 * - Column drag/move: store canDragCard / get_move_options + assert_move_allowed.
 * - Tags / likes / create: separate Desk APIs (see CardTags, CardExtraInfo, createValidation).
 */
export function canOpenInlineEditor({ doctype, docname, fieldMeta, doc }) {
  if (!doc || !fieldMeta?.fieldname) {
    return false
  }
  if (!isInlineFieldTypeSupported(fieldMeta)) {
    return false
  }
  if (isWorkflowReadOnly(doctype, docname)) {
    return false
  }
  return getInlineFieldDisplayStatus(doctype, docname, fieldMeta.fieldname, doc) === 'Write'
}

export function resolveDoubleClickNavigation({
  role: _role,
  fieldMeta,
  card,
  refDoctype,
  value,
}) {
  const fieldtype = normalizeFieldtype(fieldMeta)
  if (fieldtype === 'Link' && fieldMeta?.options && value) {
    return {
      doctype: fieldMeta.options,
      name: value,
    }
  }
  if (!refDoctype || !card?.name) {
    return null
  }
  return {
    doctype: refDoctype,
    name: card.name,
  }
}

export function getFormLink(doctype, name) {
  if (!doctype || !name) {
    return null
  }
  return frappe.utils.get_form_link(doctype, name)
}

export function navigateToForm(doctype, name) {
  const href = getFormLink(doctype, name)
  if (!href) {
    return false
  }
  if (typeof frappe.set_route === 'function') {
    frappe.set_route('Form', doctype, name)
    return true
  }
  window.location.href = href
  return true
}

export function loadCardDocument(doctype, docname) {
  return frappe.model.with_doc(doctype, docname)
}

export function clearCardDocument(doctype, docname) {
  if (typeof frappe.model.clear_doc === 'function') {
    frappe.model.clear_doc(doctype, docname)
  }
}

export function valuesEqual(left, right) {
  if (left === right) {
    return true
  }
  if (left == null && right == null) {
    return true
  }
  if (left == null || right == null) {
    return false
  }
  return String(left) === String(right)
}

/**
 * Strip navigable href/target from display HTML so Desk router cannot
 * intercept single-click while inline editing is available.
 */
export function sanitizeDisplayHtmlForInlineEdit(html) {
  if (html == null || html === '') {
    return ''
  }
  const raw = String(html)
  if (typeof document === 'undefined') {
    return raw
  }
  const template = document.createElement('template')
  template.innerHTML = raw
  template.content.querySelectorAll('a').forEach((anchor) => {
    anchor.removeAttribute('href')
    anchor.removeAttribute('target')
    anchor.setAttribute('role', 'presentation')
    anchor.setAttribute('tabindex', '-1')
  })
  return template.innerHTML
}

export function buildInlineControlDf({
  fieldMeta,
  doctype,
  docname,
  doc,
  onChange,
}) {
  const df = {
    ...fieldMeta,
    label: fieldMeta.fieldtype === 'Check' ? '' : fieldMeta.label,
    get_status() {
      if (isWorkflowReadOnly(doctype, docname)) {
        return 'Read'
      }
      return getInlineFieldDisplayStatus(doctype, docname, fieldMeta.fieldname, doc)
    },
    change() {
      if (typeof onChange === 'function') {
        return onChange(this)
      }
      return undefined
    },
  }
  return df
}
