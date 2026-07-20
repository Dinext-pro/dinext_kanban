import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createKanbanStore } from '../../utils/store'
import SwimlaneRow from './SwimlaneRow.vue'

let observerCallback = null
const observe = vi.fn()
const disconnect = vi.fn()

beforeEach(() => {
  observerCallback = null
  observe.mockReset()
  disconnect.mockReset()
  class MockIntersectionObserver {
    constructor(callback) {
      observerCallback = callback
    }

    observe(...args) {
      return observe(...args)
    }

    disconnect(...args) {
      return disconnect(...args)
    }

    unobserve() {}
  }
  class MockResizeObserver {
    observe() {}

    disconnect() {}

    unobserve() {}
  }
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  // Instant lane height snaps in unit tests (skip CSS transition waits).
  vi.stubGlobal('matchMedia', vi.fn((query) => ({
    matches: String(query).includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mountRow({
  expanded = false,
  swimlaneMode = 'field',
  swimlaneField = 'project',
  laneKey = 'proj-a',
  laneLabel = 'Proj A',
  columns = [{ name: 'open', column_name: 'Open', cards: [] }],
  collapsedColumns = [],
} = {}) {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    fields: ['name', 'status'],
    swimlane_field: swimlaneField,
    swimlane_mode: swimlaneMode,
  })
  const lane = {
    key: laneKey,
    label: laneLabel,
    columns: columns.map((column) => ({ ...column })),
  }
  store.commit('SET_COLUMNS', columns.map((column) => ({ ...column })))
  store.commit('SET_LANES', [lane])
  if (expanded) {
    store.commit('SET_EXPANDED_LANE_KEYS', [laneKey])
  }
  for (const columnKey of collapsedColumns) {
    store.commit('SET_COLUMN_COLLAPSED', { columnKey, collapsed: true })
  }
  const dispatch = vi.spyOn(store, 'dispatch')
  const scroller = document.createElement('div')
  const wrapper = mount(SwimlaneRow, {
    props: {
      lane,
      laneIndex: 0,
      columns: store.state.columns,
      config: store.state.config,
      gridTemplateColumns: columns.map(() => '240px').join(' '),
      scroller,
    },
    global: {
      plugins: [store],
      stubs: {
        SwimlaneGroup: true,
      },
    },
  })
  return { store, dispatch, wrapper }
}

test('does not hydrate a collapsed intersecting lane', async () => {
  const { dispatch, wrapper } = mountRow({ expanded: false })
  await nextTick()
  await nextTick()

  expect(observe).toHaveBeenCalled()

  observerCallback([{ isIntersecting: true }])
  await nextTick()

  expect(dispatch).not.toHaveBeenCalledWith(
    'ensureLaneHydrated',
    expect.anything(),
  )
  wrapper.unmount()
})

test('dispatches ensureLaneHydrated when expanded lane becomes visible', async () => {
  const { dispatch, wrapper, store } = mountRow({ expanded: true })
  await nextTick()
  await nextTick()

  expect(dispatch).not.toHaveBeenCalledWith(
    'ensureLaneHydrated',
    expect.objectContaining({ laneKey: 'proj-a' }),
  )

  observerCallback([{ isIntersecting: true }])
  await nextTick()

  expect(dispatch).toHaveBeenCalledWith('ensureLaneHydrated', {
    laneKey: 'proj-a',
  })

  dispatch.mockClear()
  store.commit('SET_EXPANDED_LANE_KEYS', [])
  await nextTick()
  observerCallback([{ isIntersecting: true }])
  await nextTick()
  expect(dispatch).not.toHaveBeenCalledWith(
    'ensureLaneHydrated',
    expect.objectContaining({ laneKey: 'proj-a' }),
  )

  wrapper.unmount()
  expect(disconnect).toHaveBeenCalled()
})

test('hydrates immediately when a visible lane is expanded', async () => {
  const { dispatch, wrapper, store } = mountRow({ expanded: false })
  await nextTick()
  await nextTick()

  observerCallback([{ isIntersecting: true }])
  await nextTick()
  dispatch.mockClear()

  store.commit('SET_EXPANDED_LANE_KEYS', ['proj-a'])
  await nextTick()

  expect(dispatch).toHaveBeenCalledWith('ensureLaneHydrated', {
    laneKey: 'proj-a',
  })
  wrapper.unmount()
})

test('renders assignee avatar in assign swimlane header', async () => {
  frappe.avatar.mockClear()
  const { wrapper } = mountRow({
    swimlaneMode: 'assign',
    swimlaneField: '__assign',
    laneKey: 'alice@example.com',
    laneLabel: 'Alice',
  })
  await nextTick()
  await nextTick()

  expect(frappe.avatar).toHaveBeenCalledWith('alice@example.com', 'avatar-small')
  expect(wrapper.find('.swimlane-lane-avatar .avatar').exists()).toBe(true)
  wrapper.unmount()
})

test('does not render assignee avatar for Unassigned or field swimlanes', async () => {
  frappe.avatar.mockClear()
  const unassigned = mountRow({
    swimlaneMode: 'assign',
    swimlaneField: '__assign',
    laneKey: '',
    laneLabel: 'Unassigned',
  })
  await nextTick()
  await nextTick()
  expect(frappe.avatar).not.toHaveBeenCalled()
  expect(unassigned.wrapper.find('.swimlane-lane-avatar').exists()).toBe(false)
  unassigned.wrapper.unmount()

  frappe.avatar.mockClear()
  const fieldLane = mountRow({
    swimlaneMode: 'field',
    laneKey: 'proj-a',
    laneLabel: 'Proj A',
  })
  await nextTick()
  await nextTick()
  expect(frappe.avatar).not.toHaveBeenCalled()
  expect(fieldLane.wrapper.find('.swimlane-lane-avatar').exists()).toBe(false)
  fieldLane.wrapper.unmount()
})

test('collapse does not clear lane cards; re-expand remounts cached row', async () => {
  const { dispatch, wrapper, store } = mountRow({ expanded: true })
  await nextTick()
  await nextTick()
  store.commit('SET_LANE_HYDRATION', { laneKey: 'proj-a', status: 'ready' })
  store.state.lanes[0].columns[0].cards = [{ name: 'T1' }]
  dispatch.mockClear()

  store.commit('SET_EXPANDED_LANE_KEYS', [])
  // beginCollapseSequence is async (await nextTick before unmounting the row).
  await nextTick()
  await nextTick()
  await nextTick()

  expect(dispatch).not.toHaveBeenCalledWith(
    'finalizeLaneCollapse',
    expect.anything(),
  )
  expect(store.state.lanes[0].columns[0].cards).toEqual([{ name: 'T1' }])
  expect(store.state.laneHydration['proj-a']).toBe('ready')
  expect(wrapper.find('.swimlane-lane--collapsed').exists()).toBe(true)
  expect(wrapper.find('.swimlane-row').element.style.display).toBe('none')

  store.commit('SET_EXPANDED_LANE_KEYS', ['proj-a'])
  await nextTick()
  await nextTick()
  await nextTick()

  expect(wrapper.find('.swimlane-lane--expanded').exists()).toBe(true)
  expect(wrapper.find('.swimlane-row').element.style.display).not.toBe('none')
  expect(store.state.lanes[0].columns[0].cards).toEqual([{ name: 'T1' }])
  wrapper.unmount()
})

test('auto-expands a collapsed column after drag dwell on the cell spacer', async () => {
  vi.useFakeTimers()
  const { wrapper, store } = mountRow({
    expanded: true,
    collapsedColumns: ['Open'],
  })
  store.commit('SET_ACTIVE_DRAG', {
    cardName: 'TASK-1',
    fromColumn: 1,
    fromIndex: 0,
  })
  await nextTick()

  const spacer = wrapper.get('.swimlane-cell-spacer[data-column-value="Open"]')
  await spacer.trigger('pointerenter')
  expect(store.getters.isColumnCollapsed('Open')).toBe(true)

  await vi.advanceTimersByTimeAsync(400)
  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
  expect(wrapper.find('.swimlane-cell-spacer[data-column-value="Open"]').exists()).toBe(false)

  vi.useRealTimers()
  wrapper.unmount()
})

test('cancels collapsed-column drag auto-expand when the pointer leaves before the dwell delay', async () => {
  vi.useFakeTimers()
  const { wrapper, store } = mountRow({
    expanded: true,
    collapsedColumns: ['Open'],
  })
  store.commit('SET_ACTIVE_DRAG', {
    cardName: 'TASK-1',
    fromColumn: 1,
    fromIndex: 0,
  })
  await nextTick()

  const spacer = wrapper.get('.swimlane-cell-spacer[data-column-value="Open"]')
  await spacer.trigger('pointerenter')
  await spacer.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(400)

  expect(store.getters.isColumnCollapsed('Open')).toBe(true)
  vi.useRealTimers()
  wrapper.unmount()
})

test('does not auto-expand a collapsed column spacer without an active card drag', async () => {
  vi.useFakeTimers()
  const { wrapper, store } = mountRow({
    expanded: true,
    collapsedColumns: ['Open'],
  })
  await nextTick()

  await wrapper.get('.swimlane-cell-spacer[data-column-value="Open"]').trigger('pointerenter')
  await vi.advanceTimersByTimeAsync(400)

  expect(store.getters.isColumnCollapsed('Open')).toBe(true)
  vi.useRealTimers()
  wrapper.unmount()
})

test('expands a collapsed column on double-click of the cell spacer', async () => {
  const { wrapper, store } = mountRow({
    expanded: true,
    collapsedColumns: ['Open'],
  })
  await nextTick()

  await wrapper.get('.swimlane-cell-spacer[data-column-value="Open"]').trigger('dblclick')

  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
  expect(wrapper.find('.swimlane-cell-spacer[data-column-value="Open"]').exists()).toBe(false)
  wrapper.unmount()
})
