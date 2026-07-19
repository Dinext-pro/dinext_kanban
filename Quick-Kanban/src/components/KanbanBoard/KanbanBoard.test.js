import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createKanbanStore } from '../../utils/store'
import KanbanBoard from './KanbanBoard.vue'

const prefersReducedMotion = vi.fn(() => true)

vi.mock('../../utils/cardRollbackAnimation', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    animateCardRollback: vi.fn(() => Promise.resolve(true)),
    captureCardRect: vi.fn(() => ({
      left: 420,
      top: 240,
      width: 180,
      height: 96,
    })),
    prefersReducedMotion: () => prefersReducedMotion(),
  }
})
vi.mock('../../utils/cardMoveFlash', () => ({
  flashMovedCard: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../../utils/columnSortable', () => ({
  createColumnSortable: vi.fn(() => ({ destroy: vi.fn() })),
  destroyColumnSortable: vi.fn(),
}))
import {
  animateCardRollback,
  captureCardRect,
} from '../../utils/cardRollbackAnimation'
import { flashMovedCard } from '../../utils/cardMoveFlash'
import { createColumnSortable } from '../../utils/columnSortable'

function mountBoard() {
  const store = createKanbanStore()
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue()
  const wrapper = mount(KanbanBoard, {
    global: {
      plugins: [store],
      stubs: {
        KanbanColumn: {
          name: 'KanbanColumn',
          props: ['column'],
          template: '<section class="kanban-column column-stub" :data-column-value="column.column_name">{{ column.column_name }}</section>',
        },
      },
    },
  })
  return { store, dispatch, wrapper }
}

beforeEach(() => {
  frappe.get_route.mockReturnValue(['List', 'Task', 'Kanban', 'First Board'])
  frappe.realtime.doctype_subscribe.mockReset()
  frappe.realtime.doctype_unsubscribe.mockReset()
  frappe.realtime.on.mockReset()
  frappe.realtime.off.mockReset()
  animateCardRollback.mockClear()
  captureCardRect.mockClear()
  flashMovedCard.mockClear()
  createColumnSortable.mockClear()
  prefersReducedMotion.mockReturnValue(true)
})

afterEach(() => {
  delete window.refreshKanbanBoard
  delete window.hydrateQuickKanban
  delete window.quickKanbanInitialData
})

test('loads the board from the current route and refreshes a changed route', async () => {
  const { dispatch, wrapper } = mountBoard()

  expect(dispatch).toHaveBeenCalledWith('refreshBoard', expect.objectContaining({
    board_name: 'First Board',
  }))

  frappe.get_route.mockReturnValue(['List', 'Task', 'Kanban', 'Second Board'])
  await window.refreshKanbanBoard({ doctype: 'Task' })

  expect(dispatch).toHaveBeenLastCalledWith('refreshBoard', {
    board_name: 'Second Board',
    args: { doctype: 'Task' },
    forceConfig: false,
  })
  wrapper.unmount()
})

test('uses native Frappe data then fetches totals and tops up columns', async () => {
  const initialData = {
    board: { name: 'First Board', columns: [] },
    cards: [],
    args: { page_length: 100 },
  }
  window.quickKanbanInitialData = initialData
  const { dispatch, wrapper } = mountBoard()
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3))

  expect(dispatch).toHaveBeenCalledWith('hydrateFromList', initialData)
  expect(dispatch).toHaveBeenCalledWith('fetchColumnTotals', {
    args: initialData.args,
  })
  expect(dispatch).toHaveBeenCalledWith('topUpInitialColumns', {
    args: initialData.args,
  })
  wrapper.unmount()
})

