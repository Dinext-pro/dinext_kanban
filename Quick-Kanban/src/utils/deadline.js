/**
 * Deadline bucket classification (mirrors quick_kanban.deadline).
 */

export const DEADLINE_OVERDUE = 'overdue'
export const DEADLINE_ATTENTION = 'attention'
export const DEADLINE_PLANNED = 'planned'
export const DEADLINE_NONE = 'none'

export const DEADLINE_LANE_ORDER = [
  DEADLINE_OVERDUE,
  DEADLINE_ATTENTION,
  DEADLINE_PLANNED,
  DEADLINE_NONE,
]

/**
 * Visual tone for deadline swimlane chrome (title color + icon).
 * Only overdue / attention; planned and none stay unstyled.
 * @param {string|null|undefined} laneKey
 * @returns {'overdue'|'attention'|null}
 */
export function deadlineLaneTone(laneKey) {
  const key = String(laneKey || '').trim()
  if (key === DEADLINE_OVERDUE) {
    return DEADLINE_OVERDUE
  }
  if (key === DEADLINE_ATTENTION) {
    return DEADLINE_ATTENTION
  }
  return null
}

/** @type {{ projectHolidayLists: Record<string, string|null>, holidayDates: Record<string, string[]> }} */
let holidayContext = {
  projectHolidayLists: { '': null },
  holidayDates: {},
}

export function setDeadlineHolidayContext(ctx = {}) {
  holidayContext = {
    projectHolidayLists: ctx.project_holiday_lists || ctx.projectHolidayLists || { '': null },
    holidayDates: ctx.holiday_dates || ctx.holidayDates || {},
  }
}

export function getDeadlineHolidayContext() {
  return holidayContext
}

function toDateOnly(value) {
  if (value == null || value === '') {
    return null
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  // YYYY-MM-DD or YYYY-MM-DD HH:MM:SS
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

function dateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date, days) {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + days)
  return next
}

export function workingDaysUntil(targetDate, holidayList = null, asOf = null) {
  const target = toDateOnly(targetDate)
  if (!target) {
    return null
  }
  const start = toDateOnly(asOf) || toDateOnly(new Date())
  if (target < start) {
    return -1
  }
  const holidays = new Set(
    (holidayList && holidayContext.holidayDates[holidayList]) || [],
  )
  let count = 0
  let cursor = start
  while (cursor <= target) {
    if (!holidays.has(dateKey(cursor))) {
      count += 1
    }
    cursor = addDays(cursor, 1)
  }
  return count
}

export function classifyDeadlineBucket(
  dateValue,
  attentionDays = 3,
  holidayList = null,
  asOf = null,
) {
  const target = toDateOnly(dateValue)
  if (!target) {
    return DEADLINE_NONE
  }
  const start = toDateOnly(asOf) || toDateOnly(new Date())
  if (target < start) {
    return DEADLINE_OVERDUE
  }
  const days = workingDaysUntil(target, holidayList, start)
  if (days == null) {
    return DEADLINE_NONE
  }
  const attention = Number(attentionDays) > 0 ? Number(attentionDays) : 3
  if (days <= attention) {
    return DEADLINE_ATTENTION
  }
  return DEADLINE_PLANNED
}

export function resolveCardHolidayList(card) {
  const project = String(card?.project || '').trim()
  const maps = holidayContext.projectHolidayLists || {}
  if (project && Object.prototype.hasOwnProperty.call(maps, project)) {
    return maps[project]
  }
  return maps[''] ?? null
}

export function isDeadlineColumnTracked(statusValue, deadlineColumns) {
  const columns = (deadlineColumns || []).map((c) => String(c).trim()).filter(Boolean)
  if (!columns.length) {
    return false
  }
  return columns.includes(String(statusValue ?? '').trim())
}

/**
 * Live deadline swimlane/highlight bucket from card date + columns.
 * Does not read `_deadline_bucket` (use after local field edits).
 */
export function computeDeadlineBucket(card, config) {
  const field = config?.deadline_field
  if (!field) {
    return DEADLINE_NONE
  }
  const dateValue = card?.[field]
  const columns = config?.deadline_columns || []
  const statusField = config?.field_name
  const status = statusField ? card?.[statusField] : null

  if (dateValue == null || dateValue === '') {
    return DEADLINE_NONE
  }
  if (!isDeadlineColumnTracked(status, columns)) {
    return DEADLINE_PLANNED
  }
  return classifyDeadlineBucket(
    dateValue,
    config?.deadline_attention_days ?? 3,
    resolveCardHolidayList(card),
  )
}

export function classifyCardDeadline(card, config) {
  const field = config?.deadline_field
  if (!field) {
    return DEADLINE_NONE
  }
  const dateValue = card?.[field]
  // Empty date always none (ignore stale server bucket).
  if (dateValue == null || dateValue === '') {
    return DEADLINE_NONE
  }
  const columns = config?.deadline_columns || []
  const statusField = config?.field_name
  const status = statusField ? card?.[statusField] : null
  if (!isDeadlineColumnTracked(status, columns)) {
    return DEADLINE_PLANNED
  }
  // Prefer server bucket for first paint (matches holiday-aware swimlane).
  if (card?._deadline_bucket && card._deadline_bucket !== DEADLINE_NONE) {
    return card._deadline_bucket
  }
  return computeDeadlineBucket(card, config)
}

export function fieldAffectsDeadlineBucket(config, fieldname) {
  if (!config?.deadline_enabled || !config?.deadline_field || !fieldname) {
    return false
  }
  return (
    fieldname === config.deadline_field
    || fieldname === config.field_name
    || fieldname === 'project'
  )
}

export function refreshCardDeadlineBucket(card, config) {
  if (!card || !config?.deadline_enabled || !config?.deadline_field) {
    return card
  }
  card._deadline_bucket = computeDeadlineBucket(card, config)
  return card
}

export function shouldHighlightDeadline(card, config) {
  const field = config?.deadline_field
  if (!field || !config?.deadline_enabled) {
    return false
  }
  const columns = config?.deadline_columns || []
  if (!columns.length) {
    return false
  }
  const statusField = config?.field_name
  const status = statusField ? card?.[statusField] : null
  if (!columns.map(String).includes(String(status ?? ''))) {
    return false
  }
  const displayFields = config?.display_fields || []
  const shown = displayFields.some((df) => df?.fieldname === field || df === field)
  if (!shown) {
    return false
  }
  const bucket = classifyCardDeadline(card, config)
  return bucket === DEADLINE_OVERDUE || bucket === DEADLINE_ATTENTION
}

export function deadlineToneForCard(card, config) {
  if (!shouldHighlightDeadline(card, config)) {
    return ''
  }
  const bucket = classifyCardDeadline(card, config)
  if (bucket === DEADLINE_OVERDUE) {
    return 'overdue'
  }
  if (bucket === DEADLINE_ATTENTION) {
    return 'attention'
  }
  return ''
}

export async function hydrateDeadlineHolidayContext(projects = []) {
  const unique = [...new Set((projects || []).map((p) => String(p || '').trim()).filter(Boolean))]
  const response = await globalThis.frappe?.call?.({
    method: 'quick_kanban.api.get_deadline_holiday_context',
    args: { projects: unique },
  })
  if (response?.message) {
    setDeadlineHolidayContext(response.message)
  }
  return holidayContext
}
