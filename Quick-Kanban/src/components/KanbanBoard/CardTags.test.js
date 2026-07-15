import { beforeEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createKanbanStore } from '../../utils/store'
import CardTags from './CardTags.vue'

vi.mock('../../utils/listNavigation', async () => {
  const actual = await vi.importActual('../../utils/listNavigation')
  return {
    ...actual,
    applyUserTagFilter: vi.fn(() => true),
  }
})

import { applyUserTagFilter } from '../../utils/listNavigation'

function createStore() {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: ['subject'],
    display_fields: [],
    show_labels: true,
    show_tags: true,
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
        _assign: {},
        _user_tags: ',alpha,beta',
      }],
    },
  ])
  return store
}

beforeEach(() => {
  frappe.ui.TagEditor.mockClear()
  frappe.model.can_write.mockReturnValue(true)
  applyUserTagFilter.mockClear()
})

test('mounts TagEditor with doctype, docname and normalized tags', async () => {
  const store = createStore()
  mount(CardTags, {
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha,beta',
    },
    global: { plugins: [store] },
  })
  await flushPromises()

  expect(frappe.ui.TagEditor).toHaveBeenCalledTimes(1)
  const opts = frappe.ui.TagEditor.mock.calls[0][0]
  expect(opts.frm).toEqual({ doctype: 'Task', docname: 'TASK-1' })
  expect(opts.user_tags).toBe('alpha,beta')
})

test('replaces add-button icon with es-line-tag and sets aria-label', async () => {
  const store = createStore()
  const wrapper = mount(CardTags, {
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha',
    },
    global: { plugins: [store] },
  })
  await flushPromises()

  const button = wrapper.find('.add-tags-btn')
  expect(button.exists()).toBe(true)
  expect(button.attributes('aria-label')).toBe('Add Tag')
  expect(button.find('use').attributes('href')).toBe('#es-line-tag')
})

test('on_change writes list-shaped _user_tags into the store', async () => {
  const store = createStore()
  mount(CardTags, {
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha',
    },
    global: { plugins: [store] },
  })
  await flushPromises()

  const opts = frappe.ui.TagEditor.mock.calls[0][0]
  opts.on_change('alpha,gamma')

  expect(store.state.columns[0].cards[0]._user_tags).toBe(',alpha,gamma')
})

test('refreshes editor when userTags prop changes', async () => {
  const store = createStore()
  const wrapper = mount(CardTags, {
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha',
    },
    global: { plugins: [store] },
  })
  await flushPromises()

  const instance = frappe.ui.TagEditor.mock.results[0].value
  await wrapper.setProps({ userTags: ',alpha,beta' })
  await flushPromises()

  expect(instance.refresh).toHaveBeenCalledWith('alpha,beta')
})

test('pointerdown on a pill starts tag drag and holds density', async () => {
  const store = createStore()
  const beginPending = vi.fn(() => true)
  const wrapper = mount(CardTags, {
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha,beta',
    },
    global: {
      plugins: [store],
      provide: {
        tagDragController: { beginPending },
      },
    },
  })
  await flushPromises()

  const pill = wrapper.find('.data-pill')
  expect(pill.exists()).toBe(true)
  pill.element.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  }))
  await flushPromises()

  expect(beginPending).toHaveBeenCalledTimes(1)
  expect(beginPending.mock.calls[0][1]).toMatchObject({
    tag: 'alpha',
    sourceCardName: 'TASK-1',
  })
  expect(beginPending.mock.calls[0][1].sourcePill).toBe(pill.element)
})

test('pointerdown on remove button does not start tag drag', async () => {
  const store = createStore()
  const beginPending = vi.fn(() => true)
  const wrapper = mount(CardTags, {
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha',
    },
    global: {
      plugins: [store],
      provide: {
        tagDragController: { beginPending },
      },
    },
  })
  await flushPromises()

  wrapper.find('.remove-btn').element.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  }))
  await flushPromises()

  expect(beginPending).not.toHaveBeenCalled()
})

test('double-click on pill label applies user tag filter', async () => {
  const store = createStore()
  const wrapper = mount(CardTags, {
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha,beta',
    },
    global: { plugins: [store] },
  })
  await flushPromises()

  await wrapper.find('.pill-label').trigger('dblclick')
  expect(applyUserTagFilter).toHaveBeenCalledWith('alpha')
})

test('double-click on remove button does not apply user tag filter', async () => {
  const store = createStore()
  const wrapper = mount(CardTags, {
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha',
    },
    global: { plugins: [store] },
  })
  await flushPromises()

  await wrapper.find('.remove-btn').trigger('dblclick')
  expect(applyUserTagFilter).not.toHaveBeenCalled()
})