test('does not fetch totals for an obsolete hydration', async () => {
  const { dispatch, wrapper } = mountBoard()
  dispatch.mockClear()
  let resolveFirst
  const firstHydration = new Promise((resolve) => {
    resolveFirst = resolve
  })
  let hydrationCalls = 0
  dispatch.mockImplementation((action) => {
    if (action === 'hydrateFromList' && hydrationCalls++ === 0) {
      return firstHydration
    }
    return Promise.resolve()
  })

  const first = window.hydrateQuickKanban({
    board: { name: 'Old Board', columns: [] },
    cards: [],
    args: { filters: [['priority', '=', 'Low']] },
  })
  const second = window.hydrateQuickKanban({
    board: { name: 'New Board', columns: [] },
    cards: [],
    args: { filters: [['priority', '=', 'High']] },
  })
  await second
  resolveFirst()
  await first

  expect(dispatch).toHaveBeenCalledWith('fetchColumnTotals', {
    args: { filters: [['priority', '=', 'High']] },
  })
  expect(dispatch).not.toHaveBeenCalledWith('fetchColumnTotals', {
    args: { filters: [['priority', '=', 'Low']] },
  })
  expect(dispatch).toHaveBeenCalledWith('topUpInitialColumns', {
    args: { filters: [['priority', '=', 'High']] },
  })
  expect(dispatch).not.toHaveBeenCalledWith('topUpInitialColumns', {
    args: { filters: [['priority', '=', 'Low']] },
  })
  wrapper.unmount()
})

test('does not top up a hydration superseded by a refresh', async () => {
  const { dispatch, wrapper } = mountBoard()
  dispatch.mockClear()
  let resolveTotals
  const pendingTotals = new Promise((resolve) => {
    resolveTotals = resolve
  })
  dispatch.mockImplementation((action) => {
    if (action === 'fetchColumnTotals') return pendingTotals
    return Promise.resolve()
  })

  const hydration = window.hydrateQuickKanban({
    board: { name: 'Old Board', columns: [] },
    cards: [],
    args: { filters: [['priority', '=', 'Low']] },
  })
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith(
    'fetchColumnTotals',
    { args: { filters: [['priority', '=', 'Low']] } },
  ))
  await window.refreshKanbanBoard({
    filters: [['priority', '=', 'High']],
  })
  resolveTotals()
  await hydration

  expect(dispatch).not.toHaveBeenCalledWith('topUpInitialColumns', {
    args: { filters: [['priority', '=', 'Low']] },
  })
  wrapper.unmount()
})

test('renders explicit error and live announcement states without a loading banner', async () => {
  const { store, wrapper } = mountBoard()

  store.commit('SET_LOADING', true)
  await wrapper.vm.$nextTick()
  expect(wrapper.text()).not.toContain('Loading Kanban board')
  expect(wrapper.find('.loading-indicator').exists()).toBe(false)

  store.commit('SET_LOADING', false)
  store.commit('SET_ERROR', 'Network unavailable')
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[role="alert"]').text()).toContain('Network unavailable')

  store.commit('SET_ANNOUNCEMENT', 'Card moved to Done')
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[aria-live="polite"]').text()).toContain('Card moved to Done')
  wrapper.unmount()
})

test('does not render a global pagination banner', async () => {
  const { wrapper } = mountBoard()

  expect(wrapper.text()).not.toContain('Showing 100 matching cards')
  expect(wrapper.find('[aria-label="Load more Kanban cards"]').exists()).toBe(false)
  wrapper.unmount()
})

test('uses the native list realtime lifecycle without adding a duplicate listener', () => {
  const { wrapper } = mountBoard()

  expect(frappe.realtime.doctype_subscribe).not.toHaveBeenCalled()
  expect(frappe.realtime.on).not.toHaveBeenCalled()

  expect(() => wrapper.unmount()).not.toThrow()
  expect(frappe.realtime.off).not.toHaveBeenCalled()
  expect(frappe.realtime.doctype_unsubscribe).not.toHaveBeenCalled()
})

test('persists the destination drop emitted by the virtual list', async () => {
  const { store, dispatch, wrapper } = mountBoard()
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', cards: [] },
    { name: 'done', column_name: 'Done', cards: [{ name: 'TASK-1' }] },
  ])
  await wrapper.vm.$nextTick()
  const columns = wrapper.findAllComponents({ name: 'KanbanColumn' })

  columns[0].vm.$emit('dragstart', {
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 2,
  })
  expect(store.getters.activeDragCard?.cardName).toBe('TASK-1')

  columns[1].vm.$emit('drop', {
    oldIndex: 0,
    newIndex: 0,
    event: { from: { id: '0' }, to: { id: '1' } },
  })
  await wrapper.vm.$nextTick()

  expect(dispatch).toHaveBeenCalledWith('persistMovedCard', {
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 2,
    toColumn: 1,
    toIndex: 0,
  })
  expect(store.getters.activeDragCard).toBeNull()
  wrapper.unmount()
})

