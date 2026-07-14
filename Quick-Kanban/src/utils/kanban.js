import { getIndicatorDefinition } from './colors'
import DOMPurify from 'dompurify'

const DEFAULT_FIELDS = ['name']
const CARD_COLOR_FIELDNAME = 'color'
const CARD_ACCENT_COLOR_PATTERN = /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?([0-9A-Fa-f]{2})?$/
const MINIMIZE_CARDS_STORAGE_PREFIX = 'quick_kanban:minimize_cards:'
const COLLAPSED_COLUMNS_STORAGE_PREFIX = 'quick_kanban:collapsed_columns:'

export const QUICK_KANBAN_BOARD_TRANSLATION_CONTEXT = 'QuickKanban.Board'
export const QUICK_KANBAN_COLUMN_TRANSLATION_CONTEXT = 'QuickKanban.Column'
export const CARD_EXPAND_DELAY_MS = 400
export const CARD_COLLAPSE_DELAY_MS = 300
export const CARD_DENSITY_ANIMATION_MS = 200
export const COLUMN_COLLAPSE_ANIMATION_MS = 220
export const COLUMN_DRAG_EXPAND_DELAY_MS = 400

export function minimizeCardsStorageKey(boardName) {
  return `${MINIMIZE_CARDS_STORAGE_PREFIX}${boardName || ''}`
}

export function readMinimizeCardsPreference(boardName, storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(minimizeCardsStorageKey(boardName)) === '1'
  } catch {
    return false
  }
}

export function writeMinimizeCardsPreference(boardName, value, storage = globalThis.localStorage) {
  try {
    const key = minimizeCardsStorageKey(boardName)
    if (value) {
      storage?.setItem?.(key, '1')
    } else {
      storage?.removeItem?.(key)
    }
  } catch {
    // Ignore quota / private-mode storage failures.
  }
}

export function collapsedColumnsStorageKey(boardName) {
  return `${COLLAPSED_COLUMNS_STORAGE_PREFIX}${boardName || ''}`
}

export function collapsedColumnsFromList(columnNames = []) {
  const collapsed = {}
  for (const name of columnNames) {
    if (name) {
      collapsed[name] = true
    }
  }
  return collapsed
}

export function collapsedColumnsToList(collapsedColumns = {}) {
  return Object.keys(collapsedColumns).filter((name) => collapsedColumns[name])
}

export function readCollapsedColumnsPreference(boardName, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(collapsedColumnsStorageKey(boardName))
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return {}
    }
    return collapsedColumnsFromList(parsed)
  } catch {
    return {}
  }
}

export function writeCollapsedColumnsPreference(
  boardName,
  collapsedColumns,
  storage = globalThis.localStorage,
) {
  try {
    const key = collapsedColumnsStorageKey(boardName)
    const names = collapsedColumnsToList(collapsedColumns)
    if (names.length) {
      storage?.setItem?.(key, JSON.stringify(names))
    } else {
      storage?.removeItem?.(key)
    }
  } catch {
    // Ignore quota / private-mode storage failures.
  }
}

const ALWAYS_TRANSLATED_VALUE_TYPES = new Set(['Select', 'Autocomplete'])

const TRANSLATABLE_TEXT_TYPES = new Set([
  'Data',
  'Text',
  'Small Text',
  'Text Editor',
  'Long Text',
  'Code',
  'HTML Editor',
])

function normalizeFieldtype(fieldMeta) {
  return fieldMeta?.fieldtype?.replace(/ /g, '') || ''
}

export function getColumnKey(column) {
  return column?.column_name || column?.name
}

/** Visible on the board when status is Active (or unset). Matches Frappe native Kanban. */
export function isActiveColumn(column) {
  return column?.status !== 'Archived'
}

export function translateFieldLabel(fieldMeta, translate = globalThis.__) {
  if (!fieldMeta?.label) {
    return fieldMeta?.fieldname || ''
  }
  return translate(fieldMeta.label, null, fieldMeta.parent)
}

export function isTranslatedLinkField(fieldMeta) {
  const options = fieldMeta?.options
  if (!options || normalizeFieldtype(fieldMeta) !== 'Link') {
    return false
  }
  return (globalThis.frappe?.boot?.translated_doctypes || []).includes(options)
}

