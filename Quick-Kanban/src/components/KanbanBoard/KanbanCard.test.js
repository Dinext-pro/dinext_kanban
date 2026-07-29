import { beforeEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createKanbanStore, buildPermissiveMoveOptions } from '../../utils/store'
import {
  CARD_EXPAND_DELAY_MS,
  CARD_EXPAND_DELAY_OVER_CHILD_COUNT_MS,
} from '../../utils/kanban'
import KanbanCard from './KanbanCard.vue'

vi.mock('../../utils/cardMoveFlash', () => ({
  flashMovedCard: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../utils/listNavigation', async () => {
  const actual = await vi.importActual('../../utils/listNavigation')
  return {
    ...actual,
    applyUserTagFilter: vi.fn(() => true),
  }
})

import { flashMovedCard } from '../../utils/cardMoveFlash'
import { applyUserTagFilter } from '../../utils/listNavigation'

function seedMoveOptions(store) {
  store.commit('SET_MOVE_OPTIONS_BATCH', {
    options: {
      'TASK-1': buildPermissiveMoveOptions(store.state),
    },
    generation: store.state.moveOptionsGeneration,
  })
}

function createStore() {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    title_field_meta: { fieldname: 'subject', label: 'Subject', fieldtype: 'Data', parent: 'Task' },
    highlighted_field_meta: { fieldname: 'priority', label: 'Priority', fieldtype: 'Select', parent: 'Task' },
    status_field_meta: { fieldname: 'status', fieldtype: 'Select', parent: 'Task' },
    fields: ['subject', 'priority', 'due_date', 'project'],
    display_fields: [
      { fieldname: 'due_date', label: 'Due date', fieldtype: 'Date', parent: 'Task' },
      { fieldname: 'project', label: 'Project', fieldtype: 'Link', parent: 'Task' },
    ],
    highlighted_field: 'priority',
    highlight_table: [{ tag: 'High', color: 'red' }],
    show_labels: true,
    show_tags: false,
    show_extra_info: false,
  })
  store.commit('SET_COLUMNS', [
    {
      name: 'open',
      column_name: 'Open',
      display_name: 'Open',
      cards: [{
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      }],
    },
    {
      name: 'done',
      column_name: 'Done',
      display_name: 'Done',
      cards: [],
    },
  ])
  seedMoveOptions(store)
  return store
}

beforeEach(() => {
  frappe.get_meta.mockReturnValue({
    fields: [
      { fieldname: 'priority', label: 'Priority', fieldtype: 'Select' },
      { fieldname: 'due_date', label: 'Due date', fieldtype: 'Date' },
      { fieldname: 'project', label: 'Project', fieldtype: 'Link' },
    ],
  })
  frappe.format = vi.fn((value, field) =>
    field.fieldtype === 'Link'
      ? `<a href="/app/project/${value}">${value}</a>`
      : `formatted:${value}`,
  )
  frappe.get_palette = vi.fn(() => ['--blue-100', '--blue-800'])
  frappe.model.can_write.mockReturnValue(false)
  frappe.ui.TagEditor.mockClear()
  frappe.ui.form.AssignToDialog.mockClear()
  frappe.ui.form.AssignmentDialog.mockClear()
  applyUserTagFilter.mockClear()
  flashMovedCard.mockClear()
  frappe.set_route.mockClear()
  cur_list.get_tags_html.mockClear()
})

test('renders a semantic card with labels and a dedicated drag handle', () => {
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      },
      config: createStore().state.config,
      columnIndex: 0,
    },
    global: {
      plugins: [createStore()],
      stubs: { Teleport: true },
    },
  })

  expect(wrapper.attributes('role')).toBe('listitem')
  expect(wrapper.get('[aria-label="Drag First task"]').exists()).toBe(true)
  expect(
    wrapper.findAll('[aria-label="Drag First task"] use[href="#icon-drag"]'),
  ).toHaveLength(2)
  expect(wrapper.text()).toContain('Due date')
  expect(wrapper.text()).toContain('formatted:2026-07-10')
  expect(wrapper.get('.kanban-card-fields a').text()).toBe('TEST-PROJECT')
  expect(wrapper.text()).not.toContain('<a href=')

  const fields = wrapper.findAll('.kanban-card-field')
  expect(fields).toHaveLength(2)
  expect(fields[0].find('dt').text()).toBe('Due date')
  expect(fields[0].find('dd').exists()).toBe(true)
  expect(fields[0].element.children[0].tagName).toBe('DT')
  expect(fields[0].element.children[1].tagName).toBe('DD')
  expect(fields[1].find('dt').text()).toBe('Project')
  expect(fields[1].element.children[0].tagName).toBe('DT')
  expect(fields[1].element.children[1].tagName).toBe('DD')
})

test('hides field labels when show_labels is disabled', () => {
  const store = createStore()
  const config = { ...store.state.config, show_labels: false }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.text()).not.toContain('Due date')
  expect(wrapper.text()).not.toContain('Project')
  expect(wrapper.text()).toContain('formatted:2026-07-10')
  expect(wrapper.get('.kanban-card-fields a').text()).toBe('TEST-PROJECT')
  expect(wrapper.findAll('.kanban-card-fields dt')).toHaveLength(0)
  const fields = wrapper.findAll('.kanban-card-field')
  expect(fields).toHaveLength(2)
  expect(fields[0].element.children[0].tagName).toBe('DD')
  expect(fields[1].element.children[0].tagName).toBe('DD')
})

test('renders Percent display fields as a progress bar', () => {
  const store = createStore()
  const config = {
    ...store.state.config,
    fields: ['subject', 'priority', 'progress'],
    display_fields: [
      { fieldname: 'progress', label: 'Progress', fieldtype: 'Percent', parent: 'Task' },
    ],
  }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        progress: 75,
        _assign: {},
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  const percentField = wrapper.get('dd[data-fieldtype="Percent"]')
  expect(percentField.find('.progress.kanban-card-progress').exists()).toBe(true)
  expect(percentField.find('.progress-bar-success').exists()).toBe(true)
  expect(percentField.html()).toContain('width: 75%')
  expect(frappe.format).not.toHaveBeenCalled()
})