test('clears active drag on same-column drop and pointer release', async () => {
  const { store, dispatch, wrapper } = mountBoard()
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', cards: [{ name: 'TASK-1' }] },
    { name: 'done', column_name: 'Done', cards: [] },
  ])
  await wrapper.vm.$nextTick()
  const columns = wrapper.findAllComponents({ name: 'KanbanColumn' })

  columns[0].vm.$emit('dragstart', {
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 0,
  })
  columns[0].vm.$emit('drop', {
    oldIndex: 1,
    newIndex: 0,
    event: { to: { id: '0' } },
  })
  await wrapper.vm.$nextTick()

  expect(dispatch).not.toHaveBeenCalledWith('persistMovedCard', expect.anything())
  expect(store.getters.activeDragCard).toBeNull()

  columns[0].vm.$emit('dragstart', {
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 0,
  })
  document.dispatchEvent(new PointerEvent('pointerup'))
  await wrapper.vm.$nextTick()
  expect(store.getters.activeDragCard).toBeNull()
  wrapper.unmount()
})

test('capture pointerup completes swimlane append drop before bubble clear', async () => {
  const previousPermissive = globalThis.__quickKanbanPermissiveMoves
  globalThis.__quickKanbanPermissiveMoves = true
  const store = createKanbanStore()
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    board_name: 'Swim Board',
    ref_doctype: 'Task',
    field_name: 'status',
    swimlane_field: 'project',
    swimlane_mode: 'field',
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', display_name: 'Open', cards: [] },
    { name: 'done', column_name: 'Done', display_name: 'Done', cards: [] },
  ])
  store.commit('SET_LANES', [
    {
      key: 'lane-a',
      label: 'Lane A',
      columns: [
        {
          name: 'open',
          column_name: 'Open',
          display_name: 'Open',
          cards: [{ name: 'TASK-1' }],
        },
        {
          name: 'done',
          column_name: 'Done',
          display_name: 'Done',
          cards: [{ name: 'TASK-EXISTING' }],
        },
      ],
    },
  ])
  store.commit('SET_EXPANDED_LANE_KEYS', ['lane-a'])
  store.commit('SET_BOARD_PERMS', { write: true })

  const wrapper = mount(KanbanBoard, {
    global: {
      plugins: [store],
      stubs: {
        VirtualList: {
          name: 'VirtualList',
          props: ['scroller', 'id'],
          template: `
            <div class="virtual-list-stub" :id="id">
              <slot />
              <slot name="footer" />
            </div>
          `,
        },
      },
    },
  })
  try {
    await vi.waitFor(() =>
      expect(wrapper.findAll('.column-stick-room-dropzone').length).toBeGreaterThan(0),
    )

    const rows = wrapper.findAllComponents({ name: 'SwimlaneRow' })
    rows[0].vm.$emit('dragstart', {
      cardName: 'TASK-1',
      fromColumn: 0,
      fromIndex: 0,
      fromLaneIndex: 0,
      fromLaneKey: 'lane-a',
    })
    expect(store.getters.activeDragCard?.cardName).toBe('TASK-1')

    const cells = wrapper.findAll('.kanban-column--cell')
    const targetCell = cells[1]?.element || cells[0]?.element
    const zone = targetCell.querySelector('.column-stick-room-dropzone')
    const list = targetCell.querySelector('.kanban-card-list')
    expect(zone).toBeTruthy()
    expect(list?.id).toBeTruthy()
    // Destination must be column 1
    list.id = '1'
    document.elementsFromPoint = vi.fn(() => [zone, targetCell])

    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      clientX: 12,
      clientY: 34,
      button: 0,
    }))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(store.state.lanes[0].columns[1].cards.map((c) => c.name)).toEqual([
      'TASK-1',
      'TASK-EXISTING',
    ])
    expect(dispatch).toHaveBeenCalledWith(
      'persistMovedCardToCell',
      expect.objectContaining({
        cardName: 'TASK-1',
        fromLaneIndex: 0,
        toLaneIndex: 0,
        fromColumn: 0,
        toColumn: 1,
        toIndex: 0,
      }),
    )
    expect(store.getters.activeDragCard).toBeNull()
    delete document.elementsFromPoint
  } finally {
    globalThis.__quickKanbanPermissiveMoves = previousPermissive
    wrapper.unmount()
  }
})

