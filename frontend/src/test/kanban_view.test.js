import { beforeEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const bridgeSource = readFileSync(
  resolve(process.cwd(), '../dinext_kanban/public/js/kanban_view.bundle.js'),
  'utf8',
)

function createVisibilityContainer(className, initialHtml = '') {
  const wrapper = document.createElement('div')
  wrapper.className = className
  wrapper.innerHTML = initialHtml
  document.body.appendChild(wrapper)
  const api = {
    wrapper,
    visible: true,
    html: vi.fn((html) => {
      wrapper.innerHTML = html
    }),
    find: vi.fn((selector) => wrapper.querySelectorAll(selector)),
    empty: vi.fn(() => {
      wrapper.innerHTML = ''
    }),
    show: vi.fn(() => {
      api.visible = true
      wrapper.style.display = ''
      return api
    }),
    hide: vi.fn(() => {
      api.visible = false
      wrapper.style.display = 'none'
      return api
    }),
    toggle: vi.fn((show) => {
      if (show === undefined) {
        return api.visible ? api.hide() : api.show()
      }
      return show ? api.show() : api.hide()
    }),
  }
  return api
}

function createResultContainer(initialHtml = '') {
  return createVisibilityContainer('list-result', initialHtml)
}

class NativeKanbanView {
  constructor(options = {}) {
    this.page_length = 0
    this.board_name = options.board_name || 'Task Board'
    this.board = {
      name: options.board_name || 'Task Board',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['expected_end_date', 'project'],
      custom_highlighted_field: 'priority',
      columns: [],
    }
    this.card_meta = { title_field: { fieldname: 'subject' } }
    this.fields = []
    this.data = options.data || []
    this.$result = options.$result || createResultContainer()
    this.$no_result = options.$no_result || createVisibilityContainer('no-result')
    this.$paging_area = options.$paging_area || createVisibilityContainer('list-paging-area')
  }

  async setup_defaults() {
    this.page_length = 0
  }

  set_fields() {
    this._add_field(this.card_meta.title_field)
  }

  _add_field(field) {
    const fieldname = typeof field === 'object' ? field.fieldname : field
    if (fieldname && !this.fields.includes(fieldname)) {
      this.fields.push(fieldname)
    }
  }

  get_args() {
    return { doctype: 'Task', page_length: this.page_length }
  }

  get_fields() {
    this.fields.push(this.board.field_name)
    return this.fields
  }

  show_kanban_settings() {
    window.cur_dialog = {
      fields: [{ fieldname: 'show_labels' }],
      set_secondary_action_label: vi.fn(),
      set_secondary_action: vi.fn(),
      hide: vi.fn(),
      show: vi.fn(),
    }
    if (typeof globalThis.$ !== 'undefined') {
      globalThis.$(document).trigger('frappe.ui.Dialog:shown')
    }
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.mountDinextKanban = vi.fn()
  window.unmountDinextKanban = vi.fn()
  window.isDinextKanbanMountedOn = vi.fn(() => false)
  window.hydrateDinextKanban = vi.fn()
  window.cur_dialog = null
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      'dinext_kanban.bundle.js': '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js',
      'dinext_kanban.bundle.css': '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css',
    }),
  })
  const documentEventHandlers = {}
  globalThis.__documentEventHandlers = documentEventHandlers
  globalThis.$ = vi.fn((target) => {
    if (target !== document) {
      return { one: vi.fn(), trigger: vi.fn() }
    }
    return {
      one: vi.fn((event, handler) => {
        documentEventHandlers[event] = handler
      }),
      trigger: vi.fn((event) => {
        documentEventHandlers[event]?.()
      }),
    }
  })
  window.dinextKanbanBootstrap = {
    loadScript: vi.fn().mockResolvedValue(),
    loadStylesheet: vi.fn().mockResolvedValue(),
    forgetScript: vi.fn(),
  }
})

