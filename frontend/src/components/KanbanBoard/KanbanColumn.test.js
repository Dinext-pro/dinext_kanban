import { expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createKanbanStore } from '../../utils/store'
import { COLUMN_COLLAPSE_ANIMATION_MS } from '../../utils/kanban'

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
}, { boardPerms, laneKey = null, laneIndex = null } = {}) {
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
      laneKey,
      laneIndex,
      config: store.state.config,
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          inheritAttrs: false,
          template: '<div role="list" class="kanban-card-list" :class="$attrs.class"><slot name="footer" /></div>',
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
  expect(wrapper.find('.kanban-column-header .dinext-kanban-indicator-swatch').exists()).toBe(false)
  expect(wrapper.text()).toContain('No data')
})

test('hides add-card controls when create options deny the column', async () => {
  const { wrapper, store } = mountColumn()
  store.commit('SET_CREATE_OPTIONS_BY_COLUMN', {
    Open: {
      allowed: false,
      reason: 'no_permission',
      form_mode: 'blocked',
      missing_mandatory: [],
      missing_fieldnames: [],
    },
  })
  await wrapper.vm.$nextTick()

  expect(wrapper.find('[aria-label="Add Task to Open"]').exists()).toBe(false)
  expect(wrapper.find('.addcard').exists()).toBe(false)
})

test('opens the filtered list view when the column count is double-clicked', async () => {
  const { wrapper } = mountColumn()

  await wrapper.get('.column-count').trigger('dblclick')

  expect(frappe.route_options).toEqual({ status: 'Open' })
  expect(frappe.set_route).toHaveBeenCalledWith('List', 'Task', 'List')
})

test('double-click adds name not-in for hidden board children when children are hidden', async () => {
  const { wrapper, store } = mountColumn()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  store.commit('SET_SHOW_CHILD_TASKS', false)
  store.commit('SET_HIDDEN_BOARD_CHILD_NAMES', ['CHILD-1', 'CHILD-2'])

  await wrapper.get('.column-count').trigger('dblclick')

  expect(frappe.route_options).toEqual({
    status: 'Open',
    name: ['not in', ['CHILD-1', 'CHILD-2']],
  })
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

test('shows a resize handle only when the board can be edited', () => {
  const editable = mountColumn(undefined, { boardPerms: { write: true } })
  expect(editable.wrapper.find('.kanban-column-resize-handle').exists()).toBe(true)

  const readonly = mountColumn(undefined, { boardPerms: { write: false } })
  expect(readonly.wrapper.find('.kanban-column-resize-handle').exists()).toBe(false)
})

test('applies stored column width without viewport clamping', () => {
  const { wrapper } = mountColumn({
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'Blue',
    custom_column_width: 420,
    cards: [],
  }, { boardPerms: { write: true } })

  expect(wrapper.attributes('style')).toContain('width: 420px')
  expect(wrapper.attributes('style')).toContain('flex-basis: 420px')
})

test('sets explicit collapsed width so CSS can interpolate from expanded px', async () => {
  const { wrapper, store } = mountColumn({
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'Blue',
    custom_column_width: 420,
    cards: [],
  }, { boardPerms: { write: true } })

  expect(wrapper.attributes('style')).toContain('width: 420px')

  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  await wrapper.vm.$nextTick()

  expect(wrapper.classes()).toContain('kanban-column--collapsed')
  expect(wrapper.attributes('style')).toContain('width: 52px')
  expect(wrapper.attributes('style')).toContain('flex-basis: 52px')
  expect(wrapper.attributes('style')).not.toContain('max-width')
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
    if (message === 'Task') return 'Задача'
    if (context === 'Task' && message === 'Open') return 'Открыто'
    return values.reduce(
      (result, value, index) => result.replace(`{${index}}`, value),
      message,
    )
  }

  try {
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
    expect(wrapper.get('.addcard button').text()).toContain('Add Задача')

    await wrapper.get('[aria-label="Add Задача to Открыто"]').trigger('click')
    expect(dispatchSpy).toHaveBeenCalledWith('startCreateCard', {
      columnIndex: 0,
      column: expect.objectContaining({ column_name: 'Open' }),
      laneKey: null,
      childScopeId: null,
    })
  } finally {
    globalThis.__ = originalTranslate
  }
})

test('passes swimlane laneKey when adding a card from a cell', async () => {
  const column = {
    name: 'open',
    column_name: 'Open',
    indicator: 'Blue',
    cards: [],
  }
  const { wrapper, store } = mountColumn(column, {
    laneKey: 'PROJ-1',
    laneIndex: 0,
  })
  const dispatchSpy = vi.spyOn(store, 'dispatch').mockResolvedValue(true)

  await wrapper.get('.addcard button').trigger('click')

  expect(dispatchSpy).toHaveBeenCalledWith('startCreateCard', {
    columnIndex: 0,
    column: expect.objectContaining({ column_name: 'Open' }),
    laneKey: 'PROJ-1',
    childScopeId: null,
  })
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
    fromLaneIndex: null,
    fromLaneKey: null,
    fromIndex: 0,
    childDepth: 0,
    childScopeId: null,
  })
})