test('plays rollback animation after a failed drag drop', async () => {
  const { store, dispatch, wrapper } = mountBoard()
  dispatch.mockImplementation((action) => {
    if (action === 'persistMovedCard') {
      return Promise.resolve({
        ok: false,
        needsAnimatedRollback: true,
        preflight: { reason: 'workflow_denied' },
      })
    }
    return Promise.resolve()
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', cards: [{ name: 'TASK-1' }] },
    { name: 'done', column_name: 'Done', cards: [] },
  ])
  await wrapper.vm.$nextTick()
  const columns = wrapper.findAllComponents({ name: 'KanbanColumn' })

  columns[0].vm.$emit('dragstart', {
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 0,
  })
  columns[1].vm.$emit('drop', {
    oldIndex: 0,
    newIndex: 0,
    event: { from: { id: '0' }, to: { id: '1' } },
  })
  await vi.waitFor(() => expect(animateCardRollback).toHaveBeenCalled())

  expect(captureCardRect).toHaveBeenCalledWith('TASK-1', expect.anything())
  expect(animateCardRollback).toHaveBeenCalledWith(
    'TASK-1',
    expect.objectContaining({ left: 420, top: 240 }),
    expect.objectContaining({ root: expect.anything() }),
  )
  await vi.waitFor(() => expect(flashMovedCard).toHaveBeenCalledWith(
    'TASK-1',
    { outcome: 'failure' },
  ))
  wrapper.unmount()
})

test('flashes the card after a successful drag drop', async () => {
  const { store, dispatch, wrapper } = mountBoard()
  dispatch.mockImplementation((action) => {
    if (action === 'persistMovedCard') {
      return Promise.resolve({ ok: true })
    }
    return Promise.resolve()
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', cards: [{ name: 'TASK-1' }] },
    { name: 'done', column_name: 'Done', cards: [] },
  ])
  await wrapper.vm.$nextTick()
  const columns = wrapper.findAllComponents({ name: 'KanbanColumn' })

  columns[0].vm.$emit('dragstart', {
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 0,
  })
  columns[1].vm.$emit('drop', {
    oldIndex: 0,
    newIndex: 0,
    event: { from: { id: '0' }, to: { id: '1' } },
  })
  await vi.waitFor(() => expect(flashMovedCard).toHaveBeenCalledWith(
    'TASK-1',
    { outcome: 'success' },
  ))
  expect(animateCardRollback).not.toHaveBeenCalled()
  wrapper.unmount()
})

test('expands collapsed destination column after a successful drag drop', async () => {
  const { store, dispatch, wrapper } = mountBoard()
  dispatch.mockImplementation((action) => {
    if (action === 'persistMovedCard') {
      return Promise.resolve({ ok: true })
    }
    return Promise.resolve()
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', cards: [{ name: 'TASK-1' }] },
    { name: 'done', column_name: 'Done', cards: [] },
  ])
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Done', collapsed: true })
  expect(store.getters.isColumnCollapsed('Done')).toBe(true)
  await wrapper.vm.$nextTick()
  const columns = wrapper.findAllComponents({ name: 'KanbanColumn' })

  columns[0].vm.$emit('dragstart', {
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 0,
  })
  columns[1].vm.$emit('drop', {
    oldIndex: 0,
    newIndex: 0,
    event: { from: { id: '0' }, to: { id: '1' } },
  })
  await vi.waitFor(() => expect(flashMovedCard).toHaveBeenCalledWith(
    'TASK-1',
    { outcome: 'success' },
  ))
  expect(store.getters.isColumnCollapsed('Done')).toBe(false)
  wrapper.unmount()
})