test('caps the native query and mounts once with its initial data', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css'
          : '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js'
      )),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
          this._add_field('_assign')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()

  await view.setup_defaults()
  expect(view.page_length).toBe(100)

  view.render()
  await vi.waitFor(() => {
    expect(window.mountDinextKanban).toHaveBeenCalledTimes(1)
  })

  expect(window.dinextKanbanInitialData).toEqual({
    board: view.board,
    cards: view.data,
    args: { doctype: 'Task', page_length: 100 },
    board_perms: {},
  })
  expect(frappeApi.assets.bundled_asset).toHaveBeenCalledWith('dinext_kanban.bundle.js')
  expect(frappeApi.assets.bundled_asset).toHaveBeenCalledWith('dinext_kanban.bundle.css')
  expect(window.dinextKanbanBootstrap.loadStylesheet).toHaveBeenCalledWith(
    '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css',
  )
  expect(window.dinextKanbanBootstrap.loadScript).toHaveBeenCalledWith(
    '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js',
  )
})

test('adds configured card fields before the first report request', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: {
      bundled_asset: vi.fn(),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
          this._add_field('_assign')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()

  await view.setup_defaults()
  await view.set_fields()

  expect(view.fields).toEqual([
    'name',
    '_assign',
    'subject',
    'expected_end_date',
    'project',
    'priority',
  ])
  expect(view.get_fields().filter((field) => field === 'status')).toHaveLength(1)
})

test('adds color field when DocType defines color with fieldtype Color', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: {
      bundled_asset: vi.fn(),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({
      fields: [{ fieldname: 'color', fieldtype: 'Color', label: 'Color' }],
    })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
          this._add_field('_assign')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()

  await view.setup_defaults()
  await view.set_fields()

  expect(view.fields).toContain('color')
})

test('adds tree parent field for tree DocTypes so child filtering can work', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: {
      bundled_asset: vi.fn(),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({
      fields: [],
      is_tree: 1,
      nsm_parent_field: 'parent_task',
    })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
          this._add_field('_assign')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()

  await view.setup_defaults()
  await view.set_fields()

  expect(view.fields).toContain('parent_task')
})

test('mounts beta assets when bootstrap lacks stylesheet helpers', async () => {
  window.dinextKanbanBootstrap = {
    loadScript: vi.fn().mockResolvedValue(),
  }
  const appendChild = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    if (node?.rel === 'stylesheet') {
      node.dispatchEvent(new Event('load'))
    }
    return node
  })
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css'
          : '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js'
      )),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
          this._add_field('_assign')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()

  view.render()
  await vi.waitFor(() => {
    expect(window.mountDinextKanban).toHaveBeenCalledTimes(1)
  })

  expect(
    appendChild.mock.calls.some(([node]) => node?.rel === 'stylesheet'),
  ).toBe(true)
  expect(window.dinextKanbanBootstrap.loadScript).toHaveBeenCalledWith(
    '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js',
  )
  appendChild.mockRestore()
})

test('upgrades an active native Kanban instance created before the bridge loads', async () => {
  const nativeView = new NativeKanbanView()
  nativeView.render = vi.fn()
  nativeView.refresh = vi.fn().mockResolvedValue(undefined)
  nativeView.set_fields = vi.fn().mockResolvedValue(undefined)
  window.cur_list = nativeView

  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css'
          : '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js'
      )),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_route: vi.fn(() => ['List', 'Task', 'Kanban', 'Task Board']),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
          this._add_field('_assign')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )

  await vi.waitFor(() => {
    expect(nativeView.__dinextKanbanUpgraded).toBe(true)
    expect(nativeView.set_fields).toHaveBeenCalledTimes(1)
    expect(nativeView.refresh).toHaveBeenCalledTimes(1)
  })
  expect(nativeView.page_length).toBe(100)
  expect(Object.getPrototypeOf(nativeView)).toBe(frappeApi.views.KanbanView.prototype)
})

test('keeps the result area visible when filters match no cards', () => {
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: { bundled_asset: vi.fn() },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )

  const $result = createResultContainer('<div id="kanbanapp"></div>')
  $result.hide()
  const $no_result = createVisibilityContainer('no-result')
  $no_result.show()
  const $paging_area = createVisibilityContainer('list-paging-area')
  $paging_area.show()

  const view = new frappeApi.views.KanbanView({
    data: [],
    $result,
    $no_result,
    $paging_area,
  })
  view.toggle_result_area()

  expect($result.visible).toBe(true)
  expect($result.show).toHaveBeenCalled()
  expect($no_result.visible).toBe(false)
  expect($no_result.hide).toHaveBeenCalled()
  expect($paging_area.visible).toBe(false)
  expect($paging_area.toggle).toHaveBeenCalledWith(false)
})

