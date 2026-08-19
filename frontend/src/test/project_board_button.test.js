import { beforeEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const navSource = readFileSync(
  resolve(process.cwd(), '../dinext_kanban/public/js/board_navigation.js'),
  'utf8',
)
const formSource = readFileSync(
  resolve(process.cwd(), '../dinext_kanban/public/js/project_board_button.js'),
  'utf8',
)
const treeSource = readFileSync(
  resolve(process.cwd(), '../dinext_kanban/public/js/task_tree_board_button.js'),
  'utf8',
)

function jq(nodes) {
  const list = (Array.isArray(nodes) ? nodes : nodes ? [nodes] : []).filter(Boolean)
  const api = {
    length: list.length,
    0: list[0],
    get textContent() {
      return list[0]?.textContent || ''
    },
    data(key, value) {
      const node = list[0]
      if (!node) {
        return value === undefined ? undefined : api
      }
      node._data = node._data || {}
      if (value !== undefined) {
        node._data[key] = value
        return api
      }
      return node._data[key]
    },
    prepend(html) {
      if (list[0]) {
        list[0].prepended = `${list[0].prepended || ''}${html}`
      }
      return api
    },
    parent() {
      return jq(list[0]?.parent)
    },
    insertAfter(other) {
      if (list[0]) {
        list[0].insertedAfter = other
      }
      return api
    },
    prop(name, value) {
      if (!list[0]) {
        return value === undefined ? undefined : api
      }
      if (value !== undefined) {
        list[0][name] = value
        return api
      }
      return list[0][name]
    },
    find(selector) {
      const kids = list[0]?.buttons || []
      if (selector?.startsWith('button[data-label=')) {
        const encoded = selector.slice('button[data-label="'.length, -2)
        const label = decodeURIComponent(encoded)
        return jq(kids.filter((button) => button.datasetLabel === label))
      }
      if (selector === 'button') {
        return jq(kids)
      }
      return jq([])
    },
    filter(callback) {
      return jq(list.filter((node) => callback.call(node)))
    },
    first() {
      return jq(list[0])
    },
    on: vi.fn(),
  }
  return api
}

function createContext() {
  const handlers = {}
  const routeCalls = []
  const pageChangeHandlers = []
  const innerButtons = []

  const frappe = {
    provide(namespace) {
      let pointer = globalThis
      for (const part of namespace.split('.')) {
        pointer[part] = pointer[part] || {}
        pointer = pointer[part]
      }
    },
    route_options: null,
    set_route(...args) {
      routeCalls.push(args)
    },
    get_route: vi.fn(() => []),
    get_route_str: vi.fn(() => ''),
    user: { name: 'tester@example.com' },
    session: { user: 'tester@example.com' },
    ui: {
      form: {
        on(doctype, next) {
          handlers[doctype] = next
        },
      },
    },
    treeview_settings: {},
    views: {
      trees: {},
      TreeFactory: function TreeFactory() {},
    },
    container: { pages: {}, page: null },
  }
  frappe.views.TreeFactory.prototype = { on_show: vi.fn() }

  const $ = (target) => {
    if (target === document || target?.nodeType === 9) {
      return {
        on(event, handler) {
          if (String(event).startsWith('page-change')) {
            pageChangeHandlers.push(handler)
          }
        },
      }
    }
    if (target && typeof target === 'object' && 'length' in target && target.find) {
      return target
    }
    return jq([])
  }

  const context = {
    frappe,
    $,
    __(message) {
      return message
    },
    handlers,
    routeCalls,
    pageChangeHandlers,
    innerButtons,
  }

  const run = (source) => {
    new Function('frappe', '$', '__', 'document', source)(
      frappe,
      $,
      context.__,
      document,
    )
  }

  run(navSource)
  return { ...context, run }
}

function createButton(text, extra = {}) {
  return {
    textContent: text,
    prepended: '',
    insertedAfter: null,
    parent: null,
    disabled: false,
    datasetLabel: extra.datasetLabel || text,
    ...extra,
  }
}

beforeEach(() => {
  delete globalThis.dinext_kanban
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})

function expectedBoardUrl(project) {
  return (
    '/app/task/view/kanban/' +
    encodeURIComponent('Все задачи') +
    '?project=' +
    encodeURIComponent(project)
  )
}

describe('board navigation helper', () => {
  test('opens the shared Task kanban with a project filter via set_route fallback', () => {
    const { frappe, routeCalls } = createContext()

    dinext_kanban.board_navigation.open_project_board('PROJ-1')

    expect(frappe.route_options).toEqual({ project: 'PROJ-1' })
    expect(routeCalls).toEqual([['List', 'Task', 'Kanban', 'Все задачи']])
  })

  test('puts project on the board URL before router.route so the filter survives show()', () => {
    const { frappe, routeCalls } = createContext()
    frappe.router = { route: vi.fn() }

    dinext_kanban.board_navigation.open_project_board('PROJ-1')

    expect(frappe.route_options).toEqual({ project: 'PROJ-1' })
    expect(`${window.location.pathname}${window.location.search}`).toBe(expectedBoardUrl('PROJ-1'))
    expect(frappe.router.route).toHaveBeenCalledTimes(1)
    expect(routeCalls).toEqual([])
  })

  test('encodes project names with spaces on the query string', () => {
    const { frappe } = createContext()
    frappe.router = { route: vi.fn() }

    dinext_kanban.board_navigation.open_project_board('TEST-V15.106.0 (HEAD)')

    expect(window.location.search).toBe('?project=TEST-V15.106.0%20(HEAD)')
  })

  test('re-routes with replaceState when already on the Task kanban path', () => {
    const { frappe } = createContext()
    frappe.router = { route: vi.fn() }
    const boardPath = '/app/task/view/kanban/' + encodeURIComponent('Все задачи')
    window.history.replaceState({}, '', boardPath)
    const replaceSpy = vi.spyOn(window.history, 'replaceState')

    dinext_kanban.board_navigation.open_project_board('PROJ-1')

    expect(replaceSpy).toHaveBeenCalled()
    expect(replaceSpy.mock.calls.some((call) => String(call[2]).includes('project=PROJ-1'))).toBe(
      true,
    )
    expect(frappe.router.route).toHaveBeenCalledTimes(1)
    replaceSpy.mockRestore()
  })

  test('does not route without a project', () => {
    const { routeCalls } = createContext()

    dinext_kanban.board_navigation.open_project_board('')

    expect(routeCalls).toEqual([])
  })

  test('resolves the tree project from the page filter first', () => {
    createContext()

    const project = dinext_kanban.board_navigation.resolve_tree_project({
      page: {
        fields_dict: {
          project: {
            get_value: () => 'FROM-FIELD',
            df: { default: 'FROM-DEFAULT' },
          },
        },
      },
      args: { project: 'FROM-ARGS' },
    })

    expect(project).toBe('FROM-FIELD')
  })

  test('falls back to stored tree project', () => {
    const { frappe } = createContext()
    localStorage.setItem(`${frappe.user.name}:tree:project`, 'STORED-PROJ')

    expect(dinext_kanban.board_navigation.resolve_tree_project({ page: {}, args: {} })).toBe(
      'STORED-PROJ',
    )
  })
})

describe('Project form Board button', () => {
  test('skips new documents', () => {
    const { handlers, run } = createContext()
    run(formSource)
    const add_custom_button = vi.fn()

    handlers.Project.refresh({
      is_new: () => true,
      doc: { name: 'PROJ-1' },
      add_custom_button,
    })

    expect(add_custom_button).not.toHaveBeenCalled()
  })

  test('adds Board after Task tree and routes on click', () => {
    const { handlers, run, routeCalls, frappe } = createContext()
    run(formSource)

    const taskTree = createButton('𝌠 Task tree')
    const board = createButton('Board')
    const toolbar = jq({ buttons: [taskTree] })
    const add_custom_button = vi.fn((_label, action) => {
      board.click = action
      return jq(board)
    })

    handlers.Project.refresh({
      is_new: () => false,
      doc: { name: 'PROJ-1' },
      add_custom_button,
      page: { inner_toolbar: toolbar },
    })

    expect(add_custom_button).toHaveBeenCalledWith('Board', expect.any(Function))
    expect(board.prepended).toContain('#icon-kanban')
    expect(board.insertedAfter[0]).toBe(taskTree)

    board.click()
    expect(frappe.route_options).toEqual({ project: 'PROJ-1' })
    expect(routeCalls).toEqual([['List', 'Task', 'Kanban', 'Все задачи']])
  })

  test('still shows Board when Task tree is missing', () => {
    const { handlers, run } = createContext()
    run(formSource)
    const board = createButton('Board')
    const add_custom_button = vi.fn(() => jq(board))

    handlers.Project.refresh({
      is_new: () => false,
      doc: { name: 'PROJ-1' },
      add_custom_button,
      page: { inner_toolbar: jq({ buttons: [] }) },
    })

    expect(add_custom_button).toHaveBeenCalled()
    expect(board.insertedAfter).toBeNull()
  })
})

describe('Task tree Board button', () => {
  function installTree(context) {
    context.run(treeSource)
    return context.frappe.treeview_settings.Task
  }

  function makeTreeview({ project = null, existingButtons = [] } = {}) {
    const buttons = [...existingButtons]
    const boardHolder = {}
    const page = {
      buttons,
      inner_toolbar: jq({ buttons }),
      fields_dict: {
        project: {
          get_value: () => project,
          df: { default: null },
          $input: { on: vi.fn() },
        },
      },
      add_inner_button(label, action) {
        const button = createButton(label, { datasetLabel: label, click: action })
        buttons.push(button)
        boardHolder.button = button
        return jq(button)
      },
    }
    return {
      page,
      args: { project },
      boardHolder,
    }
  }

  test('wraps onload and post_render without setTimeout', () => {
    const context = createContext()
    const previousOnload = vi.fn()
    context.frappe.treeview_settings.Task = { onload: previousOnload }
    const settings = installTree(context)
    const treeview = makeTreeview({ project: 'PROJ-1' })

    settings.onload(treeview)
    expect(previousOnload).toHaveBeenCalledWith(treeview)
    expect(treeview.page.buttons).toHaveLength(1)
    expect(treeview.page.buttons[0].textContent).toBe('Board')
    expect(treeview.page.buttons[0].disabled).toBe(false)

    settings.post_render(treeview)
    expect(treeview.page.buttons).toHaveLength(1)
  })

  test('disables Board when no project is selected and enables after change', () => {
    const context = createContext()
    const settings = installTree(context)
    const treeview = makeTreeview({ project: null })

    settings.onload(treeview)
    expect(treeview.page.buttons[0].disabled).toBe(true)

    treeview.page.fields_dict.project.get_value = () => 'PROJ-9'
    treeview.page.fields_dict.project.change()
    expect(treeview.page.buttons[0].disabled).toBe(false)
  })

  test('page-change on Tree/Task installs a single button', () => {
    const context = createContext()
    installTree(context)
    const treeview = makeTreeview({ project: 'PROJ-1' })
    context.frappe.views.trees.Task = treeview
    context.frappe.get_route.mockReturnValue(['Tree', 'Task'])

    context.pageChangeHandlers.forEach((handler) => handler())
    context.pageChangeHandlers.forEach((handler) => handler())

    expect(treeview.page.buttons).toHaveLength(1)
  })

  test('enabled tree Board opens the filtered kanban', () => {
    const context = createContext()
    const settings = installTree(context)
    const treeview = makeTreeview({ project: 'PROJ-2' })

    settings.onload(treeview)
    treeview.page.buttons[0].click()

    expect(context.frappe.route_options).toEqual({ project: 'PROJ-2' })
    expect(context.routeCalls).toEqual([['List', 'Task', 'Kanban', 'Все задачи']])
  })

  test('disabled tree Board is a no-op', () => {
    const context = createContext()
    const settings = installTree(context)
    const treeview = makeTreeview({ project: null })

    settings.onload(treeview)
    treeview.page.buttons[0].click()

    expect(context.routeCalls).toEqual([])
  })

  test('desk scripts do not schedule timers', () => {
    expect(navSource).not.toMatch(/setTimeout|requestAnimationFrame/)
    expect(formSource).not.toMatch(/setTimeout|requestAnimationFrame/)
    expect(treeSource).not.toMatch(/setTimeout|requestAnimationFrame/)
  })
})
