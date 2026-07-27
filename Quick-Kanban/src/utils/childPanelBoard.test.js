import {
  CHILD_LIST_ID_BASE,
  CHILD_PANEL_COLUMN_TINT_STEP,
  buildEmptyChildColumns,
  childPanelColumnTintStrength,
  childPanelColumnTintValue,
  childPanelDragGroupName,
  childPanelKey,
  createChildColumnPagination,
  decodeChildListId,
  encodeChildListId,
  getSortableDndInstance,
  isChildListId,
  resolveChildPanelDropTarget,
  resolveChildPanelSpacerHeight,
  resolvePanelHostCard,
  resolvePanelHostSpacer,
  setSortableNearestParticipation,
  measureVisibleColumnsContentWidth,
  mergeHostPinScrollSnapshots,
  resolveChildPanelHostWidth,
  shouldRememberHostPinScroll,
  stabilizeCollapsedHostPanelRect,
  stabilizeHostPanelRectOnColumnToggle,
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

  test('childPanelDragGroupName isolates child scopes from the board by ordinal', () => {
    expect(childPanelDragGroupName(null)).toBe('kanban')
    expect(childPanelDragGroupName('')).toBe('kanban')
    expect(childPanelDragGroupName('0::TASK-1')).toBe('kanban')
    expect(childPanelDragGroupName(0)).toBe('kanban-child-0')
    expect(childPanelDragGroupName(2)).toBe('kanban-child-2')
    expect(childPanelDragGroupName(-1)).toBe('kanban-child--1')
  })

  test('setSortableNearestParticipation toggles emptyInsertThreshold', () => {
    const option = vi.fn()
    const el = { Sortable123: { option } }
    expect(getSortableDndInstance(el)).toBe(el.Sortable123)
    expect(setSortableNearestParticipation(el, false)).toBe(true)
    expect(option).toHaveBeenCalledWith('emptyInsertThreshold', null)
    expect(setSortableNearestParticipation(el, true)).toBe(true)
    expect(option).toHaveBeenCalledWith('emptyInsertThreshold', 0)
    expect(setSortableNearestParticipation({}, true)).toBe(false)
  })

  test('resolveChildPanelDropTarget accepts same-scope child list drops', () => {
    const scopeId = '0::PARENT'
    const childPanels = { [scopeId]: { ordinal: 1, columns: [{}, {}] } }
    const fromId = encodeChildListId(1, 0)
    const toId = encodeChildListId(1, 1)
    expect(resolveChildPanelDropTarget({
      toId,
      fromId,
      contextChildScopeId: scopeId,
      childPanels,
    })).toEqual({
      ok: true,
      childScopeId: scopeId,
      fromColumn: 0,
      toColumn: 1,
      sameColumn: false,
    })
  })

  test('resolveChildPanelDropTarget rejects board list targets', () => {
    const scopeId = '0::PARENT'
    const childPanels = { [scopeId]: { ordinal: 1, columns: [{}, {}] } }
    const result = resolveChildPanelDropTarget({
      toId: 1,
      fromId: encodeChildListId(1, 0),
      contextChildScopeId: scopeId,
      contextFromColumn: 0,
      childPanels,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('non_child_target')
    expect(result.childScopeId).toBe(scopeId)
    expect(result.fromColumn).toBe(0)
  })

  test('resolveChildPanelDropTarget rejects cross-scope child drops', () => {
    const scopeId = '0::PARENT'
    const childPanels = {
      [scopeId]: { ordinal: 1, columns: [{}, {}] },
      '1::NESTED': { ordinal: 2, columns: [{}, {}] },
    }
    const result = resolveChildPanelDropTarget({
      toId: encodeChildListId(2, 1),
      fromId: encodeChildListId(1, 0),
      contextChildScopeId: scopeId,
      childPanels,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('scope_mismatch')
  })

  test('resolveChildPanelDropTarget marks same-column drops', () => {
    const scopeId = '0::PARENT'
    const childPanels = { [scopeId]: { ordinal: 0, columns: [{}] } }
    const id = encodeChildListId(0, 0)
    expect(resolveChildPanelDropTarget({
      toId: id,
      fromId: id,
      contextChildScopeId: scopeId,
      childPanels,
    })).toMatchObject({
      ok: true,
      sameColumn: true,
      fromColumn: 0,
      toColumn: 0,
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

  test('shouldRememberHostPinScroll rejects bare zero unless near top', () => {
    expect(shouldRememberHostPinScroll({ scrollTop: 120 })).toBe(true)
    expect(shouldRememberHostPinScroll({ scrollTop: 0, hostNearTop: false })).toBe(false)
    expect(shouldRememberHostPinScroll({ scrollTop: 0, hostNearTop: true })).toBe(true)
  })

  test('mergeHostPinScrollSnapshots prefers live scroll then last-good', () => {
    const captured = [
      { parentName: 'TASK-A', depth: 0, hostLaneKey: null, scrollTop: 0 },
      { parentName: 'TASK-B', depth: 1, hostLaneKey: null, scrollTop: 40 },
    ]
    const lastGood = [
      { parentName: 'TASK-A', depth: 0, hostLaneKey: null, scrollTop: 220 },
      { parentName: 'TASK-C', depth: 0, hostLaneKey: null, scrollTop: 80 },
    ]
    expect(mergeHostPinScrollSnapshots({
      captured,
      lastGood,
      excludeParentName: 'TASK-B',
    })).toEqual([
      { parentName: 'TASK-A', depth: 0, hostLaneKey: null, scrollTop: 220 },
      { parentName: 'TASK-C', depth: 0, hostLaneKey: null, scrollTop: 80 },
    ])
    expect(mergeHostPinScrollSnapshots({
      captured,
      lastGood,
    })).toEqual([
      { parentName: 'TASK-A', depth: 0, hostLaneKey: null, scrollTop: 220 },
      { parentName: 'TASK-B', depth: 1, hostLaneKey: null, scrollTop: 40 },
      { parentName: 'TASK-C', depth: 0, hostLaneKey: null, scrollTop: 80 },
    ])
  })

  test('resolveChildPanelHostWidth sums tracks and gutters', () => {
    expect(resolveChildPanelHostWidth({
      columnWidthsPx: [280, 280, 52],
      gutterPx: 8,
    })).toBe(280 + 8 + 280 + 8 + 52)
    expect(resolveChildPanelHostWidth({
      columnWidthsPx: [300],
      gutterPx: 8,
    })).toBe(300)
    expect(resolveChildPanelHostWidth({
      columnWidthsPx: [],
      gutterPx: 8,
    })).toBe(0)
    expect(resolveChildPanelHostWidth({
      columnWidthsPx: [52, 280, 0, null, 52],
      gutterPx: 8,
    })).toBe(52 + 8 + 280 + 8 + 52)
  })

  test('measureVisibleColumnsContentWidth spans first to last column', () => {
    const board = document.createElement('div')
    board.className = 'kanban'
    const makeCol = (left, width) => {
      const el = document.createElement('div')
      el.className = 'kanban-column'
      el.getBoundingClientRect = () => ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 100,
        height: 100,
        x: left,
        y: 0,
        toJSON() { return {} },
      })
      return el
    }
    board.appendChild(makeCol(0, 280))
    board.appendChild(makeCol(288, 52))
    const add = document.createElement('div')
    add.className = 'add-column-control'
    add.getBoundingClientRect = () => ({
      left: 400,
      right: 520,
      width: 120,
      top: 0,
      bottom: 40,
      height: 40,
      x: 400,
      y: 0,
      toJSON() { return {} },
    })
    board.appendChild(add)
    expect(measureVisibleColumnsContentWidth(board, { swimlanesEnabled: false })).toBe(340)
  })

  test('stabilizeHostPanelRectOnColumnToggle freezes top/height on flat collapsed host', () => {
    const previousRect = { top: 120, left: 0, width: 900, height: 400 }
    const nextRect = { top: 40, left: 0, width: 800, height: 520 }
    const { rect, verticalFrozen } = stabilizeHostPanelRectOnColumnToggle({
      previousRect,
      nextRect,
      hostColumnCollapsed: true,
      swimlanesEnabled: false,
    })
    expect(verticalFrozen).toBe(true)
    expect(rect).toEqual({ top: 120, left: 0, width: 800, height: 400 })
  })

  test('stabilizeHostPanelRectOnColumnToggle freezes on verticalLock or hostMissing', () => {
    const previousRect = { top: 120, left: 0, width: 900, height: 400 }
    const nextRect = { top: 40, left: 0, width: 800, height: 520 }
    expect(stabilizeHostPanelRectOnColumnToggle({
      previousRect,
      nextRect,
      verticalLock: true,
      swimlanesEnabled: false,
    })).toEqual({
      rect: { top: 120, left: 0, width: 800, height: 400 },
      verticalFrozen: true,
    })
    expect(stabilizeHostPanelRectOnColumnToggle({
      previousRect,
      nextRect,
      hostMissing: true,
      swimlanesEnabled: false,
    })).toEqual({
      rect: { top: 120, left: 0, width: 800, height: 400 },
      verticalFrozen: true,
    })
  })

  test('stabilizeHostPanelRectOnColumnToggle does not freeze when expanded or swimlane', () => {
    const previousRect = { top: 120, left: 0, width: 900, height: 400 }
    const nextRect = { top: 40, left: 0, width: 800, height: 520 }
    expect(stabilizeHostPanelRectOnColumnToggle({
      previousRect,
      nextRect,
      hostColumnCollapsed: false,
      swimlanesEnabled: false,
    })).toEqual({ rect: nextRect, verticalFrozen: false })
    expect(stabilizeHostPanelRectOnColumnToggle({
      previousRect,
      nextRect,
      hostColumnCollapsed: true,
      verticalLock: true,
      hostMissing: true,
      swimlanesEnabled: true,
    })).toEqual({ rect: nextRect, verticalFrozen: false })
    expect(stabilizeHostPanelRectOnColumnToggle({
      previousRect: null,
      nextRect,
      hostColumnCollapsed: true,
      swimlanesEnabled: false,
    })).toEqual({ rect: nextRect, verticalFrozen: false })
    // Deprecated alias still freezes collapsed hosts.
    expect(stabilizeCollapsedHostPanelRect({
      previousRect,
      nextRect,
      hostColumnCollapsed: true,
      swimlanesEnabled: false,
    }).verticalFrozen).toBe(true)
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

  test('resolvePanelHostCard prefers matching swimlane hostLaneKey at depth 0', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="kanban">
        <section class="swimlane-lane" data-lane-key="alice">
          <div class="kanban-card" data-card-name="TASK-DUP" id="host-alice"></div>
          <div class="child-panel-spacer" data-panel-parent="TASK-DUP" id="spacer-alice"></div>
        </section>
        <section class="swimlane-lane" data-lane-key="bob">
          <div class="kanban-card" data-card-name="TASK-DUP" id="host-bob"></div>
          <div class="child-panel-spacer" data-panel-parent="TASK-DUP" id="spacer-bob"></div>
        </section>
      </div>
    `
    expect(resolvePanelHostCard(root, 'TASK-DUP', 0, 'bob')?.id).toBe('host-bob')
    expect(resolvePanelHostCard(root, 'TASK-DUP', 0, 'alice')?.id).toBe('host-alice')
    // Unknown lane falls back to first board instance.
    expect(resolvePanelHostCard(root, 'TASK-DUP', 0, 'carol')?.id).toBe('host-alice')
    expect(resolvePanelHostSpacer(root, 'TASK-DUP', 0, 'bob')?.id).toBe('spacer-bob')
  })
})
