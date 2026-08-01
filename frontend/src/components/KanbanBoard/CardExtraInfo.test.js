import { beforeEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createKanbanStore } from '../../utils/store'
import CardExtraInfo from './CardExtraInfo.vue'

function createStore(cardOverrides = {}) {
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: ['subject'],
    display_fields: [],
    show_labels: false,
    show_tags: false,
    show_extra_info: true,
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
        _liked_by: '[]',
        _comment_count: 2,
        _attachment_count: 1,
        docstatus: 0,
        ...cardOverrides,
      }],
    },
  ])
  return store
}

function mountExtra(store, options = {}) {
  const card = store.state.columns[0].cards[0]
  return mount(CardExtraInfo, {
    global: {
      plugins: [store],
      stubs: { Teleport: true },
    },
    props: {
      card,
      doctype: 'Task',
      ...options.props,
    },
    attachTo: document.body,
  })
}

function makeCurFrm(doctype, name) {
  const commentBox = { 0: document.createElement('div'), length: 1 }
  commentBox[0].className = 'comment-box'
  return {
    doctype,
    docname: name,
    doc: { name },
    footer: {
      wrapper: {
        find: (selector) => (selector === '.comment-box' ? commentBox : { length: 0 }),
      },
    },
  }
}

beforeEach(() => {
  frappe.session = { user: 'Administrator' }
  frappe.model.can_write.mockReturnValue(true)
  frappe.model.can_delete.mockReturnValue(false)
  frappe.get_meta.mockReturnValue({ protect_attached_files: 0, fields: [] })
  frappe.call.mockReset()
  frappe.call.mockResolvedValue({ message: {} })
  frappe.utils.copy_to_clipboard.mockClear()
  frappe.utils.scroll_to.mockClear()
  frappe.set_route.mockReset()
  frappe.set_route.mockImplementation(async () => {
    globalThis.cur_frm = makeCurFrm('Task', 'TASK-1')
  })
  frappe.confirm.mockReset()
  frappe.confirm.mockImplementation((_message, onYes) => onYes?.())
  frappe.ui.FileUploader.mockClear()
  frappe.ui.form.Attachments = class Attachments {}
  globalThis.cur_frm = null
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

test('renders link, like, comments and attachments actions', () => {
  const store = createStore()
  const wrapper = mountExtra(store)
  expect(wrapper.find('[aria-label="Copy link"]').exists()).toBe(true)
  expect(wrapper.find('.like-action').exists()).toBe(true)
  expect(wrapper.find('[aria-label="Comments"]').text()).toContain('2')
  expect(wrapper.find('[aria-label="Attachments"]').text()).toContain('1')
})

test('copies form link to clipboard', async () => {
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Copy link"]').trigger('click')
  expect(frappe.utils.copy_to_clipboard).toHaveBeenCalled()
})

test('toggles like via desk API and updates card', async () => {
  frappe.call.mockResolvedValue({ message: null })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('.like-action').trigger('click')
  await flushPromises()
  expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
    method: 'frappe.desk.like.toggle_like',
    args: expect.objectContaining({
      doctype: 'Task',
      name: 'TASK-1',
      add: 'Yes',
    }),
  }))
  expect(store.state.columns[0].cards[0]._liked_by).toContain('Administrator')
})

test('shows alert and keeps like state when toggle_like fails', async () => {
  frappe.call.mockRejectedValue(new Error('like failed'))
  frappe.show_alert.mockClear()
  const store = createStore()
  const wrapper = mountExtra(store)
  const before = store.state.columns[0].cards[0]._liked_by
  await wrapper.get('.like-action').trigger('click')
  await flushPromises()
  expect(frappe.show_alert).toHaveBeenCalledWith(expect.objectContaining({
    indicator: 'red',
  }))
  expect(store.state.columns[0].cards[0]._liked_by).toBe(before)
})

test('opens the document form from comments icon and scrolls to comments', async () => {
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Comments"]').trigger('click')
  await flushPromises()
  expect(frappe.set_route).toHaveBeenCalledWith('Form', 'Task', 'TASK-1')
  expect(frappe.utils.scroll_to).toHaveBeenCalledWith(
    expect.objectContaining({ length: 1 }),
    true,
  )
})

test('shows empty-state and upload when there are no attachments', async () => {
  frappe.call.mockResolvedValue({ docinfo: { attachments: [] } })
  const store = createStore({ _attachment_count: 0 })
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('No attachments')
  expect(wrapper.text()).toContain('+ Upload')
  expect(wrapper.find('.extra-info-upload.dropdown-item').exists()).toBe(true)
})

test('emits files-menu-open when attachments menu opens and closes', async () => {
  frappe.call.mockResolvedValue({ docinfo: { attachments: [] } })
  const store = createStore({ _attachment_count: 0 })
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()
  expect(wrapper.emitted('files-menu-open')?.at(-1)).toEqual([true])

  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()
  expect(wrapper.emitted('files-menu-open')?.at(-1)).toEqual([false])
})

test('opens attachments menu with upload and preview fallback', async () => {
  frappe.call.mockImplementation(async ({ method }) => {
    if (method === 'frappe.desk.form.load.get_docinfo') {
      return {
        docinfo: {
          attachments: [
            { name: 'FILE-1', file_name: 'spec.pdf', file_url: '/files/spec.pdf' },
          ],
        },
      }
    }
    return { message: {} }
  })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('spec.pdf')
  expect(wrapper.text()).toContain('+ Upload')
  expect(wrapper.find('.extra-info-file-name.dropdown-item').exists()).toBe(true)

  await wrapper.get('.extra-info-file-name').trigger('click')
  expect(window.open).toHaveBeenCalledWith('/files/spec.pdf', '_blank')
})

