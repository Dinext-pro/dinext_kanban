import { beforeEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const bridgeSource = readFileSync(
  resolve(process.cwd(), '../quick_kanban/public/js/kanban_view.bundle.js'),
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
  window.mountQuickKanban = vi.fn()
  window.unmountQuickKanban = vi.fn()
  window.isQuickKanbanMountedOn = vi.fn(() => false)
  window.hydrateQuickKanban = vi.fn()
  window.cur_dialog = null
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
  window.quickKanbanBootstrap = {
    loadConfig: vi.fn().mockResolvedValue({
      kanban_beta: 1,
      kanban_beta_users: [],
    }),
    shouldUseBeta: vi.fn(() => true),
    loadScript: vi.fn().mockResolvedValue(),
    loadStylesheet: vi.fn().mockResolvedValue(),
  }
})

test('caps the native query and mounts once with its initial data', async () => {
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/quick_kanban/dist/css/quick_kanban.bundle.HASH.css'
          : '/assets/quick_kanban/dist/js/quick_kanban.bundle.HASH.js'
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
    expect(window.mountQuickKanban).toHaveBeenCalledTimes(1)
  })

  expect(window.quickKanbanInitialData).toEqual({
    board: view.board,
    cards: view.data,
    args: { doctype: 'Task', page_length: 100 },
    board_perms: {},
  })
  expect(window.quickKanbanBootstrap.loadConfig).toHaveBeenCalledTimes(1)
  expect(frappeApi.assets.bundled_asset).toHaveBeenCalledWith('quick_kanban.bundle.js')
  expect(frappeApi.assets.bundled_asset).toHaveBeenCalledWith('quick_kanban.bundle.css')
  expect(window.quickKanbanBootstrap.loadStylesheet).toHaveBeenCalledWith(
    '/assets/quick_kanban/dist/css/quick_kanban.bundle.HASH.css',
  )
  expect(window.quickKanbanBootstrap.loadScript).toHaveBeenCalledWith(
    '/assets/quick_kanban/dist/js/quick_kanban.bundle.HASH.js',
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

test('mounts beta assets when bootstrap lacks stylesheet helpers', async () => {
  window.quickKanbanBootstrap = {
    loadConfig: vi.fn().mockResolvedValue({
      kanban_beta: 1,
      kanban_beta_users: [],
    }),
    shouldUseBeta: vi.fn(() => true),
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
          ? '/assets/quick_kanban/dist/css/quick_kanban.bundle.HASH.css'
          : '/assets/quick_kanban/dist/js/quick_kanban.bundle.HASH.js'
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
    expect(window.mountQuickKanban).toHaveBeenCalledTimes(1)
  })

  expect(
    appendChild.mock.calls.some(([node]) => node?.rel === 'stylesheet'),
  ).toBe(true)
  expect(window.quickKanbanBootstrap.loadScript).toHaveBeenCalledWith(
    '/assets/quick_kanban/dist/js/quick_kanban.bundle.HASH.js',
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
          ? '/assets/quick_kanban/dist/css/quick_kanban.bundle.HASH.css'
          : '/assets/quick_kanban/dist/js/quick_kanban.bundle.HASH.js'
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
    expect(nativeView.__quickKanbanUpgraded).toBe(true)
  })
  expect(nativeView.page_length).toBe(100)
  expect(nativeView.set_fields).toHaveBeenCalledTimes(1)
  expect(nativeView.refresh).toHaveBeenCalledTimes(1)
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
  window.isQuickKanbanMountedOn = vi.fn((node) => node === mountNode)

  const view = new frappeApi.views.KanbanView({ $result })
  await view.renderBeta()

  expect(window.hydrateQuickKanban).toHaveBeenCalledTimes(1)
  expect(window.mountQuickKanban).not.toHaveBeenCalled()
  expect(window.unmountQuickKanban).not.toHaveBeenCalled()
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
  window.isQuickKanbanMountedOn = vi.fn((node) => node === firstMountNode)
  window.mountQuickKanban = vi.fn()

  const secondView = new frappeApi.views.KanbanView({
    board_name: 'Second Board',
    $result: secondResult,
    data: [{ name: 'TASK-2', status: 'Open' }],
  })

  await secondView.renderBeta()

  expect(window.unmountQuickKanban).toHaveBeenCalledTimes(1)
  expect(window.mountQuickKanban).toHaveBeenCalledWith(secondMountNode)
  expect(window.hydrateQuickKanban).not.toHaveBeenCalled()
  expect(window.quickKanbanInitialData).toEqual({
    board: secondView.board,
    cards: secondView.data,
    args: { doctype: 'Task', page_length: 0 },
    board_perms: {},
  })
})

