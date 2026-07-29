import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createKanbanStore } from '../../utils/store'
import AddColumnControl from './AddColumnControl.vue'
import KanbanBoard from './KanbanBoard.vue'

vi.mock('../../utils/cardRollbackAnimation', () => ({
  animateCardRollback: vi.fn(() => Promise.resolve(true)),
  captureCardRect: vi.fn(() => ({
    left: 420,
    top: 240,
    width: 180,
    height: 96,
  })),
  prefersReducedMotion: vi.fn(() => true),
}))
vi.mock('../../utils/cardMoveFlash', () => ({
  flashMovedCard: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../../utils/columnSortable', () => ({
  createColumnSortable: vi.fn(() => ({ destroy: vi.fn() })),
  destroyColumnSortable: vi.fn(),
}))

function mountControl(store) {
  return mount(AddColumnControl, {
    global: {
      plugins: [store],
    },
  })
}

function mountBoard(store) {
  return mount(KanbanBoard, {
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
}

beforeEach(() => {
  frappe.get_route.mockReturnValue(['List', 'Task', 'Kanban', 'Task Board'])
})

afterEach(() => {
  delete window.refreshKanbanBoard
  delete window.hydrateDinextKanban
  delete window.dinextKanbanInitialData
})

test('hides add-column control without write permission or candidates', () => {
  const store = createKanbanStore()
  store.commit('SET_BOARD_PERMS', { write: false })
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: [],
    highlight_table: [],
    status_field_meta: {
      fieldname: 'status',
      fieldtype: 'Select',
      options: 'Open\nDone',
      parent: 'Task',
    },
  })
  store.commit('SET_COLUMNS', [])
  store.commit('SET_ARCHIVED_COLUMNS', [
    { name: 'open', column_name: 'Open', status: 'Archived' },
  ])

  const wrapper = mountControl(store)
  expect(wrapper.find('.add-column-control').exists()).toBe(false)
  wrapper.unmount()

  store.commit('SET_BOARD_PERMS', { write: true })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', cards: [] },
    { name: 'done', column_name: 'Done', cards: [] },
  ])
  store.commit('SET_ARCHIVED_COLUMNS', [])
  const empty = mountControl(store)
  expect(empty.find('.add-column-control').exists()).toBe(false)
  empty.unmount()
})

test('lists unused and archived columns and dispatches addColumn on select', async () => {
  const store = createKanbanStore()
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue()
  store.commit('SET_BOARD_PERMS', { write: true })
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: [],
    highlight_table: [],
    status_field_meta: {
      fieldname: 'status',
      fieldtype: 'Select',
      options: 'Open\nWorking\nDone',
      parent: 'Task',
    },
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', cards: [] },
  ])
  store.commit('SET_ARCHIVED_COLUMNS', [
    { name: 'done', column_name: 'Done', status: 'Archived', display_name: 'Done' },
  ])

  const wrapper = mountControl(store)
  expect(wrapper.find('.add-column-control').exists()).toBe(true)

  await wrapper.get('.add-column-trigger').trigger('click')
  const options = wrapper.findAll('.add-column-option')
  expect(options.map((option) => option.text().trim())).toEqual(['Working', 'Done'])

  await options[0].trigger('click')
  expect(dispatch).toHaveBeenCalledWith('addColumn', { column_title: 'Working' })
  wrapper.unmount()
})

test('renders add-column control after the last visible column', async () => {
  const store = createKanbanStore()
  vi.spyOn(store, 'dispatch').mockResolvedValue()
  store.commit('SET_BOARD_PERMS', { write: true })
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: [],
    highlight_table: [],
    status_field_meta: {
      fieldname: 'status',
      fieldtype: 'Select',
      options: 'Open\nReview\nDone',
      parent: 'Task',
    },
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', cards: [] },
    { name: 'review', column_name: 'Review', cards: [] },
  ])
  store.commit('SET_ARCHIVED_COLUMNS', [])
  store.commit('SET_LOADING', false)

  const wrapper = mountBoard(store)
  await wrapper.vm.$nextTick()

  const board = wrapper.get('.kanban')
  const children = [...board.element.children]
  expect(children[0].classList.contains('column-stub')).toBe(true)
  expect(children[1].classList.contains('column-stub')).toBe(true)
  expect(children[2].classList.contains('add-column-control')).toBe(true)
  wrapper.unmount()
})