test('keeps scroll-to-top hidden until cards scroll out of view', async () => {
  const column = {
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'gray',
    cards: [{ name: 'TASK-1' }],
  }
  const { wrapper } = mountColumn(column)
  await wrapper.vm.$nextTick()

  expect(wrapper.find('.column-footer-actions').exists()).toBe(true)
  expect(wrapper.find('.column-footer-actions--swimlane').exists()).toBe(false)
  expect(wrapper.get('.column-scroll-top').element.style.display).toBe('none')

  const list = wrapper.get('.kanban-card-list').element
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    writable: true,
    value: 40,
  })
  wrapper.vm.updateScrollTopVisibility(list)
  await wrapper.vm.$nextTick()

  expect(wrapper.get('.column-scroll-top').element.style.display).not.toBe('none')
  expect(wrapper.get('.column-scroll-top').attributes('aria-label')).toBe(
    'Scroll to top of column',
  )
  expect(wrapper.get('.column-scroll-top use').attributes('href')).toBe('#icon-up-line')
})

test('marks footer actions as swimlane when an external scroller is provided', async () => {
  const scroller = document.createElement('div')
  const { wrapper } = mountColumn()
  await wrapper.setProps({ externalScroller: scroller })
  expect(wrapper.find('.column-footer-actions--swimlane').exists()).toBe(true)
  expect(wrapper.find('.column-stick-room-dropzone').exists()).toBe(true)
  expect(wrapper.find('.column-stick-room-spacer').exists()).toBe(false)
  expect(wrapper.find('.column-footer-actions-spacer').exists()).toBe(false)
  expect(wrapper.find('.column-footer-actions--pinned').exists()).toBe(false)
  expect(wrapper.find('.kanban-card-list--external-scroller').exists()).toBe(true)
})

