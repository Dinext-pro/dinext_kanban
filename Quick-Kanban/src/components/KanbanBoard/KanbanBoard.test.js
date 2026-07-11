import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createKanbanStore } from '../../utils/store'
import KanbanBoard from './KanbanBoard.vue'

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
          template: '<section class="column-stub">{{ column.column_name }}</section>',
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
  columns[1].vm.$emit('drop', {
    oldIndex: -1,
    newIndex: 0,
    event: { to: { id: '1' } },
  })
  await wrapper.vm.$nextTick()

  expect(dispatch).toHaveBeenCalledWith('persistMovedCard', {
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 2,
    toColumn: 1,
    toIndex: 0,
  })
  wrapper.unmount()
})