test('does not expand destination column after a failed drag drop', async () => {
  const { store, dispatch, wrapper } = mountBoard()
  dispatch.mockImplementation((action) => {
    if (action === 'persistMovedCard') {
      return Promise.resolve({
        ok: false,
        needsAnimatedRollback: true,
        preflight: { reason: 'workflow_denied' },
      })
    }
    return Promise.resolve()
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', cards: [{ name: 'TASK-1' }] },
    { name: 'done', column_name: 'Done', cards: [] },
  ])
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Done', collapsed: true })
  await wrapper.vm.$nextTick()
  const columns = wrapper.findAllComponents({ name: 'KanbanColumn' })

  columns[0].vm.$emit('dragstart', {
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 0,
  })
  columns[1].vm.$emit('drop', {
    oldIndex: 0,
    newIndex: 0,
    event: { from: { id: '0' }, to: { id: '1' } },
  })
  await vi.waitFor(() => expect(flashMovedCard).toHaveBeenCalledWith(
    'TASK-1',
    { outcome: 'failure' },
  ))
  expect(store.getters.isColumnCollapsed('Done')).toBe(true)
  wrapper.unmount()
})

test('enables column reordering when board write access is granted', async () => {
  window.quickKanbanInitialData = {
    board: {
      name: 'Task Board',
      reference_doctype: 'Task',
      field_name: 'status',
      columns: [
        { name: 'open', column_name: 'Open' },
        { name: 'done', column_name: 'Done' },
      ],
    },
    cards: [],
    args: { page_length: 100 },
    board_perms: { write: true },
  }
  frappe.call.mockResolvedValue({ message: {} })
  const store = createKanbanStore()
  const wrapper = mount(KanbanBoard, {
    global: {
      plugins: [store],
      stubs: {
        KanbanColumn: {
          name: 'KanbanColumn',
          props: ['column'],
          template: '<section class="kanban-column column-stub" :data-column-value="column.column_name">{{ column.column_name }}</section>',
        },
      },
    },
  })
  await vi.waitFor(() => expect(createColumnSortable).toHaveBeenCalled())
  wrapper.unmount()
})

test('does not enable column reordering without board write access', async () => {
  window.quickKanbanInitialData = {
    board: {
      name: 'Task Board',
      reference_doctype: 'Task',
      field_name: 'status',
      columns: [
        { name: 'open', column_name: 'Open' },
        { name: 'done', column_name: 'Done' },
      ],
    },
    cards: [],
    args: { page_length: 100 },
    board_perms: { write: false },
  }
  frappe.call.mockResolvedValue({ message: {} })
  const store = createKanbanStore()
  const wrapper = mount(KanbanBoard, {
    global: {
      plugins: [store],
      stubs: {
        KanbanColumn: {
          name: 'KanbanColumn',
          props: ['column'],
          template: '<section class="kanban-column column-stub" :data-column-value="column.column_name">{{ column.column_name }}</section>',
        },
      },
    },
  })
  await vi.waitFor(() => expect(store.state.columns.length).toBe(2))
  expect(createColumnSortable).not.toHaveBeenCalled()
  wrapper.unmount()
})

