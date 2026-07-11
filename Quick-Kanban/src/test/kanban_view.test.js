import { beforeEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const bridgeSource = readFileSync(
  resolve(process.cwd(), '../quick_kanban/public/js/kanban_view.bundle.js'),
  'utf8',
)

class NativeKanbanView {
  constructor() {
    this.page_length = 0
    this.board_name = 'Task Board'
    this.board = {
      name: 'Task Board',
      reference_doctype: 'Task',
      field_name: 'status',
      fields: ['expected_end_date', 'project'],
      custom_highlighted_field: 'priority',
      columns: [],
    }
    this.card_meta = { title_field: { fieldname: 'subject' } }
    this.fields = []
    this.data = []
    this.currentHtml = ''
    this.$result = {
      html: vi.fn((html) => {
        this.currentHtml = html
      }),
      find: vi.fn((selector) => ({
        length: selector === '#kanbanapp' && this.currentHtml.includes('kanbanapp') ? 1 : 0,
      })),
    }
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
}

beforeEach(() => {
  window.mountQuickKanban = vi.fn()
  window.unmountQuickKanban = vi.fn()
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
