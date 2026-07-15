import { beforeEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createKanbanStore } from '../../utils/store'
import { INLINE_EDIT_CLICK_DELAY_MS } from '../../utils/inlineEditing'
import InlineCardField from './InlineCardField.vue'

function createStore() {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
  })
  store.commit('SET_COLUMNS', [
    {
      name: 'open',
      column_name: 'Open',
      cards: [{
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        due_date: '2026-07-10',
        project: 'TEST-PROJECT',
        _assign: {},
      }],
    },
  ])
  return store
}

beforeEach(() => {
  frappe.model.with_doc.mockClear()
  frappe.model.with_doc.mockResolvedValue({
    doctype: 'Task',
    name: 'TASK-1',
    subject: 'First task',
    docstatus: 0,
  })
  frappe.perm.get_field_display_status.mockReturnValue('Write')
  frappe.workflow.is_read_only.mockReturnValue(false)
  frappe.ui.form.make_control.mockClear()
  frappe.set_route.mockClear()
  frappe.db.set_value.mockClear()
})

test('loads the full document before creating a Frappe control', async () => {
  vi.useFakeTimers()
  const store = createStore()
  const wrapper = mount(InlineCardField, {
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'subject',
        fieldtype: 'Data',
        label: 'Subject',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'title',
      displayMode: 'text',
      displayText: 'First task',
    },
    global: { plugins: [store] },
  })

  await wrapper.trigger('click')
  await vi.advanceTimersByTimeAsync(INLINE_EDIT_CLICK_DELAY_MS)
  await flushPromises()

  expect(frappe.model.with_doc).toHaveBeenCalledWith('Task', 'TASK-1')
  expect(frappe.ui.form.make_control).toHaveBeenCalled()
  expect(wrapper.classes()).toContain('is-editing')
  vi.useRealTimers()
})

test('opens Select options via size fallback when showPicker is unavailable', async () => {
  vi.useFakeTimers()
  const store = createStore()
  const card = {
    ...store.state.columns[0].cards[0],
    priority: 'High',
  }
  const wrapper = mount(InlineCardField, {
    attachTo: document.body,
    props: {
      card,
      fieldMeta: {
        fieldname: 'priority',
        fieldtype: 'Select',
        label: 'Priority',
        options: 'Low\nMedium\nHigh',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'highlight',
      displayMode: 'text',
      displayText: 'High',
    },
    global: { plugins: [store] },
  })

  await wrapper.trigger('click')
  await vi.advanceTimersByTimeAsync(0)
  await flushPromises()

  expect(wrapper.classes()).toContain('is-editing')
  const select = wrapper.find('.kanban-inline-control select').element
  expect(select.size).toBeGreaterThan(1)
  expect(select.querySelectorAll('option').length).toBe(3)

  wrapper.unmount()
  vi.useRealTimers()
})

test('applies measured display width height and font metrics to the control input', async () => {
  vi.useFakeTimers()
  const store = createStore()
  const wrapper = mount(InlineCardField, {
    attachTo: document.body,
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'subject',
        fieldtype: 'Data',
        label: 'Subject',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'title',
      displayMode: 'text',
      displayText: 'First task',
    },
    global: { plugins: [store] },
  })

  const display = wrapper.find('.kanban-inline-display').element
  display.getBoundingClientRect = () => ({
    width: 168,
    height: 22,
    top: 0,
    left: 0,
    right: 168,
    bottom: 22,
    x: 0,
    y: 0,
    toJSON() {},
  })
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
    if (el === display) {
      return {
        fontSize: '14px',
        lineHeight: '18.9px',
        fontWeight: '600',
        fontFamily: 'Inter, sans-serif',
      }
    }
    return {
      fontSize: '12px',
      lineHeight: '16px',
      fontWeight: '400',
      fontFamily: 'sans-serif',
    }
  })

  await wrapper.trigger('click')
  await vi.advanceTimersByTimeAsync(INLINE_EDIT_CLICK_DELAY_MS)
  await flushPromises()

  const controlParent = wrapper.find('.kanban-inline-control')
  expect(controlParent.attributes('style')).toContain('--kanban-inline-edit-height: 22px')
  expect(controlParent.attributes('style')).toContain('--kanban-inline-edit-width: 168px')
  expect(controlParent.attributes('style')).toContain('--kanban-inline-edit-font-size: 14px')

  const created = frappe.ui.form.make_control.mock.results[0].value
  const input = created.$input[0]
  expect(input.style.height).toBe('22px')
  expect(input.style.width).toBe('168px')
  expect(input.style.fontSize).toBe('14px')
  expect(input.style.lineHeight).toBe('18.9px')
  expect(input.style.fontWeight).toBe('600')

  wrapper.unmount()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test('does not open the editor when field status is not Write', async () => {
  vi.useFakeTimers()
  frappe.perm.get_field_display_status.mockReturnValue('Read')
  const store = createStore()
  const wrapper = mount(InlineCardField, {
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'subject',
        fieldtype: 'Data',
        label: 'Subject',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'title',
      displayMode: 'text',
      displayText: 'First task',
    },
    global: { plugins: [store] },
  })

  await wrapper.trigger('click')
  await vi.advanceTimersByTimeAsync(INLINE_EDIT_CLICK_DELAY_MS)
  await flushPromises()

  expect(frappe.model.with_doc).toHaveBeenCalled()
  expect(frappe.ui.form.make_control).not.toHaveBeenCalled()
  expect(wrapper.classes()).not.toContain('is-editing')
  vi.useRealTimers()
})

