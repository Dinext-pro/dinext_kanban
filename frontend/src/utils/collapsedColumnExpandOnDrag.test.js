import { afterEach, describe, expect, test, vi } from 'vitest'
import { createCollapsedColumnExpandOnDrag } from './collapsedColumnExpandOnDrag'
import { COLUMN_DRAG_EXPAND_DELAY_MS } from './kanban'

describe('createCollapsedColumnExpandOnDrag', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('schedules expand once and clears pending timer', () => {
    vi.useFakeTimers()
    const expand = vi.fn()
    const helper = createCollapsedColumnExpandOnDrag({
      shouldSchedule: () => true,
      shouldExpand: () => true,
      expand,
      delayMs: COLUMN_DRAG_EXPAND_DELAY_MS,
    })

    helper.schedule()
    helper.schedule()
    expect(expand).not.toHaveBeenCalled()

    vi.advanceTimersByTime(COLUMN_DRAG_EXPAND_DELAY_MS)
    expect(expand).toHaveBeenCalledTimes(1)

    helper.schedule()
    helper.clear()
    vi.advanceTimersByTime(COLUMN_DRAG_EXPAND_DELAY_MS)
    expect(expand).toHaveBeenCalledTimes(1)
  })

  test('skips when shouldSchedule or shouldExpand is false', () => {
    vi.useFakeTimers()
    const expand = vi.fn()
    let allowSchedule = false
    let allowExpand = true
    const helper = createCollapsedColumnExpandOnDrag({
      shouldSchedule: () => allowSchedule,
      shouldExpand: () => allowExpand,
      expand,
      delayMs: 100,
    })

    helper.schedule()
    vi.advanceTimersByTime(100)
    expect(expand).not.toHaveBeenCalled()

    allowSchedule = true
    helper.schedule()
    allowExpand = false
    vi.advanceTimersByTime(100)
    expect(expand).not.toHaveBeenCalled()
  })
})
