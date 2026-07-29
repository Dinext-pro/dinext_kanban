import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  buildFormUrl,
  canDeleteAttachment,
  canDeleteCard,
  confirmDeleteAttachment,
  confirmDeleteCard,
  copyFormLink,
  DELETE_ATTACHMENT_CONFIRM_MESSAGE,
  DELETE_CARD_CONFIRM_MESSAGE,
  formatActivityCount,
  getAttachmentCount,
  getCommentCount,
  getFileUrl,
  hasPreviewAttachment,
  isLikedByUser,
  navigateToFormComments,
  openAttachmentPreviewOrFile,
  parseLikedBy,
  toggleLikedByValue,
} from './cardExtraInfo'

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

describe('cardExtraInfo helpers', () => {
  beforeEach(() => {
    frappe.session = { user: 'tester@example.com' }
    frappe.utils.get_form_link = vi.fn((doctype, name) => `/app/${doctype.toLowerCase()}/${name}`)
    frappe.utils.copy_to_clipboard = vi.fn()
    frappe.utils.scroll_to = vi.fn()
    frappe.confirm = vi.fn((_message, onYes) => onYes?.())
    frappe.set_route = vi.fn(() => Promise.resolve())
    frappe.get_route = vi.fn(() => ['List', 'Task', 'Kanban', 'Board'])
    frappe.urllib = { get_full_url: vi.fn((url) => `https://desk.example${url}`) }
    frappe.ui.form = { Attachments: class Attachments {} }
    globalThis.cur_frm = null
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  test('parseLikedBy and isLikedByUser', () => {
    expect(parseLikedBy('["a","b"]')).toEqual(['a', 'b'])
    expect(isLikedByUser('["tester@example.com"]', 'tester@example.com')).toBe(true)
    expect(isLikedByUser('[]', 'tester@example.com')).toBe(false)
  })

  test('toggleLikedByValue adds and removes the user', () => {
    expect(toggleLikedByValue('[]', 'u1', true)).toBe('["u1"]')
    expect(toggleLikedByValue('["u1","u2"]', 'u1', false)).toBe('["u2"]')
  })

  test('getCommentCount prefers _comment_count', () => {
    expect(getCommentCount({ _comment_count: 3, _comments: '[]' })).toBe(3)
    expect(getCommentCount({ _comments: '[{"name":"1"},{"name":"2"}]' })).toBe(2)
  })

  test('formatActivityCount caps at 99+', () => {
    expect(formatActivityCount(12)).toBe('12')
    expect(formatActivityCount(120)).toBe('99+')
  })

  test('getAttachmentCount reads card field', () => {
    expect(getAttachmentCount({ _attachment_count: 4 })).toBe(4)
    expect(getAttachmentCount({})).toBe(0)
  })

  test('getFileUrl encodes local paths', () => {
    expect(getFileUrl({ file_url: '/files/a b.pdf' })).toContain('a%20b.pdf')
    expect(getFileUrl({ file_name: 'note.txt' })).toBe('/files/note.txt')
  })

  test('canDeleteAttachment mirrors Form protect_attached_files rules', () => {
    expect(canDeleteAttachment({ canWrite: true, docstatus: 0 })).toBe(true)
    expect(canDeleteAttachment({
      canWrite: true,
      protectAttachedFiles: true,
      docstatus: 1,
    })).toBe(false)
    expect(canDeleteAttachment({
      canWrite: true,
      canDelete: true,
      protectAttachedFiles: true,
      docstatus: 2,
    })).toBe(true)
    expect(canDeleteAttachment({ canWrite: false })).toBe(false)
  })

  test('canDeleteCard requires delete permission and hides submitted docs', () => {
    expect(canDeleteCard({ canDelete: true, docstatus: 0 })).toBe(true)
    expect(canDeleteCard({ canDelete: true, docstatus: 2 })).toBe(true)
    expect(canDeleteCard({ canDelete: true, docstatus: 1 })).toBe(false)
    expect(canDeleteCard({ canDelete: false, docstatus: 0 })).toBe(false)
  })

  test('buildFormUrl and copyFormLink use Desk helpers', () => {
    expect(buildFormUrl('Task', 'TASK-1')).toBe('https://desk.example/app/task/TASK-1')
    expect(copyFormLink('Task', 'TASK-1')).toBe(true)
    expect(frappe.utils.copy_to_clipboard).toHaveBeenCalledWith(
      'https://desk.example/app/task/TASK-1',
    )
  })

  test('openAttachmentPreviewOrFile uses preview when available', () => {
    const preview = vi.fn()
    frappe.ui.form.Attachments.prototype.preview_attachment = preview
    expect(hasPreviewAttachment()).toBe(true)
    openAttachmentPreviewOrFile({ file_name: 'a.png', file_url: '/files/a.png' })
    expect(preview).toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  test('openAttachmentPreviewOrFile opens file when preview is missing', () => {
    delete frappe.ui.form.Attachments.prototype.preview_attachment
    expect(hasPreviewAttachment()).toBe(false)
    openAttachmentPreviewOrFile({ file_name: 'a.png', file_url: '/files/a.png' })
    expect(window.open).toHaveBeenCalledWith('/files/a.png', '_blank')
  })

  test('navigateToFormComments routes then scrolls to comment box', async () => {
    frappe.set_route.mockImplementation(async () => {
      globalThis.cur_frm = makeCurFrm('Task', 'TASK-1')
      frappe.get_route.mockReturnValue(['Form', 'Task', 'TASK-1'])
    })
    await expect(navigateToFormComments('Task', 'TASK-1')).resolves.toBe(true)
    expect(frappe.set_route).toHaveBeenCalledWith('Form', 'Task', 'TASK-1')
    expect(frappe.utils.scroll_to).toHaveBeenCalledWith(
      expect.objectContaining({ length: 1 }),
      true,
    )
  })

  test('navigateToFormComments scrolls only when form route is active', async () => {
    globalThis.cur_frm = makeCurFrm('Task', 'TASK-1')
    frappe.get_route.mockReturnValue(['Form', 'Task', 'TASK-1'])
    await expect(navigateToFormComments('Task', 'TASK-1')).resolves.toBe(true)
    expect(frappe.set_route).not.toHaveBeenCalled()
    expect(frappe.utils.scroll_to).toHaveBeenCalled()
  })

  test('navigateToFormComments re-routes when cur_frm is stale after leaving Form', async () => {
    globalThis.cur_frm = makeCurFrm('Task', 'TASK-1')
    frappe.get_route.mockReturnValue(['List', 'Task', 'Kanban', 'Board'])
    frappe.set_route.mockImplementation(async () => {
      frappe.get_route.mockReturnValue(['Form', 'Task', 'TASK-1'])
    })
    await expect(navigateToFormComments('Task', 'TASK-1')).resolves.toBe(true)
    expect(frappe.set_route).toHaveBeenCalledWith('Form', 'Task', 'TASK-1')
    expect(frappe.utils.scroll_to).toHaveBeenCalled()
  })

  test('confirmDeleteAttachment resolves from frappe.confirm callbacks', async () => {
    frappe.confirm.mockImplementation((_message, onYes) => onYes())
    await expect(confirmDeleteAttachment()).resolves.toBe(true)
    expect(frappe.confirm).toHaveBeenCalledWith(
      DELETE_ATTACHMENT_CONFIRM_MESSAGE,
      expect.any(Function),
      expect.any(Function),
    )

    frappe.confirm.mockImplementation((_message, _onYes, onNo) => onNo())
    await expect(confirmDeleteAttachment()).resolves.toBe(false)
  })

  test('confirmDeleteCard uses card label in the prompt', async () => {
    frappe.confirm.mockImplementation((_message, onYes) => onYes())
    await expect(confirmDeleteCard('First task')).resolves.toBe(true)
    expect(frappe.confirm).toHaveBeenCalledWith(
      'Are you sure you want to delete First task?',
      expect.any(Function),
      expect.any(Function),
    )
    expect(DELETE_CARD_CONFIRM_MESSAGE).toContain('{0}')

    frappe.confirm.mockImplementation((_message, _onYes, onNo) => onNo())
    await expect(confirmDeleteCard('First task')).resolves.toBe(false)
  })
})
