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

function installRaven({
  canDiscuss = true,
  channels = [],
} = {}) {
  const open_channel = vi.fn()
  const show_send_raven_dialog = vi.fn()
  const show_create_channel_dialog = vi.fn()
  const open_created_channel = vi.fn()
  globalThis.dinext_raven = {
    DISCUSS_DENYLIST: { Comment: true },
    can_discuss_document: vi.fn(() => canDiscuss),
    open_channel,
    show_send_raven_dialog,
    show_create_channel_dialog,
    open_created_channel,
  }
  frappe.boot.user = { roles: ['Raven User'] }
  frappe.call.mockImplementation(async ({ method }) => {
    if (method === 'dinext_raven.document_channels.api.get_document_channels') {
      return { message: channels }
    }
    return { message: {} }
  })
  return {
    open_channel,
    show_send_raven_dialog,
    show_create_channel_dialog,
    open_created_channel,
  }
}

beforeEach(() => {
  delete globalThis.dinext_raven
  frappe.boot.user = { roles: [] }
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

test('replaces comments with Raven chat when overlay and role are available', () => {
  installRaven()
  const store = createStore()
  const wrapper = mountExtra(store)
  expect(wrapper.find('[aria-label="Comments"]').exists()).toBe(false)
  expect(wrapper.find('[aria-label="Chat"]').exists()).toBe(true)
  expect(wrapper.find('[aria-label="Chat"]').text()).not.toContain('2')
  expect(wrapper.find('[aria-label="Chat"] use').attributes('href')).toBe('#es-line-chat-alt')
})

test('opens a single accessible channel without a picker', async () => {
  const raven = installRaven({
    channels: [{ name: 'Dinext-one', channel_name: 'one', route: '/raven/Dinext/Dinext-one' }],
  })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Chat"]').trigger('click')
  await flushPromises()
  expect(raven.open_channel).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Dinext-one',
  }))
  expect(wrapper.find('.extra-info-raven-menu').exists()).toBe(false)
})

test('lists multiple accessible channels in a dropdown', async () => {
  const raven = installRaven({
    channels: [
      { name: 'Dinext-one', channel_name: 'one' },
      { name: 'Dinext-two', channel_name: 'two' },
    ],
  })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Chat"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('one')
  expect(wrapper.text()).toContain('two')
  expect(wrapper.text()).not.toContain('Send to chat or channel')
  await wrapper.get('.extra-info-raven-item').trigger('click')
  expect(raven.open_channel).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Dinext-one',
  }))
})

test('offers send and create when no accessible channel exists', async () => {
  const raven = installRaven({ channels: [] })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Chat"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('Send to chat or channel')
  expect(wrapper.text()).toContain('Create channel')
  const items = wrapper.findAll('.extra-info-raven-item')
  await items[0].trigger('click')
  expect(raven.show_send_raven_dialog).toHaveBeenCalledWith(expect.objectContaining({
    doctype: 'Task',
    docname: 'TASK-1',
  }))
})

test('create channel uses overlay dialog and open_created_channel', async () => {
  const raven = installRaven({ channels: [] })
  const store = createStore()
  const wrapper = mountExtra(store)
  await wrapper.get('[aria-label="Chat"]').trigger('click')
  await flushPromises()
  const items = wrapper.findAll('.extra-info-raven-item')
  await items[1].trigger('click')
  expect(raven.show_create_channel_dialog).toHaveBeenCalled()
  const onCreated = raven.show_create_channel_dialog.mock.calls[0][1]
  onCreated({ name: 'Dinext-new', channel_name: 'new' })
  expect(raven.open_created_channel).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Dinext-new',
  }))
})

test('keeps comments when Raven discuss is denied', () => {
  installRaven({ canDiscuss: false })
  const store = createStore()
  const wrapper = mountExtra(store)
  expect(wrapper.find('[aria-label="Comments"]').exists()).toBe(true)
  expect(wrapper.find('[aria-label="Chat"]').exists()).toBe(false)
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