test('renders colored tags between fields and meta when show_tags is enabled', () => {
  const store = createStore()
  const config = { ...store.state.config, show_tags: true }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _user_tags: ',alpha,beta,gamma,delta',
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  const details = wrapper.get('.kanban-card-fields-slot')
  const tags = wrapper.get('.kanban-tags')
  const fields = wrapper.get('.kanban-card-fields')
  const meta = wrapper.get('.kanban-card-meta')
  expect(fields.element.parentElement).toBe(details.get('.kanban-card-density-inner').element)
  expect(tags.element.parentElement).toBe(fields.element.parentElement)
  expect(fields.element.nextElementSibling).toBe(tags.element)
  expect(details.element.nextElementSibling).toBe(meta.element)
  expect(wrapper.findAll('.tag-pill')).toHaveLength(3)
  expect(wrapper.text()).toContain('alpha')
  expect(wrapper.text()).toContain('beta')
  expect(wrapper.text()).toContain('gamma')
  expect(wrapper.text()).not.toContain('delta')
  expect(cur_list.get_tags_html).toHaveBeenCalledWith(',alpha,beta,gamma,delta', 3, true)
})

test('renders extra info row after tags when show_extra_info is enabled', () => {
  const store = createStore()
  const config = { ...store.state.config, show_tags: true, show_extra_info: true }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _user_tags: ',alpha',
        _comment_count: 1,
        _attachment_count: 0,
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  const tags = wrapper.get('.kanban-tags')
  const extra = wrapper.get('.kanban-card-extra-info')
  expect(tags.element.nextElementSibling).toBe(extra.element)
  expect(extra.find('[aria-label="Copy link"]').exists()).toBe(true)
})

test('renders child count badge after highlight when _child_count > 0', () => {
  const store = createStore()
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _child_count: 3,
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  const highlight = wrapper.get('.kanban-highlight')
  const childCount = wrapper.get('.kanban-child-count')
  const actions = wrapper.get('.kanban-card-actions')
  expect(highlight.element.nextElementSibling).toBe(childCount.element)
  expect(childCount.element.nextElementSibling).toBe(actions.element)
  expect(childCount.text()).toContain('3')
  expect(childCount.attributes('aria-label')).toBe('Child records')
  expect(childCount.find('svg[data-icon="child-tree"]').exists()).toBe(true)
  expect(childCount.find('use[href="#icon-collapse"]').exists()).toBe(false)
  expect(childCount.find('.kanban-child-count__chevron').exists()).toBe(false)
})

test('child count badge uses collapse icon while panel is open', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.get('.kanban-child-count svg[data-icon="child-tree"]').exists()).toBe(true)
  openChildPanelFor(store, 'TASK-1', 0)
  await flushPromises()
  expect(wrapper.get('.kanban-child-count').attributes('aria-expanded')).toBe('true')
  expect(wrapper.get('.kanban-child-count use').attributes('href')).toBe('#icon-collapse')
  expect(wrapper.get('.kanban-title-area .kanban-child-count').exists()).toBe(true)
  expect(wrapper.find('.kanban-card-meta .kanban-child-count').exists()).toBe(false)
  expect(wrapper.find('.drag-handle').exists()).toBe(false)

  store.commit('CLOSE_CHILD_PANELS_FROM_DEPTH', 0)
  await flushPromises()
  expect(wrapper.get('.kanban-child-count svg[data-icon="child-tree"]').exists()).toBe(true)
  expect(wrapper.get('.kanban-card-meta .kanban-child-count').exists()).toBe(true)
  expect(wrapper.find('.kanban-title-area .kanban-child-count').exists()).toBe(false)
  expect(wrapper.find('.drag-handle').exists()).toBe(true)
})

test('panel-open host keeps badge in title row instead of drag handle', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  openChildPanelFor(store, 'TASK-1', 0)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--panel-ancestor')
  expect(wrapper.classes()).toContain('kanban-card--minimized')
  const titleArea = wrapper.get('.kanban-title-area')
  expect(titleArea.find('.kanban-child-count').exists()).toBe(true)
  expect(titleArea.find('.drag-handle').exists()).toBe(false)
  expect(wrapper.find('.kanban-card-meta .kanban-child-count').exists()).toBe(false)
})

test('depth-0 panel host does not get nested border gradient class', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  openChildPanelFor(store, 'TASK-1', 0)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--panel-ancestor')
  expect(wrapper.classes()).not.toContain('kanban-card--panel-host-nested')
})

test('nested panel host uses nested border gradient class', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  openChildPanelFor(store, 'TASK-ROOT', 0)
  openChildPanelFor(store, 'TASK-CHILD', 1)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-CHILD',
        subject: 'Child host',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 1,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--panel-ancestor')
  expect(wrapper.classes()).toContain('kanban-card--panel-host-nested')
})

test('child count click toggles child panel at card depth', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 1,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.get('.kanban-child-count').trigger('click')
  expect(dispatch).toHaveBeenCalledWith('toggleChildPanel', {
    parentName: 'TASK-1',
    depth: 1,
    laneKey: null,
  })
  expect(wrapper.get('.kanban-child-count').attributes('aria-expanded')).toBe('false')
})

test('marks non-host board cards inert when child panel is open', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  openChildPanelFor(store, 'TASK-PARENT', 0)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-OTHER',
        subject: 'Other task',
        status: 'Open',
        priority: 'Low',
        _assign: {},
        _child_count: 0,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--panel-inert')
  expect(wrapper.classes()).not.toContain('kanban-card--panel-ancestor')
})

