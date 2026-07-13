import { expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createKanbanStore } from '../../utils/store'

const scrollToKey = vi.fn()
const scrollToIndex = vi.fn()

vi.mock('vue-virtual-draglist', () => ({
  default: defineComponent({
    name: 'VirtualList',
    setup(_props, { expose }) {
      expose({ scrollToKey, scrollToIndex })
      return () => h('div')
    },
  }),
}))

import VirtualList from 'vue-virtual-draglist'
import KanbanColumn from './KanbanColumn.vue'

function mountColumn(column = {
  name: 'open',
  column_name: 'Open',
  display_name: 'Open',
  indicator: 'unknown',
  cards: [],
}, { boardPerms } = {}) {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'name',
    status_field_meta: { fieldname: 'status', fieldtype: 'Select', parent: 'Task' },
    fields: ['name'],
    highlighted_field: '',
    highlight_table: [],
    show_labels: false,
  })
  store.commit('SET_COLUMNS', [column])
  store.commit('SET_COLUMN_TOTALS', {
    [column.column_name]: 51,
  })
  if (boardPerms !== undefined) {
    store.commit('SET_BOARD_PERMS', boardPerms)
  }
  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      config: store.state.config,
    },
    global: {
      plugins: [store],
      stubs: {
        VirtualList: {
          name: 'VirtualList',
          template: '<div role="list"><slot name="footer" /></div>',
        },
      },
    },
  })
  return { wrapper, store }
}

test('renders a labelled region with a card count and empty state', () => {
  const { wrapper } = mountColumn()

  expect(wrapper.attributes('role')).toBe('region')
  expect(wrapper.attributes('aria-label')).toBe('Open, 51 records')
  expect(wrapper.get('h2').text()).toBe('Open')
  expect(wrapper.get('.column-count').text()).toBe('51')
  expect(wrapper.get('.column-count').classes()).toContain('gray')
  expect(wrapper.get('.column-count').attributes('title')).toBe('Double-click to open filtered list')
  expect(wrapper.find('.kanban-column-header .quick-kanban-indicator-swatch').exists()).toBe(false)
  expect(wrapper.text()).toContain('No cards')
})

test('opens the filtered list view when the column count is double-clicked', async () => {
  const { wrapper } = mountColumn()

  await wrapper.get('.column-count').trigger('dblclick')

  expect(frappe.route_options).toEqual({ status: 'Open' })
  expect(frappe.set_route).toHaveBeenCalledWith('List', 'Task', 'List')
})

test('marks the column title draggable when board write access is granted', () => {
  const { wrapper } = mountColumn(undefined, { boardPerms: { write: true } })

  expect(wrapper.attributes('data-column-value')).toBe('Open')
  expect(wrapper.get('h2.column-title').classes()).toContain('column-title--draggable')
  expect(wrapper.get('h2.column-title').attributes('title')).toBe('Drag to reorder column')
})

test('does not mark the column title draggable without board write access', () => {
  const { wrapper } = mountColumn(undefined, { boardPerms: { write: false } })

  expect(wrapper.get('h2.column-title').classes()).not.toContain('column-title--draggable')
  expect(wrapper.get('h2.column-title').attributes('title')).toBeUndefined()
})

test('uses labelled buttons for adding cards and choosing colors', async () => {
  const { wrapper, store } = mountColumn()
  const dispatchSpy = vi.spyOn(store, 'dispatch').mockResolvedValue(true)

  const addButton = wrapper.get('[aria-label="Add Task to Open"]')
  expect(addButton.element.tagName).toBe('BUTTON')

  await wrapper.get('[aria-label="Change Open column color"]').trigger('click')
  const colorButton = wrapper.get('[aria-label="Set Open color to Gray"]')
  expect(colorButton.element.tagName).toBe('BUTTON')
  await colorButton.trigger('click')
  expect(dispatchSpy).toHaveBeenCalledWith('setIndicator', {
    indicator: 'Gray',
    columnIndex: 0,
  })
})