test('hydrates when Vue is already mounted on the active board container', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: { bundled_asset: vi.fn() },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )

  const $result = createResultContainer('<div id="kanbanapp"></div>')
  const mountNode = $result.find('#kanbanapp')[0]
  window.isDinextKanbanMountedOn = vi.fn((node) => node === mountNode)

  const view = new frappeApi.views.KanbanView({ $result })
  await view.renderBeta()

  expect(window.hydrateDinextKanban).toHaveBeenCalledTimes(1)
  expect(window.mountDinextKanban).not.toHaveBeenCalled()
  expect(window.unmountDinextKanban).not.toHaveBeenCalled()
})

test('remounts onto the active board container when switching cached Kanban pages', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: { bundled_asset: vi.fn() },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )

  const firstResult = createResultContainer('<div id="kanbanapp"></div>')
  const secondResult = createResultContainer('<div id="kanbanapp"></div>')
  const firstMountNode = firstResult.find('#kanbanapp')[0]
  const secondMountNode = secondResult.find('#kanbanapp')[0]
  window.isDinextKanbanMountedOn = vi.fn((node) => node === firstMountNode)
  window.mountDinextKanban = vi.fn()

  const secondView = new frappeApi.views.KanbanView({
    board_name: 'Second Board',
    $result: secondResult,
    data: [{ name: 'TASK-2', status: 'Open' }],
  })

  await secondView.renderBeta()

  expect(window.unmountDinextKanban).toHaveBeenCalledTimes(1)
  expect(window.mountDinextKanban).toHaveBeenCalledWith(secondMountNode)
  expect(window.hydrateDinextKanban).not.toHaveBeenCalled()
  expect(window.dinextKanbanInitialData).toEqual({
    board: secondView.board,
    cards: secondView.data,
    args: { doctype: 'Task', page_length: 0 },
    board_perms: {},
  })
})