test('swimlane mode renders row-major lanes with shared column tracks', async () => {
  const store = createKanbanStore()
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    board_name: 'Swim Board',
    ref_doctype: 'Task',
    field_name: 'status',
    fields: ['name', 'status', 'project'],
    swimlane_field: 'project',
    swimlane_mode: 'field',
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', indicator: 'blue', custom_column_width: 280, cards: [] },
    { name: 'done', column_name: 'Done', indicator: 'green', custom_column_width: 320, cards: [] },
  ])
  store.commit('SET_LANES', [
    {
      key: 'alpha',
      label: 'Alpha',
      columns: [
        { name: 'open', column_name: 'Open', cards: [{ name: 'T1' }] },
        { name: 'done', column_name: 'Done', cards: [] },
      ],
    },
    {
      key: 'beta',
      label: 'Beta',
      columns: [
        { name: 'open', column_name: 'Open', cards: [] },
        { name: 'done', column_name: 'Done', cards: [{ name: 'T2' }] },
      ],
    },
  ])
  store.commit('SET_CELL_TOTALS', {
    alpha: { Open: 1, Done: 0 },
    beta: { Open: 0, Done: 1 },
  })
  store.commit('SET_EXPANDED_LANE_KEYS', ['alpha'])
  store.commit('SET_BOARD_PERMS', { write: true })

  const wrapper = mount(KanbanBoard, {
    global: {
      plugins: [store],
      stubs: {
        VirtualList: {
          name: 'VirtualList',
          props: ['scroller'],
          template: '<div class="virtual-list-stub" :data-has-scroller="Boolean(scroller)"><slot name="footer" /></div>',
        },
      },
    },
  })

  await vi.waitFor(() => expect(wrapper.find('.kanban--swimlanes').exists()).toBe(true))
  expect(wrapper.find('.swimlane-board-content').exists()).toBe(true)
  expect(wrapper.find('.swimlane-header-row').exists()).toBe(true)
  expect(wrapper.findAll('.swimlane-lane').length).toBe(2)
  expect(wrapper.find('.swimlane-lane--last').exists()).toBe(true)
  expect(wrapper.findAll('.swimlane-lane-sticky').length).toBe(2)
  expect(wrapper.findAll('.swimlane-chrome-row').length).toBe(2)
  expect(
    wrapper.findAll('.swimlane-lane[data-lane-key="alpha"] .swimlane-chrome-cell').length,
  ).toBe(2)
  expect(wrapper.findAll('.swimlane-lane-toggle').length).toBe(2)
  expect(wrapper.findAll('.swimlane-group-header').length).toBe(0)
  expect(
    wrapper.find('.swimlane-lane[data-lane-key="alpha"] .swimlane-lane-title').text(),
  ).toBe('Alpha')
  expect(
    wrapper.find('.swimlane-lane[data-lane-key="alpha"] .swimlane-lane-count').text(),
  ).toBe('1')
  expect(
    wrapper.find('.swimlane-lane[data-lane-key="beta"] .swimlane-lane-count').text(),
  ).toBe('1')
  expect(wrapper.findAll('.swimlane-row').length).toBe(2)
  expect(wrapper.findAll('.swimlane-column--header').length).toBe(2)
  expect(wrapper.findAll('.swimlane-group').length).toBe(4)
  expect(wrapper.findAll('.swimlane-group--expanded').length).toBe(2)
  expect(
    wrapper.find('.swimlane-lane[data-lane-key="beta"]').classes(),
  ).toContain('swimlane-lane--collapsed')
  expect(
    wrapper.find('.swimlane-lane[data-lane-key="beta"] .swimlane-row').exists(),
  ).toBe(true)
  expect(
    wrapper.findAll('.swimlane-lane[data-lane-key="beta"] .swimlane-group').length,
  ).toBe(2)
  expect(wrapper.find('.kanban--swimlanes').attributes('aria-label')).toContain('swimlane groups')
  await vi.waitFor(() => expect(createColumnSortable).toHaveBeenCalled())
  const sortableContainer = createColumnSortable.mock.calls.at(-1)?.[0]
  const sortableOptions = createColumnSortable.mock.calls.at(-1)?.[1]
  expect(sortableContainer?.classList?.contains('swimlane-header-row')).toBe(true)
  expect(sortableOptions?.boardRoot?.classList?.contains('kanban--swimlanes')).toBe(true)
  expect(
    wrapper.find('.swimlane-column-rail[data-column-value="Open"]').exists(),
  ).toBe(true)
  expect(
    wrapper.find('.swimlane-header-row .column-title--draggable').exists(),
  ).toBe(true)

  const expectedTracks = '280px 320px'
  expect(wrapper.find('.swimlane-header-row').attributes('style')).toContain(expectedTracks)
  expect(wrapper.findAll('.swimlane-row')[0].attributes('style')).toContain(expectedTracks)
  expect(
    wrapper.find('.swimlane-lane[data-lane-key="beta"] .swimlane-row').attributes('style'),
  ).toContain(expectedTracks)
  expect(
    wrapper
      .find('.swimlane-lane[data-lane-key="beta"] .swimlane-group[data-column-value="Open"]')
      .attributes('style'),
  ).toContain('--kanban-column-blue')

  expect(wrapper.findAll('.kanban-card-list--external-scroller').length).toBeGreaterThanOrEqual(2)
  expect(wrapper.findAll('[data-card-name="T1"]').length).toBeGreaterThan(0)

  const openGroup = wrapper.find('.swimlane-group[data-column-value="Open"]')
  const doneGroup = wrapper.find('.swimlane-group[data-column-value="Done"]')
  expect(openGroup.attributes('style')).toContain('--kanban-column-blue')
  expect(doneGroup.attributes('style')).toContain('--kanban-column-green')

  expect(wrapper.find('.kanban--swimlanes').attributes('style')).toContain(
    '--swimlane-label-inset: 0px',
  )

  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  await wrapper.vm.$nextTick()
  expect(wrapper.find('.swimlane-header-row').attributes('style')).toContain('52px 320px')
  expect(wrapper.find('.kanban--swimlanes').attributes('style')).toContain(
    '--swimlane-label-inset: 60px',
  )
  expect(wrapper.findAll('.swimlane-cell-spacer').length).toBe(2)
  expect(wrapper.findAll('.swimlane-group').length).toBe(2)
  expect(
    wrapper.find('.swimlane-cell-spacer[data-column-value="Open"]').attributes('style'),
  ).toContain('--kanban-column-blue')
  expect(
    wrapper.find('.swimlane-header-row .kanban-column--collapsed').classes(),
  ).toContain('kanban-column--header-only')

  wrapper.unmount()
  dispatch.mockRestore()
})