export function shouldTranslateFieldValue(fieldMeta) {
  if (!fieldMeta?.fieldtype) return false

  const fieldtype = normalizeFieldtype(fieldMeta)
  if (ALWAYS_TRANSLATED_VALUE_TYPES.has(fieldtype)) {
    return true
  }
  if (TRANSLATABLE_TEXT_TYPES.has(fieldMeta.fieldtype)) {
    return Boolean(fieldMeta.translatable)
  }
  return isTranslatedLinkField(fieldMeta)
}

export function needsPreFormatTranslation(fieldMeta) {
  if (!fieldMeta?.fieldtype) return false

  const fieldtype = normalizeFieldtype(fieldMeta)
  if (ALWAYS_TRANSLATED_VALUE_TYPES.has(fieldtype)) {
    return false
  }
  if (TRANSLATABLE_TEXT_TYPES.has(fieldMeta.fieldtype)) {
    return Boolean(fieldMeta.translatable)
  }
  return false
}

export function translateFieldValue(value, fieldMeta, translate = globalThis.__) {
  if (value === null || value === undefined || value === '') {
    return value
  }
  if (!shouldTranslateFieldValue(fieldMeta)) {
    return value
  }
  return translate(String(value), null, fieldMeta?.parent)
}

export function getCardFieldDisplayValue(
  value,
  fieldMeta,
  translate = globalThis.__,
) {
  if (value === null || value === undefined || value === '') {
    return ''
  }
  const translated = translateFieldValue(value, fieldMeta, translate)
  return String(translated)
}

export function getColumnDisplayName(
  columnName,
  statusFieldMeta,
  translate = globalThis.__,
) {
  if (!columnName) return columnName
  if (!statusFieldMeta) return columnName

  const fieldtype = normalizeFieldtype(statusFieldMeta)
  if (fieldtype === 'Select' || fieldtype === 'Autocomplete') {
    return translate(columnName, null, statusFieldMeta.parent)
  }
  return columnName
}

/** Select/Autocomplete options from DocField meta (newline-separated). */
export function parseSelectOptions(fieldMeta) {
  const fieldtype = normalizeFieldtype(fieldMeta)
  if (fieldtype !== 'Select' && fieldtype !== 'Autocomplete') {
    return []
  }
  const raw = fieldMeta?.options
  if (raw == null || raw === '') {
    return []
  }
  return String(raw)
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
}

/**
 * Columns that can be added to the board: unused Select options (add) and
 * Archived columns (restore). Active column names are excluded.
 */
export function getAddableColumnCandidates({
  options = [],
  activeNames = [],
  archivedColumns = [],
  statusFieldMeta = null,
  translate = globalThis.__,
} = {}) {
  const active = new Set(
    (activeNames || []).filter(Boolean).map((name) => String(name)),
  )
  const archivedByName = new Map(
    (archivedColumns || [])
      .filter((column) => column?.column_name)
      .map((column) => [String(column.column_name), column]),
  )
  const seen = new Set()
  const candidates = []

  function pushCandidate(columnName, mode) {
    if (!columnName || active.has(columnName) || seen.has(columnName)) {
      return
    }
    seen.add(columnName)
    candidates.push({
      column_name: columnName,
      display_name: getColumnDisplayName(columnName, statusFieldMeta, translate),
      mode,
    })
  }

  for (const option of options || []) {
    const columnName = String(option)
    if (archivedByName.has(columnName)) {
      pushCandidate(columnName, 'restore')
    } else {
      pushCandidate(columnName, 'add')
    }
  }

  for (const column of archivedColumns || []) {
    const columnName = column?.column_name
    if (!columnName) continue
    pushCandidate(String(columnName), 'restore')
  }

  return candidates
}

export function resolveColorField(metaByField = {}) {
  const field = metaByField[CARD_COLOR_FIELDNAME]
  if (field && normalizeFieldtype(field) === 'Color') {
    return field
  }
  return null
}

export function parseCardAccentColor(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const normalized = String(value).trim()
  return CARD_ACCENT_COLOR_PATTERN.test(normalized) ? normalized : null
}