test('synchronizes expanded state and closes the color menu with Escape', async () => {
  const { wrapper } = mountColumn()
  const trigger = wrapper.get('[aria-label="Change Open column color"]')

  expect(trigger.attributes('aria-expanded')).toBe('false')
  expect(wrapper.find('[aria-label="Column colors"]').exists()).toBe(false)

  await trigger.trigger('click')
  expect(trigger.attributes('aria-expanded')).toBe('true')
  expect(wrapper.get('[aria-label="Column colors"]').exists()).toBe(true)

  await wrapper.get('[aria-label="Column colors"]').trigger('keydown', { key: 'Escape' })
  expect(trigger.attributes('aria-expanded')).toBe('false')
  expect(wrapper.find('[aria-label="Column colors"]').exists()).toBe(false)
})

test('keeps the color menu open for arrows and closes it on scroll', async () => {
  const { wrapper } = mountColumn()
  const trigger = wrapper.get('[aria-label="Change Open column color"]')
  await trigger.trigger('click')

  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowDown',
    bubbles: true,
  }))
  await wrapper.vm.$nextTick()
  expect(wrapper.find('[aria-label="Column colors"]').exists()).toBe(true)

  window.dispatchEvent(new Event('scroll'))
  await wrapper.vm.$nextTick()
  expect(wrapper.find('[aria-label="Column colors"]').exists()).toBe(false)
})

test('closes the color menu on a non-arrow key without restoring focus', async () => {
  const { wrapper } = mountColumn()
  const outside = document.createElement('button')
  document.body.append(outside)
  await wrapper.get('[aria-label="Change Open column color"]').trigger('click')
  outside.focus()

  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'a',
    bubbles: true,
  }))
  await wrapper.vm.$nextTick()

  expect(wrapper.find('[aria-label="Column colors"]').exists()).toBe(false)
  expect(outside).toBe(document.activeElement)
  outside.remove()
})

test('renders translated column labels while dispatching create from the column', async () => {
  const originalTranslate = globalThis.__
  globalThis.__ = (message, values = [], context) => {
    if (context === 'Task' && message === 'Open') return 'Открыто'
    return values.reduce(
      (result, value, index) => result.replace(`{${index}}`, value),
      message,
    )
  }

  const { wrapper } = mountColumn({
    name: 'open',
    column_name: 'Open',
    display_name: 'Открыто',
    indicator: 'gray',
    cards: [],
  })
  const store = wrapper.vm.$store
  const dispatchSpy = vi.spyOn(store, 'dispatch').mockResolvedValue(true)

  expect(wrapper.get('h2').text()).toBe('Открыто')
  expect(wrapper.attributes('aria-label')).toBe('Открыто, 51 records')

  await wrapper.get('[aria-label="Add Task to Открыто"]').trigger('click')
  expect(dispatchSpy).toHaveBeenCalledWith('startCreateCard', {
    columnIndex: 0,
    column: expect.objectContaining({ column_name: 'Open' }),
  })

  globalThis.__ = originalTranslate
})

test('does not throw for an unknown column indicator', () => {
  expect(() => mountColumn()).not.toThrow()
})

test('forwards the drag origin supplied by the virtual list', async () => {
  const column = {
    name: 'open',
    column_name: 'Open',
    indicator: 'gray',
    cards: [{ name: 'TASK-1' }],
  }
  const { wrapper } = mountColumn(column)

  wrapper.findComponent(VirtualList).vm.$emit('drag', {
    key: 'TASK-1',
    index: 0,
  })
  await wrapper.vm.$nextTick()

  expect(wrapper.emitted('dragstart')[0][0]).toEqual({
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 0,
  })
})

test('exposes scrollToCard through the virtual list API', async () => {
  scrollToKey.mockClear()
  const column = {
    name: 'open',
    column_name: 'Open',
    indicator: 'gray',
    cards: [{ name: 'TASK-1' }],
  }
  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      config: {
        board_name: 'Task Board',
        ref_doctype: 'Task',
        field_name: 'status',
        title_field: 'name',
        status_field_meta: { fieldname: 'status', fieldtype: 'Select', parent: 'Task' },
        fields: ['name'],
        highlighted_field: '',
        highlight_table: [],
        show_labels: false,
      },
    },
    global: {
      plugins: [createKanbanStore()],
    },
  })

  await wrapper.vm.$nextTick()
  wrapper.vm.scrollToCard('TASK-1', 4)
  expect(scrollToIndex).toHaveBeenCalledWith(4)
  expect(scrollToKey).not.toHaveBeenCalled()

  scrollToIndex.mockClear()
  wrapper.vm.scrollToCard('TASK-1')
  expect(scrollToKey).toHaveBeenCalledWith('TASK-1')
})