test('keeps swimlane Add outside the card list with stick-room dropzone after it', async () => {
  const scroller = document.createElement('div')
  const { wrapper } = mountColumn({
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'gray',
    cards: [{ name: 'TASK-1' }],
  })
  await wrapper.setProps({
    externalScroller: scroller,
    hideHeader: true,
  })

  const list = wrapper.get('.kanban-card-list').element
  const footer = wrapper.get('.column-footer-actions').element
  const dropzone = wrapper.get('.column-stick-room-dropzone').element
  expect(list.contains(footer)).toBe(false)
  expect(list.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(footer.compareDocumentPosition(dropzone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(wrapper.find('.column-footer-actions--swimlane').exists()).toBe(true)
  expect(wrapper.find('.column-footer-actions--pinned').exists()).toBe(false)
  expect(wrapper.findAll('.column-footer-actions').length).toBe(1)
  expect(footer.style.position).toBe('')
})

test('classic mode keeps Add outside the list without stick-room dropzone', async () => {
  const { wrapper } = mountColumn({
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'gray',
    cards: [{ name: 'TASK-1' }],
  })
  await wrapper.vm.$nextTick()

  const list = wrapper.get('.kanban-card-list').element
  const footer = wrapper.get('.column-footer-actions').element
  expect(list.contains(footer)).toBe(false)
  expect(list.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(wrapper.find('.column-stick-room-dropzone').exists()).toBe(false)
  expect(wrapper.find('.column-footer-actions--swimlane').exists()).toBe(false)
})

test('keeps append drop marker classes without local mouseup handlers', async () => {
  const scroller = document.createElement('div')
  const { wrapper } = mountColumn({
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'gray',
    cards: [],
  })
  await wrapper.setProps({
    externalScroller: scroller,
    hideHeader: true,
    laneIndex: 0,
    laneKey: 'lane-a',
    columnIndex: 1,
    listId: 1,
  })
  expect(wrapper.find('.empty-column--drop-target').exists()).toBe(true)
  expect(wrapper.find('.column-stick-room-dropzone').exists()).toBe(true)
  // Append drop is handled at board document capture, not per-column mouseup.
  expect(wrapper.find('.column-stick-room-dropzone').element.onmouseup).toBeFalsy()
})

test('marks empty-column as drop target on classic columns without external scroller', async () => {
  const { wrapper } = mountColumn({
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'gray',
    cards: [],
  })
  await wrapper.vm.$nextTick()
  expect(wrapper.find('.empty-column').exists()).toBe(true)
  expect(wrapper.find('.empty-column--drop-target').exists()).toBe(true)
})

test('scrolls the column list to the top in classic mode', async () => {
  const column = {
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'gray',
    cards: [{ name: 'TASK-1' }],
  }
  const { wrapper } = mountColumn(column)
  const list = wrapper.get('.kanban-card-list').element
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    writable: true,
    value: 40,
  })
  const scrollTo = vi.fn()
  list.scrollTo = scrollTo
  wrapper.vm.updateScrollTopVisibility(list)
  await wrapper.vm.$nextTick()

  await wrapper.get('.column-scroll-top').trigger('click')

  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
})

test('scrolls the external swimlane scroller to the column top', async () => {
  const scroller = document.createElement('div')
  scroller.className = 'kanban kanban--swimlanes'
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    writable: true,
    value: 240,
  })
  scroller.scrollTo = vi.fn()
  scroller.getBoundingClientRect = () => ({
    top: 100,
    bottom: 700,
    left: 0,
    right: 400,
    width: 400,
    height: 600,
  })

  const lane = document.createElement('div')
  lane.className = 'swimlane-lane'
  const laneSticky = document.createElement('div')
  laneSticky.className = 'swimlane-lane-sticky'
  laneSticky.getBoundingClientRect = () => ({
    top: 140,
    bottom: 176,
    left: 0,
    right: 400,
    width: 400,
    height: 36,
  })
  lane.appendChild(laneSticky)
  document.body.appendChild(lane)
  document.body.appendChild(scroller)

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
  const column = {
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'gray',
    cards: [{ name: 'TASK-1' }],
  }
  store.commit('SET_COLUMNS', [column])
  store.commit('SET_COLUMN_TOTALS', { Open: 2 })

  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      config: store.state.config,
      hideHeader: true,
      externalScroller: scroller,
    },
    attachTo: lane,
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          template: '<div role="list" class="kanban-card-list"><slot name="footer" /></div>',
        },
      },
    },
  })

  const columnEl = wrapper.element
  columnEl.getBoundingClientRect = () => ({
    top: 40,
    bottom: 900,
    left: 0,
    right: 200,
    width: 200,
    height: 860,
  })
  wrapper.vm.updateScrollTopVisibility()
  await wrapper.vm.$nextTick()

  expect(wrapper.get('.column-scroll-top').element.style.display).not.toBe('none')
  await wrapper.get('.column-scroll-top').trigger('click')

  // scrollTop (240) + (columnTop 40 - stickyBottom 176) = 104
  expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 104, behavior: 'smooth' })

  wrapper.unmount()
  lane.remove()
  scroller.remove()
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
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
      },
    },
  })

  await wrapper.vm.$nextTick()
  wrapper.vm.scrollToCard('TASK-1', 4)
  expect(scrollToIndex).toHaveBeenCalledWith(4)
  expect(scrollToKey).not.toHaveBeenCalled()

  scrollToIndex.mockClear()
  wrapper.vm.scrollToCard('TASK-1')
  expect(scrollToKey).toHaveBeenCalledWith('TASK-1')
  expect(wrapper.vm.getRootEl()).toBe(wrapper.element)
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
  const collapseButton = wrapper.get('[aria-label="Collapse Open column"]')
  expect(collapseButton.get('span').text()).toBe('Collapse')
  expect(collapseButton.get('use').attributes('href')).toBe('#icon-sidebar-collapse')
  const hideButton = wrapper.get('[aria-label="Hide Open column"]')
  expect(hideButton.exists()).toBe(true)
  expect(hideButton.get('use').attributes('href')).toBe('#icon-hide')

  await wrapper.get('[aria-label="Collapse Open column"]').trigger('click')
  expect(wrapper.classes()).toContain('kanban-column--collapsed')
  expect(store.getters.isColumnCollapsed('Open')).toBe(true)
  expect(wrapper.find('[aria-label="Add Task to Open"]').isVisible()).toBe(false)
  expect(wrapper.find('[aria-label="Column colors"]').exists()).toBe(false)

  await wrapper.get('[aria-label="Change Open column color"]').trigger('click')
  const openButton = wrapper.get('[aria-label="Open Open column"]')
  expect(openButton.get('span').text()).toBe('Open')
  expect(openButton.get('use').attributes('href')).toBe('#icon-sidebar-expand')

  await wrapper.get('[aria-label="Open Open column"]').trigger('click')
  expect(wrapper.classes()).not.toContain('kanban-column--collapsed')
  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
})