export function attachColumnDisplayNames(
  columns,
  statusFieldMeta,
  translate = globalThis.__,
) {
  return columns.map((column) => ({
    ...column,
    display_name: getColumnDisplayName(
      column.column_name,
      statusFieldMeta,
      translate,
    ),
  }))
}

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
  const colorFieldMeta = resolveColorField(metaByField)
  const colorField = colorFieldMeta?.fieldname || ''
  if (colorField && !fields.includes(colorField)) {
    fields = [...fields, colorField]
  }
  const titleField = meta.title_field || 'name'
  const statusFieldMeta = metaByField[board.field_name] || {
    fieldname: board.field_name,
  }
  const titleFieldMeta = metaByField[titleField] || { fieldname: titleField }
  const highlightedFieldMeta = highlightedField
    ? metaByField[highlightedField] || { fieldname: highlightedField }
    : null
  const displayFields = fields
    .filter((field) =>
      field !== titleField &&
      field !== highlightedField &&
      field !== colorField &&
      field !== 'name',
    )
    .map((field) => metaByField[field] || { fieldname: field, label: field })

  return {
    board_name: board.name,
    ref_doctype: board.reference_doctype,
    field_name: board.field_name,
    title_field: titleField,
    title_field_meta: titleFieldMeta,
    status_field_meta: statusFieldMeta,
    highlighted_field_meta: highlightedFieldMeta,
    fields,
    display_fields: displayFields,
    highlighted_field: highlightedField,
    color_field: colorField,
    color_field_meta: colorFieldMeta,
    highlight_table: Array.isArray(board.custom_highlight_table)
      ? board.custom_highlight_table
      : [],
    show_labels: Boolean(board.show_labels),
    show_tags: Boolean(board.custom_show_tags),
  }
}

/**
 * Build colored tag-pill HTML via the standard ListView helper (same as native Kanban).
 * @param {string|null|undefined} userTags `_user_tags` value (",tag1,tag2")
 * @param {{ get_tags_html?: Function }|null} [list] list view instance; defaults to `cur_list`
 * @param {number} [limit=3]
 * @returns {string}
 */
export function getCardTagsHtml(userTags, list = globalThis.cur_list, limit = 3) {
  if (!userTags) {
    return ''
  }
  const getTagsHtml =
    (typeof list?.get_tags_html === 'function' && list.get_tags_html.bind(list))
    || globalThis.frappe?.views?.ListView?.prototype?.get_tags_html
  if (typeof getTagsHtml !== 'function') {
    return ''
  }
  return getTagsHtml(userTags, limit, true) || ''
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

const CARD_FIELD_SANITIZE_CONFIG = {
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
}

const PERCENT_PROGRESS_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['div'],
  ALLOWED_ATTR: [
    'class',
    'style',
    'role',
    'aria-valuenow',
    'aria-valuemin',
    'aria-valuemax',
  ],
}

export function formatPercentProgress(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }

  const pct = Math.min(100, Math.max(0, Math.round(numeric)))
  return `<div class="progress kanban-card-progress">
    <div class="progress-bar progress-bar-success" role="progressbar"
      aria-valuenow="${pct}"
      aria-valuemin="0" aria-valuemax="100" style="width: ${pct}%;">
    </div>
  </div>`
}

export function formatCardField(
  value,
  fieldMeta,
  formatter = globalThis.frappe?.format,
  card = {},
  translate = globalThis.__,
) {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  if (fieldMeta && normalizeFieldtype(fieldMeta) === 'Percent') {
    const progressHtml = formatPercentProgress(value)
    if (!progressHtml) {
      return '—'
    }
    return DOMPurify.sanitize(progressHtml, PERCENT_PROGRESS_SANITIZE_CONFIG)
  }

  const formatValue = fieldMeta && needsPreFormatTranslation(fieldMeta)
    ? translate(String(value), null, fieldMeta.parent)
    : value

  const formatted = fieldMeta && formatter
    ? formatter(formatValue, fieldMeta, {}, card)
    : String(formatValue)
  return DOMPurify.sanitize(String(formatted), CARD_FIELD_SANITIZE_CONFIG)
}