test('falls back to native Kanban when bootstrap asset is unavailable', async () => {
  delete window.dinextKanbanBootstrap
  const NativeBoard = vi.fn()
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: {
      bundled_asset: vi.fn(),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: NativeBoard,
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()

  expect(() => view.render()).not.toThrow()
  await vi.waitFor(() => expect(NativeBoard).toHaveBeenCalledTimes(1))
})

function createKanbanSettingsFrappeApi(options = {}) {
  const boardName = options.board_name || 'Task Board'
  const setRoute = vi.fn()
  const clearDoc = vi.fn()
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: { bundled_asset: vi.fn() },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    set_route: setRoute,
    model: { clear_doc: clearDoc },
    db: {
      get_doc: vi.fn(),
    },
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView({ board_name: boardName })
  return { view, setRoute, clearDoc, frappeApi }
}

test('adds Advanced Settings secondary action when Kanban Settings opens', () => {
  const { view } = createKanbanSettingsFrappeApi({ board_name: 'My Task Board' })

  view.show_kanban_settings()

  expect(window.cur_dialog.set_secondary_action_label).toHaveBeenCalledWith('Advanced Settings')
  expect(window.cur_dialog.set_secondary_action).toHaveBeenCalledTimes(1)
})

test('navigates to the current Kanban Board form and closes the settings dialog', () => {
  const { view, setRoute, clearDoc } = createKanbanSettingsFrappeApi({
    board_name: 'My Task Board',
  })

  view.show_kanban_settings()

  const secondaryAction = window.cur_dialog.set_secondary_action.mock.calls[0][0]
  secondaryAction()

  expect(window.cur_dialog.hide).toHaveBeenCalledTimes(1)
  expect(clearDoc).toHaveBeenCalledWith('Kanban Board', 'My Task Board')
  expect(setRoute).toHaveBeenCalledWith('Form', 'Kanban Board', 'My Task Board')
})

test('parses serialized board.fields before opening Kanban Settings', () => {
  const { view } = createKanbanSettingsFrappeApi()
  view.board.fields = '["expected_end_date","project"]'

  view.show_kanban_settings()

  expect(view.board.fields).toEqual(['expected_end_date', 'project'])
})

test('get_board parses fields on a copy and leaves synced locals as a JSON string', async () => {
  const { view, frappeApi } = createKanbanSettingsFrappeApi({
    board_name: 'My Task Board',
  })
  const syncedLocals = {
    name: 'My Task Board',
    doctype: 'Kanban Board',
    fields: '["expected_end_date","project"]',
    filters: '[]',
    reference_doctype: 'Task',
    field_name: 'status',
    columns: [],
  }
  frappeApi.db.get_doc.mockResolvedValue(syncedLocals)

  await view.get_board()

  expect(syncedLocals.fields).toBe('["expected_end_date","project"]')
  expect(view.board).not.toBe(syncedLocals)
  expect(view.board.fields).toEqual(['expected_end_date', 'project'])
  expect(view.board.filters_array).toEqual([])
  expect(view.filters).toEqual([])
})

test('does not attach Advanced Settings action to unrelated dialogs', () => {
  const { view } = createKanbanSettingsFrappeApi()
  const nativeShow = NativeKanbanView.prototype.show_kanban_settings
  NativeKanbanView.prototype.show_kanban_settings = vi.fn()

  try {
    view.show_kanban_settings()
    const attachHandler = globalThis.__documentEventHandlers['frappe.ui.Dialog:shown']

    window.cur_dialog = {
      fields: [{ fieldname: 'other_field' }],
      set_secondary_action_label: vi.fn(),
      set_secondary_action: vi.fn(),
    }
    attachHandler()
    expect(window.cur_dialog.set_secondary_action_label).not.toHaveBeenCalled()
    expect(window.cur_dialog.set_secondary_action).not.toHaveBeenCalled()

    window.cur_dialog = {
      fields: [{ fieldname: 'show_labels' }],
      set_secondary_action_label: vi.fn(),
      set_secondary_action: vi.fn(),
      hide: vi.fn(),
    }
    attachHandler()
    expect(window.cur_dialog.set_secondary_action_label).toHaveBeenCalledWith('Advanced Settings')
  } finally {
    NativeKanbanView.prototype.show_kanban_settings = nativeShow
  }
})

function createFilterSection() {
  const customActions = document.createElement('div')
  customActions.className = 'custom-actions'
  const section = document.createElement('div')
  section.className = 'filter-section flex'
  const filterSelector = document.createElement('div')
  filterSelector.className = 'filter-selector'
  const button = document.createElement('button')
  button.className = 'filter-button'
  button.textContent = 'Filter'
  filterSelector.appendChild(button)
  section.appendChild(filterSelector)
  customActions.appendChild(section)
  document.body.appendChild(customActions)
  return {
    0: section,
    length: 1,
    find: (selector) => {
      const nodes = [...section.querySelectorAll(selector)]
      return Object.assign(nodes, {
        0: nodes[0],
        length: nodes.length,
      })
    },
    prepend: (node) => {
      section.insertBefore(node, section.firstChild)
    },
  }
}

test('inserts Minimize checkbox before the Filter control on beta render', async () => {
  const setMinimize = vi.fn()
  window.setDinextKanbanMinimizeCards = setMinimize
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css'
          : '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js'
      )),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    utils: {
      icon: vi.fn((name, size = 'sm') => (
        `<svg class="icon icon-${size}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`
      )),
    },
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()
  view.$filter_section = createFilterSection()

  view.render()
  await vi.waitFor(() => {
    expect(window.mountDinextKanban).toHaveBeenCalledTimes(1)
  })

  const control = document.querySelector('.dinext-kanban-minimize-control')
  const filterSection = document.querySelector('.filter-section')
  expect(control).toBeTruthy()
  expect(control.nextElementSibling).toBe(filterSection)
  expect(control.getAttribute('aria-label')).toBe('Minimize')
  expect(control.getAttribute('title')).toBe('Minimize')
  expect(control.querySelector('use[href="#icon-collapse"]')).toBeTruthy()
  expect(control.textContent).not.toContain('Minimize')
  expect(frappeApi.utils.icon).toHaveBeenCalledWith('collapse', 'sm')

  const checkbox = control.querySelector('input[type="checkbox"]')
  checkbox.checked = true
  checkbox.dispatchEvent(new Event('change'))
  expect(setMinimize).toHaveBeenCalledWith(true)
})