test('positions the expanded column menu with fixed viewport coords', async () => {
  const { wrapper } = mountColumn(undefined, { boardPerms: { write: true } })

  const originalInnerWidth = window.innerWidth
  const originalInnerHeight = window.innerHeight
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })

  const originalGbr = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.classList?.contains('column-dropdown')) {
      return {
        top: 0,
        bottom: 160,
        left: 0,
        right: 180,
        width: 180,
        height: 160,
        x: 0,
        y: 0,
        toJSON() {},
      }
    }
    if (this.getAttribute?.('aria-label') === 'Change Open column color') {
      return {
        top: 40,
        bottom: 72,
        left: 500,
        right: 532,
        width: 32,
        height: 32,
        x: 500,
        y: 40,
        toJSON() {},
      }
    }
    return originalGbr.call(this)
  }

  try {
    await wrapper.get('[aria-label="Change Open column color"]').trigger('click')
    await wrapper.vm.$nextTick()

    const menu = wrapper.get('[aria-label="Column colors"]')
    const style = menu.attributes('style') || ''
    const leftMatch = style.match(/left:\s*([\d.]+)px/)
    const topMatch = style.match(/top:\s*([\d.]+)px/)
    expect(leftMatch).not.toBeNull()
    expect(topMatch).not.toBeNull()
    // trigger.right (532) - menu.width (180) = 352; top = trigger.bottom (72) + gap (4)
    expect(Number(leftMatch[1])).toBe(352)
    expect(Number(topMatch[1])).toBe(76)
    expect(style).toContain('visibility: visible')
  } finally {
    Element.prototype.getBoundingClientRect = originalGbr
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    })
  }
})

test('flips the collapsed column menu left when there is no room on the right', async () => {
  const { wrapper, store } = mountColumn(undefined, { boardPerms: { write: true } })
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  await wrapper.vm.$nextTick()

  const originalInnerWidth = window.innerWidth
  const originalInnerHeight = window.innerHeight
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })

  const originalGbr = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.classList?.contains('column-dropdown')) {
      return {
        top: 0,
        bottom: 180,
        left: 0,
        right: 200,
        width: 200,
        height: 180,
        x: 0,
        y: 0,
        toJSON() {},
      }
    }
    if (this.getAttribute?.('aria-label') === 'Change Open column color') {
      return {
        top: 40,
        bottom: 72,
        left: 340,
        right: 372,
        width: 32,
        height: 32,
        x: 340,
        y: 40,
        toJSON() {},
      }
    }
    return originalGbr.call(this)
  }

  try {
    await wrapper.get('[aria-label="Change Open column color"]').trigger('click')
    await wrapper.vm.$nextTick()

    const menu = wrapper.get('[aria-label="Column colors"]')
    const style = menu.attributes('style') || ''
    const leftMatch = style.match(/left:\s*([\d.]+)px/)
    expect(leftMatch).not.toBeNull()
    // trigger.left (340) - menu.width (200) - gap (4) = 136
    expect(Number(leftMatch[1])).toBe(136)
    expect(Number(leftMatch[1])).toBeLessThanOrEqual(340)
  } finally {
    Element.prototype.getBoundingClientRect = originalGbr
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    })
  }
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