test('double-click on a title opens the card form', async () => {
  const store = createStore()
  const wrapper = mount(InlineCardField, {
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'subject',
        fieldtype: 'Data',
        label: 'Subject',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'title',
      displayMode: 'text',
      displayText: 'First task',
    },
    global: { plugins: [store] },
  })

  await wrapper.trigger('dblclick')
  expect(frappe.set_route).toHaveBeenCalledWith('Form', 'Task', 'TASK-1')
})

test('double-click on a Link field opens the linked record', async () => {
  const store = createStore()
  const wrapper = mount(InlineCardField, {
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'project',
        fieldtype: 'Link',
        options: 'Project',
        label: 'Project',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'display',
      displayMode: 'html',
      displayHtml: '<a href="/app/project/TEST-PROJECT">TEST-PROJECT</a>',
    },
    global: { plugins: [store] },
  })

  await wrapper.trigger('dblclick')
  expect(frappe.set_route).toHaveBeenCalledWith('Form', 'Project', 'TEST-PROJECT')
})

test('double-click on a display field opens the card form', async () => {
  const store = createStore()
  const wrapper = mount(InlineCardField, {
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'due_date',
        fieldtype: 'Date',
        label: 'Due date',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'display',
      displayMode: 'html',
      displayHtml: 'formatted:2026-07-10',
      displayText: '2026-07-10',
    },
    global: { plugins: [store] },
  })

  await wrapper.trigger('dblclick')
  expect(frappe.set_route).toHaveBeenCalledWith('Form', 'Task', 'TASK-1')
})

test('double-click on a highlight field opens the card form', async () => {
  const store = createStore()
  const wrapper = mount(InlineCardField, {
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'priority',
        fieldtype: 'Select',
        label: 'Priority',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'highlight',
      displayMode: 'text',
      displayText: 'High',
    },
    global: { plugins: [store] },
  })

  await wrapper.trigger('dblclick')
  expect(frappe.set_route).toHaveBeenCalledWith('Form', 'Task', 'TASK-1')
})

