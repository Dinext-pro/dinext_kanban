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

vi.mock('../../utils/tagLayoutAnimation', () => ({
  captureTagLayoutPositions: vi.fn(() => new Map([
    ['pill:alpha', { left: 80, top: 10, width: 40, height: 22 }],
  ])),
  scheduleTagLayoutAnimation: vi.fn(() => Promise.resolve(true)),
  isTagLayoutAnimating: vi.fn(() => false),
}))

import { applyUserTagFilter } from '../../utils/listNavigation'
import {
  captureTagLayoutPositions,
  scheduleTagLayoutAnimation,
} from '../../utils/tagLayoutAnimation'

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
  captureTagLayoutPositions.mockClear()
  scheduleTagLayoutAnimation.mockClear()
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb) => globalThis.setTimeout(() => cb(0), 0),
  )
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

test('remove-button click schedules tag layout animation', async () => {
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
  captureTagLayoutPositions.mockClear()
  scheduleTagLayoutAnimation.mockClear()

  await wrapper.find('.remove-btn').trigger('click')
  await flushPromises()

  expect(captureTagLayoutPositions).toHaveBeenCalledTimes(1)
  expect(scheduleTagLayoutAnimation).toHaveBeenCalledTimes(1)
})

test('add-tags-button click schedules tag layout animation', async () => {
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
  captureTagLayoutPositions.mockClear()
  scheduleTagLayoutAnimation.mockClear()

  await wrapper.find('.add-tags-btn').trigger('click')
  await flushPromises()

  expect(captureTagLayoutPositions).toHaveBeenCalledTimes(1)
  expect(scheduleTagLayoutAnimation).toHaveBeenCalledTimes(1)
})

test('userTags prop refresh schedules tag layout animation', async () => {
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
  captureTagLayoutPositions.mockClear()
  scheduleTagLayoutAnimation.mockClear()

  await wrapper.setProps({ userTags: ',alpha,beta' })
  await flushPromises()

  expect(captureTagLayoutPositions).toHaveBeenCalled()
  expect(scheduleTagLayoutAnimation).toHaveBeenCalled()
})

test('add-tags-button click sets activeInlineEdit for _user_tags', async () => {
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

  await wrapper.find('.add-tags-btn').trigger('click')
  await flushPromises()

  expect(store.state.activeInlineEdit).toEqual({
    cardName: 'TASK-1',
    fieldname: '_user_tags',
  })
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')
})

test('pointerdown on tags-input sets activeInlineEdit for _user_tags', async () => {
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

  wrapper.find('input.tags-input').element.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    button: 0,
    pointerId: 1,
  }))
  await flushPromises()

  expect(store.state.activeInlineEdit).toEqual({
    cardName: 'TASK-1',
    fieldname: '_user_tags',
  })
})

test('focus alone on tags-input does not set activeInlineEdit', async () => {
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

  wrapper.find('input.tags-input').element.focus()
  await flushPromises()

  expect(store.state.activeInlineEdit).toBeNull()
  expect(store.state.densityHoldExpandedCard).toBeNull()
})

test('blur on tags-input clears activeInlineEdit', async () => {
  const store = createStore()
  const wrapper = mount(CardTags, {
    attachTo: document.body,
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha',
    },
    global: { plugins: [store] },
  })
  await flushPromises()

  await wrapper.find('.add-tags-btn').trigger('click')
  const input = wrapper.find('input.tags-input').element
  input.focus()
  await flushPromises()
  expect(store.state.activeInlineEdit).not.toBeNull()
  expect(document.activeElement).toBe(input)

  input.blur()
  await flushPromises()

  expect(store.state.activeInlineEdit).toBeNull()
  expect(store.state.densityHoldExpandedCard).toBeNull()
  wrapper.unmount()
})

test('pointerdown outside the card ends tag edit', async () => {
  const store = createStore()
  const host = document.createElement('article')
  host.className = 'kanban-card'
  host.setAttribute('data-card-name', 'TASK-1')
  document.body.appendChild(host)

  const wrapper = mount(CardTags, {
    attachTo: host,
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha',
    },
    global: { plugins: [store] },
  })
  await flushPromises()

  await wrapper.find('.add-tags-btn').trigger('click')
  const input = wrapper.find('input.tags-input').element
  input.focus()
  await flushPromises()
  expect(store.state.activeInlineEdit).toEqual({
    cardName: 'TASK-1',
    fieldname: '_user_tags',
  })

  document.body.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    button: 0,
    pointerId: 1,
  }))
  await flushPromises()

  expect(store.state.activeInlineEdit).toBeNull()
  expect(store.state.densityHoldExpandedCard).toBeNull()

  wrapper.unmount()
  host.remove()
})

test('another activeInlineEdit field blurs tags-input', async () => {
  const store = createStore()
  const wrapper = mount(CardTags, {
    attachTo: document.body,
    props: {
      card: store.state.columns[0].cards[0],
      doctype: 'Task',
      userTags: ',alpha',
    },
    global: { plugins: [store] },
  })
  await flushPromises()

  await wrapper.find('.add-tags-btn').trigger('click')
  const input = wrapper.find('input.tags-input').element
  input.focus()
  await flushPromises()
  expect(document.activeElement).toBe(input)

  store.commit('SET_ACTIVE_INLINE_EDIT', {
    cardName: 'TASK-1',
    fieldname: 'subject',
  })
  await flushPromises()

  expect(document.activeElement).not.toBe(input)
  expect(store.state.activeInlineEdit).toEqual({
    cardName: 'TASK-1',
    fieldname: 'subject',
  })
  wrapper.unmount()
})
