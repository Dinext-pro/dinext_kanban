import { describe, expect, test } from 'vitest'
import {
  DEADLINE_ATTENTION,
  DEADLINE_NONE,
  DEADLINE_OVERDUE,
  DEADLINE_PLANNED,
  classifyCardDeadline,
  classifyDeadlineBucket,
  computeDeadlineBucket,
  deadlineLaneTone,
  deadlineToneForCard,
  setDeadlineHolidayContext,
  shouldHighlightDeadline,
  workingDaysUntil,
} from './deadline'
import { resolveSwimlaneMode, laneKeysFromCard, SWIMLANE_DEADLINES } from './kanban'

describe('deadline classification', () => {
  test('empty date is none', () => {
    expect(classifyDeadlineBucket(null)).toBe(DEADLINE_NONE)
    expect(classifyDeadlineBucket('')).toBe(DEADLINE_NONE)
  })

  test('past date is overdue', () => {
    expect(classifyDeadlineBucket('2026-07-20', 3, null, '2026-07-25')).toBe(DEADLINE_OVERDUE)
  })

  test('within attention window', () => {
    expect(classifyDeadlineBucket('2026-07-27', 3, null, '2026-07-25')).toBe(DEADLINE_ATTENTION)
  })

  test('beyond attention is planned', () => {
    expect(classifyDeadlineBucket('2026-08-10', 3, null, '2026-07-25')).toBe(DEADLINE_PLANNED)
  })

  test('working days skip holidays', () => {
    setDeadlineHolidayContext({
      project_holiday_lists: { '': 'HL' },
      holiday_dates: { HL: ['2026-07-26', '2026-07-27'] },
    })
    expect(workingDaysUntil('2026-07-28', 'HL', '2026-07-25')).toBe(2)
    expect(classifyDeadlineBucket('2026-07-28', 2, 'HL', '2026-07-25')).toBe(DEADLINE_ATTENTION)
    expect(classifyDeadlineBucket('2026-07-28', 1, 'HL', '2026-07-25')).toBe(DEADLINE_PLANNED)
  })
})

describe('deadline highlight gates', () => {
  const baseConfig = {
    deadline_field: 'exp_end_date',
    deadline_enabled: true,
    deadline_attention_days: 3,
    deadline_columns: ['Open', 'Working'],
    field_name: 'status',
    display_fields: [{ fieldname: 'exp_end_date', fieldtype: 'Date' }],
  }

  test('highlights overdue in tracked column when field displayed', () => {
    setDeadlineHolidayContext({ project_holiday_lists: { '': null }, holiday_dates: {} })
    const card = { status: 'Open', exp_end_date: '2026-07-20' }
    // Force overdue via _deadline_bucket to avoid depending on "today"
    card._deadline_bucket = DEADLINE_OVERDUE
    expect(shouldHighlightDeadline(card, baseConfig)).toBe(true)
    expect(deadlineToneForCard(card, baseConfig)).toBe('overdue')
  })

  test('highlights attention from server _deadline_bucket without client holidays', () => {
    setDeadlineHolidayContext({ project_holiday_lists: { '': null }, holiday_dates: {} })
    // Without holidays this date would be planned (5 calendar days); server bucket wins.
    const card = {
      status: 'Open',
      exp_end_date: '2026-07-29',
      _deadline_bucket: DEADLINE_ATTENTION,
    }
    expect(shouldHighlightDeadline(card, baseConfig)).toBe(true)
    expect(deadlineToneForCard(card, baseConfig)).toBe('attention')
  })

  test('skips highlight outside tracked columns', () => {
    const card = { status: 'Completed', exp_end_date: '2026-07-20', _deadline_bucket: DEADLINE_OVERDUE }
    expect(shouldHighlightDeadline(card, baseConfig)).toBe(false)
  })

  test('skips highlight when date field not on card', () => {
    const card = { status: 'Open', exp_end_date: '2026-07-20', _deadline_bucket: DEADLINE_OVERDUE }
    expect(
      shouldHighlightDeadline(card, { ...baseConfig, display_fields: [{ fieldname: 'priority' }] }),
    ).toBe(false)
  })
})

describe('deadlines swimlane mode', () => {
  test('resolveSwimlaneMode maps __deadlines', () => {
    expect(resolveSwimlaneMode(SWIMLANE_DEADLINES)).toBe('deadlines')
  })

  test('laneKeysFromCard uses deadline bucket', () => {
    const config = {
      swimlane_mode: 'deadlines',
      deadline_field: 'exp_end_date',
      deadline_attention_days: 3,
      deadline_columns: ['Open'],
      field_name: 'status',
    }
    const card = { status: 'Open', exp_end_date: null }
    expect(laneKeysFromCard(card, config)).toEqual([DEADLINE_NONE])
  })

  test('non-tracked column with date maps to planned', () => {
    const config = {
      swimlane_mode: 'deadlines',
      deadline_field: 'exp_end_date',
      deadline_attention_days: 3,
      deadline_columns: ['Open'],
      field_name: 'status',
    }
    const card = {
      status: 'Completed',
      exp_end_date: '2020-01-01',
      _deadline_bucket: DEADLINE_OVERDUE,
    }
    expect(laneKeysFromCard(card, config)).toEqual([DEADLINE_PLANNED])
  })

  test('classifyCardDeadline maps non-tracked with date to planned', () => {
    const config = {
      deadline_field: 'exp_end_date',
      deadline_columns: ['Open', 'Working'],
      field_name: 'status',
    }
    expect(
      classifyCardDeadline(
        { status: 'Completed', exp_end_date: '2020-01-01', _deadline_bucket: DEADLINE_OVERDUE },
        config,
      ),
    ).toBe(DEADLINE_PLANNED)
  })

  test('classifyCardDeadline empty date is none for any column', () => {
    const config = {
      deadline_field: 'exp_end_date',
      deadline_columns: ['Open'],
      field_name: 'status',
    }
    expect(
      classifyCardDeadline({ status: 'Completed', exp_end_date: null }, config),
    ).toBe(DEADLINE_NONE)
    expect(
      classifyCardDeadline({ status: 'Open', exp_end_date: '' }, config),
    ).toBe(DEADLINE_NONE)
  })

  test('computeDeadlineBucket ignores stale _deadline_bucket', () => {
    setDeadlineHolidayContext({ project_holiday_lists: { '': null }, holiday_dates: {} })
    const config = {
      deadline_field: 'exp_end_date',
      deadline_attention_days: 3,
      deadline_columns: ['Open', 'Working'],
      field_name: 'status',
    }
    const card = {
      status: 'Open',
      exp_end_date: '2026-12-31',
      _deadline_bucket: DEADLINE_ATTENTION,
    }
    expect(computeDeadlineBucket(card, config)).toBe(DEADLINE_PLANNED)
    expect(classifyCardDeadline(card, config)).toBe(DEADLINE_ATTENTION)
    expect(computeDeadlineBucket({ ...card, exp_end_date: null }, config)).toBe(DEADLINE_NONE)
  })
})

describe('deadlineLaneTone', () => {
  test('maps overdue and attention only', () => {
    expect(deadlineLaneTone(DEADLINE_OVERDUE)).toBe('overdue')
    expect(deadlineLaneTone(DEADLINE_ATTENTION)).toBe('attention')
    expect(deadlineLaneTone(DEADLINE_PLANNED)).toBeNull()
    expect(deadlineLaneTone(DEADLINE_NONE)).toBeNull()
    expect(deadlineLaneTone('')).toBeNull()
    expect(deadlineLaneTone(null)).toBeNull()
  })
})
