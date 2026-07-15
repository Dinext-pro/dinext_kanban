import { beforeEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createKanbanStore, buildPermissiveMoveOptions } from '../../utils/store'
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
  }))
  expect(trigger.attributes('aria-expanded')).toBe('false')
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
  await vi.advanceTimersByTimeAsync(400)
  await flushPromises()
  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')
  expect(wrapper.text()).toContain('alpha')
  expect(wrapper.text()).toContain('beta')
  expect(wrapper.text()).toContain('Due date')

  vi.useRealTimers()
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

  await vi.advanceTimersByTimeAsync(400)
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
  await vi.advanceTimersByTimeAsync(400)
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

  await vi.advanceTimersByTimeAsync(400)
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
  await vi.advanceTimersByTimeAsync(400)
  await flushPromises()

  expect(wrapper.classes()).toContain('kanban-card--expanded')
  expect(wrapper.classes()).not.toContain('kanban-card--minimized')

  wrapper.unmount()
  vi.useRealTimers()
})

test('marks minimized card as tag drop target; expands only after hover delay', async () => {
  vi.useFakeTimers()
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

  await vi.advanceTimersByTimeAsync(400)
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
  await vi.advanceTimersByTimeAsync(400)
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