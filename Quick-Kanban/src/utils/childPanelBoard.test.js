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
  resolvePanelHostCard,
  resolvePanelHostSpacer,
} from './childPanelBoard.js'

function buildDuplicateHostDom() {
  const root = document.createElement('div')
  root.innerHTML = `
    <div class="kanban">
      <div class="kanban-card" data-card-name="TASK-L2" id="board-l2"></div>
      <div class="child-panel-spacer" data-panel-parent="TASK-L2" id="board-spacer-l2"></div>
      <div class="child-panel" data-child-depth="0" id="panel-0">
        <div class="kanban-card" data-card-name="TASK-L1" id="panel-l1"></div>
        <div class="child-panel-spacer" data-panel-parent="TASK-L1" id="panel-spacer-l1"></div>
        <div class="kanban-card" data-card-name="TASK-L2" id="panel-l2"></div>
        <div class="child-panel-spacer" data-panel-parent="TASK-L2" id="panel-spacer-l2"></div>
      </div>
      <div class="child-panel" data-child-depth="1" id="panel-1">
        <div class="kanban-card" data-card-name="TASK-L2" id="nested-l2"></div>
        <div class="child-panel-spacer" data-panel-parent="TASK-L2" id="nested-spacer-l2"></div>
      </div>
      <div class="kanban-card" data-card-name="TASK-L0" id="board-l0"></div>
      <div class="child-panel-spacer" data-panel-parent="TASK-L0" id="board-spacer-l0"></div>
    </div>
  `
  return root
}

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

  test('resolvePanelHostCard prefers board instance at depth 0', () => {
    const root = buildDuplicateHostDom()
    expect(resolvePanelHostCard(root, 'TASK-L0', 0)?.id).toBe('board-l0')
    // Board duplicate for L2 must win at depth 0, not the in-panel copy.
    expect(resolvePanelHostCard(root, 'TASK-L2', 0)?.id).toBe('board-l2')
  })

  test('resolvePanelHostCard scopes nested depths away from board duplicates', () => {
    const root = buildDuplicateHostDom()
    // Depth 1 host lives in panel depth 0.
    expect(resolvePanelHostCard(root, 'TASK-L1', 1)?.id).toBe('panel-l1')
    // Depth 2 host: parent panel is depth 1 — never the board duplicate.
    expect(resolvePanelHostCard(root, 'TASK-L2', 2)?.id).toBe('nested-l2')
    // Depth 1 looking up L2 (host inside panel 0, before depth-1 panel exists).
    expect(resolvePanelHostCard(root, 'TASK-L2', 1)?.id).toBe('panel-l2')
  })

  test('resolvePanelHostSpacer follows the same depth scope as cards', () => {
    const root = buildDuplicateHostDom()
    expect(resolvePanelHostSpacer(root, 'TASK-L0', 0)?.id).toBe('board-spacer-l0')
    expect(resolvePanelHostSpacer(root, 'TASK-L2', 0)?.id).toBe('board-spacer-l2')
    expect(resolvePanelHostSpacer(root, 'TASK-L1', 1)?.id).toBe('panel-spacer-l1')
    expect(resolvePanelHostSpacer(root, 'TASK-L2', 2)?.id).toBe('nested-spacer-l2')
  })
})