test('falls back to native Kanban when bootstrap asset is unavailable', async () => {
  delete window.quickKanbanBootstrap
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
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: { bundled_asset: vi.fn() },
    session: { user: 'user@example.com' },
    show_alert: vi.fn(),
    set_route: setRoute,
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
  return { view, setRoute, frappeApi }
}

test('adds Open Kanban Board secondary action when Kanban Settings opens', () => {
  const { view } = createKanbanSettingsFrappeApi({ board_name: 'My Task Board' })

  view.show_kanban_settings()

  expect(window.cur_dialog.set_secondary_action_label).toHaveBeenCalledWith('Open Kanban Board')
  expect(window.cur_dialog.set_secondary_action).toHaveBeenCalledTimes(1)
})

test('navigates to the current Kanban Board form and closes the settings dialog', () => {
  const { view, setRoute } = createKanbanSettingsFrappeApi({ board_name: 'My Task Board' })

  view.show_kanban_settings()

  const secondaryAction = window.cur_dialog.set_secondary_action.mock.calls[0][0]
  secondaryAction()

  expect(window.cur_dialog.hide).toHaveBeenCalledTimes(1)
  expect(setRoute).toHaveBeenCalledWith('Form', 'Kanban Board', 'My Task Board')
})

test('parses serialized board.fields before opening Kanban Settings', () => {
  const { view } = createKanbanSettingsFrappeApi()
  view.board.fields = '["expected_end_date","project"]'

  view.show_kanban_settings()

  expect(view.board.fields).toEqual(['expected_end_date', 'project'])
})

test('does not attach Open Kanban Board action to unrelated dialogs', () => {
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
    expect(window.cur_dialog.set_secondary_action_label).toHaveBeenCalledWith('Open Kanban Board')
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
  window.setQuickKanbanMinimizeCards = setMinimize
  const frappeApi = {
    provide: vi.fn(),
    call: vi.fn(),
    assets: {
      bundled_asset: vi.fn((asset) => (
        asset.includes('css')
          ? '/assets/quick_kanban/dist/css/quick_kanban.bundle.HASH.css'
          : '/assets/quick_kanban/dist/js/quick_kanban.bundle.HASH.js'
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
  view.$filter_section = createFilterSection()

  view.render()
  await vi.waitFor(() => {
    expect(window.mountQuickKanban).toHaveBeenCalledTimes(1)
  })

  const control = document.querySelector('.quick-kanban-minimize-control')
  const filterSection = document.querySelector('.filter-section')
  expect(control).toBeTruthy()
  expect(control.nextElementSibling).toBe(filterSection)
  expect(control.textContent).toContain('Minimize')

  const checkbox = control.querySelector('input[type="checkbox"]')
  checkbox.checked = true
  checkbox.dispatchEvent(new Event('change'))
  expect(setMinimize).toHaveBeenCalledWith(true)
})

test('removes Minimize checkbox when falling back to native Kanban', async () => {
  window.quickKanbanBootstrap.shouldUseBeta = vi.fn(() => false)
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
  expect(document.querySelector('.quick-kanban-minimize-control')).toBeTruthy()

  view.render()
  await vi.waitFor(() => expect(NativeBoard).toHaveBeenCalledTimes(1))
  expect(document.querySelector('.quick-kanban-minimize-control')).toBeNull()
})
