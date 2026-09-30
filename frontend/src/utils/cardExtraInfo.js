const EXTRA_INFO_CONTEXT = 'DinextKanban.ExtraInfo'
export const RAVEN_CONTEXT = 'Dinext.Raven'

export function getExtraInfoContext() {
  return EXTRA_INFO_CONTEXT
}

export function getRavenContext() {
  return RAVEN_CONTEXT
}

export function hasRavenRole(frappeGlobal = globalThis.frappe) {
  const roles = frappeGlobal?.boot?.user?.roles || []
  const user = frappeGlobal?.session?.user
  return roles.includes('Raven User') || user === 'Administrator'
}

export function isRavenDeniedDoctype(doctype, denylist = globalThis.dinext_raven?.DISCUSS_DENYLIST) {
  if (!doctype) {
    return true
  }
  if (String(doctype).startsWith('Raven ')) {
    return true
  }
  return Boolean(denylist?.[doctype])
}

export function canUseRavenChat(doctype, name, {
  dinextRaven = globalThis.dinext_raven,
  frappeGlobal = globalThis.frappe,
} = {}) {
  if (!dinextRaven || !doctype || !name) {
    return false
  }
  if (typeof dinextRaven.can_discuss_document === 'function') {
    return Boolean(dinextRaven.can_discuss_document(doctype, name))
  }
  return hasRavenRole(frappeGlobal) && !isRavenDeniedDoctype(doctype, dinextRaven.DISCUSS_DENYLIST)
}

export function resolveRavenChatAction(channels = []) {
  const list = Array.isArray(channels) ? channels.filter((row) => row && row.name) : []
  if (list.length === 1) {
    return { type: 'open', channels: list }
  }
  if (list.length > 1) {
    return { type: 'pick', channels: list }
  }
  return { type: 'empty', channels: [] }
}

export async function fetchDocumentChannels(doctype, name) {
  const response = await frappe.call({
    method: 'dinext_raven.document_channels.api.get_document_channels',
    args: { doctype, name },
  })
  return Array.isArray(response?.message) ? response.message : []
}

export function parseLikedBy(likedBy) {
  if (Array.isArray(likedBy)) {
    return likedBy.filter(Boolean).map(String)
  }
  if (!likedBy) {
    return []
  }
  try {
    const parsed = JSON.parse(likedBy)
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : []
  } catch {
    return []
  }
}

export function isLikedByUser(likedBy, user) {
  if (!user) {
    return false
  }
  return parseLikedBy(likedBy).includes(String(user))
}

export function toggleLikedByValue(likedBy, user, liked) {
  const users = parseLikedBy(likedBy)
  const current = String(user || '')
  if (!current) {
    return JSON.stringify(users)
  }
  if (liked) {
    if (!users.includes(current)) {
      users.push(current)
    }
  } else {
    return JSON.stringify(users.filter((entry) => entry !== current))
  }
  return JSON.stringify(users)
}

export function getCommentCount(card = {}) {
  if (card._comment_count != null && card._comment_count !== '') {
    return Math.max(0, Number(card._comment_count) || 0)
  }
  try {
    const comments = JSON.parse(card._comments || '[]')
    return Array.isArray(comments) ? comments.length : 0
  } catch {
    return 0
  }
}

export function formatActivityCount(count) {
  const value = Math.max(0, Number(count) || 0)
  return value > 99 ? '99+' : String(value)
}

export function getAttachmentCount(card = {}) {
  if (card._attachment_count != null && card._attachment_count !== '') {
    return Math.max(0, Number(card._attachment_count) || 0)
  }
  return 0
}

