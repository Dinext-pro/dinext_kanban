import { SWIMLANE_UNASSIGNED } from './kanban'

/**
 * Resolve the Link fieldname on a Table MultiSelect child DocType
 * (mirrors quick_kanban.swimlane._child_link_field).
 */
export function resolveSwimlaneLinkField(fieldMeta, getMeta = (name) => frappe.get_meta(name)) {
  const childDoctype = fieldMeta?.options
  if (!childDoctype) {
    return ''
  }
  const childMeta = getMeta(childDoctype)
  const linkField = (childMeta?.fields || []).find((field) => field.fieldtype === 'Link')
  return linkField?.fieldname || ''
}

function canWriteDoctype(doctype) {
  const canWrite = globalThis.frappe?.model?.can_write
  if (typeof canWrite === 'function' && doctype) {
    return Boolean(canWrite(doctype))
  }
  return true
}

/**
 * Build swimlane prefill for create: document defaults and/or post-save assign.
 * Returns { defaults, assignTo }.
 */
export function buildSwimlaneCreateDefaults(config, laneKey, {
  canWrite = null,
} = {}) {
  const result = { defaults: {}, assignTo: null }
  const mode = config?.swimlane_mode || 'off'
  if (mode === 'off' || laneKey == null) {
    return result
  }

  const key = String(laneKey)
  if (key === SWIMLANE_UNASSIGNED) {
    return result
  }

  const writable = canWrite == null
    ? canWriteDoctype(config.ref_doctype)
    : Boolean(canWrite)
  if (!writable) {
    return result
  }

  if (mode === 'assign') {
    result.assignTo = key
    return result
  }

  if (config.swimlane_field_meta?.read_only) {
    return result
  }

  if (mode === 'field' && config.swimlane_field) {
    result.defaults[config.swimlane_field] = key
    return result
  }

  if (mode === 'multi' && config.swimlane_field) {
    const linkField = config.swimlane_link_field
      || resolveSwimlaneLinkField(config.swimlane_field_meta)
    if (!linkField) {
      return result
    }
    result.defaults[config.swimlane_field] = [{ [linkField]: key }]
    return result
  }

  return result
}