test('uses preview_attachment when available', async () => {
  const preview = vi.fn()
  frappe.ui.form.Attachments.prototype.preview_attachment = preview
  frappe.call.mockResolvedValue({
    docinfo: {
      attachments: [
        { name: 'FILE-1', file_name: 'photo.png', file_url: '/files/photo.png' },
      ],
    },
  })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()
  await wrapper.get('.extra-info-file-name').trigger('click')
  expect(preview).toHaveBeenCalled()
  expect(window.open).not.toHaveBeenCalled()
})

test('hides delete when user cannot write', async () => {
  frappe.model.can_write.mockReturnValue(false)
  frappe.call.mockResolvedValue({
    docinfo: {
      attachments: [
        { name: 'FILE-1', file_name: 'spec.pdf', file_url: '/files/spec.pdf' },
      ],
    },
  })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('.extra-info-file-delete').exists()).toBe(false)
  expect(wrapper.find('.extra-info-upload').exists()).toBe(false)
})

test('confirms before deleting attachment and refreshes count', async () => {
  frappe.call.mockImplementation(async ({ method }) => {
    if (method === 'frappe.desk.form.load.get_docinfo') {
      return {
        docinfo: {
          attachments: [
            { name: 'FILE-1', file_name: 'spec.pdf', file_url: '/files/spec.pdf' },
          ],
        },
      }
    }
    return { message: {} }
  })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()
  await wrapper.get('.extra-info-file-delete').trigger('click')
  await flushPromises()
  expect(frappe.confirm).toHaveBeenCalledWith(
    'Are you sure you want to delete the attachment?',
    expect.any(Function),
    expect.any(Function),
  )
  expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
    method: 'frappe.desk.form.utils.remove_attach',
    args: expect.objectContaining({
      fid: 'FILE-1',
      dt: 'Task',
      dn: 'TASK-1',
    }),
  }))
  expect(store.state.columns[0].cards[0]._attachment_count).toBe(0)
})

test('does not delete attachment when confirm is cancelled', async () => {
  frappe.confirm.mockImplementation((_message, _onYes, onNo) => onNo?.())
  frappe.call.mockImplementation(async ({ method }) => {
    if (method === 'frappe.desk.form.load.get_docinfo') {
      return {
        docinfo: {
          attachments: [
            { name: 'FILE-1', file_name: 'spec.pdf', file_url: '/files/spec.pdf' },
          ],
        },
      }
    }
    return { message: {} }
  })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Attachments"]').trigger('click')
  await flushPromises()
  await wrapper.get('.extra-info-file-delete').trigger('click')
  await flushPromises()
  expect(frappe.confirm).toHaveBeenCalled()
  expect(frappe.call).not.toHaveBeenCalledWith(expect.objectContaining({
    method: 'frappe.desk.form.utils.remove_attach',
  }))
  expect(store.state.columns[0].cards[0]._attachment_count).toBe(1)
  expect(wrapper.find('.extra-info-files-menu').exists()).toBe(true)
})

test('hides card delete when user cannot delete', () => {
  frappe.model.can_delete.mockReturnValue(false)
  const store = createStore()
  const wrapper = mountExtra(store)
  expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(false)
})

test('hides card delete for submitted documents', () => {
  frappe.model.can_delete.mockReturnValue(true)
  const store = createStore({ docstatus: 1 })
  const wrapper = mountExtra(store)
  expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(false)
})

test('shows card delete for draft when user can delete', () => {
  frappe.model.can_delete.mockReturnValue(true)
  const store = createStore({ docstatus: 0 })
  const wrapper = mountExtra(store)
  expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(true)
})

test('confirms before deleting card and removes it from the board', async () => {
  frappe.model.can_delete.mockReturnValue(true)
  frappe.call.mockImplementation(async ({ method }) => {
    if (method === 'dinext_kanban.api.delete_card') {
      return { message: { name: 'TASK-1' } }
    }
    if (method === 'dinext_kanban.api.get_column_totals') {
      return { message: { Open: 0 } }
    }
    return { message: {} }
  })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Delete"]').trigger('click')
  await flushPromises()
  expect(frappe.confirm).toHaveBeenCalledWith(
    'Are you sure you want to delete First task?',
    expect.any(Function),
    expect.any(Function),
  )
  expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
    method: 'dinext_kanban.api.delete_card',
    args: expect.objectContaining({
      board_name: 'Task Board',
      name: 'TASK-1',
    }),
  }))
  expect(store.state.columns[0].cards.find(({ name }) => name === 'TASK-1')).toBeUndefined()
})

test('does not delete card when confirm is cancelled', async () => {
  frappe.model.can_delete.mockReturnValue(true)
  frappe.confirm.mockImplementation((_message, _onYes, onNo) => onNo?.())
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Delete"]').trigger('click')
  await flushPromises()
  expect(frappe.confirm).toHaveBeenCalled()
  expect(frappe.call).not.toHaveBeenCalledWith(expect.objectContaining({
    method: 'dinext_kanban.api.delete_card',
  }))
  expect(store.state.columns[0].cards[0].name).toBe('TASK-1')
})