test('header-only mode keeps the header and hides the card list', () => {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'name',
    fields: ['name'],
  })
  store.commit('SET_BOARD_PERMS', { write: true })
  const column = {
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'blue',
    cards: [{ name: 'T1' }],
  }
  store.commit('SET_COLUMNS', [column])
  store.commit('SET_COLUMN_TOTALS', { Open: 1 })
  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      config: store.state.config,
      headerOnly: true,
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          template: '<div class="virtual-list-stub" />',
        },
      },
    },
  })

  expect(wrapper.classes()).toContain('kanban-column--header-only')
  expect(wrapper.find('.kanban-column-header').exists()).toBe(true)
  expect(wrapper.find('.virtual-list-stub').exists()).toBe(false)
  expect(wrapper.get('h2.column-title').classes()).toContain('column-title--draggable')
  wrapper.unmount()
})

test('header-only collapsed column expands on title double-click', async () => {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'name',
    fields: ['name'],
  })
  const column = {
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'blue',
    cards: [{ name: 'T1' }],
  }
  store.commit('SET_COLUMNS', [column])
  store.commit('SET_COLUMN_TOTALS', { Open: 1 })
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      config: store.state.config,
      headerOnly: true,
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          template: '<div class="virtual-list-stub" />',
        },
      },
    },
  })

  expect(wrapper.classes()).toContain('kanban-column--collapsed')
  await wrapper.get('h2.column-title').trigger('dblclick')
  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
  wrapper.unmount()
})

test('header-only collapsed column expands on count double-click without opening the list', async () => {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'name',
    fields: ['name'],
  })
  const column = {
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'blue',
    cards: [{ name: 'T1' }],
  }
  store.commit('SET_COLUMNS', [column])
  store.commit('SET_COLUMN_TOTALS', { Open: 1 })
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      config: store.state.config,
      headerOnly: true,
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          template: '<div class="virtual-list-stub" />',
        },
      },
    },
  })
  frappe.set_route.mockClear()

  await wrapper.get('.column-count').trigger('dblclick')

  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
  expect(frappe.set_route).not.toHaveBeenCalled()
  wrapper.unmount()
})

test('passes externalScroller to VirtualList and marks external scroll mode', () => {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'name',
    fields: ['name'],
    swimlane_mode: 'field',
    swimlane_field: 'project',
  })
  const column = {
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'blue',
    cards: [{ name: 'T1' }],
  }
  const scroller = document.createElement('div')
  store.commit('SET_COLUMNS', [column])
  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      laneIndex: 0,
      laneKey: 'alpha',
      listId: 1,
      config: store.state.config,
      hideHeader: true,
      hideResize: true,
      externalScroller: scroller,
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          props: ['scroller'],
          inheritAttrs: false,
          template: `
            <div
              role="list"
              class="kanban-card-list"
              :class="$attrs.class"
              :data-has-scroller="scroller ? 'true' : 'false'"
            />
          `,
        },
      },
    },
  })

  expect(wrapper.classes()).toContain('kanban-column--external-scroller')
  expect(wrapper.find('.kanban-card-list--external-scroller').exists()).toBe(true)
  expect(wrapper.find('.kanban-card-list').attributes('data-has-scroller')).toBe('true')
  expect(wrapper.findComponent({ name: 'VirtualList' }).props('scroller')).toBe(scroller)
  wrapper.unmount()
})

test('raises VirtualList keeps when a board-hosted ChildPanel host is in the column', async () => {
  const cards = Array.from({ length: 35 }, (_, index) => ({
    name: `CARD-${index + 1}`,
    subject: `Card ${index + 1}`,
    status: 'Open',
  }))
  const column = {
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'blue',
    cards,
  }
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'name',
    parent_field: 'parent_task',
    fields: ['name', 'subject', 'status'],
    swimlane_mode: 'field',
    swimlane_field: 'project',
  })
  store.commit('SET_COLUMNS', [column])
  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      laneIndex: 0,
      laneKey: 'alpha',
      listId: 1,
      config: store.state.config,
      childDepth: 0,
      hideHeader: true,
      hideResize: true,
      externalScroller: document.createElement('div'),
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          props: ['keeps', 'scroller'],
          inheritAttrs: false,
          template: '<div role="list" class="kanban-card-list" />',
        },
        KanbanCard: true,
      },
    },
  })

  expect(wrapper.findComponent({ name: 'VirtualList' }).props('keeps')).toBe(30)

  store.commit('OPEN_CHILD_PANEL', {
    scopeId: 'PARENT::CARD-20::0',
    parentName: 'CARD-20',
    depth: 0,
    ordinal: 0,
    columns: [{ name: 'open', column_name: 'Open', cards: [] }],
    columnPagination: {},
    columnTotals: {},
  })
  await wrapper.vm.$nextTick()

  expect(wrapper.findComponent({ name: 'VirtualList' }).props('keeps')).toBe(40)

  store.commit('CLOSE_CHILD_PANELS_FROM_DEPTH', 0)
  await wrapper.vm.$nextTick()
  expect(wrapper.findComponent({ name: 'VirtualList' }).props('keeps')).toBe(30)
  wrapper.unmount()
})