test('inert board card click closes child panels from depth 0', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  openChildPanelFor(store, 'TASK-PARENT', 0)
  const commit = vi.spyOn(store, 'commit')
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-OTHER',
        subject: 'Other task',
        status: 'Open',
        priority: 'Low',
        _assign: {},
        _child_count: 0,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--panel-inert')

  await wrapper.trigger('click')
  expect(commit).toHaveBeenCalledWith('CLOSE_CHILD_PANELS_FROM_DEPTH', 0)
})

test('inert nested sibling click closes from depth 1 only', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  openChildPanelFor(store, 'TASK-ROOT', 0)
  openChildPanelFor(store, 'TASK-CHILD', 1)
  const commit = vi.spyOn(store, 'commit')
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-SIBLING',
        subject: 'Sibling in parent panel',
        status: 'Open',
        priority: 'Low',
        _assign: {},
        _child_count: 0,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 1,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--panel-inert')

  await wrapper.trigger('click')
  expect(commit).toHaveBeenCalledWith('CLOSE_CHILD_PANELS_FROM_DEPTH', 1)
  expect(commit).not.toHaveBeenCalledWith('CLOSE_CHILD_PANELS_FROM_DEPTH', 0)
})

test('ancestor host keeps badge clickable while panel is open', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(true)
  openChildPanelFor(store, 'TASK-1', 0)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--panel-ancestor')
  expect(wrapper.classes()).not.toContain('kanban-card--panel-inert')
  expect(wrapper.get('.kanban-child-count use').attributes('href')).toBe('#icon-collapse')
  await wrapper.get('.kanban-child-count').trigger('click')
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(dispatch).toHaveBeenCalledWith('toggleChildPanel', {
    parentName: 'TASK-1',
    depth: 0,
    laneKey: null,
  })
})

test('ancestor host card click closes child panel from card depth', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(true)
  openChildPanelFor(store, 'TASK-1', 0)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--panel-ancestor')

  await wrapper.trigger('click')
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(dispatch).toHaveBeenCalledWith('toggleChildPanel', {
    parentName: 'TASK-1',
    depth: 0,
    laneKey: null,
  })
})

test('nested ancestor root click closes from depth 0', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  openChildPanelFor(store, 'TASK-ROOT', 0)
  openChildPanelFor(store, 'TASK-CHILD', 1)
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-ROOT',
        subject: 'Root parent',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--panel-ancestor')

  await wrapper.trigger('click')
  expect(dispatch).toHaveBeenCalledWith('toggleChildPanel', {
    parentName: 'TASK-ROOT',
    depth: 0,
    laneKey: null,
  })
})

test('active card click does not toggle child panel', async () => {
  const store = createStore()
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  openChildPanelFor(store, 'TASK-PARENT', 0)
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(true)
  const commit = vi.spyOn(store, 'commit')
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-IN-PANEL',
        subject: 'Child in open panel',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _child_count: 0,
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 1,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.classes()).not.toContain('kanban-card--panel-inert')
  expect(wrapper.classes()).not.toContain('kanban-card--panel-ancestor')

  await wrapper.trigger('click')
  expect(dispatch).not.toHaveBeenCalledWith(
    'toggleChildPanel',
    expect.anything(),
  )
  expect(commit).not.toHaveBeenCalledWith('CLOSE_CHILD_PANELS_FROM_DEPTH', expect.anything())
})

function openChildPanelFor(store, parentName, depth = 0) {
  const scopeId = `${depth}::${parentName}`
  store.commit('OPEN_CHILD_PANEL', {
    scopeId,
    parentName,
    depth,
    ordinal: 0,
    columns: store.state.columns.map((column) => ({ ...column, cards: [] })),
    columnPagination: {},
    columnTotals: {},
  })
}

test('minimizes parent card when child panel opens with Minimize off', async () => {
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', false)
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  openChildPanelFor(store, 'TASK-1', 0)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.get('.kanban-card-fields-slot').element.style.maxHeight).toBe('0px')
  expect(wrapper.get('.kanban-child-count').attributes('aria-expanded')).toBe('true')

  store.commit('CLOSE_CHILD_PANELS_FROM_DEPTH', 0)
  await flushPromises()
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
})

test('keeps parent minimized while panel open even with Minimize on and hover', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  store.commit('SET_KANBAN_CONFIG', {
    ...store.state.config,
    parent_field: 'parent_task',
  })
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  openChildPanelFor(store, 'TASK-1', 0)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.classes()).not.toContain('kanban-card--expanded')
  expect(store.state.densityHoldExpandedCard).toBeNull()

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.classes()).not.toContain('kanban-card--expanded')

  vi.useRealTimers()
})

test('hides child count badge when _child_count is zero or missing', () => {
  const store = createStore()
  const withoutCount = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  expect(withoutCount.find('.kanban-child-count').exists()).toBe(false)

  const zeroCount = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-2',
        subject: 'Second task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _child_count: 0,
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  expect(zeroCount.find('.kanban-child-count').exists()).toBe(false)
})

test('shows details slot when only show_extra_info is enabled', () => {
  const store = createStore()
  const config = {
    ...store.state.config,
    display_fields: [],
    show_tags: false,
    show_extra_info: true,
  }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.find('.kanban-card-fields-slot').exists()).toBe(true)
  expect(wrapper.find('.kanban-card-extra-info').exists()).toBe(true)
})

test('hides tags when show_tags is disabled', () => {
  const store = createStore()
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _user_tags: ',alpha,beta',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.find('.kanban-tags').exists()).toBe(false)
})

test('double-click on read-only tag pill applies user tag filter', async () => {
  const store = createStore()
  const config = { ...store.state.config, show_tags: true }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _user_tags: ',alpha,beta',
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.find('.tag-pill').trigger('dblclick')
  expect(applyUserTagFilter).toHaveBeenCalledWith('alpha')
  expect(frappe.set_route).not.toHaveBeenCalled()
})