test('single click on a Link field opens the editor without navigating', async () => {
  vi.useFakeTimers()
  const store = createStore()
  const wrapper = mount(InlineCardField, {
    attachTo: document.body,
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'project',
        fieldtype: 'Link',
        options: 'Project',
        label: 'Project',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'display',
      displayMode: 'html',
      displayHtml: '<a href="/app/project/TEST-PROJECT">TEST-PROJECT</a>',
    },
    global: { plugins: [store] },
  })

  expect(wrapper.find('a').attributes('href')).toBeUndefined()
  expect(wrapper.find('a').attributes('role')).toBe('presentation')

  const anchor = wrapper.find('a')
  await anchor.trigger('click')
  await vi.advanceTimersByTimeAsync(INLINE_EDIT_CLICK_DELAY_MS)
  await flushPromises()

  expect(frappe.set_route).not.toHaveBeenCalled()
  expect(frappe.model.with_doc).toHaveBeenCalledWith('Task', 'TASK-1')
  expect(frappe.ui.form.make_control).toHaveBeenCalled()
  expect(wrapper.classes()).toContain('is-editing')
  wrapper.unmount()
  vi.useRealTimers()
})

test('double-click on a Link field while editing opens the linked record', async () => {
  vi.useFakeTimers()
  const store = createStore()
  const wrapper = mount(InlineCardField, {
    attachTo: document.body,
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'project',
        fieldtype: 'Link',
        options: 'Project',
        label: 'Project',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'display',
      displayMode: 'html',
      displayHtml: '<a href="/app/project/TEST-PROJECT">TEST-PROJECT</a>',
    },
    global: { plugins: [store] },
  })

  await wrapper.trigger('click')
  await vi.advanceTimersByTimeAsync(INLINE_EDIT_CLICK_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('is-editing')
  frappe.set_route.mockClear()

  await wrapper.get('.kanban-inline-control').trigger('dblclick')
  await flushPromises()

  expect(frappe.set_route).toHaveBeenCalledWith('Form', 'Project', 'TEST-PROJECT')
  expect(wrapper.classes()).not.toContain('is-editing')
  wrapper.unmount()
  vi.useRealTimers()
})

test('double-click on a title Link field while editing opens the linked record', async () => {
  vi.useFakeTimers()
  const store = createStore()
  const wrapper = mount(InlineCardField, {
    attachTo: document.body,
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'project',
        fieldtype: 'Link',
        options: 'Project',
        label: 'Project',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'title',
      displayMode: 'text',
      displayText: 'TEST-PROJECT',
    },
    global: { plugins: [store] },
  })

  await wrapper.trigger('click')
  await vi.advanceTimersByTimeAsync(INLINE_EDIT_CLICK_DELAY_MS)
  await flushPromises()
  expect(wrapper.classes()).toContain('is-editing')
  frappe.set_route.mockClear()

  await wrapper.get('.kanban-inline-control').trigger('dblclick')
  await flushPromises()

  expect(frappe.set_route).toHaveBeenCalledWith('Form', 'Project', 'TEST-PROJECT')
  expect(wrapper.classes()).not.toContain('is-editing')
  wrapper.unmount()
  vi.useRealTimers()
})

test('saving through the store uses frappe.db.set_value', async () => {
  vi.useFakeTimers()
  const store = createStore()
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue(true)
  const wrapper = mount(InlineCardField, {
    props: {
      card: store.state.columns[0].cards[0],
      fieldMeta: {
        fieldname: 'subject',
        fieldtype: 'Data',
        label: 'Subject',
        parent: 'Task',
      },
      doctype: 'Task',
      fieldRole: 'title',
      displayMode: 'text',
      displayText: 'First task',
    },
    global: { plugins: [store] },
  })

  await wrapper.trigger('click')
  await vi.advanceTimersByTimeAsync(INLINE_EDIT_CLICK_DELAY_MS)
  await flushPromises()

  const created = frappe.ui.form.make_control.mock.results[0].value
  created.get_value.mockReturnValue('Renamed task')
  await created.df.change.call(created)
  await flushPromises()

  expect(dispatch).toHaveBeenCalledWith('updateCardField', expect.objectContaining({
    cardName: 'TASK-1',
    fieldname: 'subject',
    value: 'Renamed task',
  }))
  vi.useRealTimers()
})