test('swimlane cell shows forbidden overlay mark while dragging into a blocked column', async () => {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'name',
    fields: ['name'],
    swimlane_mode: 'field',
    swimlane_field: 'project',
    status_field_meta: { fieldname: 'status', fieldtype: 'Select', read_only: 1 },
  })
  const column = {
    name: 'done',
    column_name: 'Done',
    display_name: 'Done',
    indicator: 'green',
    cards: [],
  }
  const scroller = document.createElement('div')
  store.commit('SET_COLUMNS', [column])
  store.commit('SET_ACTIVE_DRAG', {
    cardName: 'TASK-1',
    fromColumn: 1,
    fromLaneKey: 'other',
    fromIndex: 0,
  })

  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      laneIndex: 0,
      laneKey: 'alpha',
      listId: 1,
      config: store.state.config,
      hideHeader: true,
      hideResize: true,
      externalScroller: scroller,
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          template: '<div class="kanban-card-list" />',
        },
      },
    },
  })

  expect(wrapper.classes()).toContain('kanban-column-drop-forbidden')
  expect(wrapper.find('.kanban-column-drop-overlay').exists()).toBe(true)
  expect(wrapper.find('.kanban-column-drop-overlay__mark').exists()).toBe(true)
  wrapper.unmount()
})

test('disables Add outside the deepest open child panel', async () => {
  const { wrapper, store } = mountColumn()
  store.commit('SET_CREATE_OPTIONS_BY_COLUMN', {
    Open: {
      allowed: true,
      reason: null,
      form_mode: 'quick_entry',
      missing_mandatory: [],
      missing_fieldnames: [],
    },
  })
  await wrapper.vm.$nextTick()

  const headerAdd = wrapper.get('[aria-label="Add Task to Open"]')
  const footerAdd = wrapper.get('.addcard button')
  expect(headerAdd.attributes('disabled')).toBeUndefined()
  expect(footerAdd.attributes('disabled')).toBeUndefined()

  store.commit('OPEN_CHILD_PANEL', {
    scopeId: '0::PARENT-A',
    parentName: 'PARENT-A',
    depth: 0,
    hostLaneKey: null,
    ordinal: 0,
    columns: [{ name: 'open', column_name: 'Open', cards: [] }],
    columnPagination: {},
    columnTotals: {},
  })
  await wrapper.vm.$nextTick()

  expect(headerAdd.attributes('disabled')).toBeDefined()
  expect(footerAdd.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

test('keeps Add enabled inside the deepest child panel columns', async () => {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'name',
    fields: ['name'],
    parent_field: 'parent_task',
  })
  const column = {
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'blue',
    cards: [],
  }
  store.commit('SET_COLUMNS', [column])
  store.commit('SET_CREATE_OPTIONS_BY_COLUMN', {
    Open: {
      allowed: true,
      reason: null,
      form_mode: 'quick_entry',
      missing_mandatory: [],
      missing_fieldnames: [],
    },
  })
  store.commit('OPEN_CHILD_PANEL', {
    scopeId: '0::PARENT-A',
    parentName: 'PARENT-A',
    depth: 0,
    hostLaneKey: null,
    ordinal: 0,
    columns: [{ name: 'open', column_name: 'Open', cards: [] }],
    columnPagination: {},
    columnTotals: {},
  })

  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      config: store.state.config,
      childDepth: 1,
      hideHeader: true,
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          inheritAttrs: false,
          template: '<div role="list" class="kanban-card-list"><slot name="footer" /></div>',
        },
      },
    },
  })

  expect(wrapper.get('.addcard button').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

test('uses board Sortable group on main columns and scoped group in child panels', () => {
  const previousPermissive = globalThis.__dinextKanbanPermissiveMoves
  globalThis.__dinextKanbanPermissiveMoves = false

  const column = {
    name: 'open',
    column_name: 'Open',
    display_name: 'Open',
    indicator: 'gray',
    cards: [{ name: 'TASK-1', status: 'Open' }],
  }
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
  store.commit('OPEN_CHILD_PANEL', {
    scopeId: '0::PARENT',
    parentName: 'PARENT',
    depth: 0,
    hostLaneKey: null,
    ordinal: 3,
    columns: [column],
    columnPagination: {},
    columnTotals: {},
  })

  const boardWrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      config: store.state.config,
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          props: ['group'],
          template: '<div class="kanban-card-list" />',
        },
      },
    },
  })
  expect(boardWrapper.findComponent({ name: 'VirtualList' }).props('group')).toEqual(
    expect.objectContaining({ name: 'kanban', put: true }),
  )
  boardWrapper.unmount()

  const childWrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 0,
      config: store.state.config,
      childScopeId: '0::PARENT',
      childDepth: 1,
      hideHeader: true,
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          props: ['group'],
          template: '<div class="kanban-card-list" />',
        },
      },
    },
  })
  expect(childWrapper.findComponent({ name: 'VirtualList' }).props('group')).toEqual(
    expect.objectContaining({ name: 'kanban-child-3', put: true }),
  )
  childWrapper.unmount()

  globalThis.__dinextKanbanPermissiveMoves = previousPermissive
})