test('double-click on card chrome opens the card form', async () => {
  const store = createStore()
  const wrapper = mount(KanbanCard, {
    props: {
      card: store.state.columns[0].cards[0],
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.get('.drag-handle').trigger('dblclick')
  expect(frappe.set_route).toHaveBeenCalledWith('Form', 'Task', 'TASK-1')
})

test('double-click on card actions does not open the card form', async () => {
  const store = createStore()
  const wrapper = mount(KanbanCard, {
    props: {
      card: store.state.columns[0].cards[0],
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.get('.kanban-card-actions').trigger('dblclick')
  expect(frappe.set_route).not.toHaveBeenCalled()
})

test('mounts editable CardTags when show_tags and can_write', async () => {
  frappe.model.can_write.mockReturnValue(true)
  const store = createStore()
  const config = { ...store.state.config, show_tags: true }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _user_tags: ',alpha,beta,gamma,delta',
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()

  expect(wrapper.find('.kanban-tags--editable').exists()).toBe(true)
  expect(wrapper.findAll('.tag-pill')).toHaveLength(0)
  expect(frappe.ui.TagEditor).toHaveBeenCalled()
  expect(cur_list.get_tags_html).not.toHaveBeenCalled()
})

test('shows editable tags area when can_write even without tags', async () => {
  frappe.model.can_write.mockReturnValue(true)
  const store = createStore()
  const config = { ...store.state.config, show_tags: true }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _user_tags: '',
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()

  expect(wrapper.find('.kanban-card-fields-slot').exists()).toBe(true)
  expect(wrapper.find('.kanban-tags--editable').exists()).toBe(true)
  expect(wrapper.find('.add-tags-btn').exists()).toBe(true)
})

test('offers a keyboard-operable move control', async () => {
  const store = createStore()
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue()
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  const trigger = wrapper.get('[aria-label="Move First task"]')
  expect(trigger.element.tagName).toBe('BUTTON')
  expect(trigger.attributes('aria-expanded')).toBe('false')
  expect(wrapper.find('select.move-card-select').exists()).toBe(false)

  await trigger.trigger('click')
  expect(trigger.attributes('aria-expanded')).toBe('true')
  await wrapper.get('[aria-label="Move First task to Done"]').trigger('click')

  expect(dispatch).toHaveBeenCalledWith('moveCard', expect.objectContaining({
    cardName: 'TASK-1',
    fromColumn: 0,
    toColumn: 1,
    toIndex: 0,
  }))
  expect(trigger.attributes('aria-expanded')).toBe('false')
})

test('menu move inside a child panel passes childScopeId and panel fromIndex', async () => {
  const store = createStore()
  const scopeId = '0::PARENT-A'
  store.commit('OPEN_CHILD_PANEL', {
    scopeId,
    parentName: 'PARENT-A',
    depth: 0,
    hostLaneKey: null,
    ordinal: 0,
    columns: [
      {
        name: 'open',
        column_name: 'Open',
        cards: [{
          name: 'TASK-1',
          subject: 'First task',
          status: 'Open',
          priority: 'High',
          _assign: {},
        }],
      },
      { name: 'done', column_name: 'Done', cards: [] },
    ],
    columnPagination: {},
    columnTotals: {},
  })
  store.commit('SET_COLUMNS', [
    { name: 'open', column_name: 'Open', display_name: 'Open', cards: [] },
    { name: 'done', column_name: 'Done', display_name: 'Done', cards: [] },
  ])
  seedMoveOptions(store)
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
      childDepth: 1,
      childScopeId: scopeId,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.get('[aria-label="Move First task"]').trigger('click')
  await wrapper.get('[aria-label="Move First task to Done"]').trigger('click')

  expect(dispatch).toHaveBeenCalledWith('moveCard', expect.objectContaining({
    cardName: 'TASK-1',
    fromColumn: 0,
    toColumn: 1,
    fromIndex: 0,
    childScopeId: scopeId,
  }))
})

test('flashes the card after a successful menu move', async () => {
  const store = createStore()
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.get('[aria-label="Move First task"]').trigger('click')
  await wrapper.get('[aria-label="Move First task to Done"]').trigger('click')
  await flushPromises()

  expect(dispatch).toHaveBeenCalledWith('moveCard', expect.objectContaining({
    cardName: 'TASK-1',
    toColumn: 1,
  }))
  expect(flashMovedCard).toHaveBeenCalledWith('TASK-1', { outcome: 'success' })
})

test('passes laneIndex to scrollToMovedCard after a successful menu move', async () => {
  const store = createStore()
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(true)
  const scrollToMovedCard = vi.fn(() => Promise.resolve())
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
      laneIndex: 2,
    },
    global: {
      plugins: [store],
      stubs: { Teleport: true },
      provide: { scrollToMovedCard },
    },
  })

  await wrapper.get('[aria-label="Move First task"]').trigger('click')
  await wrapper.get('[aria-label="Move First task to Done"]').trigger('click')
  await flushPromises()

  expect(scrollToMovedCard).toHaveBeenCalledWith({
    columnIndex: 1,
    cardName: 'TASK-1',
    cardIndex: 0,
    laneIndex: 2,
  })
})

test('flashes the card after a failed menu move', async () => {
  const store = createStore()
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(false)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.get('[aria-label="Move First task"]').trigger('click')
  await wrapper.get('[aria-label="Move First task to Done"]').trigger('click')
  await flushPromises()

  expect(dispatch).toHaveBeenCalledWith('moveCard', expect.anything())
  expect(flashMovedCard).toHaveBeenCalledWith('TASK-1', { outcome: 'failure' })
})

test('applies move flash classes from store state', () => {
  const store = createStore()
  store.commit('SET_CARD_MOVE_FLASH', {
    cardName: 'TASK-1',
    outcome: 'success',
    instant: false,
  })
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.classes()).toContain('kanban-card-move-flash')
  expect(wrapper.classes()).toContain('kanban-card-move-flash--success')
})

test('closes the move disclosure with Escape and restores trigger state', async () => {
  const store = createStore()
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  const trigger = wrapper.get('[aria-label="Move First task"]')

  await trigger.trigger('click')
  await wrapper.get('[aria-label="Move First task to column"]').trigger(
    'keydown',
    { key: 'Escape' },
  )

  expect(trigger.attributes('aria-expanded')).toBe('false')
  expect(wrapper.find('[aria-label="Move First task to column"]').exists()).toBe(false)
})

test('closes the move disclosure on an outside pointer without stealing focus', async () => {
  const store = createStore()
  const outside = document.createElement('button')
  document.body.append(outside)
  const wrapper = mount(KanbanCard, {
    attachTo: document.body,
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.get('[aria-label="Move First task"]').trigger('click')
  outside.focus()
  outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  await wrapper.vm.$nextTick()

  expect(wrapper.find('[aria-label="Move First task to column"]').exists()).toBe(false)
  expect(outside).toBe(document.activeElement)
  wrapper.unmount()
  outside.remove()
})

test('renders assignment avatars with separate edit and add click targets', async () => {
  const store = createStore()
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {
          'one@example.com': 'One User',
          'two@example.com': 'Two User',
          'three@example.com': 'Three User',
          'four@example.com': 'Four User',
        },
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()

  expect(wrapper.get('.assignments-block').element.tagName).toBe('DIV')
  expect(frappe.avatar_group).toHaveBeenCalledWith(
    [
      'one@example.com',
      'two@example.com',
      'three@example.com',
      'four@example.com',
    ],
    2,
    expect.objectContaining({
      css_class: 'avatar avatar-small',
      action_icon: 'add',
      action: expect.any(Function),
    }),
  )
  expect(wrapper.find('.avatar-extra-count').text()).toBe('+2')
  expect(wrapper.findAll('.avatar.avatar-small[data-user]')).toHaveLength(2)
  expect(wrapper.find('.avatar-action').exists()).toBe(true)

  await wrapper.get('.avatar.avatar-small[data-user]').trigger('click')
  expect(frappe.ui.form.AssignmentDialog).toHaveBeenCalledWith(
    expect.objectContaining({
      assignments: [
        'one@example.com',
        'two@example.com',
        'three@example.com',
        'four@example.com',
      ],
      frm: expect.objectContaining({
        doctype: 'Task',
        docname: 'TASK-1',
      }),
    }),
  )
  expect(frappe.ui.form.AssignToDialog).not.toHaveBeenCalled()

  frappe.ui.form.AssignmentDialog.mockClear()
  await wrapper.get('.avatar-action').trigger('click')
  expect(frappe.ui.form.AssignToDialog).toHaveBeenCalledWith(
    expect.objectContaining({
      doctype: 'Task',
      docname: 'TASK-1',
    }),
  )
  expect(frappe.ui.form.AssignmentDialog).not.toHaveBeenCalled()
})

test('renders translated labels, values, and column names from metadata', async () => {
  const originalTranslate = globalThis.__
  globalThis.__ = (message, values = [], context) => {
    const map = {
      'Due date::Task': 'Срок',
      'Project::Task': 'Проект',
      'High::Task': 'Высокий',
      'Done::Task': 'Готово',
    }
    const translated = context
      ? map[`${message}::${context}`] || message
      : map[message] || message
    return (values || []).reduce(
      (result, value, index) => result.replace(`{${index}}`, value),
      translated,
    )
  }

  const store = createStore()
  store.state.columns[1].display_name = 'Готово'
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue()
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.text()).toContain('Срок')
  expect(wrapper.find('.kanban-highlight').text()).toBe('Высокий')

  await wrapper.get('[aria-label="Move First task"]').trigger('click')
  expect(wrapper.get('[aria-label="Move First task to Готово"]').exists()).toBe(true)
  await wrapper.get('[aria-label="Move First task to Готово"]').trigger('click')
  expect(dispatch).toHaveBeenCalledWith('moveCard', expect.objectContaining({
    toColumn: 1,
  }))

  globalThis.__ = originalTranslate
})

test('opens the add assignment dialog from the plus action when empty', async () => {
  const store = createStore()
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()

  await wrapper.get('.avatar-action').trigger('click')
  expect(frappe.ui.form.AssignToDialog).toHaveBeenCalled()
  expect(frappe.ui.form.AssignmentDialog).not.toHaveBeenCalled()
})

test('applies card accent class and CSS variable when color is valid', () => {
  const store = createStore()
  const config = {
    ...store.state.config,
    color_field: 'color',
    color_field_meta: { fieldname: 'color', fieldtype: 'Color', parent: 'Task' },
  }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        color: '#FF5733',
        _assign: {},
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.classes()).toContain('kanban-card--has-color')
  expect(wrapper.attributes('style')).toContain('--card-accent-color: #FF5733')
})

test('does not apply card accent styling for empty or invalid color values', () => {
  const store = createStore()
  const config = {
    ...store.state.config,
    color_field: 'color',
    color_field_meta: { fieldname: 'color', fieldtype: 'Color', parent: 'Task' },
  }

  for (const color of ['', null, 'not-a-color']) {
    const wrapper = mount(KanbanCard, {
      props: {
        card: {
          name: 'TASK-1',
          subject: 'First task',
          status: 'Open',
          priority: 'High',
          color,
          _assign: {},
        },
        config,
        columnIndex: 0,
      },
      global: { plugins: [store], stubs: { Teleport: true } },
    })

    expect(wrapper.classes()).not.toContain('kanban-card--has-color')
    expect(wrapper.attributes('style') || '').not.toContain('--card-accent-color')
  }
})

test('collapses fields and tags slots while minimized; keeps header and meta', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const config = { ...store.state.config, show_tags: true }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _user_tags: ',alpha,beta',
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.find('.kanban-card-fields-slot').exists()).toBe(true)
  expect(wrapper.find('.kanban-card-density-inner .kanban-card-fields').exists()).toBe(true)
  expect(wrapper.find('.kanban-card-density-inner .kanban-tags').exists()).toBe(true)
  expect(wrapper.get('.card-title').text()).toBe('First task')
  expect(wrapper.get('[aria-label="Drag First task"]').exists()).toBe(true)
  expect(wrapper.get('.kanban-highlight').text()).toBe('High')
  expect(wrapper.get('[aria-label="Move First task"]').exists()).toBe(true)
  expect(wrapper.get('.assignments-block').exists()).toBe(true)

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  expect(wrapper.text()).toContain('alpha')
  expect(wrapper.text()).toContain('beta')
  expect(wrapper.text()).toContain('Due date')

  vi.useRealTimers()
})