export function getFileUrl(attachment = {}) {
  let fileUrl = attachment.file_url
  if (!fileUrl) {
    const fileName = String(attachment.file_name || '')
    if (fileName.indexOf('files/') === 0) {
      fileUrl = `/${fileName}`
    } else if (fileName) {
      fileUrl = `/files/${fileName}`
    } else {
      return ''
    }
  }

  const isWebUrl = /^(https?:)?\/\//i.test(fileUrl)
  fileUrl = encodeURI(fileUrl)
  if (!isWebUrl) {
    fileUrl = fileUrl.replace(/#/g, '%23')
  }
  return fileUrl
}

export function canDeleteAttachment({
  canWrite = false,
  canDelete = false,
  protectAttachedFiles = false,
  docstatus = 0,
} = {}) {
  if (!canWrite) {
    return false
  }
  if (protectAttachedFiles) {
    switch (Number(docstatus) || 0) {
      case 0:
        return true
      case 2:
        return Boolean(canDelete)
      default:
        return false
    }
  }
  return true
}

/**
 * Card delete is allowed when the user has doctype delete permission
 * and the document is not submitted (docstatus !== 1).
 */
export function canDeleteCard({ canDelete = false, docstatus = 0 } = {}) {
  if (!canDelete) {
    return false
  }
  return Number(docstatus) !== 1
}

export function hasPreviewAttachment() {
  return typeof globalThis.frappe?.ui?.form?.Attachments?.prototype?.preview_attachment === 'function'
}

export function openAttachmentPreviewOrFile(attachment) {
  const fileUrl = getFileUrl(attachment)
  if (!fileUrl) {
    return false
  }
  const fileName = attachment.file_name || fileUrl
  if (hasPreviewAttachment()) {
    const stub = Object.create(frappe.ui.form.Attachments.prototype)
    stub.action_to_close_remove_modal = (dialog) => dialog?.hide?.()
    stub.additional_actions = () => {}
    stub.enable_resizable_dialog = () => {}
    frappe.ui.form.Attachments.prototype.preview_attachment.call(stub, fileUrl, fileName)
    return true
  }
  globalThis.window?.open?.(fileUrl, '_blank')
  return true
}

export function buildFormUrl(doctype, name) {
  const route = frappe.utils?.get_form_link?.(doctype, name)
  if (!route) {
    return ''
  }
  if (typeof frappe.urllib?.get_full_url === 'function') {
    return frappe.urllib.get_full_url(route)
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${route.startsWith('/') ? '' : '/'}${route}`
  }
  return route
}

export function copyFormLink(doctype, name) {
  const url = buildFormUrl(doctype, name)
  if (!url) {
    return false
  }
  if (typeof frappe.utils?.copy_to_clipboard === 'function') {
    frappe.utils.copy_to_clipboard(url)
    return true
  }
  return false
}

const COMMENT_BOX_WAIT_MS = 50
const COMMENT_BOX_MAX_ATTEMPTS = 40

function getCurFrm() {
  return globalThis.cur_frm || globalThis.window?.cur_frm || null
}

function findCommentBox(frm = getCurFrm()) {
  const wrapper = frm?.footer?.wrapper
  if (!wrapper) {
    return null
  }
  if (typeof wrapper.find === 'function') {
    const found = wrapper.find('.comment-box')
    if (found?.length) {
      return found
    }
  }
  const root = wrapper?.[0] || wrapper
  if (root?.querySelector) {
    const node = root.querySelector('.comment-box')
    return node ? globalThis.$(node) : null
  }
  return null
}

function isFormRouteActive(doctype, name) {
  if (!doctype || !name || typeof frappe.get_route !== 'function') {
    return false
  }
  const route = frappe.get_route() || []
  return route[0] === 'Form' && route[1] === doctype && route[2] === name
}

function isFormOpen(doctype, name, frm = getCurFrm()) {
  if (!frm || !doctype || !name) {
    return false
  }
  // cur_frm alone is not enough: Desk often keeps it after returning to Kanban.
  if (!isFormRouteActive(doctype, name)) {
    return false
  }
  return frm.doctype === doctype && (frm.docname === name || frm.doc?.name === name)
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function waitForCommentBox({
  attempts = COMMENT_BOX_MAX_ATTEMPTS,
  delayMs = COMMENT_BOX_WAIT_MS,
} = {}) {
  for (let index = 0; index < attempts; index += 1) {
    const commentBox = findCommentBox()
    if (commentBox) {
      return commentBox
    }
    await sleep(delayMs)
  }
  return null
}

export function scrollToFormComments(frm = getCurFrm()) {
  const commentBox = findCommentBox(frm)
  if (!commentBox || typeof frappe.utils?.scroll_to !== 'function') {
    return false
  }
  frappe.utils.scroll_to(commentBox, true)
  return true
}

/**
 * Open the document form and scroll to the comment box (Form sidebar behavior).
 */
export async function navigateToFormComments(doctype, name) {
  if (!doctype || !name) {
    return false
  }

  if (!isFormOpen(doctype, name)) {
    if (typeof frappe.set_route !== 'function') {
      return false
    }
    await frappe.set_route('Form', doctype, name)
  }

  const commentBox = await waitForCommentBox()
  if (!commentBox || typeof frappe.utils?.scroll_to !== 'function') {
    return false
  }
  frappe.utils.scroll_to(commentBox, true)
  return true
}

export const DELETE_ATTACHMENT_CONFIRM_MESSAGE = 'Are you sure you want to delete the attachment?'

export const DELETE_CARD_CONFIRM_MESSAGE = 'Are you sure you want to delete {0}?'

/**
 * Confirm attachment delete with the same prompt as Form sidebar Attachments.
 * @returns {Promise<boolean>} true if the user confirmed
 */
export function confirmDeleteAttachment() {
  return new Promise((resolve) => {
    if (typeof frappe.confirm !== 'function') {
      resolve(true)
      return
    }
    frappe.confirm(
      __(DELETE_ATTACHMENT_CONFIRM_MESSAGE),
      () => resolve(true),
      () => resolve(false),
    )
  })
}

/**
 * Confirm permanent card/document delete.
 * @param {string} label Document title or name shown in the prompt
 * @returns {Promise<boolean>} true if the user confirmed
 */
export function confirmDeleteCard(label) {
  return new Promise((resolve) => {
    if (typeof frappe.confirm !== 'function') {
      resolve(true)
      return
    }
    frappe.confirm(
      __(DELETE_CARD_CONFIRM_MESSAGE, [label || ''], EXTRA_INFO_CONTEXT),
      () => resolve(true),
      () => resolve(false),
    )
  })
}
