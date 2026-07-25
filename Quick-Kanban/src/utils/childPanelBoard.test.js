import {
  CHILD_LIST_ID_BASE,
  CHILD_PANEL_COLUMN_TINT_STEP,
  buildEmptyChildColumns,
  childPanelColumnTintStrength,
  childPanelColumnTintValue,
  childPanelKey,
  createChildColumnPagination,
  decodeChildListId,
  encodeChildListId,
  isChildListId,
  resolveChildPanelSpacerHeight,
} from './childPanelBoard.js'

describe('childPanelBoard', () => {
  test('encode/decode child list ids above swimlane range', () => {
    const id = encodeChildListId(2, 5)
    expect(id).toBe(CHILD_LIST_ID_BASE + 20000 + 5)
    expect(isChildListId(id)).toBe(true)
    expect(isChildListId(10000)).toBe(false)
    expect(decodeChildListId(id)).toEqual({
      scopeOrdinal: 2,
      columnIndex: 5,
    })
  })

  test('childPanelKey and empty columns', () => {
    expect(childPanelKey('TASK-1', 0)).toBe('0::TASK-1')
    const columns = buildEmptyChildColumns([
      { column_name: 'Open', indicator: 'blue' },
      { column_name: 'Closed', indicator: 'green' },
    ])
    expect(columns).toHaveLength(2)
    expect(columns[0].cards).toEqual([])
    const pagination = createChildColumnPagination(columns, true)
    expect(pagination.Open.hasMore).toBe(true)
    expect(pagination.Open.offset).toBe(0)
  })

  test('childPanelColumnTintStrength stacks swimlane and depth steps', () => {
    expect(CHILD_PANEL_COLUMN_TINT_STEP).toBe(8)
    expect(childPanelColumnTintStrength(0, false)).toBe(8)
    expect(childPanelColumnTintStrength(0, true)).toBe(16)
    expect(childPanelColumnTintStrength(1, false)).toBe(16)
    expect(childPanelColumnTintStrength(1, true)).toBe(24)
    expect(childPanelColumnTintValue(0, false)).toContain('8%')
    expect(childPanelColumnTintValue(0, true)).toContain('16%')
    expect(childPanelColumnTintValue(1, false)).toContain('16%')
  })

  test('resolveChildPanelSpacerHeight fills viewport below inset and host', () => {
    expect(resolveChildPanelSpacerHeight({
      scrollerClientHeight: 800,
      topInset: 100,
      hostHeight: 48,
    })).toBe(652)
    // Independent of current Y — bottom-of-column hosts get the same pad.
    expect(resolveChildPanelSpacerHeight({
      scrollerClientHeight: 600,
      topInset: 64,
      hostHeight: 40,
    })).toBe(496)
    expect(resolveChildPanelSpacerHeight({
      scrollerClientHeight: 100,
      topInset: 80,
      hostHeight: 40,
    })).toBe(0)
  })
})
