import { beforeEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createKanbanStore, buildPermissiveMoveOptions } from '../../utils/store'
import KanbanCard from './KanbanCard.vue'

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
  frappe.ui.form.AssignToDialog.mockClear()
  frappe.ui.form.AssignmentDialog.mockClear()
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
  expect(wrapper.text()).toContain('Due date')
  expect(wrapper.text()).toContain('formatted:2026-07-10')
  expect(wrapper.get('.kanban-card-fields a').text()).toBe('TEST-PROJECT')
  expect(wrapper.text()).not.toContain('<a href=')
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
  }))
  expect(trigger.attributes('aria-expanded')).toBe('false')
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
