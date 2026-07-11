import { vi } from 'vitest'

globalThis.__ = (message, values = []) =>
  (values || []).reduce(
    (result, value, index) => result.replace(`{${index}}`, value),
    message,
  )

globalThis.frappe = {
  boot: { user_info: {} },
  call: vi.fn(),
  get_meta: vi.fn(),
  get_route: vi.fn(() => ['List', 'Task', 'Kanban', 'Test Board']),
  new_doc: vi.fn(),
  show_alert: vi.fn(),
  set_route: vi.fn(),
  update_user_info: vi.fn((userInfo = {}) => {
    Object.assign(frappe.boot.user_info, userInfo)
  }),
  user_info: vi.fn((user) => frappe.boot.user_info[user] || { fullname: user }),
  avatar_group: vi.fn((users, limit, options = {}) => {
    const group = document.createElement('div')
    group.className = 'avatar-group overlap'
    group.dataset.users = users.join(',')
    group.dataset.limit = String(limit)

    users.slice(0, limit).forEach((user) => {
      const avatar = document.createElement('span')
      avatar.className = 'avatar avatar-small'
      avatar.dataset.user = user
      group.appendChild(avatar)
    })

    const extra = users.slice(limit)
    if (extra.length > 1) {
      const count = document.createElement('span')
      count.className = 'avatar avatar-small avatar-extra-count'
      count.textContent = `+${extra.length}`
      group.appendChild(count)
    } else if (extra.length === 1) {
      const avatar = document.createElement('span')
      avatar.className = 'avatar avatar-small'
      avatar.dataset.user = extra[0]
      group.appendChild(avatar)
    }

    if (options.action_icon) {
      const action = document.createElement('span')
      action.className = 'avatar avatar-small avatar-action'
      if (options.action) {
        action.addEventListener('click', options.action)
      }
      group.appendChild(action)
    }

    return {
      0: group,
      length: 1,
      get: () => group,
      find: (selector) => ({
        on: (event, handler) => {
          if (event === 'click' && selector === '.avatar-action') {
            group.querySelectorAll('.avatar-action').forEach((node) => {
              node.addEventListener('click', handler)
            })
          }
        },
      }),
    }
  }),
  utils: {
    get_form_link: vi.fn((doctype, name) => `/app/${doctype}/${name}`),
  },
  realtime: {
    doctype_subscribe: vi.fn(),
    doctype_unsubscribe: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
  ui: {
    form: {
      AssignToDialog: vi.fn(function AssignToDialog() {
        this.dialog = { show: vi.fn() }
      }),
      AssignmentDialog: vi.fn(function AssignmentDialog() {
        this.dialog = { show: vi.fn() }
      }),
    },
  },
}

window.cur_list = {
  get_args: vi.fn(() => ({ doctype: 'Task' })),
}