test('shows stick-room dropzone and drop chrome inside child panel columns', async () => {
  const previousPermissive = globalThis.__dinextKanbanPermissiveMoves
  globalThis.__dinextKanbanPermissiveMoves = false

  const column = {
    name: 'done',
    column_name: 'Done',
    display_name: 'Done',
    indicator: 'green',
    cards: [],
  }
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'name',
    fields: ['name'],
    status_field_meta: { fieldname: 'status', fieldtype: 'Select', read_only: 1 },
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', cards: [] },
    column,
  ])
  store.commit('OPEN_CHILD_PANEL', {
    scopeId: '0::PARENT',
    parentName: 'PARENT',
    depth: 0,
    hostLaneKey: null,
    ordinal: 0,
    columns: [
      { name: 'open', column_name: 'Open', cards: [] },
      column,
    ],
    columnPagination: {},
    columnTotals: {},
  })
  store.commit('SET_ACTIVE_DRAG', {
    cardName: 'CHILD-1',
    fromColumn: 0,
    fromIndex: 0,
    childScopeId: '0::PARENT',
  })

  const wrapper = mount(KanbanColumn, {
    props: {
      column,
      columnIndex: 1,
      config: store.state.config,
      childScopeId: '0::PARENT',
      childDepth: 1,
      hideHeader: true,
    },
    global: {
      plugins: [store],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        VirtualList: {
          name: 'VirtualList',
          template: '<div class="kanban-card-list"><slot name="footer" /></div>',
        },
      },
    },
  })

  expect(wrapper.find('.column-stick-room-dropzone').exists()).toBe(true)
  expect(wrapper.classes()).toContain('kanban-column-drop-forbidden')
  expect(wrapper.find('.kanban-column-drop-overlay').exists()).toBe(true)

  const dispatchSpy = vi.spyOn(store, 'dispatch').mockResolvedValue(true)
  store.commit('SET_CREATE_OPTIONS_BY_COLUMN', {
    Done: {
      allowed: true,
      reason: null,
      form_mode: 'quick_entry',
      missing_mandatory: [],
      missing_fieldnames: [],
    },
  })
  await wrapper.vm.$nextTick()
  await wrapper.get('.addcard button').trigger('click')
  expect(dispatchSpy).toHaveBeenCalledWith('startCreateCard', {
    columnIndex: 1,
    column: expect.objectContaining({ column_name: 'Done' }),
    laneKey: null,
    childScopeId: '0::PARENT',
  })

  wrapper.unmount()
  globalThis.__dinextKanbanPermissiveMoves = previousPermissive
})