test('shows deadline icon before title only while minimized', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const config = {
    ...store.state.config,
    deadline_enabled: true,
    deadline_field: 'due_date',
    deadline_attention_days: 3,
    deadline_columns: ['Open'],
  }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2020-01-01',
        project: 'TEST-PROJECT',
        _assign: {},
        _deadline_bucket: 'overdue',
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.classes()).toContain('kanban-card--minimized')
  const titleIcon = wrapper.find('.kanban-title-area .kanban-title-deadline-icon')
  expect(titleIcon.exists()).toBe(true)
  expect(titleIcon.classes()).toContain('kanban-deadline-icon--overdue')
  expect(titleIcon.classes()).toContain('kanban-title-deadline-icon--visible')
  expect(titleIcon.find('use').attributes('href')).toBe('#icon-solid-error')

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  const expandedIcon = wrapper.find('.kanban-title-area .kanban-title-deadline-icon')
  expect(expandedIcon.exists()).toBe(true)
  expect(expandedIcon.classes()).not.toContain('kanban-title-deadline-icon--visible')

  vi.useRealTimers()
})

test('hides title deadline icon when minimize is off', () => {
  const store = createStore()
  const config = {
    ...store.state.config,
    deadline_enabled: true,
    deadline_field: 'due_date',
    deadline_attention_days: 3,
    deadline_columns: ['Open'],
  }
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2020-01-01',
        project: 'TEST-PROJECT',
        _assign: {},
        _deadline_bucket: 'overdue',
      },
      config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  const titleIcon = wrapper.find('.kanban-title-area .kanban-title-deadline-icon')
  expect(titleIcon.exists()).toBe(true)
  expect(titleIcon.classes()).not.toContain('kanban-title-deadline-icon--visible')
})