test('removes Minimize checkbox when falling back to native Kanban', async () => {
  delete window.dinextKanbanBootstrap
  const NativeBoard = vi.fn()
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: { bundled_asset: vi.fn() },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: NativeBoard,
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()
  view.$filter_section = createFilterSection()
  view.setup_minimize_cards_control()
  expect(document.querySelector('.dinext-kanban-minimize-control')).toBeTruthy()

  view.render()
  await vi.waitFor(() => expect(NativeBoard).toHaveBeenCalledTimes(1))
  expect(frappeApi.show_alert).toHaveBeenCalled()
  expect(document.querySelector('.dinext-kanban-minimize-control')).toBeNull()
  expect(document.querySelector('.dinext-kanban-show-child-tasks-control')).toBeNull()
  expect(document.querySelector('.dinext-kanban-groupby-control')).toBeNull()
})

function mockFrappeCall(handlers = {}) {
  return vi.fn((opts) => {
    const method = opts?.method
    const handler = handlers[method]
    const message = handler
      ? handler(opts.args || {})
      : undefined
    opts?.callback?.({ message })
    opts?.always?.()
    return Promise.resolve({ message })
  })
}

test('inserts Show child tasks between Minimize and Group By for tree doctypes', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: mockFrappeCall({
      'dinext_kanban.api.get_swimlane_field_options': () => ([
        { value: '__assign', label: 'Assigned To' },
        { value: 'priority', label: 'Priority' },
      ]),
    }),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css'
          : '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js'
      )),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({
      fields: [],
      is_tree: 1,
      nsm_parent_field: 'parent_task',
    })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()
  view.board_perms = { write: true }
  view.board.reference_doctype = 'Task'
  view.board.custom_swimlane_field = ''
  view.$filter_section = createFilterSection()

  view.render()
  await vi.waitFor(() => {
    expect(window.mountDinextKanban).toHaveBeenCalledTimes(1)
  })

  const minimize = document.querySelector('.dinext-kanban-minimize-control')
  const showChildren = document.querySelector('.dinext-kanban-show-child-tasks-control')
  const groupby = document.querySelector('.dinext-kanban-groupby-control')
  const filterSection = document.querySelector('.filter-section')
  expect(minimize).toBeTruthy()
  expect(showChildren).toBeTruthy()
  expect(groupby).toBeTruthy()
  expect(minimize.nextElementSibling).toBe(showChildren)
  expect(showChildren.nextElementSibling).toBe(groupby)
  expect(groupby.nextElementSibling).toBe(filterSection)
  expect(showChildren.getAttribute('aria-label')).toBe('Show child tasks')
  expect(showChildren.querySelector('svg[data-icon="child-tree"]')).toBeTruthy()
  expect(showChildren.textContent).not.toContain('Show child tasks')
  expect(showChildren.querySelector('input[type="checkbox"]').checked).toBe(false)
})

test('hides Show child tasks control for non-tree doctypes', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: mockFrappeCall({
      'dinext_kanban.api.get_swimlane_field_options': () => ([]),
    }),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css'
          : '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js'
      )),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [], is_tree: 0 })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()
  view.board_perms = { write: true }
  view.$filter_section = createFilterSection()

  view.render()
  await vi.waitFor(() => {
    expect(window.mountDinextKanban).toHaveBeenCalledTimes(1)
  })

  expect(document.querySelector('.dinext-kanban-show-child-tasks-control')).toBeNull()
  const minimize = document.querySelector('.dinext-kanban-minimize-control')
  const groupby = document.querySelector('.dinext-kanban-groupby-control')
  expect(minimize.nextElementSibling).toBe(groupby)
})

