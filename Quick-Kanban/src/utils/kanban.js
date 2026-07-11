import { getIndicatorDefinition } from './colors'
import DOMPurify from 'dompurify'

const DEFAULT_FIELDS = ['name']

export function normalizeBoardConfig(board, meta = {}) {
  let fields = DEFAULT_FIELDS

  if (Array.isArray(board.fields) && board.fields.length) {
    fields = board.fields
  } else if (board.fields) {
    try {
      const parsedFields = JSON.parse(board.fields)
      if (Array.isArray(parsedFields) && parsedFields.length) {
        fields = parsedFields
      }
    } catch {
      fields = DEFAULT_FIELDS
    }
  }

  const highlightedField = board.custom_highlighted_field || ''
  if (highlightedField && !fields.includes(highlightedField)) {
    fields = [...fields, highlightedField]
  }
  const metaByField = Object.fromEntries(
    (meta.fields || []).map((field) => [field.fieldname, field]),
  )
  const displayFields = fields
    .filter((field) =>
      field !== (meta.title_field || 'name') &&
      field !== highlightedField &&
      field !== 'name',
    )
    .map((field) => metaByField[field] || { fieldname: field, label: field })

  return {
    board_name: board.name,
    ref_doctype: board.reference_doctype,
    field_name: board.field_name,
    title_field: meta.title_field || 'name',
    fields,
    display_fields: displayFields,
    highlighted_field: highlightedField,
    highlight_table: Array.isArray(board.custom_highlight_table)
      ? board.custom_highlight_table
      : [],
    show_labels: Boolean(board.show_labels),
  }
}

export function transformCard(keys, values, userInfo = {}) {
  const card = Object.fromEntries(keys.map((key, index) => [key, values[index]]))
  card._assign = mapAssignments(card._assign, userInfo)

  return card
}

export function parseAssignments(value) {
  if (Array.isArray(value)) return value
  try {
    return JSON.parse(value || '[]')
  } catch {
    return []
  }
}

export function mapAssignments(value, userInfo = {}) {
  return Object.fromEntries(
    parseAssignments(value).map((user) => [
      user,
      userInfo[user]?.fullname ||
        userInfo[user] ||
        globalThis.frappe?.user_info?.(user)?.fullname ||
        user,
    ]),
  )
}

export function groupCardsByColumn({
  columns,
  keys = [],
  values = [],
  statusField,
  userInfo = {},
}) {
  const statusIndex = keys.indexOf(statusField)
  const grouped = new Map(columns.map((column) => [column.column_name, []]))

  if (statusIndex >= 0) {
    for (const valuesRow of values) {
      const cards = grouped.get(valuesRow[statusIndex])
      if (cards) {
        cards.push(transformCard(keys, valuesRow, userInfo))
      }
    }
  }

  return columns.map((column) => ({
    ...column,
    cards: grouped.get(column.column_name) || [],
  }))
}

export function getIndicatorClass(indicatorValue) {
  const definition = getIndicatorDefinition(indicatorValue)
  return definition?.class || 'gray'
}

export function isNearScrollEnd(element, threshold = 48) {
  return (
    element.scrollTop + element.clientHeight >=
    element.scrollHeight - threshold
  )
}

export function formatCardField(
  value,
  fieldMeta,
  formatter = globalThis.frappe?.format,
  card = {},
) {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  const formatted = fieldMeta && formatter
    ? formatter(value, fieldMeta, {}, card)
    : String(value)
  return DOMPurify.sanitize(String(formatted), {
    ALLOWED_TAGS: ['a', 'span', 'strong', 'em', 'small', 'br', 'div'],
    ALLOWED_ATTR: [
      'href',
      'title',
      'class',
      'target',
      'rel',
      'data-doctype',
      'data-name',
    ],
  })
}
