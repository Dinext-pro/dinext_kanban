import { vi } from 'vitest'

globalThis.__ = (message, values = []) =>
  (values || []).reduce(
    (result, value, index) => result.replace(`{${index}}`, value),
    message,
  )

globalThis.frappe = {
  boot: { user_info: {} },
  session: { user: 'Administrator' },
  call: vi.fn(),
  get_meta: vi.fn(() => ({ fields: [], protect_attached_files: 0 })),
  get_route: vi.fn(() => ['List', 'Task', 'Kanban', 'Test Board']),
  new_doc: vi.fn(),
  show_alert: vi.fn(),
  confirm: vi.fn((_message, onYes) => {
    onYes?.()
  }),
  set_route: vi.fn(() => Promise.resolve()),
  update_user_info: vi.fn((userInfo = {}) => {
    Object.assign(frappe.boot.user_info, userInfo)
  }),
  user_info: vi.fn((user) => frappe.boot.user_info[user] || { fullname: user }),
  urllib: {
    get_full_url: vi.fn((url) => `https://example.com${url}`),
  },
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
    get_link_title: vi.fn(() => null),
    fetch_link_title: vi.fn(async (_doctype, name) => name),
    add_link_title: vi.fn(),
    copy_to_clipboard: vi.fn(),
    scroll_to: vi.fn(),
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
    is_read_only: vi.fn(() => false),
  },
  model: {
    can_create: vi.fn(() => true),
    can_write: vi.fn(() => false),
    can_delete: vi.fn(() => false),
    with_doctype: vi.fn((doctype, callback) => Promise.resolve(callback?.())),
    with_doc: vi.fn((doctype, name) =>
      Promise.resolve({
        doctype,
        name,
        docstatus: 0,
      }),
    ),
    clear_doc: vi.fn(),
    get_new_doc: vi.fn((doctype) => ({
      doctype,
      name: `new-${doctype}-1`,
    })),
    is_non_std_field: vi.fn((fieldname) => ![
      'name',
      'owner',
      'creation',
      'modified',
      'modified_by',
      'docstatus',
      'idx',
      'parent',
      'parentfield',
      'parenttype',
    ].includes(fieldname)),
  },
  meta: {
    docfield_list: {},
    has_field: vi.fn(() => ({ no_copy: 0 })),
    get_field: vi.fn((doctype, fieldname) => ({
      fieldname,
      fieldtype: 'Data',
      label: fieldname,
      parent: doctype,
    })),
    get_docfield: vi.fn((doctype, fieldname) => ({
      fieldname,
      fieldtype: 'Data',
      label: fieldname,
      parent: doctype,
    })),
  },
  perm: {
    get_field_display_status: vi.fn(() => 'Write'),
  },
  db: {
    set_value: vi.fn((doctype, name, values) =>
      Promise.resolve({
        message: {
          doctype,
          name,
          ...values,
          modified: '2026-07-15 12:00:00',
        },
      }),
    ),
  },
  route_options: {},
  route_hooks: {},
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
    TagEditor: vi.fn(function TagEditor(opts = {}) {
      Object.assign(this, opts)
      this.user_tags = opts.user_tags || ''
      this.refresh = vi.fn((userTags) => {
        this.user_tags = userTags || ''
        renderPills(opts.parent?.[0] || opts.parent, this.user_tags)
      })
      this.awesomplete = { destroy: vi.fn() }

      const parent = opts.parent?.[0] || opts.parent
      if (parent?.querySelector) {
        const toolbar = parent.querySelector('.form-sidebar-items')
        if (toolbar && !toolbar.querySelector('.add-tags-btn')) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'add-tags-btn text-muted btn btn-link icon-btn'
          button.innerHTML = '<svg class="es-icon icon-sm"><use href="#es-line-add"></use></svg>'
          toolbar.appendChild(button)
        }
        if (!parent.querySelector('input.tags-input')) {
          const inputLi = document.createElement('li')
          const input = document.createElement('input')
          input.className = 'tags-input form-control'
          inputLi.appendChild(input)
          parent.appendChild(inputLi)
        }
        renderPills(parent, this.user_tags)
      }

      function renderPills(root, userTags) {
        if (!root?.querySelector) {
          return
        }
        root.querySelectorAll(':scope > li.form-tag-row').forEach((node) => node.remove())
        const tags = String(userTags || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
        const inputLi = root.querySelector('input.tags-input')?.closest('li')
        let insertAfter = inputLi
        for (const tag of tags) {
          const li = document.createElement('li')
          li.className = 'form-tag-row'
          const pill = document.createElement('div')
          pill.className = 'data-pill'
          pill.setAttribute('data-tag', tag)
          const label = document.createElement('span')
          label.className = 'pill-label'
          label.textContent = tag
          const remove = document.createElement('button')
          remove.type = 'button'
          remove.className = 'remove-btn'
          remove.textContent = 'x'
          pill.appendChild(label)
          pill.appendChild(remove)
          li.appendChild(pill)
          if (insertAfter?.parentNode) {
            insertAfter.parentNode.insertBefore(li, insertAfter.nextSibling)
            insertAfter = li
          } else {
            root.appendChild(li)
            insertAfter = li
          }
        }
      }
    }),
    FileUploader: vi.fn(function FileUploader() {}),
    form: {
      Attachments: class Attachments {},
      on: vi.fn(),
      off: vi.fn(),
      make_quick_entry: vi.fn(() => Promise.resolve({})),
      make_control: vi.fn(({ parent, df, value }) => {
        const input = document.createElement(
          df.fieldtype === 'Select' ? 'select' : 'input',
        )
        input.className = 'input-with-feedback form-control'
        if (df.fieldtype === 'Select') {
          String(df.options || '')
            .split('\n')
            .map((option) => option.trim())
            .filter(Boolean)
            .forEach((option) => {
              const node = document.createElement('option')
              node.value = option
              node.textContent = option
              input.appendChild(node)
            })
        }
        input.value = value ?? ''
        const wrapper = document.createElement('div')
        wrapper.className = 'frappe-control'
        wrapper.appendChild(input)
        if (parent?.append) {
          parent.append(wrapper)
        } else if (parent?.[0]?.appendChild) {
          parent[0].appendChild(wrapper)
        } else if (parent instanceof HTMLElement) {
          parent.appendChild(wrapper)
        }
        const control = {
          df,
          value,
          $wrapper: {
            0: wrapper,
            on: vi.fn(),
            off: vi.fn(),
            remove: () => wrapper.remove(),
          },
          $input: {
            0: input,
            trigger: vi.fn(),
            focus: vi.fn(),
          },
          toggle_label: vi.fn(),
          toggle_description: vi.fn(),
          set_focus: vi.fn(),
          set_value: vi.fn((next) => {
            control.value = next
            input.value = next ?? ''
            return Promise.resolve()
          }),
          get_value: vi.fn(() => control.value ?? input.value),
        }
        return control
      }),
      AssignToDialog: vi.fn(function AssignToDialog() {
        this.dialog = { show: vi.fn() }
      }),
      AssignmentDialog: vi.fn(function AssignmentDialog() {
        this.dialog = { show: vi.fn() }
      }),
    },
  },
}

