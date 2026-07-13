import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createKanbanStore } from '../../utils/store'
import KanbanBoard from './KanbanBoard.vue'

vi.mock('../../utils/cardRollbackAnimation', () => ({
  animateCardRollback: vi.fn(() => Promise.resolve(true)),
  captureCardRect: vi.fn(() => ({
    left: 420,
    top: 240,
    width: 180,
    height: 96,
  })),
}))
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

test('renders explicit loading, error, and live announcement states', async () => {
  const { store, wrapper } = mountBoard()

  store.commit('SET_LOADING', true)
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[role="status"]').text()).toContain('Loading')

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