test('loads the next page only when this column reaches the bottom', async () => {
  const column = {
    name: 'open',
    column_name: 'Open',
    indicator: 'gray',
    cards: [{ name: 'TASK-1' }],
  }
  const { wrapper } = mountColumn(column)
  const store = wrapper.vm.$store
  store.commit('SET_COLUMN_PAGINATION', {
    Open: { offset: 1, loading: false, hasMore: true },
  })
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue()

  wrapper.findComponent(VirtualList).vm.$emit('bottom')
  await wrapper.vm.$nextTick()

  expect(dispatch).toHaveBeenCalledWith('loadColumnPage', {
    columnIndex: 0,
    args: window.cur_list.get_args(),
  })
})

test('collapses the column from the menu and shows Open while collapsed', async () => {
  const { wrapper, store } = mountColumn(undefined, { boardPerms: { write: true } })

  await wrapper.get('[aria-label="Change Open column color"]').trigger('click')
  expect(wrapper.get('[aria-label="Collapse Open column"]').text()).toBe('Collapse')
  expect(wrapper.get('[aria-label="Hide Open column"]').exists()).toBe(true)

  await wrapper.get('[aria-label="Collapse Open column"]').trigger('click')
  expect(wrapper.classes()).toContain('kanban-column--collapsed')
  expect(store.getters.isColumnCollapsed('Open')).toBe(true)
  expect(wrapper.find('[aria-label="Add Task to Open"]').isVisible()).toBe(false)
  expect(wrapper.find('[aria-label="Column colors"]').exists()).toBe(false)

  await wrapper.get('[aria-label="Change Open column color"]').trigger('click')
  expect(wrapper.get('[aria-label="Open Open column"]').text()).toBe('Open')

  await wrapper.get('[aria-label="Open Open column"]').trigger('click')
  expect(wrapper.classes()).not.toContain('kanban-column--collapsed')
  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
})

test('toggles collapse with double-click on the title', async () => {
  const { wrapper, store } = mountColumn()

  await wrapper.get('h2.column-title').trigger('dblclick')
  expect(store.getters.isColumnCollapsed('Open')).toBe(true)
  expect(wrapper.classes()).toContain('kanban-column--collapsed')

  await wrapper.get('h2.column-title').trigger('dblclick')
  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
})

test('expands a collapsed column from the count without opening the list', async () => {
  const { wrapper, store } = mountColumn()
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  await wrapper.vm.$nextTick()
  frappe.set_route.mockClear()

  await wrapper.get('.column-count').trigger('dblclick')

  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
  expect(frappe.set_route).not.toHaveBeenCalled()
})

test('auto-expands a collapsed column after drag dwell delay', async () => {
  vi.useFakeTimers()
  const { wrapper, store } = mountColumn()
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  store.commit('SET_ACTIVE_DRAG', {
    cardName: 'TASK-1',
    fromColumn: 1,
    fromIndex: 0,
  })
  await wrapper.vm.$nextTick()

  await wrapper.trigger('pointerenter')
  expect(store.getters.isColumnCollapsed('Open')).toBe(true)

  await vi.advanceTimersByTimeAsync(400)
  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
  vi.useRealTimers()
})

test('cancels drag auto-expand when the pointer leaves before the dwell delay', async () => {
  vi.useFakeTimers()
  const { wrapper, store } = mountColumn()
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  store.commit('SET_ACTIVE_DRAG', {
    cardName: 'TASK-1',
    fromColumn: 1,
    fromIndex: 0,
  })
  await wrapper.vm.$nextTick()

  await wrapper.trigger('pointerenter')
  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(400)

  expect(store.getters.isColumnCollapsed('Open')).toBe(true)
  vi.useRealTimers()
})

test('keeps title draggable while the column is collapsed', () => {
  const { wrapper, store } = mountColumn(undefined, { boardPerms: { write: true } })
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })

  expect(wrapper.get('h2.column-title').classes()).toContain('column-title--draggable')
})