test('animates fields-slot max-height when minimize preference toggles', async () => {
  const store = createStore()
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  await flushPromises()

  const slot = wrapper.get('.kanban-card-fields-slot').element
  Object.defineProperty(slot, 'scrollHeight', {
    configurable: true,
    get: () => 120,
  })

  store.commit('SET_MINIMIZE_CARDS', true)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(slot.style.maxHeight).toBe('0px')

  store.commit('SET_MINIMIZE_CARDS', false)
  await flushPromises()
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  expect(slot.style.maxHeight).toBe('120px')
})

test('expands minimized card after hover delay and collapses after leave', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.find('.kanban-card-fields-slot').exists()).toBe(true)

  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  expect(wrapper.text()).toContain('Due date')

  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.classes()).not.toContain('kanban-card--expanded')
  expect(wrapper.find('.kanban-card-fields-slot').exists()).toBe(true)

  vi.useRealTimers()
})

test('uses longer expand delay while hovering child-count badge', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.get('.kanban-child-count').trigger('pointerenter', { pointerType: 'mouse' })
  expect(wrapper.classes()).toContain('kanban-card--minimized')

  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')

  await vi.advanceTimersByTimeAsync(
    CARD_EXPAND_DELAY_OVER_CHILD_COUNT_MS - CARD_EXPAND_DELAY_MS,
  )
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')

  wrapper.unmount()
  vi.useRealTimers()
})

test('entering child-count badge reschedules expand to the longer delay', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS - 100)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')

  await wrapper.get('.kanban-child-count').trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')

  await vi.advanceTimersByTimeAsync(
    CARD_EXPAND_DELAY_OVER_CHILD_COUNT_MS - CARD_EXPAND_DELAY_MS,
  )
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')

  wrapper.unmount()
  vi.useRealTimers()
})

test('leaving child-count badge restores the base expand delay while still on card', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _child_count: 2,
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  const matchesSpy = vi.spyOn(wrapper.element, 'matches').mockImplementation((selector) => {
    if (selector === ':hover') {
      return true
    }
    return Element.prototype.matches.call(wrapper.element, selector)
  })

  await wrapper.get('.kanban-child-count').trigger('pointerenter', { pointerType: 'mouse' })
  await wrapper.get('.kanban-child-count').trigger('pointerleave', { pointerType: 'mouse' })

  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')

  matchesSpy.mockRestore()
  wrapper.unmount()
  vi.useRealTimers()
})