test('inserts Group By between Minimize and Filter when board write is allowed', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: mockFrappeCall({
      'dinext_kanban.api.get_swimlane_field_options': () => ([
        { value: '__assign', label: 'Assigned To' },
        { value: 'priority', label: 'Priority' },
      ]),
    }),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css'
          : '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js'
      )),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()
  view.board_perms = { write: true }
  view.board.custom_swimlane_field = ''
  view.$filter_section = createFilterSection()

  view.render()
  await vi.waitFor(() => {
    expect(window.mountDinextKanban).toHaveBeenCalledTimes(1)
  })

  const minimize = document.querySelector('.dinext-kanban-minimize-control')
  const groupby = document.querySelector('.dinext-kanban-groupby-control')
  const filterSection = document.querySelector('.filter-section')
  expect(minimize).toBeTruthy()
  expect(groupby).toBeTruthy()
  expect(minimize.nextElementSibling).toBe(groupby)
  expect(groupby.nextElementSibling).toBe(filterSection)
  expect(groupby.querySelector('.dinext-kanban-groupby-label')).toBeNull()
  expect(groupby.querySelector('button')?.getAttribute('aria-label')).toBe('Group By')
  expect(groupby.querySelector('.dropdown-text')?.textContent).toBe('No Grouping')
  expect(groupby.querySelectorAll('.dropdown-item.option').length).toBe(3)
})

test('hides Group By when board write is not allowed', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: mockFrappeCall(),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css'
          : '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js'
      )),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()
  view.board_perms = {}
  view.$filter_section = createFilterSection()

  view.render()
  await vi.waitFor(() => {
    expect(window.mountDinextKanban).toHaveBeenCalledTimes(1)
  })

  expect(document.querySelector('.dinext-kanban-minimize-control')).toBeTruthy()
  expect(document.querySelector('.dinext-kanban-groupby-control')).toBeNull()
})

test('Group By change persists via set_swimlane_field and refreshes the board', async () => {
  const refreshBoard = vi.fn()
  window.__dinextKanbanStore = {
    state: { minimize_cards: false },
    getters: { canEditBoard: true },
    dispatch: refreshBoard,
  }
  const frappeApi = {
    provide: vi.fn(),
    call: mockFrappeCall({
      'dinext_kanban.api.get_swimlane_field_options': () => ([
        { value: '__assign', label: 'Assigned To' },
      ]),
      'dinext_kanban.api.set_swimlane_field': ({ swimlane_field }) => ({
        custom_swimlane_field: swimlane_field,
      }),
    }),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.HASH.css'
          : '/assets/dinext_kanban/dist/js/dinext_kanban.bundle.HASH.js'
      )),
    },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    get_meta: vi.fn(() => ({ fields: [] })),
    views: {
      KanbanView: NativeKanbanView,
      KanbanBoard: vi.fn(),
      ListView: class {
        async set_fields() {
          this._add_field('name')
        }
      },
    },
  }
  new Function('window', 'frappe', '__', bridgeSource)(
    window,
    frappeApi,
    globalThis.__,
  )
  const view = new frappeApi.views.KanbanView()
  view.board_perms = { write: true }
  view.board_name = 'Task Board'
  view.board.custom_swimlane_field = ''
  view.$filter_section = createFilterSection()

  view.render()
  await vi.waitFor(() => {
    expect(document.querySelector('.dinext-kanban-groupby-control')).toBeTruthy()
  })

  const option = document.querySelector(
    '.dinext-kanban-groupby-control .dropdown-item.option[data-value="__assign"]',
  )
  expect(option).toBeTruthy()
  option.click()

  expect(frappeApi.call).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'dinext_kanban.api.set_swimlane_field',
      args: {
        board_name: 'Task Board',
        swimlane_field: '__assign',
      },
    }),
  )
  expect(view.board.custom_swimlane_field).toBe('__assign')
  expect(refreshBoard).toHaveBeenCalledWith('refreshBoard', {
    board_name: 'Task Board',
    forceConfig: true,
  })
  delete window.__dinextKanbanStore
})