test('swimlane column collapse animates grid tracks before settling', async () => {
  prefersReducedMotion.mockReturnValue(false)

  let now = 0
  const rafCallbacks = []
  const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.spyOn(globalThis.performance, 'now').mockImplementation(() => now)

  const store = createKanbanStore()
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    board_name: 'Swim Board',
    ref_doctype: 'Task',
    field_name: 'status',
    fields: ['name', 'status', 'project'],
    swimlane_field: 'project',
    swimlane_mode: 'field',
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', indicator: 'blue', custom_column_width: 280, cards: [] },
    { name: 'done', column_name: 'Done', indicator: 'green', custom_column_width: 320, cards: [] },
  ])
  store.commit('SET_LANES', [
    {
      key: 'alpha',
      label: 'Alpha',
      columns: [
        { name: 'open', column_name: 'Open', cards: [] },
        { name: 'done', column_name: 'Done', cards: [] },
      ],
    },
  ])
  store.commit('SET_EXPANDED_LANE_KEYS', ['alpha'])
  store.commit('SET_BOARD_PERMS', { write: true })

  const wrapper = mount(KanbanBoard, {
    global: {
      plugins: [store],
      stubs: {
        VirtualList: {
          name: 'VirtualList',
          props: ['scroller'],
          template: '<div class="virtual-list-stub"><slot name="footer" /></div>',
        },
      },
    },
  })

  await vi.waitFor(() => expect(wrapper.find('.swimlane-header-row').exists()).toBe(true))
  expect(wrapper.find('.swimlane-header-row').attributes('style')).toContain('280px 320px')

  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  await wrapper.vm.$nextTick()
  expect(rafCallbacks.length).toBeGreaterThan(0)

  async function flushRaf(at) {
    now = at
    for (let i = 0; i < 8; i += 1) {
      const batch = rafCallbacks.splice(0, rafCallbacks.length)
      if (!batch.length) {
        break
      }
      for (const cb of batch) {
        cb(at)
      }
      await wrapper.vm.$nextTick()
    }
  }

  await flushRaf(110)
  const midStyle = wrapper.find('.swimlane-header-row').attributes('style') || ''
  expect(midStyle).not.toContain('280px 320px')
  expect(midStyle).not.toContain('52px 320px')
  expect(midStyle).toMatch(/grid-template-columns:\s*\d+px 320px/)

  await flushRaf(220)
  expect(wrapper.find('.swimlane-header-row').attributes('style')).toContain('52px 320px')

  wrapper.unmount()
  dispatch.mockRestore()
  rafSpy.mockRestore()
})