test('keeps expanded density while dragging and after remount until leave', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const card = {
    name: 'TASK-1',
    subject: 'First task',
    status: 'Open',
    priority: 'High',
    due_date: '2026-07-10',
    project: 'TEST-PROJECT',
    _assign: {},
  }
  const wrapper = mount(KanbanCard, {
    props: {
      card,
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  store.commit('SET_ACTIVE_DRAG', {
    cardName: 'TASK-1',
    fromColumn: 0,
    fromIndex: 0,
  })
  await flushPromises()
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  wrapper.unmount()
  store.commit('SET_ACTIVE_DRAG', null)

  const remounted = mount(KanbanCard, {
    props: {
      card,
      config: store.state.config,
      columnIndex: 1,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  expect(remounted.classes()).toContain('kanban-card--expanded')
  expect(remounted.classes()).not.toContain('kanban-card--minimized')

  await remounted.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(remounted.classes()).toContain('kanban-card--minimized')
  expect(store.state.densityHoldExpandedCard).toBeNull()

  remounted.unmount()
  vi.useRealTimers()
})

test('expands minimized card on tag-drag hover after expand delay', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  store.commit('SET_ACTIVE_TAG_DRAG', {
    tag: 'alpha',
    sourceCardName: 'TASK-OTHER',
    mode: 'copy',
  })
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _user_tags: '',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.classes()).toContain('kanban-card--minimized')

  store.commit('SET_TAG_DRAG_HOVER', 'TASK-1')
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')

  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')

  store.commit('SET_TAG_DRAG_HOVER', null)
  await flushPromises()
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')

  wrapper.unmount()
  vi.useRealTimers()
})

test('pointerenter expands during tag-drag after the same delay', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  store.commit('SET_ACTIVE_TAG_DRAG', {
    tag: 'alpha',
    sourceCardName: 'TASK-OTHER',
    mode: 'copy',
  })
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _user_tags: '',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.classes()).toContain('kanban-card--minimized')

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')

  wrapper.unmount()
  vi.useRealTimers()
})

test('marks minimized card as tag drop target; expands only after hover delay', async () => {
  vi.useFakeTimers()
  frappe.model.can_write.mockReturnValue(true)
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  store.commit('SET_ACTIVE_TAG_DRAG', {
    tag: 'alpha',
    sourceCardName: 'TASK-OTHER',
    mode: 'copy',
  })
  store.commit('SET_TAG_DRAG_HOVER', 'TASK-1')
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _user_tags: ',beta',
      },
      config: {
        ...store.state.config,
        show_tags: true,
      },
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.classes()).toContain('kanban-card-tag-drop-allowed')

  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).toContain('kanban-card-tag-drop-allowed')

  wrapper.unmount()
  const forbidden = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _user_tags: ',alpha,beta',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  expect(forbidden.classes()).toContain('kanban-card-tag-drop-forbidden')
  forbidden.unmount()
  vi.useRealTimers()
})

test('expands minimized card when density hold targets it after tag drop', async () => {
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _user_tags: ',beta',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  expect(wrapper.classes()).toContain('kanban-card--minimized')

  store.commit('SET_DENSITY_HOLD_EXPANDED', 'TASK-1')
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')

  wrapper.unmount()
})

test('force-collapses tag-drag source even when local expand state was open', async () => {
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _user_tags: ',alpha',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  store.commit('SET_ACTIVE_TAG_DRAG', {
    tag: 'alpha',
    sourceCardName: 'TASK-1',
    mode: 'copy',
  })
  store.commit('SET_DENSITY_HOLD_EXPANDED', 'TASK-1')
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  store.commit('CLEAR_ACTIVE_TAG_DRAG')
  store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-1')
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.classes()).not.toContain('kanban-card--expanded')
  expect(store.state.densityHoldExpandedCard).toBeNull()
  expect(store.state.densityForceCollapsedCards['TASK-1']).toBe(true)

  wrapper.unmount()
})

test('keeps tag-drag source minimized after unmount/remount when force-collapsed', async () => {
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const card = {
    name: 'TASK-1',
    subject: 'First task',
    status: 'Open',
    priority: 'High',
    _assign: {},
    _user_tags: ',alpha',
  }
  const mountOpts = {
    props: {
      card,
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  }

  const wrapper = mount(KanbanCard, mountOpts)
  store.commit('SET_DENSITY_HOLD_EXPANDED', 'TASK-1')
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-1')
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')
  wrapper.unmount()

  const remounted = mount(KanbanCard, mountOpts)
  expect(remounted.classes()).toContain('kanban-card--minimized')
  expect(remounted.classes()).not.toContain('kanban-card--expanded')

  remounted.unmount()
})

test('clears force-collapse and expands again on intentional hover', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _user_tags: ',alpha',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-1')
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()

  expect(store.state.densityForceCollapsedCards['TASK-1']).toBeUndefined()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  wrapper.unmount()
  vi.useRealTimers()
})

test('collapses tag-drag source after force-collapse while target hold expands goal', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const source = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-SOURCE',
        subject: 'Source',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _user_tags: ',alpha',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })
  const target = mount(KanbanCard, {
    props: {
      card: {
        name: 'TASK-1',
        subject: 'Target',
        status: 'Open',
        priority: 'High',
        _assign: {},
        _user_tags: '',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  store.commit('SET_ACTIVE_TAG_DRAG', {
    tag: 'alpha',
    sourceCardName: 'TASK-SOURCE',
    mode: 'copy',
  })
  store.commit('SET_DENSITY_HOLD_EXPANDED', 'TASK-SOURCE')
  await flushPromises()

  store.commit('CLEAR_ACTIVE_TAG_DRAG')
  store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-SOURCE')
  store.commit('SET_DENSITY_HOLD_EXPANDED', 'TASK-1')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()

  expect(source.classes()).toContain('kanban-card--minimized')
  expect(target.classes()).toContain('kanban-card--expanded')
  expect(store.state.densityForceCollapsedCards['TASK-SOURCE']).toBe(true)
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  source.unmount()
  target.unmount()
  vi.useRealTimers()
})

test('collapses after inline-edit ends when pointer already left the card', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    attachTo: document.body,
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  store.commit('SET_ACTIVE_INLINE_EDIT', {
    cardName: 'TASK-1',
    fieldname: 'subject',
  })
  await flushPromises()
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  store.commit('CLEAR_ACTIVE_INLINE_EDIT')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.classes()).not.toContain('kanban-card--expanded')
  expect(store.state.densityHoldExpandedCard).toBeNull()

  wrapper.unmount()
  vi.useRealTimers()
})

