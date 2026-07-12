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
  set_route: vi.fn(() => Promise.resolve()),
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
    eval: vi.fn((expression, context) => {
      if (expression.includes('status == "Done"')) {
        return context.doc.status === 'Done'
      }
      if (expression.includes('status == "Working"')) {
        return context.doc.status === 'Working'
      }
      return false
    }),
  },
  msgprint: vi.fn(),
  workflow: {
    workflows: {},
    setup: vi.fn(),
  },
  model: {
    can_create: vi.fn(() => true),
    with_doctype: vi.fn((doctype, callback) => Promise.resolve(callback?.())),
    get_new_doc: vi.fn((doctype) => ({
      doctype,
      name: `new-${doctype}-1`,
    })),
  },
  route_options: {},
  route_hooks: {},
  meta: {
    docfield_list: {},
    has_field: vi.fn(() => ({ no_copy: 0 })),
  },
  realtime: {
    doctype_subscribe: vi.fn(),
    doctype_unsubscribe: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
  ui: {
    Dialog: vi.fn(function Dialog() {
      this.fields = []
      this.$wrapper = {
        on: vi.fn(),
      }
      this.show = vi.fn()
      this.hide = vi.fn()
    }),
    form: {
      on: vi.fn(),
      off: vi.fn(),
      make_quick_entry: vi.fn(() => Promise.resolve({})),
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