globalThis.$ = (target) => {
  if (target && typeof target === 'object' && typeof target.on === 'function') {
    return target
  }
  const element = target?.nodeType
    ? target
    : typeof target === 'string'
      ? document.querySelector(target)
      : target?.[0] || target
  return {
    0: element,
    length: element ? 1 : 0,
    append: (node) => {
      const child = node?.nodeType ? node : node?.[0]
      if (element && child) {
        element.appendChild(child)
      }
      return globalThis.$(element)
    },
    empty: () => {
      if (element) {
        element.innerHTML = ''
      }
      return globalThis.$(element)
    },
    on: vi.fn(),
    off: vi.fn(),
    trigger: vi.fn(),
    remove: () => {
      element?.remove?.()
      return globalThis.$(element)
    },
  }
}

window.cur_list = {
  get_args: vi.fn(() => ({ doctype: 'Task' })),
  get_tags_html: vi.fn((userTags, limit = 3, colored = false) => {
    if (!userTags) return ''
    return userTags
      .split(',')
      .slice(1, limit + 1)
      .filter(Boolean)
      .map((tag) => {
        const style = colored ? 'background-color: var(--blue-100); color: var(--blue-800)' : ''
        return `<div class="tag-pill ellipsis" title="${tag}" style="${style}">${tag}</div>`
      })
      .join('')
  }),
}