test('floats collapsed title and menu above child panel without strip background', async () => {
  const { wrapper, store } = mountColumn(undefined, { boardPerms: { write: true } })
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  await wrapper.vm.$nextTick()

  expect(wrapper.find('.kanban-collapsed-chrome--floating').exists()).toBe(false)

  store.commit('OPEN_CHILD_PANEL', {
    scopeId: '0::PARENT',
    parentName: 'PARENT',
    depth: 0,
    hostLaneKey: null,
    ordinal: 0,
    columns: [],
    columnPagination: {},
    columnTotals: {},
  })
  await wrapper.vm.$nextTick()

  const floatingTitles = wrapper.findAll('h2.kanban-collapsed-chrome--floating')
  expect(floatingTitles.length).toBe(1)
  expect(floatingTitles[0].text()).toBe('Open')
  expect(floatingTitles[0].classes()).toContain('column-title--draggable')
  expect(floatingTitles[0].classes()).not.toContain('kanban-column')

  const floatingMenus = wrapper.findAll(
    '.column-header-actions.kanban-collapsed-chrome--floating',
  )
  expect(floatingMenus.length).toBe(1)
  expect(floatingMenus[0].find('.header-item').exists()).toBe(true)

  const inFlowTitle = wrapper.get('h2.column-title.kanban-collapsed-chrome--placeholder')
  expect(inFlowTitle.classes()).toContain('column-title--draggable')
  const dispatchSpy = vi.spyOn(inFlowTitle.element, 'dispatchEvent')

  floatingTitles[0].element.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1 }),
  )
  expect(document.documentElement.classList.contains('kanban-column-sortable-dragging')).toBe(true)
  expect(dispatchSpy).toHaveBeenCalled()
  const types = dispatchSpy.mock.calls.map((call) => call[0].type)
  expect(types).toEqual(expect.arrayContaining(['pointerdown', 'mousedown']))
  expect(dispatchSpy.mock.calls.every((call) => call[0].bubbles)).toBe(true)
  dispatchSpy.mockRestore()
  document.documentElement.classList.remove('kanban-column-sortable-dragging')

  // Column stacking context stays low; float is a Teleport sibling, not raised column.
  expect(wrapper.classes()).toContain('kanban-column--collapsed')
  expect(wrapper.attributes('style') || '').not.toMatch(/z-index:\s*6[0-9]/)

  await floatingTitles[0].trigger('dblclick')
  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
  await wrapper.vm.$nextTick()
  expect(wrapper.find('.kanban-collapsed-chrome--floating').exists()).toBe(false)
})

test('does not float collapsed chrome when no child panel is open', async () => {
  const { wrapper, store } = mountColumn()
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  await wrapper.vm.$nextTick()

  expect(wrapper.find('.kanban-collapsed-chrome--floating').exists()).toBe(false)
  expect(wrapper.get('h2.column-title').classes()).not.toContain(
    'kanban-collapsed-chrome--placeholder',
  )
})

test('re-syncs floating title after collapse settle and neighbor collapse', async () => {
  const { wrapper, store } = mountColumn(undefined, { boardPerms: { write: true } })

  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  store.commit('OPEN_CHILD_PANEL', {
    scopeId: '0::PARENT',
    parentName: 'PARENT',
    depth: 0,
    hostLaneKey: null,
    ordinal: 0,
    columns: [],
    columnPagination: {},
    columnTotals: {},
  })
  await wrapper.vm.$nextTick()

  const inFlowTitle = wrapper.get('h2.column-title.kanban-collapsed-chrome--placeholder')
  let rectLeft = 100
  const rectSpy = vi
    .spyOn(inFlowTitle.element, 'getBoundingClientRect')
    .mockImplementation(() => ({
      x: rectLeft,
      y: 150,
      top: 150,
      left: rectLeft,
      width: 52,
      height: 120,
      right: rectLeft + 52,
      bottom: 270,
      toJSON() {},
    }))

  // Neighbor collapse reflows this strip — immediate sync uses current rect.
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Done', collapsed: true })
  await wrapper.vm.$nextTick()
  expect(
    wrapper.get('h2.kanban-collapsed-chrome--floating').attributes('style') || '',
  ).toMatch(/left:\s*126px/)

  // Another neighbor change with a moved strip must re-sync immediately.
  rectLeft = 280
  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Closed', collapsed: true })
  await wrapper.vm.$nextTick()
  expect(
    wrapper.get('h2.kanban-collapsed-chrome--floating').attributes('style') || '',
  ).toMatch(/left:\s*306px/)

  // After width-transition settle, float must follow the final strip rect.
  rectLeft = 400
  await new Promise((resolve) => {
    setTimeout(resolve, COLUMN_COLLAPSE_ANIMATION_MS + 40)
  })
  await wrapper.vm.$nextTick()
  expect(
    wrapper.get('h2.kanban-collapsed-chrome--floating').attributes('style') || '',
  ).toMatch(/left:\s*426px/)

  rectSpy.mockRestore()
  wrapper.unmount()
})