test('stays expanded after inline-edit ends while pointer remains over the card', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    attachTo: document.body,
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  store.commit('SET_ACTIVE_INLINE_EDIT', {
    cardName: 'TASK-1',
    fieldname: 'subject',
  })
  await flushPromises()

  const matchesSpy = vi.spyOn(wrapper.element, 'matches').mockImplementation((selector) => {
    if (selector === ':hover') {
      return true
    }
    return Element.prototype.matches.call(wrapper.element, selector)
  })

  store.commit('CLEAR_ACTIVE_INLINE_EDIT')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  matchesSpy.mockRestore()
  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(store.state.densityHoldExpandedCard).toBeNull()

  wrapper.unmount()
  vi.useRealTimers()
})

test('collapses after tag-edit ends when pointer already left the card', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    attachTo: document.body,
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _user_tags: ',alpha',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  store.commit('SET_ACTIVE_INLINE_EDIT', {
    cardName: 'TASK-1',
    fieldname: '_user_tags',
  })
  await flushPromises()
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  store.commit('CLEAR_ACTIVE_INLINE_EDIT')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.classes()).not.toContain('kanban-card--expanded')
  expect(store.state.densityHoldExpandedCard).toBeNull()

  wrapper.unmount()
  vi.useRealTimers()
})

test('stays expanded after tag-edit ends while pointer remains over the card', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    attachTo: document.body,
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _user_tags: ',alpha',
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  store.commit('SET_ACTIVE_INLINE_EDIT', {
    cardName: 'TASK-1',
    fieldname: '_user_tags',
  })
  await flushPromises()

  const matchesSpy = vi.spyOn(wrapper.element, 'matches').mockImplementation((selector) => {
    if (selector === ':hover') {
      return true
    }
    return Element.prototype.matches.call(wrapper.element, selector)
  })

  store.commit('CLEAR_ACTIVE_INLINE_EDIT')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  matchesSpy.mockRestore()
  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(store.state.densityHoldExpandedCard).toBeNull()

  wrapper.unmount()
  vi.useRealTimers()
})

test('keeps expanded density while move menu is open after pointer leave', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    attachTo: document.body,
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  await wrapper.get('[aria-label="Move First task"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[aria-label="Move First task"]').attributes('aria-expanded')).toBe('true')

  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  wrapper.unmount()
  vi.useRealTimers()
})

test('collapses after move menu closes when pointer already left the card', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    attachTo: document.body,
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()

  await wrapper.get('[aria-label="Move First task"]').trigger('click')
  await flushPromises()

  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  await wrapper.get('[aria-label="Move First task to column"]').trigger(
    'keydown',
    { key: 'Escape' },
  )
  await flushPromises()
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.classes()).not.toContain('kanban-card--expanded')
  expect(store.state.densityHoldExpandedCard).toBeNull()

  wrapper.unmount()
  vi.useRealTimers()
})

test('stays expanded after move menu closes while pointer remains over the card', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  const wrapper = mount(KanbanCard, {
    attachTo: document.body,
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      },
      config: store.state.config,
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()

  await wrapper.get('[aria-label="Move First task"]').trigger('click')
  await flushPromises()

  const matchesSpy = vi.spyOn(wrapper.element, 'matches').mockImplementation((selector) => {
    if (selector === ':hover') {
      return true
    }
    return Element.prototype.matches.call(wrapper.element, selector)
  })

  await wrapper.get('[aria-label="Move First task to column"]').trigger(
    'keydown',
    { key: 'Escape' },
  )
  await flushPromises()
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')

  matchesSpy.mockRestore()
  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--minimized')

  wrapper.unmount()
  vi.useRealTimers()
})

test('keeps expanded density while files menu is open after pointer leave', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  frappe.call.mockResolvedValue({ docinfo: { attachments: [] } })
  const wrapper = mount(KanbanCard, {
    attachTo: document.body,
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _attachment_count: 0,
      },
      config: { ...store.state.config, show_extra_info: true },
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')

  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[aria-label="Attachments"]').attributes('aria-expanded')).toBe('true')

  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  wrapper.unmount()
  vi.useRealTimers()
})

test('collapses after files menu closes when pointer already left the card', async () => {
  vi.useFakeTimers()
  const store = createStore()
  store.commit('SET_MINIMIZE_CARDS', true)
  frappe.call.mockResolvedValue({ docinfo: { attachments: [] } })
  const wrapper = mount(KanbanCard, {
    attachTo: document.body,
    props: {
      card: {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
        _attachment_count: 0,
      },
      config: { ...store.state.config, show_extra_info: true },
      columnIndex: 0,
    },
    global: { plugins: [store], stubs: { Teleport: true } },
  })

  await wrapper.trigger('pointerenter', { pointerType: 'mouse' })
  await vi.advanceTimersByTimeAsync(CARD_EXPAND_DELAY_MS)
  await flushPromises()

  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()

  await wrapper.trigger('pointerleave')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.get('[aria-label="Attachments"]').attributes('aria-expanded')).toBe('true')

  // Closing via the in-card trigger can re-arm :hover in jsdom; keep leave semantics.
  const matchesSpy = vi.spyOn(wrapper.element, 'matches').mockImplementation((selector) => {
    if (selector === ':hover') {
      return false
    }
    return Element.prototype.matches.call(wrapper.element, selector)
  })

  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[aria-label="Attachments"]').attributes('aria-expanded')).toBe('false')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--minimized')
  expect(wrapper.classes()).not.toContain('kanban-card--expanded')
  expect(store.state.densityHoldExpandedCard).toBeNull()

  matchesSpy.mockRestore()
  wrapper.unmount()
  vi.useRealTimers()
})
