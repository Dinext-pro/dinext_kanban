import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createKanbanStore } from '../../utils/store'
import ChildPanel from './ChildPanel.vue'
import KanbanColumn from './KanbanColumn.vue'

beforeEach(() => {
  class MockResizeObserver {
    observe() {}

    disconnect() {}

    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  globalThis.__ = (text) => text
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete globalThis.__
})

function mountPanel({
  columns = [
    {
      name: 'open',
      column_name: 'Open',
      display_name: 'Open',
      indicator: 'blue',
      cards: [{ name: 'CHILD-1', status: 'Open' }],
    },
    {
      name: 'done',
      column_name: 'Done',
      display_name: 'Done',
      indicator: 'green',
      cards: [],
    },
  ],
  collapsedColumns = [],
} = {}) {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'name',
    parent_field: 'parent_task',
    fields: ['name', 'status'],
    status_field_meta: { fieldname: 'status', fieldtype: 'Select', parent: 'Task' },
  })
  store.commit('SET_COLUMNS', columns.map((column) => ({ ...column, cards: [] })))
  store.commit('SET_BOARD_PERMS', { write: true, create: true })
  const scopeId = '0::PARENT-1'
  store.commit('OPEN_CHILD_PANEL', {
    scopeId,
    parentName: 'PARENT-1',
    depth: 0,
    ordinal: 0,
    columns: columns.map((column) => ({
      ...column,
      cards: (column.cards || []).map((card) => ({ ...card })),
    })),
    columnPagination: Object.fromEntries(
      columns.map((column) => [
        column.column_name,
        { offset: column.cards?.length || 0, loading: false, hasMore: false },
      ]),
    ),
    columnTotals: Object.fromEntries(
      columns.map((column) => [column.column_name, column.cards?.length || 0]),
    ),
  })
  for (const columnKey of collapsedColumns) {
    store.commit('SET_COLUMN_COLLAPSED', { columnKey, collapsed: true })
  }

  const wrapper = mount(ChildPanel, {
    props: {
      parentName: 'PARENT-1',
      depth: 0,
      scopeId,
      config: store.state.config,
    },
    global: {
      plugins: [store],
      stubs: {
        KanbanColumn: {
          name: 'KanbanColumn',
          props: [
            'column',
            'columnIndex',
            'listId',
            'config',
            'childScopeId',
            'childDepth',
            'hideHeader',
            'hideResize',
          ],
          template: `
            <section
              class="kanban-column kanban-column--cell"
              data-testid="child-kanban-column"
            >
              <div
                v-for="card in column.cards || []"
                :key="card.name"
                class="kanban-card"
              >
                <span class="drag-handle drag" />
                {{ card.name }}
              </div>
            </section>
          `,
        },
      },
    },
  })
  return { store, wrapper, scopeId }
}

test('keeps KanbanColumn mounted across collapse and expand so drag handles survive', async () => {
  const { store, wrapper } = mountPanel()
  await nextTick()

  const openGroup = wrapper.get('.child-panel-group[data-column-value="Open"]')
  const columnBefore = openGroup.findComponent(KanbanColumn)
  expect(columnBefore.exists()).toBe(true)
  expect(columnBefore.find('.drag-handle.drag').exists()).toBe(true)
  expect(wrapper.find('.child-panel-cell-spacer[data-column-value="Open"]').exists()).toBe(false)
  const columnVm = columnBefore.vm

  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: true })
  await nextTick()

  expect(wrapper.find('.child-panel-cell-spacer[data-column-value="Open"]').exists()).toBe(true)
  const columnWhileCollapsed = openGroup.findComponent(KanbanColumn)
  expect(columnWhileCollapsed.exists()).toBe(true)
  expect(columnWhileCollapsed.vm).toBe(columnVm)
  expect(columnWhileCollapsed.element.style.display).toBe('none')

  store.commit('SET_COLUMN_COLLAPSED', { columnKey: 'Open', collapsed: false })
  await nextTick()

  expect(wrapper.find('.child-panel-cell-spacer[data-column-value="Open"]').exists()).toBe(false)
  const columnAfter = openGroup.findComponent(KanbanColumn)
  expect(columnAfter.exists()).toBe(true)
  expect(columnAfter.vm).toBe(columnVm)
  expect(columnAfter.element.style.display).not.toBe('none')
  expect(columnAfter.find('.drag-handle.drag').exists()).toBe(true)

  wrapper.unmount()
})

test('expands a collapsed column on double-click of the cell spacer', async () => {
  const { store, wrapper } = mountPanel({ collapsedColumns: ['Open'] })
  await nextTick()

  expect(wrapper.find('.child-panel-cell-spacer[data-column-value="Open"]').exists()).toBe(true)
  await wrapper.get('.child-panel-cell-spacer[data-column-value="Open"]').trigger('dblclick')
  await nextTick()

  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
  expect(wrapper.find('.child-panel-cell-spacer[data-column-value="Open"]').exists()).toBe(false)
  const column = wrapper.get('.child-panel-group[data-column-value="Open"]').findComponent(KanbanColumn)
  expect(column.exists()).toBe(true)
  expect(column.element.style.display).not.toBe('none')

  wrapper.unmount()
})

test('auto-expands a collapsed column after drag dwell on the cell spacer', async () => {
  vi.useFakeTimers()
  const { store, wrapper } = mountPanel({ collapsedColumns: ['Open'] })
  await nextTick()

  store.commit('SET_ACTIVE_DRAG', {
    cardName: 'CHILD-1',
    fromColumn: 0,
    fromIndex: 0,
    childScopeId: '0::PARENT-1',
    childDepth: 1,
  })

  const spacer = wrapper.get('.child-panel-cell-spacer[data-column-value="Open"]')
  await spacer.trigger('pointerenter')
  await vi.advanceTimersByTimeAsync(400)
  await nextTick()

  expect(store.getters.isColumnCollapsed('Open')).toBe(false)
  expect(wrapper.find('.child-panel-cell-spacer[data-column-value="Open"]').exists()).toBe(false)

  wrapper.unmount()
  vi.useRealTimers()
})
