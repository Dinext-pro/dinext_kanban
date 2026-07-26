import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createKanbanStore, buildPermissiveMoveOptions } from './store'

const boardDocument = {
  name: 'Task Board',
  reference_doctype: 'Task',
  field_name: 'status',
  fields: '["name", "subject"]',
  columns: [
    { name: 'open', column_name: 'Open', indicator: 'gray' },
    { name: 'done', column_name: 'Done', indicator: 'green' },
  ],
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function seedMoveOptions(store, names = []) {
  const cardNames = names.length
    ? names
    : collectCardNames(store)
  store.commit('SET_MOVE_OPTIONS_BATCH', {
    options: Object.fromEntries(
      cardNames.map((name) => [name, buildPermissiveMoveOptions(store.state)]),
    ),
    generation: store.state.moveOptionsGeneration,
  })
}

function collectCardNames(store) {
  const names = []
  for (const column of store.state.columns) {
    for (const card of column.cards || []) {
      if (card?.name) {
        names.push(card.name)
      }
    }
  }
  return names
}

function createStore() {
  frappe.get_meta.mockReturnValue({ title_field: 'subject' })
  return createKanbanStore()
}

beforeEach(() => {
  frappe.call.mockReset()
  frappe.get_meta.mockReset()
  frappe.show_alert.mockReset()
  frappe.update_user_info.mockClear()
  frappe.avatar.mockClear()
  frappe.avatar_group.mockClear()
  frappe.utils.get_link_title.mockReset()
  frappe.utils.fetch_link_title.mockReset()
  frappe.utils.get_link_title.mockReturnValue(null)
  frappe.utils.fetch_link_title.mockImplementation(async (_doctype, name) => name)
  frappe.boot.user_info = {}
  frappe.call.mockImplementation(async ({ method }) => {
    if (method === 'quick_kanban.api.get_move_options') {
      return { message: {} }
    }
    if (method === 'quick_kanban.api.get_create_options') {
      return {
        message: {
          Open: {
            allowed: true,
            form_mode: 'quick_entry',
            missing_mandatory: [],
            missing_fieldnames: [],
          },
        },
      }
    }
    if (method === 'quick_kanban.api.get_column_page') {
      return { message: { keys: ['name', 'subject', 'status'], values: [], user_info: {} } }
    }
    if (method === 'quick_kanban.api.get_hidden_board_child_names') {
      return { message: [] }
    }
    return { message: {} }
  })
})

describe('board loading', () => {
  test('hydrates the initial page already loaded by Frappe', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })

    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [
        {
          name: 'TASK-1',
          subject: 'First task',
          status: 'Open',
          _assign: '["one@example.com"]',
        },
      ],
      args: { page_length: 100 },
    })

    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'quick_kanban.api.get_move_options',
    }))
    expect(store.state.config.board_name).toBe('Task Board')
    expect(store.state.columns[0].cards[0]._assign).toEqual({
      'one@example.com': 'one@example.com',
    })
    expect(store.state.columnPagination.Open.offset).toBe(1)
  })

  test('tracks independent server offsets for hydrated columns', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })

    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [
        { name: 'TASK-1', subject: 'First', status: 'Open' },
        { name: 'TASK-2', subject: 'Second', status: 'Open' },
        { name: 'TASK-3', subject: 'Third', status: 'Done' },
      ],
      args: { page_length: 3 },
    })

    expect(store.state.columnPagination.Open).toEqual({
      offset: 2,
      loading: false,
      hasMore: true,
    })
    expect(store.state.columnPagination.Done).toEqual({
      offset: 1,
      loading: false,
      hasMore: true,
    })
  })

  test('loads and completes one column without changing another', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [
        { name: 'TASK-1', subject: 'First', status: 'Open' },
        { name: 'TASK-2', subject: 'Second', status: 'Done' },
      ],
      args: { page_length: 2 },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 31, Done: 1 })
    frappe.call.mockResolvedValue({
      message: {
        keys: ['name', 'subject', 'status'],
        values: [
          ['TASK-1', 'First updated', 'Open'],
          ['TASK-3', 'Third', 'Open'],
        ],
        user_info: {},
      },
    })

    await store.dispatch('loadColumnPage', {
      columnIndex: 0,
      args: { doctype: 'Task', filters: [['priority', '=', 'High']] },
    })

    expect(frappe.call).toHaveBeenCalledWith({
      method: 'quick_kanban.api.get_column_page',
      args: expect.objectContaining({
        doctype: 'Task',
        status_field: 'status',
        column: 'Open',
        filters: [['priority', '=', 'High']],
        start: 1,
        page_length: 30,
        hide_board_children: false,
      }),
    })
    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'TASK-1',
      'TASK-3',
    ])
    expect(store.state.columns[1].cards.map(({ name }) => name)).toEqual([
      'TASK-2',
    ])
    expect(store.state.columnPagination.Open).toEqual({
      offset: 3,
      loading: false,
      hasMore: false,
    })
    expect(store.state.columnTotals).toEqual({ Open: 31, Done: 1 })
    expect(frappe.update_user_info).toHaveBeenCalledWith({})
  })

  test('loadColumnPage appends cards without bumping dragSyncGeneration', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [
        { name: 'TASK-1', subject: 'First', status: 'Open' },
      ],
      args: { page_length: 1 },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 3, Done: 0 })
    const before = store.state.dragSyncGeneration
    frappe.call.mockResolvedValue({
      message: {
        keys: ['name', 'subject', 'status'],
        values: [
          ['TASK-2', 'Second', 'Open'],
          ['TASK-3', 'Third', 'Open'],
        ],
        user_info: {},
      },
    })

    await store.dispatch('loadColumnPage', {
      columnIndex: 0,
      args: { doctype: 'Task' },
    })

    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'TASK-1',
      'TASK-2',
      'TASK-3',
    ])
    expect(store.state.dragSyncGeneration).toBe(before)
  })

  test('loads permission-aware totals for every filtered column', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [],
      args: { page_length: 100 },
    })
    frappe.call
      .mockResolvedValueOnce({ message: { Open: 51, Done: 12 } })

    frappe.call.mockClear()
    await store.dispatch('fetchColumnTotals', {
      args: {
        doctype: 'Task',
        filters: [['priority', '=', 'High']],
        or_filters: [['owner', '=', 'user@example.com']],
      },
    })

    expect(frappe.call).toHaveBeenCalledWith({
      method: 'quick_kanban.api.get_column_totals',
      args: {
        doctype: 'Task',
        fieldname: 'status',
        columns: ['Open', 'Done'],
        filters: [['priority', '=', 'High']],
        or_filters: [['owner', '=', 'user@example.com']],
        hide_board_children: false,
      },
    })
    expect(frappe.call).toHaveBeenCalledTimes(1)
    expect(store.state.columnTotals).toEqual({ Open: 51, Done: 12 })
  })

  test('fetchColumnTotals asks server to hide on-board children when preference is off', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({
      title_field: 'subject',
      is_tree: 1,
      nsm_parent_field: 'parent_task',
      fields: [{ fieldname: 'parent_task', fieldtype: 'Link' }],
    })
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [],
      args: { page_length: 100 },
    })
    store.commit('SET_SHOW_CHILD_TASKS', false)
    frappe.call.mockClear()
    frappe.call.mockResolvedValueOnce({ message: { Open: 2, Done: 0 } })

    await store.dispatch('fetchColumnTotals', {
      args: { doctype: 'Task', filters: [] },
    })

    expect(frappe.call).toHaveBeenCalledWith({
      method: 'quick_kanban.api.get_column_totals',
      args: expect.objectContaining({
        hide_board_children: true,
      }),
    })
  })

  test('enables pagination when totals reveal more cards in a hydrated column', async () => {
    const store = createStore()
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [{ name: 'TASK-1', subject: 'First', status: 'Open' }],
      args: { page_length: 100 },
    })

    store.commit('SET_COLUMN_TOTALS', { Open: 51, Done: 0 })

    expect(store.state.columnPagination.Open.hasMore).toBe(true)
    expect(store.state.columnPagination.Done.hasMore).toBe(false)
  })

  test('tops up every underfilled column to its filtered minimum', async () => {
    const store = createStore()
    const openCards = Array.from({ length: 20 }, (_, index) => ({
      name: `OPEN-${index + 1}`,
      subject: `Open ${index + 1}`,
      status: 'Open',
    }))
    const doneCards = Array.from({ length: 5 }, (_, index) => ({
      name: `DONE-${index + 1}`,
      subject: `Done ${index + 1}`,
      status: 'Done',
    }))
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [...openCards, ...doneCards],
      args: { page_length: 100 },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 40, Done: 18 })
    frappe.call.mockClear()
    frappe.call.mockResolvedValue({
      message: {
        keys: ['name', 'subject', 'status'],
        values: Array.from({ length: 10 }, (_, index) => [
          `DONE-${index + 6}`,
          `Done ${index + 6}`,
          'Done',
        ]),
        user_info: {},
      },
    })

    await store.dispatch('topUpInitialColumns', {
      args: {
        doctype: 'Task',
        filters: [['priority', '=', 'High']],
        or_filters: [['owner', '=', 'user@example.com']],
      },
    })

    expect(store.state.columns[0].cards).toHaveLength(20)
    expect(store.state.columns[1].cards).toHaveLength(15)
    expect(frappe.call).toHaveBeenCalledTimes(1)
    expect(frappe.call).toHaveBeenCalledWith({
      method: 'quick_kanban.api.get_column_page',
      args: expect.objectContaining({
        doctype: 'Task',
        column: 'Done',
        filters: [['priority', '=', 'High']],
        or_filters: [['owner', '=', 'user@example.com']],
        start: 5,
        page_length: 10,
      }),
    })
  })

  test('loads all available cards when a column total is below the minimum', async () => {
    const store = createStore()
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [],
      args: { page_length: 100 },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 3, Done: 0 })
    frappe.call.mockResolvedValue({
      message: {
        keys: ['name', 'subject', 'status'],
        values: Array.from({ length: 3 }, (_, index) => [
          `OPEN-${index + 1}`,
          `Open ${index + 1}`,
          'Open',
        ]),
        user_info: {},
      },
    })

    frappe.call.mockClear()
    await store.dispatch('topUpInitialColumns', { args: { doctype: 'Task' } })

    expect(store.state.columns[0].cards).toHaveLength(3)
    expect(store.state.columns[1].cards).toHaveLength(0)
    expect(frappe.call).toHaveBeenCalledTimes(1)
    expect(frappe.call.mock.calls[0][0].args.page_length).toBe(3)
  })

  test('continues topping up other columns when one request fails', async () => {
    const store = createStore()
    const initialCards = ['Open', 'Done'].flatMap((status) =>
      Array.from({ length: 5 }, (_, index) => ({
        name: `${status.toUpperCase()}-${index + 1}`,
        subject: `${status} ${index + 1}`,
        status,
      })),
    )
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: initialCards,
      args: { page_length: 100 },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 20, Done: 20 })
    frappe.call
      .mockRejectedValueOnce(new Error('Open unavailable'))
      .mockResolvedValueOnce({
        message: {
          keys: ['name', 'subject', 'status'],
          values: Array.from({ length: 10 }, (_, index) => [
            `DONE-${index + 6}`,
            `Done ${index + 6}`,
            'Done',
          ]),
          user_info: {},
        },
      })

    const results = await store.dispatch('topUpInitialColumns', {
      args: { doctype: 'Task' },
    })

    expect(results.map(({ status }) => status)).toEqual([
      'rejected',
      'fulfilled',
    ])
    expect(store.state.columns[0].cards).toHaveLength(5)
    expect(store.state.columns[1].cards).toHaveLength(15)
    expect(store.state.columnPagination.Open.hasMore).toBe(true)
  })

  test('disables pagination immediately when the known total is loaded', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: Array.from({ length: 30 }, (_, index) => ({
        name: `TASK-${index + 1}`,
        subject: `Task ${index + 1}`,
        status: 'Open',
      })),
      args: { page_length: 30 },
    })
    frappe.call.mockResolvedValue({
      message: { Open: 30, Done: 0 },
    })

    await store.dispatch('fetchColumnTotals', { args: { doctype: 'Task' } })

    expect(store.state.columnPagination.Open.hasMore).toBe(false)
  })

  test('discards totals returned for obsolete filters', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [],
      args: { page_length: 100 },
    })
    const oldCounts = deferred()
    frappe.call
      .mockImplementationOnce(() => oldCounts.promise)
      .mockResolvedValueOnce({ message: { Open: 7, Done: 3 } })

    const oldRequest = store.dispatch('fetchColumnTotals', {
      args: { filters: [['priority', '=', 'Low']] },
    })
    const latestRequest = store.dispatch('fetchColumnTotals', {
      args: { filters: [['priority', '=', 'High']] },
    })
    await expect(latestRequest).resolves.toBe(true)
    oldCounts.resolve({ message: { Open: 99, Done: 88 } })
    await expect(oldRequest).resolves.toBe(false)

    expect(store.state.columnTotals).toEqual({ Open: 7, Done: 3 })
  })

  test('does not let pre-move count responses overwrite adjusted totals', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [{
        name: 'TASK-1',
        subject: 'First',
        status: 'Open',
        modified: '2026-07-10 10:00:00',
      }],
      args: { page_length: 100 },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 51, Done: 10 })
    seedMoveOptions(store)
    const oldCounts = deferred()
    let totalsCalls = 0
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_column_totals') {
        totalsCalls += 1
        if (totalsCalls === 1) {
          return oldCounts.promise
        }
        return { message: { Open: 50, Done: 11 } }
      }
      if (method === 'quick_kanban.api.move_card') {
        return { message: { modified: '2026-07-10 10:01:00' } }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      return { message: {} }
    })

    const counting = store.dispatch('fetchColumnTotals', { args: {} })
    await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })
    await vi.waitFor(() => expect(totalsCalls).toBeGreaterThanOrEqual(2))
    oldCounts.resolve({ message: { Open: 99, Done: 88 } })
    await counting

    expect(store.state.columnTotals).toEqual({ Open: 50, Done: 11 })
  })

  test('stops on an exact final page when the server total is reached', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    const initialCards = Array.from({ length: 30 }, (_, index) => ({
      name: `TASK-${index + 1}`,
      subject: `Task ${index + 1}`,
      status: 'Open',
    }))
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: initialCards,
      args: { page_length: 30 },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 60, Done: 0 })
    frappe.call.mockResolvedValue({
      message: {
        keys: ['name', 'subject', 'status'],
        values: Array.from({ length: 30 }, (_, index) => [
          `TASK-${index + 31}`,
          `Task ${index + 31}`,
          'Open',
        ]),
        user_info: {},
      },
    })

    await store.dispatch('loadColumnPage', { columnIndex: 0, args: {} })

    expect(store.state.columnPagination.Open).toEqual({
      offset: 60,
      loading: false,
      hasMore: false,
    })
  })

  test('loads all pages from a mixed initial result until the total is reached', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    const openCards = Array.from({ length: 51 }, (_, index) => ({
      name: `OPEN-${index + 1}`,
      subject: `Open ${index + 1}`,
      status: 'Open',
    }))
    const doneCards = Array.from({ length: 49 }, (_, index) => ({
      name: `DONE-${index + 1}`,
      subject: `Done ${index + 1}`,
      status: 'Done',
    }))
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [...openCards, ...doneCards],
      args: { page_length: 100 },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 150, Done: 49 })
    frappe.call.mockClear()
    const makePage = (start, length) => ({
      message: {
        keys: ['name', 'subject', 'status'],
        values: Array.from({ length }, (_, index) => [
          `OPEN-${start + index + 1}`,
          `Open ${start + index + 1}`,
          'Open',
        ]),
        user_info: {},
      },
    })
    frappe.call
      .mockResolvedValueOnce(makePage(51, 30))
      .mockResolvedValueOnce(makePage(81, 30))
      .mockResolvedValueOnce(makePage(111, 30))
      .mockResolvedValueOnce(makePage(141, 9))

    for (const expectedOffset of [81, 111, 141, 150]) {
      await store.dispatch('loadColumnPage', { columnIndex: 0, args: {} })
      expect(store.state.columnPagination.Open.offset).toBe(expectedOffset)
    }
    await store.dispatch('loadColumnPage', { columnIndex: 0, args: {} })

    expect(store.state.columns[0].cards).toHaveLength(150)
    expect(new Set(store.state.columns[0].cards.map(({ name }) => name)).size).toBe(150)
    expect(store.state.columnPagination.Open.hasMore).toBe(false)
    expect(frappe.call).toHaveBeenCalledTimes(4)
    expect(frappe.call.mock.calls.map(([request]) => request.args.start)).toEqual([
      51,
      81,
      111,
      141,
    ])
  })

  test('coalesces concurrent requests for the same column', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: Array.from({ length: 2 }, (_, index) => ({
        name: `TASK-${index + 1}`,
        subject: `Task ${index + 1}`,
        status: 'Open',
      })),
      args: { page_length: 2 },
    })
    frappe.call.mockClear()
    const page = deferred()
    let columnPageCalls = 0
    frappe.call.mockImplementation(({ method }) => {
      if (method === 'quick_kanban.api.get_column_page') {
        columnPageCalls += 1
        return page.promise
      }
      return Promise.resolve({ message: {} })
    })

    const first = store.dispatch('loadColumnPage', { columnIndex: 0, args: {} })
    const second = store.dispatch('loadColumnPage', { columnIndex: 0, args: {} })
    await vi.waitFor(() => expect(columnPageCalls).toBe(1))

    page.resolve({
      message: { keys: [], values: [], user_info: {} },
    })
    await Promise.all([first, second])
    expect(columnPageCalls).toBe(1)
  })

  test('discards a column page requested before a filter refresh', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [
        { name: 'TASK-1', subject: 'First', status: 'Open' },
        { name: 'TASK-2', subject: 'Second', status: 'Open' },
      ],
      args: { page_length: 2 },
    })
    const stalePage = deferred()
    frappe.call.mockImplementation(({ method, args }) => {
      if (method === 'quick_kanban.api.get_column_page') {
        const priority = args.filters?.[0]?.at(-1)
        if (priority === 'Low') {
          return stalePage.promise
        }
        if (args.column === 'Open' && priority === 'High') {
          return Promise.resolve({
            message: {
              keys: ['name', 'subject', 'status'],
              values: [['TASK-NEW', 'New filter', 'Open']],
              user_info: {},
            },
          })
        }
        return Promise.resolve({
          message: { keys: ['name', 'subject', 'status'], values: [], user_info: {} },
        })
      }
      return Promise.resolve({ message: {} })
    })

    const loadingPage = store.dispatch('loadColumnPage', {
      columnIndex: 0,
      args: { filters: [['priority', '=', 'Low']] },
    })
    await store.dispatch('fetchKanban', {
      args: { filters: [['priority', '=', 'High']], page_length: 100 },
    })
    stalePage.resolve({
      message: {
        keys: ['name', 'subject', 'status'],
        values: [['TASK-STALE', 'Old filter', 'Open']],
        user_info: {},
      },
    })
    await loadingPage

    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'TASK-NEW',
    ])
  })

  test('loads board configuration only when the board changes', async () => {
    frappe.call.mockResolvedValue({ message: boardDocument })
    const store = createStore()

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    await store.dispatch('ensureBoard', { board_name: 'Task Board' })

    expect(frappe.call).toHaveBeenCalledTimes(2)
    expect(store.state.config.board_name).toBe('Task Board')
  })

  test('refreshes totals then tops up every underfilled column', async () => {
    frappe.call.mockImplementation(({ method, args }) => {
      if (method === 'frappe.client.get') {
        return Promise.resolve({ message: boardDocument })
      }
      if (method === 'quick_kanban.api.get_column_totals') {
        return Promise.resolve({ message: { Open: 20, Done: 3 } })
      }
      if (method === 'quick_kanban.api.get_column_page') {
        const column = args.column
        const pageLength = Number(args.page_length) || 0
        const start = Number(args.start) || 0
        let count = 0
        if (column === 'Open') {
          count = start > 0 ? 14 : 1
        } else if (column === 'Done') {
          count = Math.min(pageLength, 3)
        }
        const prefix = column === 'Done' ? 'DONE' : 'OPEN'
        return Promise.resolve({
          message: {
            keys: ['name', 'subject', 'status'],
            values: Array.from({ length: count }, (_, index) => [
              `${prefix}-${start + index + 1}`,
              `${column || 'Open'} ${start + index + 1}`,
              column || 'Open',
            ]),
            user_info: {},
          },
        })
      }
      if (method === 'quick_kanban.api.get_create_options') {
        return Promise.resolve({
          message: { Open: { allowed: true, form_mode: 'quick_entry' } },
        })
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return Promise.resolve({ message: {} })
      }
      return Promise.resolve({ message: {} })
    })
    const store = createStore()

    await store.dispatch('refreshBoard', {
      board_name: 'Task Board',
      args: {
        doctype: 'Task',
        filters: [['priority', '=', 'High']],
        page_length: 100,
      },
    })

    expect(store.state.columns[0].cards).toHaveLength(15)
    expect(store.state.columns[1].cards).toHaveLength(3)
    const topUpCalls = frappe.call.mock.calls
      .map(([request]) => request)
      .filter(({ method, args }) => (
        method === 'quick_kanban.api.get_column_page' && Number(args.start) > 0
      ))
    expect(topUpCalls.map(({ args }) => args.page_length)).toEqual([14])
  })

  test('does not top up with filters from an obsolete totals request', async () => {
    const staleTotals = deferred()
    let staleTotalsRequested = false
    let rejectLatestTopUp = true
    frappe.call.mockImplementation(({ method, args }) => {
      if (method === 'quick_kanban.api.get_column_totals') {
        const priority = args.filters?.[0]?.at(-1)
        if (priority === 'Low') {
          staleTotalsRequested = true
          return staleTotals.promise
        }
        return Promise.resolve({ message: { Open: 20, Done: 0 } })
      }
      if (method === 'quick_kanban.api.get_column_page') {
        const priority = args.filters?.[0]?.at(-1)
        const isTopUp = Number(args.start) > 0 || Number(args.page_length) < 100
        if (
          args.column === 'Open'
          && priority === 'High'
          && isTopUp
          && rejectLatestTopUp
        ) {
          rejectLatestTopUp = false
          return Promise.reject(new Error('Latest top-up unavailable'))
        }
        const count = isTopUp && args.column === 'Open' ? 14 : 1
        return Promise.resolve({
          message: {
            keys: ['name', 'subject', 'status'],
            values: Array.from({ length: count }, (_, index) => [
              `${priority}-${(Number(args.start) || 0) + index + 1}`,
              `${priority} ${(Number(args.start) || 0) + index + 1}`,
              args.column || 'Open',
            ]),
            user_info: {},
          },
        })
      }
      if (method === 'quick_kanban.api.get_create_options') {
        return Promise.resolve({
          message: { Open: { allowed: true, form_mode: 'quick_entry' } },
        })
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return Promise.resolve({ message: {} })
      }
      return Promise.resolve({ message: {} })
    })
    const store = createStore()
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [],
      args: { page_length: 100 },
    })

    const staleRefresh = store.dispatch('refreshBoard', {
      board_name: 'Task Board',
      args: {
        doctype: 'Task',
        filters: [['priority', '=', 'Low']],
        page_length: 100,
      },
    })
    await vi.waitFor(() => expect(staleTotalsRequested).toBe(true))
    await store.dispatch('refreshBoard', {
      board_name: 'Task Board',
      args: {
        doctype: 'Task',
        filters: [['priority', '=', 'High']],
        page_length: 100,
      },
    })
    staleTotals.resolve({ message: { Open: 99, Done: 0 } })
    await staleRefresh

    const staleColumnCalls = frappe.call.mock.calls.filter(([request]) =>
      request.method === 'quick_kanban.api.get_column_page' &&
      request.args.filters?.some((filter) => filter.at(-1) === 'Low') &&
      Number(request.args.start) > 0,
    )
    expect(staleColumnCalls).toHaveLength(0)
    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'High-1',
    ])
  })

  test('groups cards and initializes per-column pagination', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => [
      `TASK-${index + 1}`,
      `Task ${index + 1}`,
      'Open',
    ])
    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'frappe.client.get') {
        return { message: boardDocument }
      }
      if (method === 'quick_kanban.api.get_create_options') {
        return { message: { Open: { allowed: true, form_mode: 'quick_entry' } } }
      }
      if (method === 'quick_kanban.api.get_column_page') {
        if (args.column === 'Open') {
          return {
            message: {
              keys: ['name', 'subject', 'status'],
              values: rows.slice(0, args.page_length || 100),
              user_info: {},
            },
          }
        }
        return { message: { keys: ['name', 'subject', 'status'], values: [], user_info: {} } }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      return { message: {} }
    })
    const store = createStore()

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    await store.dispatch('fetchKanban', {
      args: { page_length: 20, start: 0 },
    })

    expect(store.state.columns[0].cards[0].name).toBe('TASK-1')
    expect(store.state.columnPagination.Open).toEqual({
      offset: 100,
      loading: false,
      hasMore: true,
    })
    expect(frappe.call.mock.calls.some(
      ([request]) => request.method === 'quick_kanban.api.get_column_page',
    )).toBe(true)
    expect(store.state.loading).toBe(false)
  })

  test('registers user info from reportview before grouping cards', async () => {
    frappe.call
      .mockResolvedValueOnce({ message: boardDocument })
      .mockResolvedValueOnce({ message: { Open: { allowed: true, form_mode: 'quick_entry' } } })
      .mockResolvedValueOnce({
        message: {
          keys: ['name', 'subject', 'status', '_assign'],
          values: [['TASK-1', 'Task 1', 'Open', '["one@example.com"]']],
          user_info: {
            'one@example.com': {
              fullname: 'One User',
              image: '/files/one.png',
            },
          },
        },
      })
    const store = createStore()

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    await store.dispatch('fetchKanban', { args: { page_length: 100 } })

    expect(frappe.update_user_info).toHaveBeenCalledWith({
      'one@example.com': {
        fullname: 'One User',
        image: '/files/one.png',
      },
    })
  })

  test('hydrates missing Link titles after fetchKanban and bumps version', async () => {
    const boardWithProject = {
      ...boardDocument,
      fields: '["name", "subject", "project"]',
    }
    frappe.get_meta.mockReturnValue({
      title_field: 'subject',
      fields: [
        { fieldname: 'subject', fieldtype: 'Data', label: 'Subject', parent: 'Task' },
        { fieldname: 'status', fieldtype: 'Select', label: 'Status', parent: 'Task' },
        {
          fieldname: 'project',
          fieldtype: 'Link',
          label: 'Project',
          options: 'Project',
          parent: 'Task',
        },
      ],
    })
    frappe.utils.fetch_link_title.mockImplementation(async () => 'Проект БалтХим')
    frappe.call
      .mockResolvedValueOnce({ message: boardWithProject })
      .mockResolvedValueOnce({ message: { Open: { allowed: true, form_mode: 'quick_entry' } } })
      .mockResolvedValueOnce({
        message: {
          keys: ['name', 'subject', 'status', 'project'],
          values: [
            ['TASK-1', 'Task 1', 'Open', 'PROJ-1'],
            ['TASK-2', 'Task 2', 'Open', 'PROJ-1'],
          ],
          user_info: {},
        },
      })
    const store = createStore()
    frappe.get_meta.mockReturnValue({
      title_field: 'subject',
      fields: [
        { fieldname: 'subject', fieldtype: 'Data', label: 'Subject', parent: 'Task' },
        { fieldname: 'status', fieldtype: 'Select', label: 'Status', parent: 'Task' },
        {
          fieldname: 'project',
          fieldtype: 'Link',
          label: 'Project',
          options: 'Project',
          parent: 'Task',
        },
      ],
    })

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    expect(store.state.linkTitlesVersion).toBe(0)

    await store.dispatch('fetchKanban', { args: { page_length: 100 } })
    await vi.waitFor(() => expect(store.state.linkTitlesVersion).toBe(1))

    expect(frappe.utils.fetch_link_title).toHaveBeenCalledWith('Project', 'PROJ-1')
    expect(frappe.utils.fetch_link_title).toHaveBeenCalledTimes(1)
  })

  test('skips link title bump when titles are already cached', async () => {
    const boardWithProject = {
      ...boardDocument,
      fields: '["name", "subject", "project"]',
    }
    frappe.get_meta.mockReturnValue({
      title_field: 'subject',
      fields: [
        { fieldname: 'subject', fieldtype: 'Data', label: 'Subject', parent: 'Task' },
        { fieldname: 'status', fieldtype: 'Select', label: 'Status', parent: 'Task' },
        {
          fieldname: 'project',
          fieldtype: 'Link',
          label: 'Project',
          options: 'Project',
          parent: 'Task',
        },
      ],
    })
    frappe.utils.get_link_title.mockReturnValue('Cached Project')
    frappe.call
      .mockResolvedValueOnce({ message: boardWithProject })
      .mockResolvedValueOnce({ message: { Open: { allowed: true, form_mode: 'quick_entry' } } })
      .mockResolvedValueOnce({
        message: {
          keys: ['name', 'subject', 'status', 'project'],
          values: [['TASK-1', 'Task 1', 'Open', 'PROJ-1']],
          user_info: {},
        },
      })
    const store = createStore()
    frappe.get_meta.mockReturnValue({
      title_field: 'subject',
      fields: [
        { fieldname: 'subject', fieldtype: 'Data', label: 'Subject', parent: 'Task' },
        { fieldname: 'status', fieldtype: 'Select', label: 'Status', parent: 'Task' },
        {
          fieldname: 'project',
          fieldtype: 'Link',
          label: 'Project',
          options: 'Project',
          parent: 'Task',
        },
      ],
    })

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    await store.dispatch('fetchKanban', { args: { page_length: 100 } })
    await Promise.resolve()

    expect(frappe.utils.fetch_link_title).not.toHaveBeenCalled()
    expect(store.state.linkTitlesVersion).toBe(0)
  })

  test('discards a slower response from obsolete filters', async () => {
    frappe.call.mockResolvedValueOnce({ message: boardDocument })
    const store = createStore()
    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    const first = deferred()
    const second = deferred()
    frappe.call.mockImplementation(({ method, args }) => {
      if (method !== 'quick_kanban.api.get_column_page') {
        return Promise.resolve({ message: {} })
      }
      const statusFilter = args.filters?.[0]?.at(-1)
      if (statusFilter === 'Open') {
        return first.promise
      }
      if (statusFilter === 'Done' && args.column === 'Open') {
        return second.promise
      }
      return Promise.resolve({
        message: { keys: ['name', 'subject', 'status'], values: [], user_info: {} },
      })
    })

    const firstRequest = store.dispatch('fetchKanban', {
      args: { filters: [['status', '=', 'Open']] },
    })
    const secondRequest = store.dispatch('fetchKanban', {
      args: { filters: [['status', '=', 'Done']] },
    })
    second.resolve({
      message: {
        keys: ['name', 'subject', 'status'],
        values: [['TASK-NEW', 'New result', 'Open']],
        user_info: {},
      },
    })
    await expect(secondRequest).resolves.toBe(true)
    first.resolve({
      message: {
        keys: ['name', 'subject', 'status'],
        values: [['TASK-STALE', 'Stale result', 'Open']],
        user_info: {},
      },
    })
    await expect(firstRequest).resolves.toBe(false)

    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'TASK-NEW',
    ])
  })

  test('does not reuse the current board while another board request is pending', async () => {
    const store = createStore()
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [],
      args: { page_length: 100 },
    })
    const boardB = deferred()
    const boardA = deferred()
    frappe.call.mockClear()
    frappe.call.mockImplementation(({ method }) => {
      if (method === 'quick_kanban.api.get_create_options') {
        return Promise.resolve({ message: { Open: { allowed: true, form_mode: 'quick_entry' } } })
      }
      if (method === 'frappe.client.get') {
        const request = frappe.call.mock.calls.at(-1)?.[0]
        if (request?.args?.name === 'Board B') {
          return boardB.promise
        }
        return boardA.promise
      }
      return Promise.resolve({ message: {} })
    })

    const openingB = store.dispatch('ensureBoard', { board_name: 'Board B' })
    const reopeningA = store.dispatch('ensureBoard', { board_name: 'Task Board' })
    boardA.resolve({ message: boardDocument })
    await reopeningA
    boardB.resolve({ message: { ...boardDocument, name: 'Board B' } })
    await openingB

    const boardGetCalls = frappe.call.mock.calls.filter(
      ([{ method }]) => method === 'frappe.client.get',
    )
    expect(boardGetCalls).toHaveLength(2)
    expect(store.state.config.board_name).toBe('Task Board')
  })

  test('surfaces API failures in state and rejects to the caller', async () => {
    const error = new Error('Network unavailable')
    frappe.call.mockRejectedValue(error)
    const store = createStore()

    await expect(
      store.dispatch('ensureBoard', { board_name: 'Task Board' }),
    ).rejects.toThrow('Network unavailable')
    expect(store.state.error).toBe('Network unavailable')
  })
})

describe('card moves', () => {
  function hydratedStore() {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject'],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        cards: [{
          name: 'TASK-1',
          subject: 'First task',
          status: 'Open',
          modified: '2026-07-10 10:00:00',
        }],
      },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    seedMoveOptions(store)
    return store
  }

  test('optimistically moves a card and persists its status', async () => {
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.move_card') {
        return { message: { status: 'Done' } }
      }
      if (method === 'quick_kanban.api.get_column_totals') {
        return { message: { Open: 50, Done: 11 } }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      return { message: {} }
    })
    const store = hydratedStore()
    store.commit('SET_COLUMN_PAGINATION', {
      Open: { offset: 30, loading: false, hasMore: true },
      Done: { offset: 10, loading: false, hasMore: true },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 51, Done: 10 })
    seedMoveOptions(store)

    await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })
    await vi.waitFor(() => expect(store.state.columnTotals).toEqual({
      Open: 50,
      Done: 11,
    }))

    expect(store.state.columns[0].cards).toEqual([])
    expect(store.state.columns[1].cards[0].status).toBe('Done')
    expect(store.state.columnPagination.Open.offset).toBe(29)
    expect(store.state.columnPagination.Done.offset).toBe(11)
    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'quick_kanban.api.move_card',
      args: expect.objectContaining({
        board_name: 'Task Board',
        value: 'Done',
        expected_modified: '2026-07-10 10:00:00',
      }),
    }))
  })

  test('resyncs virtual lists after a menu move', async () => {
    frappe.call.mockResolvedValue({ message: { modified: '2026-07-10 10:01:00' } })
    const store = hydratedStore()
    const sourceCardsBefore = store.state.columns[0].cards
    const destinationCardsBefore = store.state.columns[1].cards
    const syncGenerationBefore = store.state.dragSyncGeneration

    await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(store.state.dragSyncGeneration).toBe(syncGenerationBefore + 1)
    expect(store.state.columns[0].cards).not.toBe(sourceCardsBefore)
    expect(store.state.columns[1].cards).not.toBe(destinationCardsBefore)
    expect(store.state.columns[1].cards[0].name).toBe('TASK-1')
  })

  test('uses translated column labels in move alerts while preserving raw API values', async () => {
    const originalTranslate = globalThis.__
    globalThis.__ = (message, values = []) => {
      const labels = { Done: 'Готово' }
      const label = labels[values[0]] || values[0]
      return message.replace('{0}', label)
    }

    frappe.call.mockResolvedValue({ message: { modified: '2026-07-10 10:01:00' } })
    const store = hydratedStore()
    store.state.columns[1].display_name = 'Готово'

    await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.objectContaining({ value: 'Done' }),
    }))
    expect(frappe.show_alert).toHaveBeenCalledWith({
      message: 'Card moved to Готово',
      indicator: 'green',
    })
    expect(store.state.announcement).toBe('Card moved to Готово')

    globalThis.__ = originalTranslate
  })

  test('rolls back an optimistic move when persistence fails', async () => {
    frappe.call.mockRejectedValue(new Error('Not permitted'))
    const store = hydratedStore()

    await expect(store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })).rejects.toThrow('Not permitted')

    expect(store.state.columns[0].cards[0].name).toBe('TASK-1')
    expect(store.state.columns[1].cards).toEqual([])
    expect(frappe.show_alert).toHaveBeenCalled()
  })

  test('rolls back a drag list move already reflected in the UI', async () => {
    frappe.call.mockRejectedValue(new Error('Conflict'))
    const store = hydratedStore()
    const [card] = store.state.columns[0].cards.splice(0, 1)
    store.state.columns[1].cards.push(card)

    const result = await store.dispatch('persistMovedCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
    })

    expect(result).toMatchObject({
      ok: false,
      needsAnimatedRollback: true,
    })
    expect(store.state.columns[0].cards[0].name).toBe('TASK-1')
    expect(store.state.columns[1].cards).toEqual([])
    expect(frappe.show_alert).toHaveBeenCalledWith({
      message: 'Could not move card: Conflict',
      indicator: 'red',
    })
  })

  test('returns structured preflight failure for drag moves with toast', async () => {
    const store = hydratedStore()
    store.state.moveOptionsByCard['TASK-1'] = {
      can_drag: true,
      destinations: {
        Open: {
          allowed: true,
          mode: 'field_update',
          actions: [],
          missing_mandatory: [],
        },
        Done: {
          allowed: false,
          reason: 'workflow_denied',
          mode: 'field_update',
          actions: [],
          missing_mandatory: [],
        },
      },
    }
    const [card] = store.state.columns[0].cards.splice(0, 1)
    store.state.columns[1].cards.push(card)

    const result = await store.dispatch('persistMovedCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(result).toMatchObject({
      ok: false,
      needsAnimatedRollback: true,
      preflight: { reason: 'workflow_denied' },
    })
    expect(store.state.columns[0].cards[0].name).toBe('TASK-1')
    expect(frappe.show_alert).toHaveBeenCalledWith(expect.objectContaining({
      indicator: 'red',
    }))
    expect(frappe.call).not.toHaveBeenCalledWith(expect.objectContaining({
      method: 'quick_kanban.api.move_card',
    }))
  })

  test('shows mandatory field toast once for menu moves', async () => {
    const store = hydratedStore()
    store.state.moveOptionsByCard['TASK-1'].destinations.Done.missing_mandatory = [
      'Priority',
    ]

    const result = await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(result).toBe(false)
    expect(frappe.show_alert).toHaveBeenCalledTimes(1)
    expect(frappe.show_alert).toHaveBeenCalledWith({
      message: 'Mandatory fields required: Priority',
      indicator: 'red',
    })
  })

  test('refreshes assignments for one card without refetching the board', async () => {
    frappe.call
      .mockResolvedValueOnce({
        message: { _assign: '["one@example.com"]' },
      })
      .mockResolvedValueOnce({
        message: {
          'one@example.com': { fullname: 'One User' },
        },
      })
    const store = hydratedStore()

    await store.dispatch('refreshCard', { cardName: 'TASK-1' })

    expect(frappe.call).toHaveBeenNthCalledWith(1, {
      method: 'frappe.client.get_value',
      args: {
        doctype: 'Task',
        filters: { name: 'TASK-1' },
        fieldname: ['_assign'],
      },
    })
    expect(frappe.call).toHaveBeenNthCalledWith(2, {
      method: 'frappe.desk.form.load.get_user_info_for_viewers',
      args: { users: '["one@example.com"]' },
    })
    expect(store.state.columns[0].cards[0]._assign).toEqual({
      'one@example.com': 'One User',
    })
    expect(frappe.update_user_info).toHaveBeenCalledWith({
      'one@example.com': { fullname: 'One User' },
    })
  })

  test('updates a card field through frappe.db.set_value and clears the doc cache', async () => {
    const store = hydratedStore()
    frappe.db.set_value.mockResolvedValue({
      message: {
        name: 'TASK-1',
        subject: 'Renamed',
        modified: '2026-07-15 12:00:00',
      },
    })

    await store.dispatch('updateCardField', {
      cardName: 'TASK-1',
      fieldname: 'subject',
      value: 'Renamed',
      previousValue: 'First task',
    })

    expect(frappe.db.set_value).toHaveBeenCalledWith('Task', 'TASK-1', {
      subject: 'Renamed',
    })
    expect(store.state.columns[0].cards[0].subject).toBe('Renamed')
    expect(store.state.columns[0].cards[0].modified).toBe('2026-07-15 12:00:00')
    expect(frappe.model.clear_doc).toHaveBeenCalledWith('Task', 'TASK-1')
  })

  test('rolls back a failed field update', async () => {
    const store = hydratedStore()
    frappe.db.set_value.mockRejectedValue(new Error('no permission'))

    await expect(store.dispatch('updateCardField', {
      cardName: 'TASK-1',
      fieldname: 'subject',
      value: 'Renamed',
      previousValue: 'First task',
    })).rejects.toThrow('no permission')

    expect(store.state.columns[0].cards[0].subject).toBe('First task')
    expect(frappe.show_alert).toHaveBeenCalledWith({
      message: 'Could not update the field.',
      indicator: 'red',
    })
  })

  test('blocks dragging while a card field is being edited', () => {
    const store = hydratedStore()
    store.commit('SET_MOVE_OPTIONS_BATCH', {
      options: {},
      generation: store.state.moveOptionsGeneration,
    })
    // ensure allow destinations somehow
    store.commit('SET_ACTIVE_INLINE_EDIT', {
      cardName: 'TASK-1',
      fieldname: 'subject',
    })
    expect(store.getters.isCardInlineBusy('TASK-1')).toBe(true)
    expect(store.getters.canDragCard('TASK-1')).toBe(false)
  })

  test('does not remove another card when rollback target is already absent', () => {
    const store = hydratedStore()
    store.state.columns[1].cards.push({ name: 'TASK-2', status: 'Done' })

    store.commit('ROLLBACK_CARD_MOVE', {
      cardName: 'MISSING',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
    })

    expect(store.state.columns[1].cards.map(({ name }) => name)).toEqual(['TASK-2'])
  })

  test('blocks move when mandatory fields are missing', async () => {
    const store = hydratedStore()
    store.state.moveOptionsByCard['TASK-1'].destinations.Done.missing_mandatory = [
      'Priority',
    ]

    const result = await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(result).toBe(false)
    expect(frappe.call).not.toHaveBeenCalled()
    expect(store.state.columns[0].cards[0].name).toBe('TASK-1')
    expect(frappe.show_alert).toHaveBeenCalledWith({
      message: 'Mandatory fields required: Priority',
      indicator: 'red',
    })
  })

  test('does not roll a failed move into a board opened afterwards', async () => {
    const move = deferred()
    frappe.call.mockImplementationOnce(() => move.promise)
    const store = hydratedStore()
    const moving = store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    store.dispatch('hydrateFromList', {
      board: {
        ...boardDocument,
        name: 'Another Board',
      },
      cards: [{ name: 'OTHER-1', subject: 'Other', status: 'Open' }],
      args: { page_length: 100 },
    })
    move.reject(new Error('Conflict'))
    await expect(moving).rejects.toThrow('Conflict')

    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'OTHER-1',
    ])
  })

  test('does not start a second move while the same card is pending', async () => {
    const move = deferred()
    frappe.call.mockImplementationOnce(() => move.promise)
    const store = hydratedStore()
    const firstMove = store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    await store.dispatch('persistMovedCard', {
      cardName: 'TASK-1',
      fromColumn: 1,
      toColumn: 0,
      fromIndex: 0,
      toIndex: 0,
    })
    expect(frappe.call).toHaveBeenCalledTimes(1)

    move.resolve({ message: { modified: '2026-07-10 10:01:00' } })
    await firstMove
  })

  test('does not move a card while either affected column is loading', async () => {
    const store = hydratedStore()
    store.commit('SET_COLUMN_PAGINATION', {
      Open: { offset: 1, loading: true, hasMore: true },
      Done: { offset: 0, loading: false, hasMore: true },
    })

    const result = await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(result).toBe(false)
    expect(frappe.call).not.toHaveBeenCalled()
    expect(store.state.columns[0].cards[0].name).toBe('TASK-1')
  })
})

describe('move options loading', () => {
  test('requests move options in batches of 50 on initial hydrate', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })
    const cards = Array.from({ length: 55 }, (_, index) => ({
      name: `TASK-${index + 1}`,
      subject: `Task ${index + 1}`,
      status: 'Open',
    }))
    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'quick_kanban.api.get_move_options') {
        return {
          message: Object.fromEntries(
            args.names.map((name) => [
              name,
              buildPermissiveMoveOptions(store.state),
            ]),
          ),
        }
      }
      return { message: {} }
    })

    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards,
      args: { page_length: 100 },
    })

    const moveCalls = frappe.call.mock.calls.filter(
      ([{ method }]) => method === 'quick_kanban.api.get_move_options',
    )
    expect(moveCalls.length).toBeGreaterThanOrEqual(2)
    for (const [{ args }] of moveCalls) {
      expect(args.names.length).toBeLessThanOrEqual(50)
    }
    expect(
      moveCalls.reduce((total, [{ args }]) => total + args.names.length, 0),
    ).toBe(55)
    expect(store.state.moveOptionsLoaded).toBe(true)
  })

  test('flat mode with stale lanes still fetches move options for column cards', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      swimlane_mode: 'off',
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        cards: [{ name: 'TASK-1', subject: 'First', status: 'Open' }],
      },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'stale',
        label: 'Stale',
        columns: [
          { name: 'open', column_name: 'Open', cards: [] },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'quick_kanban.api.get_move_options') {
        return {
          message: Object.fromEntries(
            args.names.map((name) => [
              name,
              buildPermissiveMoveOptions(store.state),
            ]),
          ),
        }
      }
      return { message: {} }
    })

    await store.dispatch('fetchMoveOptions')

    const moveCalls = frappe.call.mock.calls.filter(
      ([{ method }]) => method === 'quick_kanban.api.get_move_options',
    )
    expect(moveCalls).toHaveLength(1)
    expect(moveCalls[0][0].args.names).toEqual(['TASK-1'])
    expect(store.getters.canDragCard('TASK-1')).toBe(true)
  })

  test('flat refreshBoard clears stale swimlane state', async () => {
    frappe.call.mockImplementation(({ method, args }) => {
      if (method === 'frappe.client.get') {
        return Promise.resolve({ message: boardDocument })
      }
      if (method === 'quick_kanban.api.get_column_totals') {
        return Promise.resolve({ message: { Open: 1, Done: 0 } })
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return {
          message: Object.fromEntries(
            (args.names || []).map((name) => [
              name,
              {
                can_drag: true,
                destinations: {
                  Open: {
                    allowed: false,
                    reason: 'same_column',
                    mode: 'field_update',
                    actions: [],
                    missing_mandatory: [],
                  },
                  Done: {
                    allowed: true,
                    mode: 'field_update',
                    actions: [],
                    missing_mandatory: [],
                  },
                },
              },
            ]),
          ),
        }
      }
      return Promise.resolve({
        message: {
          keys: ['name', 'subject', 'status'],
          values: [['TASK-1', 'First', 'Open']],
          user_info: {},
        },
      })
    })
    const store = createStore()
    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    store.commit('SET_LANES', [
      {
        key: 'stale',
        label: 'Stale',
        columns: [
          { name: 'open', column_name: 'Open', cards: [] },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    store.commit('SET_EXPANDED_LANE_KEYS', ['stale'])
    store.commit('SET_CELL_PAGINATION', { 'stale::Open': { loading: false, hasMore: false } })

    await store.dispatch('refreshBoard', {
      board_name: 'Task Board',
      args: {
        doctype: 'Task',
        filters: [],
        page_length: 100,
      },
    })

    expect(store.state.lanes).toEqual([])
    expect(store.state.expandedLaneKeys).toEqual([])
    expect(store.state.cellPagination).toEqual({})
    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual(['TASK-1'])
    await vi.waitFor(() => {
      expect(store.state.moveOptionsByCard['TASK-1']).toBeTruthy()
    })
    expect(store.getters.canDragCard('TASK-1')).toBe(true)
  })

  test('canDragCard allows lane-only when swimlanes on and no column destinations', () => {
    const store = createStore()
    frappe.model.can_write.mockReturnValue(true)
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      swimlane_mode: 'field',
      swimlane_field: 'project',
      swimlane_field_meta: { fieldname: 'project', read_only: 0 },
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'p1',
        label: 'P1',
        columns: [
          {
            name: 'open',
            column_name: 'Open',
            cards: [{ name: 'TASK-1', subject: 'One', status: 'Open' }],
          },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    store.commit('SET_MOVE_OPTIONS_BATCH', {
      options: {
        'TASK-1': {
          can_drag: false,
          destinations: {
            Open: {
              allowed: false,
              reason: 'same_column',
              mode: 'field_update',
              actions: [],
              missing_mandatory: [],
            },
            Done: {
              allowed: false,
              reason: 'no_permission',
              mode: 'field_update',
              actions: [],
              missing_mandatory: [],
            },
          },
        },
      },
      generation: store.state.moveOptionsGeneration,
    })

    expect(store.getters.getAllowedDestinations('TASK-1')).toHaveLength(0)
    expect(store.getters.canDragCard('TASK-1')).toBe(true)
  })

  test('isCellDropAllowed permits same-column lane change when writable', () => {
    const store = createStore()
    frappe.model.can_write.mockReturnValue(true)
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      swimlane_mode: 'field',
      swimlane_field: 'project',
      swimlane_field_meta: { fieldname: 'project', read_only: 0 },
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    store.commit('SET_ACTIVE_DRAG', {
      cardName: 'TASK-1',
      fromColumn: 0,
      fromLaneKey: 'a',
    })
    store.state.moveOptionsLoaded = true

    expect(store.getters.isCellDropAllowed({
      cardName: 'TASK-1',
      columnIndex: 0,
      laneColumnIndex: 0,
      laneKey: 'b',
    })).toBe(true)
  })

  test('moveCard under swimlanes persists via move_card_to_cell', async () => {
    const store = createStore()
    frappe.model.can_write.mockReturnValue(true)
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      swimlane_mode: 'field',
      swimlane_field: 'project',
      swimlane_field_meta: { fieldname: 'project', read_only: 0 },
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'p1',
        label: 'P1',
        columns: [
          {
            name: 'open',
            column_name: 'Open',
            cards: [{ name: 'TASK-1', subject: 'One', status: 'Open', modified: '2026-01-01' }],
          },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    seedMoveOptions(store, ['TASK-1'])
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.move_card_to_cell') {
        return { message: { name: 'TASK-1', status: 'Done', modified: '2026-01-02' } }
      }
      return { message: {} }
    })

    const moved = await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(moved).toBe(true)
    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'quick_kanban.api.move_card_to_cell',
    }))
    expect(store.state.lanes[0].columns[1].cards.map(({ name }) => name)).toEqual(['TASK-1'])
  })

  test('swimlane column move clears stale same_column so reverse move works', async () => {
    const store = createStore()
    frappe.model.can_write.mockReturnValue(true)
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      swimlane_mode: 'field',
      swimlane_field: 'project',
      swimlane_field_meta: { fieldname: 'project', read_only: 0 },
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'p1',
        label: 'P1',
        columns: [
          {
            name: 'open',
            column_name: 'Open',
            cards: [{ name: 'TASK-1', subject: 'One', status: 'Open', modified: '2026-01-01' }],
          },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])

    function optionsForStatus(status) {
      return {
        can_drag: true,
        destinations: {
          Open: {
            allowed: status !== 'Open',
            reason: status === 'Open' ? 'same_column' : null,
            mode: 'field_update',
            actions: [],
            missing_mandatory: [],
          },
          Done: {
            allowed: status !== 'Done',
            reason: status === 'Done' ? 'same_column' : null,
            mode: 'field_update',
            actions: [],
            missing_mandatory: [],
          },
        },
      }
    }

    store.commit('SET_MOVE_OPTIONS_BATCH', {
      options: { 'TASK-1': optionsForStatus('Open') },
      generation: store.state.moveOptionsGeneration,
    })

    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'quick_kanban.api.move_card_to_cell') {
        return {
          message: {
            name: 'TASK-1',
            status: args.to_column,
            modified: '2026-01-02',
          },
        }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        const card = store.state.lanes[0].columns
          .flatMap((column) => column.cards)
          .find((row) => row.name === 'TASK-1')
        return {
          message: Object.fromEntries(
            (args.names || []).map((name) => [
              name,
              optionsForStatus(card?.status || 'Open'),
            ]),
          ),
        }
      }
      return { message: {} }
    })

    const forward = await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })
    expect(forward).toBe(true)
    expect(store.state.lanes[0].columns[1].cards[0].status).toBe('Done')
    expect(store.state.moveOptionsByCard['TASK-1']).toBeUndefined()

    await vi.waitFor(() => {
      expect(store.state.moveOptionsByCard['TASK-1']).toBeTruthy()
    })
    expect(store.state.moveOptionsByCard['TASK-1'].destinations.Open.allowed).toBe(true)
    expect(store.state.moveOptionsByCard['TASK-1'].destinations.Done.reason).toBe('same_column')

    frappe.show_alert.mockClear()
    const back = await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 1,
      toColumn: 0,
      fromIndex: 0,
      toIndex: 0,
    })
    expect(back).toBe(true)
    expect(store.state.lanes[0].columns[0].cards.map(({ name }) => name)).toEqual(['TASK-1'])
    expect(store.state.lanes[0].columns[0].cards[0].status).toBe('Open')
    expect(frappe.show_alert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/already in this column/i),
      }),
    )
  })
})

describe('read_only field blocks drag', () => {
  test('status field read_only disables flat canDrag and isDropAllowed', () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      status_field_meta: { fieldname: 'status', read_only: 1 },
      swimlane_mode: 'off',
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        cards: [{ name: 'TASK-1', subject: 'One', status: 'Open' }],
      },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    seedMoveOptions(store, ['TASK-1'])

    expect(store.getters.getAllowedDestinations('TASK-1')).toHaveLength(0)
    expect(store.getters.canDragCard('TASK-1')).toBe(false)
    expect(store.getters.isDropAllowed({
      cardName: 'TASK-1',
      columnIndex: 1,
    })).toBe(false)
  })

  test('swimlane field read_only blocks lane-only drop', () => {
    const store = createStore()
    frappe.model.can_write.mockReturnValue(true)
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      status_field_meta: { fieldname: 'status', read_only: 0 },
      swimlane_mode: 'field',
      swimlane_field: 'project',
      swimlane_field_meta: { fieldname: 'project', read_only: 1 },
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        cards: [{ name: 'TASK-1', subject: 'One', status: 'Open' }],
      },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    seedMoveOptions(store, ['TASK-1'])
    store.commit('SET_ACTIVE_DRAG', {
      cardName: 'TASK-1',
      fromColumn: 0,
      fromLaneKey: 'a',
    })

    expect(store.getters.isCellDropAllowed({
      cardName: 'TASK-1',
      columnIndex: 0,
      laneColumnIndex: 0,
      laneKey: 'b',
    })).toBe(false)
    expect(store.getters.isDropAllowed({
      cardName: 'TASK-1',
      columnIndex: 1,
    })).toBe(true)
  })

  test('status RO with writable swimlane allows lane-only drag but not column drop', () => {
    const store = createStore()
    frappe.model.can_write.mockReturnValue(true)
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      status_field_meta: { fieldname: 'status', read_only: 1 },
      swimlane_mode: 'field',
      swimlane_field: 'project',
      swimlane_field_meta: { fieldname: 'project', read_only: 0 },
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        cards: [{ name: 'TASK-1', subject: 'One', status: 'Open' }],
      },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'p1',
        label: 'P1',
        columns: [
          {
            name: 'open',
            column_name: 'Open',
            cards: [{ name: 'TASK-1', subject: 'One', status: 'Open' }],
          },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    seedMoveOptions(store, ['TASK-1'])
    store.commit('SET_ACTIVE_DRAG', {
      cardName: 'TASK-1',
      fromColumn: 0,
      fromLaneKey: 'p1',
    })

    expect(store.getters.canDragCard('TASK-1')).toBe(true)
    expect(store.getters.isDropAllowed({
      cardName: 'TASK-1',
      columnIndex: 1,
    })).toBe(false)
    expect(store.getters.isCellDropAllowed({
      cardName: 'TASK-1',
      columnIndex: 0,
      laneColumnIndex: 0,
      laneKey: 'p2',
    })).toBe(true)
    expect(store.getters.isCellDropAllowed({
      cardName: 'TASK-1',
      columnIndex: 1,
      laneColumnIndex: 1,
      laneKey: 'p1',
    })).toBe(false)
  })
})

describe('card creation', () => {
  function hydratedStore() {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        cards: [{
          name: 'TASK-1',
          subject: 'First task',
          status: 'Open',
        }],
      },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_CREATE_OPTIONS_BY_COLUMN', {
      Open: {
        allowed: true,
        form_mode: 'quick_entry',
        missing_mandatory: [],
        missing_fieldnames: [],
      },
    })
    return store
  }

  test('prepends a created card to the initiating column', async () => {
    const store = hydratedStore()
    store.commit('SET_PENDING_CREATE', {
      column_name: 'Open',
      columnIndex: 0,
      board_name: 'Task Board',
      form_mode: 'quick_entry',
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 1, Done: 0 })

    const created = await store.dispatch('handleCardCreated', {
      doc: {
        name: 'TASK-NEW',
        subject: 'Fresh task',
        status: 'Open',
        modified: '2026-07-12 12:00:00',
      },
    })

    expect(created).toBe(true)
    expect(store.state.columns[0].cards[0].name).toBe('TASK-NEW')
    expect(store.state.columns[0].cards[1].name).toBe('TASK-1')
    expect(store.state.recentCreatedCards['TASK-NEW']).toBe('Open')
    expect(store.state.revealCreatedCard).toEqual({
      cardName: 'TASK-NEW',
      columnIndex: 0,
      cardIndex: 0,
      laneIndex: null,
    })
    expect(store.state.pendingCreate).toBeNull()
  })

  test('prepends a created card to the Overdue column when status matches', async () => {
    const store = hydratedStore()
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        cards: [{
          name: 'TASK-1',
          subject: 'First task',
          status: 'Open',
        }],
      },
      { name: 'overdue', column_name: 'Overdue', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_PENDING_CREATE', {
      column_name: 'Overdue',
      columnIndex: 1,
      board_name: 'Task Board',
      form_mode: 'quick_entry',
    })

    const created = await store.dispatch('handleCardCreated', {
      doc: {
        name: 'TASK-OVERDUE',
        subject: 'Late task',
        status: 'Overdue',
        modified: '2026-07-12 12:00:00',
      },
    })

    expect(created).toBe(true)
    expect(store.state.columns[1].cards[0].name).toBe('TASK-OVERDUE')
    expect(store.state.recentCreatedCards['TASK-OVERDUE']).toBe('Overdue')
    expect(store.state.pendingCreate).toBeNull()
  })

  test('does not prepend when saved status mismatches initiating column', async () => {
    const store = hydratedStore()
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        cards: [{
          name: 'TASK-1',
          subject: 'First task',
          status: 'Open',
        }],
      },
      { name: 'overdue', column_name: 'Overdue', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_PENDING_CREATE', {
      column_name: 'Overdue',
      columnIndex: 1,
      board_name: 'Task Board',
      form_mode: 'quick_entry',
    })

    const created = await store.dispatch('handleCardCreated', {
      doc: {
        name: 'TASK-WRONG',
        subject: 'Wrong status task',
        status: 'Open',
        modified: '2026-07-12 12:00:00',
      },
    })

    expect(created).toBe(false)
    expect(store.state.columns[1].cards).toHaveLength(0)
    expect(store.state.pendingCreate).toBeNull()
  })

  test('startCreateCard merges field swimlane defaults and stores pending lane', async () => {
    const store = hydratedStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      swimlane_mode: 'field',
      swimlane_field: 'project',
      swimlane_field_meta: { fieldname: 'project', read_only: 0 },
    })
    frappe.model.can_write = vi.fn(() => true)
    frappe.model.get_new_doc.mockReturnValue({ doctype: 'Task', name: 'new-Task-1' })
    let capturedDefaults = null
    frappe.ui.form.make_quick_entry.mockImplementation((_dt, _cb, _init, doc) => {
      capturedDefaults = { ...doc }
      return Promise.resolve({})
    })

    await store.dispatch('startCreateCard', {
      columnIndex: 0,
      column: store.state.columns[0],
      laneKey: 'PROJ-1',
    })

    expect(store.state.pendingCreate).toMatchObject({
      column_name: 'Open',
      laneKey: 'PROJ-1',
      assign_to: null,
    })
    expect(capturedDefaults).toMatchObject({
      status: 'Open',
      project: 'PROJ-1',
    })
  })

  test('startCreateCard stores assign_to for assign swimlanes', async () => {
    const store = hydratedStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      swimlane_mode: 'assign',
      swimlane_field: '__assign',
    })
    frappe.model.can_write = vi.fn(() => true)
    frappe.model.get_new_doc.mockReturnValue({ doctype: 'Task', name: 'new-Task-1' })
    frappe.ui.form.make_quick_entry.mockResolvedValue({})

    await store.dispatch('startCreateCard', {
      columnIndex: 0,
      column: store.state.columns[0],
      laneKey: 'alice@example.com',
    })

    expect(store.state.pendingCreate).toMatchObject({
      laneKey: 'alice@example.com',
      assign_to: 'alice@example.com',
    })
  })

  test('prepends a created card into the swimlane cell', async () => {
    const store = hydratedStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      swimlane_mode: 'field',
      swimlane_field: 'project',
      swimlane_field_meta: { fieldname: 'project', read_only: 0 },
      fields: ['name', 'subject', 'status', 'project'],
    })
    store.commit('SET_LANES', [
      {
        key: 'PROJ-1',
        label: 'Project 1',
        columns: [
          { name: 'open', column_name: 'Open', cards: [] },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    store.commit('SET_CELL_TOTALS', { 'PROJ-1': { Open: 0, Done: 0 } })
    store.commit('SET_PENDING_CREATE', {
      column_name: 'Open',
      columnIndex: 0,
      board_name: 'Task Board',
      form_mode: 'quick_entry',
      laneKey: 'PROJ-1',
    })

    const created = await store.dispatch('handleCardCreated', {
      doc: {
        name: 'TASK-LANE',
        subject: 'Lane task',
        status: 'Open',
        project: 'PROJ-1',
        modified: '2026-07-12 12:00:00',
      },
    })

    expect(created).toBe(true)
    expect(store.state.lanes[0].columns[0].cards[0].name).toBe('TASK-LANE')
    expect(store.state.cellTotals['PROJ-1'].Open).toBe(1)
    expect(store.state.columns[0].cards.map((card) => card.name)).toEqual(['TASK-1'])
    expect(store.state.revealCreatedCard).toEqual({
      cardName: 'TASK-LANE',
      columnIndex: 0,
      cardIndex: 0,
      laneIndex: 0,
    })
  })

  test('assigns user after create then prepends into assign lane', async () => {
    const store = hydratedStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      swimlane_mode: 'assign',
      swimlane_field: '__assign',
    })
    store.commit('SET_LANES', [
      {
        key: 'alice@example.com',
        label: 'Alice',
        columns: [
          { name: 'open', column_name: 'Open', cards: [] },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    store.commit('SET_CELL_TOTALS', { 'alice@example.com': { Open: 2, Done: 0 } })
    store.commit('SET_PENDING_CREATE', {
      column_name: 'Open',
      columnIndex: 0,
      board_name: 'Task Board',
      form_mode: 'quick_entry',
      laneKey: 'alice@example.com',
      assign_to: 'alice@example.com',
    })
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'frappe.desk.form.assign_to.add') {
        return { message: {} }
      }
      return { message: {} }
    })

    const created = await store.dispatch('handleCardCreated', {
      doc: {
        name: 'TASK-ASSIGN',
        subject: 'Assigned task',
        status: 'Open',
        modified: '2026-07-12 12:00:00',
      },
    })

    expect(created).toBe(true)
    expect(frappe.call).toHaveBeenCalledWith({
      method: 'frappe.desk.form.assign_to.add',
      args: {
        doctype: 'Task',
        name: 'TASK-ASSIGN',
        assign_to: ['alice@example.com'],
        description: 'TASK-ASSIGN',
      },
    })
    expect(store.state.lanes[0].columns[0].cards[0]).toMatchObject({
      name: 'TASK-ASSIGN',
      _assign: { 'alice@example.com': 'alice@example.com' },
    })
    expect(store.state.cellTotals['alice@example.com'].Open).toBe(3)
    expect(store.state.revealCreatedCard).toEqual({
      cardName: 'TASK-ASSIGN',
      columnIndex: 0,
      cardIndex: 0,
      laneIndex: 0,
    })
  })

  test('keeps recent creates pinned to the top after hydration', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      highlight_table: [],
    })
    store.commit('TRACK_RECENT_CREATED_CARD', {
      cardName: 'TASK-NEW',
      columnName: 'Open',
    })
    frappe.get_meta.mockReturnValue({ title_field: 'subject' })

    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [
        {
          name: 'TASK-1',
          subject: 'First task',
          status: 'Open',
        },
        {
          name: 'TASK-NEW',
          subject: 'Fresh task',
          status: 'Open',
        },
      ],
      args: { page_length: 100 },
    })

    expect(store.state.columns[0].cards[0].name).toBe('TASK-NEW')
    expect(store.state.columns[0].cards[1].name).toBe('TASK-1')
  })
})

describe('column reorder', () => {
  function boardStore() {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [{ name: 'C1' }] },
      { name: 'done', column_name: 'Done', cards: [{ name: 'C2' }] },
      { name: 'review', column_name: 'Review', cards: [] },
    ])
    return store
  }

  test('reorders columns optimistically and persists through Frappe API', async () => {
    frappe.call.mockResolvedValue({
      message: {
        columns: [
          { name: 'done', column_name: 'Done' },
          { name: 'open', column_name: 'Open' },
          { name: 'review', column_name: 'Review' },
        ],
      },
    })
    const store = boardStore()

    await store.dispatch('updateColumnOrder', ['Done', 'Open', 'Review'])

    expect(store.state.columns.map((column) => column.column_name)).toEqual([
      'Done',
      'Open',
      'Review',
    ])
    expect(store.state.columns[0].cards[0].name).toBe('C2')
    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'frappe.desk.doctype.kanban_board.kanban_board.update_column_order',
      args: {
        board_name: 'Task Board',
        order: JSON.stringify(['Done', 'Open', 'Review']),
      },
    }))
  })

  test('reorders lane columns together with board columns', async () => {
    frappe.call.mockResolvedValue({
      message: {
        columns: [
          { name: 'done', column_name: 'Done' },
          { name: 'open', column_name: 'Open' },
          { name: 'review', column_name: 'Review' },
        ],
      },
    })
    const store = boardStore()
    store.commit('SET_LANES', [
      {
        key: 'alpha',
        label: 'Alpha',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ name: 'L1' }] },
          { name: 'done', column_name: 'Done', cards: [{ name: 'L2' }] },
          { name: 'review', column_name: 'Review', cards: [] },
        ],
      },
    ])

    await store.dispatch('updateColumnOrder', ['Done', 'Open', 'Review'])

    expect(store.state.columns.map((column) => column.column_name)).toEqual([
      'Done',
      'Open',
      'Review',
    ])
    expect(store.state.lanes[0].columns.map((column) => column.column_name)).toEqual([
      'Done',
      'Open',
      'Review',
    ])
    expect(store.state.lanes[0].columns[0].cards[0].name).toBe('L2')
    expect(store.state.lanes[0].columns[1].cards[0].name).toBe('L1')
  })

  test('rolls back when column reorder fails', async () => {
    frappe.call.mockRejectedValue(new Error('No write access'))
    const store = boardStore()

    await expect(
      store.dispatch('updateColumnOrder', ['Review', 'Open', 'Done']),
    ).rejects.toThrow('No write access')

    expect(store.state.columns.map((column) => column.column_name)).toEqual([
      'Open',
      'Done',
      'Review',
    ])
    expect(frappe.show_alert).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Could not reorder the columns.',
    }))
  })

  test('hydrateFromList stores board permissions', async () => {
    const store = createStore()

    await store.dispatch('hydrateFromList', {
      board: {
        name: 'Task Board',
        reference_doctype: 'Task',
        field_name: 'status',
        columns: [{ name: 'open', column_name: 'Open' }],
      },
      board_perms: { write: true },
    })

    expect(store.getters.canEditBoard).toBe(true)
  })

  test('keeps column totals after reorder when child row names change', async () => {
    frappe.call.mockResolvedValue({
      message: {
        columns: [
          { name: 'new-done-row', column_name: 'Done' },
          { name: 'new-open-row', column_name: 'Open' },
          { name: 'new-review-row', column_name: 'Review' },
        ],
      },
    })
    const store = boardStore()
    store.commit('SET_COLUMN_TOTALS', { Open: 12, Done: 34, Review: 5 })

    await store.dispatch('updateColumnOrder', ['Done', 'Open', 'Review'])

    expect(store.state.columnTotals).toEqual({ Open: 12, Done: 34, Review: 5 })
  })

  test('updateColumnOrder syncs cached ListView board columns', async () => {
    window.cur_list = {
      board_name: 'Task Board',
      board: {
        name: 'Task Board',
        columns: [
          { name: 'open', column_name: 'Open' },
          { name: 'done', column_name: 'Done' },
          { name: 'review', column_name: 'Review' },
        ],
      },
      get_args: vi.fn(() => ({ doctype: 'Task' })),
    }
    frappe.call.mockResolvedValue({
      message: {
        name: 'Task Board',
        columns: [
          { name: 'done', column_name: 'Done' },
          { name: 'open', column_name: 'Open' },
          { name: 'review', column_name: 'Review' },
        ],
      },
    })
    const store = boardStore()

    await store.dispatch('updateColumnOrder', ['Done', 'Open', 'Review'])

    expect(window.cur_list.board.columns.map((column) => column.column_name)).toEqual([
      'Done',
      'Open',
      'Review',
    ])
  })
})

describe('column indicator', () => {
  function boardPayload(name, columns) {
    return {
      name,
      reference_doctype: 'Task',
      field_name: 'status',
      fields: '["name", "subject"]',
      columns,
    }
  }

  test('setIndicator updates cached ListView board column indicator', async () => {
    window.cur_list = {
      board_name: 'Task Board',
      board: {
        name: 'Task Board',
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'Gray' },
          { name: 'done', column_name: 'Done', indicator: 'Green' },
        ],
      },
      get_args: vi.fn(() => ({ doctype: 'Task' })),
    }
    frappe.call.mockResolvedValue({
      message: {
        name: 'Task Board',
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'Blue' },
          { name: 'done', column_name: 'Done', indicator: 'Green' },
        ],
      },
    })
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', indicator: 'Gray', cards: [] },
      { name: 'done', column_name: 'Done', indicator: 'Green', cards: [] },
    ])

    await store.dispatch('setIndicator', { indicator: 'Blue', columnIndex: 0 })

    expect(store.state.columns[0].indicator).toBe('Blue')
    expect(window.cur_list.board.columns[0].indicator).toBe('Blue')
    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'frappe.desk.doctype.kanban_board.kanban_board.set_indicator',
      args: {
        board_name: 'Task Board',
        column_name: 'Open',
        indicator: 'Blue',
      },
    }))
  })

  test('keeps updated indicator after switching boards and returning via hydrate', async () => {
    const boardA = boardPayload('Board A', [
      { name: 'open', column_name: 'Open', indicator: 'Gray' },
      { name: 'done', column_name: 'Done', indicator: 'Green' },
    ])
    const boardB = boardPayload('Board B', [
      { name: 'todo', column_name: 'Todo', indicator: 'Cyan' },
    ])

    const cachedListA = {
      board_name: 'Board A',
      board: structuredClone(boardA),
      get_args: vi.fn(() => ({ doctype: 'Task' })),
    }
    window.cur_list = cachedListA

    const store = createStore()
    await store.dispatch('hydrateFromList', { board: cachedListA.board, cards: [] })

    frappe.call.mockResolvedValue({
      message: {
        name: 'Board A',
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'Blue' },
          { name: 'done', column_name: 'Done', indicator: 'Green' },
        ],
      },
    })
    await store.dispatch('setIndicator', { indicator: 'Blue', columnIndex: 0 })
    expect(cachedListA.board.columns[0].indicator).toBe('Blue')

    window.cur_list = {
      board_name: 'Board B',
      board: structuredClone(boardB),
      get_args: vi.fn(() => ({ doctype: 'Task' })),
    }
    await store.dispatch('hydrateFromList', { board: boardB, cards: [] })
    expect(store.state.columns[0].column_name).toBe('Todo')

    // Returning reuses the same cached ListView instance (board mutated by setIndicator).
    window.cur_list = cachedListA
    await store.dispatch('hydrateFromList', {
      board: cachedListA.board,
      cards: [],
    })

    expect(store.state.columns[0].indicator).toBe('Blue')
  })
})

describe('column widths', () => {
  test('setColumnWidths updates store and syncs cached board columns', async () => {
    window.cur_list = {
      board_name: 'Task Board',
      board: {
        name: 'Task Board',
        columns: [
          { name: 'open', column_name: 'Open', custom_column_width: 250 },
          { name: 'done', column_name: 'Done', custom_column_width: 250 },
        ],
      },
      get_args: vi.fn(() => ({ doctype: 'Task' })),
    }
    frappe.call.mockResolvedValue({
      message: {
        name: 'Task Board',
        columns: [
          { name: 'open', column_name: 'Open', custom_column_width: 360 },
          { name: 'done', column_name: 'Done', custom_column_width: 360 },
        ],
      },
    })
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_BOARD_PERMS', { write: true })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', custom_column_width: 250, cards: [] },
      { name: 'done', column_name: 'Done', custom_column_width: 250, cards: [] },
    ])

    await store.dispatch('setColumnWidths', { Open: 360, Done: 360 })

    expect(store.state.columns.map((column) => column.custom_column_width)).toEqual([360, 360])
    expect(window.cur_list.board.columns.map((column) => column.custom_column_width)).toEqual([
      360,
      360,
    ])
    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'quick_kanban.api.set_column_widths',
      args: {
        board_name: 'Task Board',
        widths: { Open: 360, Done: 360 },
      },
    }))
  })

  test('setColumnWidths is a no-op without board write access', async () => {
    const store = createStore()
    store.commit('SET_BOARD_PERMS', { write: false })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', custom_column_width: 250, cards: [] },
    ])

    await store.dispatch('setColumnWidths', { Open: 400 })

    expect(frappe.call).not.toHaveBeenCalled()
    expect(store.state.columns[0].custom_column_width).toBe(250)
  })
})

describe('hide column', () => {
  test('hydrateFromList omits Archived columns', async () => {
    const store = createStore()

    await store.dispatch('hydrateFromList', {
      board: {
        name: 'Task Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: '["name", "subject"]',
        columns: [
          { name: 'open', column_name: 'Open', status: 'Active' },
          { name: 'done', column_name: 'Done', status: 'Archived' },
          { name: 'review', column_name: 'Review' },
        ],
      },
      cards: [
        { name: 'TASK-1', subject: 'Visible', status: 'Open' },
        { name: 'TASK-2', subject: 'Hidden', status: 'Done' },
      ],
      args: { page_length: 100 },
      board_perms: { write: true },
    })

    expect(store.state.columns.map((column) => column.column_name)).toEqual([
      'Open',
      'Review',
    ])
    expect(store.state.columns[0].cards.map((card) => card.name)).toEqual(['TASK-1'])
    expect(store.state.archivedColumns.map((column) => column.column_name)).toEqual([
      'Done',
    ])
  })

  test('ensureBoard omits Archived columns', async () => {
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'frappe.client.get') {
        return {
          message: {
            name: 'Task Board',
            reference_doctype: 'Task',
            field_name: 'status',
            fields: '["name", "subject"]',
            columns: [
              { name: 'open', column_name: 'Open', status: 'Active' },
              { name: 'done', column_name: 'Done', status: 'Archived' },
            ],
          },
        }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      if (method === 'quick_kanban.api.get_create_options') {
        return { message: {} }
      }
      return { message: {} }
    })
    const store = createStore()

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })

    expect(store.state.columns.map((column) => column.column_name)).toEqual(['Open'])
    expect(store.state.archivedColumns.map((column) => column.column_name)).toEqual([
      'Done',
    ])
  })

  test('hideColumn archives via API, removes from view, and syncs ListView cache', async () => {
    window.cur_list = {
      board_name: 'Task Board',
      board: {
        name: 'Task Board',
        columns: [
          { name: 'open', column_name: 'Open', status: 'Active' },
          { name: 'done', column_name: 'Done', status: 'Active' },
        ],
      },
      get_args: vi.fn(() => ({ doctype: 'Task' })),
    }
    frappe.call.mockResolvedValue({
      message: [
        { name: 'open', column_name: 'Open', status: 'Archived' },
        { name: 'done', column_name: 'Done', status: 'Active' },
      ],
    })
    const store = createStore()
    store.commit('SET_BOARD_PERMS', { write: true })
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', status: 'Active', cards: [{ name: 'C1' }] },
      { name: 'done', column_name: 'Done', status: 'Active', cards: [] },
    ])
    store.commit('SET_ARCHIVED_COLUMNS', [])
    store.commit('SET_COLUMN_PAGINATION', {
      Open: { offset: 1, loading: false, hasMore: false },
      Done: { offset: 0, loading: false, hasMore: false },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 1, Done: 0 })

    await store.dispatch('hideColumn', { columnIndex: 0 })

    expect(store.state.columns.map((column) => column.column_name)).toEqual(['Done'])
    expect(store.state.archivedColumns.map((column) => column.column_name)).toEqual([
      'Open',
    ])
    expect(store.state.columnPagination.Open).toBeUndefined()
    expect(store.state.columnTotals.Open).toBeUndefined()
    expect(window.cur_list.board.columns).toEqual([
      { name: 'open', column_name: 'Open', status: 'Archived' },
      { name: 'done', column_name: 'Done', status: 'Active' },
    ])
    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'frappe.desk.doctype.kanban_board.kanban_board.archive_restore_column',
      args: {
        board_name: 'Task Board',
        column_title: 'Open',
        status: 'Archived',
      },
    }))
  })

  test('hideColumn is a no-op without board write permission', async () => {
    const store = createStore()
    store.commit('SET_BOARD_PERMS', { write: false })
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    frappe.call.mockClear()

    await store.dispatch('hideColumn', { columnIndex: 0 })

    expect(store.state.columns).toHaveLength(1)
    expect(frappe.call).not.toHaveBeenCalled()
  })

  test('hideColumn rolls back and alerts when the API fails', async () => {
    frappe.call.mockRejectedValue(new Error('Permission denied'))
    const store = createStore()
    store.commit('SET_BOARD_PERMS', { write: true })
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [{ name: 'C1' }] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_ARCHIVED_COLUMNS', [])
    store.commit('SET_COLUMN_PAGINATION', {
      Open: { offset: 1, loading: false, hasMore: false },
      Done: { offset: 0, loading: false, hasMore: false },
    })
    store.commit('SET_COLUMN_TOTALS', { Open: 4, Done: 2 })

    await expect(
      store.dispatch('hideColumn', { columnIndex: 0 }),
    ).rejects.toThrow('Permission denied')

    expect(store.state.columns.map((column) => column.column_name)).toEqual([
      'Open',
      'Done',
    ])
    expect(store.state.archivedColumns).toEqual([])
    expect(store.state.columns[0].cards[0].name).toBe('C1')
    expect(store.state.columnPagination.Open.offset).toBe(1)
    expect(store.state.columnTotals).toEqual({ Open: 4, Done: 2 })
    expect(frappe.show_alert).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Could not hide the column.',
    }))
  })

  test('restoreColumn activates via API, inserts into view, and syncs ListView cache', async () => {
    window.cur_list = {
      board_name: 'Task Board',
      board: {
        name: 'Task Board',
        columns: [
          { name: 'open', column_name: 'Open', status: 'Archived' },
          { name: 'done', column_name: 'Done', status: 'Active' },
        ],
      },
      get_args: vi.fn(() => ({ doctype: 'Task', filters: [] })),
    }
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'frappe.desk.doctype.kanban_board.kanban_board.archive_restore_column') {
        return {
          message: [
            { name: 'open', column_name: 'Open', status: 'Active' },
            { name: 'done', column_name: 'Done', status: 'Active' },
          ],
        }
      }
      if (method === 'quick_kanban.api.get_column_totals') {
        return { message: { Open: 0, Done: 0 } }
      }
      if (method === 'frappe.desk.reportview.get') {
        return { message: { keys: ['name'], values: [] } }
      }
      return { message: {} }
    })
    const store = createStore()
    store.commit('SET_BOARD_PERMS', { write: true })
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'done', column_name: 'Done', status: 'Active', cards: [] },
    ])
    store.commit('SET_ARCHIVED_COLUMNS', [
      { name: 'open', column_name: 'Open', status: 'Archived' },
    ])
    store.commit('SET_COLUMN_PAGINATION', {
      Done: { offset: 0, loading: false, hasMore: false },
    })
    store.commit('SET_COLUMN_TOTALS', { Done: 0 })

    await store.dispatch('restoreColumn', { column_title: 'Open' })

    expect(store.state.columns.map((column) => column.column_name)).toEqual([
      'Open',
      'Done',
    ])
    expect(store.state.archivedColumns).toEqual([])
    expect(window.cur_list.board.columns).toEqual([
      { name: 'open', column_name: 'Open', status: 'Active' },
      { name: 'done', column_name: 'Done', status: 'Active' },
    ])
    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'frappe.desk.doctype.kanban_board.kanban_board.archive_restore_column',
      args: {
        board_name: 'Task Board',
        column_title: 'Open',
        status: 'Active',
      },
    }))
  })

  test('restoreColumn is a no-op without board write permission', async () => {
    const store = createStore()
    store.commit('SET_BOARD_PERMS', { write: false })
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_ARCHIVED_COLUMNS', [
      { name: 'open', column_name: 'Open', status: 'Archived' },
    ])
    frappe.call.mockClear()

    await store.dispatch('restoreColumn', { column_title: 'Open' })

    expect(store.state.columns).toHaveLength(1)
    expect(store.state.archivedColumns).toHaveLength(1)
    expect(frappe.call).not.toHaveBeenCalled()
  })

  test('restoreColumn rolls back and alerts when the API fails', async () => {
    frappe.call.mockRejectedValue(new Error('Permission denied'))
    const store = createStore()
    store.commit('SET_BOARD_PERMS', { write: true })
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_ARCHIVED_COLUMNS', [
      { name: 'open', column_name: 'Open', status: 'Archived' },
    ])
    store.commit('SET_COLUMN_PAGINATION', {
      Done: { offset: 0, loading: false, hasMore: false },
    })
    store.commit('SET_COLUMN_TOTALS', { Done: 2 })

    await expect(
      store.dispatch('restoreColumn', { column_title: 'Open' }),
    ).rejects.toThrow('Permission denied')

    expect(store.state.columns.map((column) => column.column_name)).toEqual(['Done'])
    expect(store.state.archivedColumns.map((column) => column.column_name)).toEqual([
      'Open',
    ])
    expect(store.state.columnPagination.Done.offset).toBe(0)
    expect(store.state.columnTotals).toEqual({ Done: 2 })
    expect(frappe.show_alert).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Could not add the column.',
    }))
  })

  test('addColumn creates via API and syncs ListView cache', async () => {
    window.cur_list = {
      board_name: 'Task Board',
      board: {
        name: 'Task Board',
        columns: [
          { name: 'open', column_name: 'Open', status: 'Active' },
        ],
      },
      get_args: vi.fn(() => ({ doctype: 'Task', filters: [] })),
    }
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'frappe.desk.doctype.kanban_board.kanban_board.add_column') {
        return {
          message: [
            { name: 'open', column_name: 'Open', status: 'Active' },
            { name: 'working', column_name: 'Working', status: 'Active' },
          ],
        }
      }
      if (method === 'quick_kanban.api.get_column_totals') {
        return { message: { Open: 0, Working: 0 } }
      }
      if (method === 'frappe.desk.reportview.get') {
        return { message: { keys: ['name'], values: [] } }
      }
      return { message: {} }
    })
    const store = createStore()
    store.commit('SET_BOARD_PERMS', { write: true })
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
      status_field_meta: {
        fieldname: 'status',
        fieldtype: 'Select',
        options: 'Open\nWorking\nDone',
        parent: 'Task',
      },
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', status: 'Active', cards: [] },
    ])
    store.commit('SET_ARCHIVED_COLUMNS', [])
    store.commit('SET_COLUMN_PAGINATION', {
      Open: { offset: 0, loading: false, hasMore: false },
    })

    expect(store.getters.getAddableColumns.map((column) => column.column_name)).toEqual([
      'Working',
      'Done',
    ])

    await store.dispatch('addColumn', { column_title: 'Working' })

    expect(store.state.columns.map((column) => column.column_name)).toEqual([
      'Open',
      'Working',
    ])
    expect(window.cur_list.board.columns).toEqual([
      { name: 'open', column_name: 'Open', status: 'Active' },
      { name: 'working', column_name: 'Working', status: 'Active' },
    ])
    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'frappe.desk.doctype.kanban_board.kanban_board.add_column',
      args: {
        board_name: 'Task Board',
        column_title: 'Working',
      },
    }))
  })

  test('addColumn delegates archived titles to restoreColumn', async () => {
    window.cur_list = {
      board_name: 'Task Board',
      board: {
        name: 'Task Board',
        columns: [
          { name: 'open', column_name: 'Open', status: 'Archived' },
          { name: 'done', column_name: 'Done', status: 'Active' },
        ],
      },
      get_args: vi.fn(() => ({ doctype: 'Task', filters: [] })),
    }
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'frappe.desk.doctype.kanban_board.kanban_board.archive_restore_column') {
        return {
          message: [
            { name: 'open', column_name: 'Open', status: 'Active' },
            { name: 'done', column_name: 'Done', status: 'Active' },
          ],
        }
      }
      if (method === 'quick_kanban.api.get_column_totals') {
        return { message: { Open: 0, Done: 0 } }
      }
      if (method === 'frappe.desk.reportview.get') {
        return { message: { keys: ['name'], values: [] } }
      }
      return { message: {} }
    })
    const store = createStore()
    store.commit('SET_BOARD_PERMS', { write: true })
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_ARCHIVED_COLUMNS', [
      { name: 'open', column_name: 'Open', status: 'Archived' },
    ])
    store.commit('SET_COLUMN_PAGINATION', {
      Done: { offset: 0, loading: false, hasMore: false },
    })

    await store.dispatch('addColumn', { column_title: 'Open' })

    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'frappe.desk.doctype.kanban_board.kanban_board.archive_restore_column',
      args: {
        board_name: 'Task Board',
        column_title: 'Open',
        status: 'Active',
      },
    }))
    expect(frappe.call).not.toHaveBeenCalledWith(expect.objectContaining({
      method: 'frappe.desk.doctype.kanban_board.kanban_board.add_column',
    }))
    expect(store.state.columns.map((column) => column.column_name)).toEqual([
      'Open',
      'Done',
    ])
    expect(store.state.archivedColumns).toEqual([])
  })

  test('addColumn is a no-op for already active columns', async () => {
    const store = createStore()
    store.commit('SET_BOARD_PERMS', { write: true })
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: [],
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    frappe.call.mockClear()

    await store.dispatch('addColumn', { column_title: 'Open' })

    expect(store.state.columns).toHaveLength(1)
    expect(frappe.call).not.toHaveBeenCalled()
  })
})

describe('persistTagTransfer', () => {
  beforeEach(() => {
    frappe.model.can_write.mockReturnValue(true)
  })

  function seedTaggedCards(store) {
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['subject'],
      display_fields: [],
      show_tags: true,
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        cards: [
          { name: 'TASK-1', subject: 'One', status: 'Open', _user_tags: ',alpha,beta', _assign: {} },
          { name: 'TASK-2', subject: 'Two', status: 'Open', _user_tags: ',gamma', _assign: {} },
        ],
      },
    ])
  }

  test('copy adds tag only on the target card', async () => {
    const store = createStore()
    seedTaggedCards(store)
    frappe.call.mockClear()

    const ok = await store.dispatch('persistTagTransfer', {
      tag: 'alpha',
      mode: 'copy',
      doctype: 'Task',
      sourceCardName: 'TASK-1',
      targetCardName: 'TASK-2',
    })

    expect(ok).toBe(true)
    expect(store.state.columns[0].cards[0]._user_tags).toBe(',alpha,beta')
    expect(store.state.columns[0].cards[1]._user_tags).toBe(',gamma,alpha')
    expect(frappe.call).toHaveBeenCalledTimes(1)
    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'frappe.desk.doctype.tag.tag.add_tag',
      args: { tag: 'alpha', dt: 'Task', dn: 'TASK-2' },
    }))
  })

  test('move adds on target and removes from source', async () => {
    const store = createStore()
    seedTaggedCards(store)
    frappe.call.mockClear()

    const ok = await store.dispatch('persistTagTransfer', {
      tag: 'alpha',
      mode: 'move',
      doctype: 'Task',
      sourceCardName: 'TASK-1',
      targetCardName: 'TASK-2',
    })

    expect(ok).toBe(true)
    expect(store.state.columns[0].cards[0]._user_tags).toBe(',beta')
    expect(store.state.columns[0].cards[1]._user_tags).toBe(',gamma,alpha')
    expect(frappe.call).toHaveBeenCalledTimes(2)
    expect(frappe.call).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: 'frappe.desk.doctype.tag.tag.add_tag',
    }))
    expect(frappe.call).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: 'frappe.desk.doctype.tag.tag.remove_tag',
      args: { tag: 'alpha', dt: 'Task', dn: 'TASK-1' },
    }))
  })

  test('forbidden drop does not call the API', async () => {
    const store = createStore()
    seedTaggedCards(store)
    store.commit('UPDATE_CARD_FIELD', {
      cardName: 'TASK-2',
      fieldname: '_user_tags',
      value: ',alpha,gamma',
    })
    frappe.call.mockClear()

    const ok = await store.dispatch('persistTagTransfer', {
      tag: 'alpha',
      mode: 'copy',
      doctype: 'Task',
      sourceCardName: 'TASK-1',
      targetCardName: 'TASK-2',
    })

    expect(ok).toBe(false)
    expect(frappe.call).not.toHaveBeenCalled()
  })

  test('rolls back optimistic tags when add_tag fails', async () => {
    const store = createStore()
    seedTaggedCards(store)
    frappe.call.mockRejectedValueOnce(new Error('boom'))

    const ok = await store.dispatch('persistTagTransfer', {
      tag: 'alpha',
      mode: 'copy',
      doctype: 'Task',
      sourceCardName: 'TASK-1',
      targetCardName: 'TASK-2',
    })

    expect(ok).toBe(false)
    expect(store.state.columns[0].cards[1]._user_tags).toBe(',gamma')
    expect(frappe.show_alert).toHaveBeenCalled()
  })
})

describe('density force-collapse', () => {
  test('FORCE_DENSITY_COLLAPSE clears hold on the same card', () => {
    const store = createStore()
    store.commit('SET_MINIMIZE_CARDS', true)
    store.commit('SET_DENSITY_HOLD_EXPANDED', 'TASK-1')
    store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-1')

    expect(store.state.densityForceCollapsedCards['TASK-1']).toBe(true)
    expect(store.state.densityHoldExpandedCard).toBeNull()
  })

  test('SET_DENSITY_HOLD_EXPANDED clears force-collapse for that card', () => {
    const store = createStore()
    store.commit('SET_MINIMIZE_CARDS', true)
    store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-1')
    store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-2')
    store.commit('SET_DENSITY_HOLD_EXPANDED', 'TASK-2')

    expect(store.state.densityForceCollapsedCards['TASK-1']).toBe(true)
    expect(store.state.densityForceCollapsedCards['TASK-2']).toBeUndefined()
    expect(store.state.densityHoldExpandedCard).toBe('TASK-2')
  })

  test('CLEAR_FORCE_DENSITY_COLLAPSE removes one or all cards', () => {
    const store = createStore()
    store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-1')
    store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-2')
    store.commit('CLEAR_FORCE_DENSITY_COLLAPSE', 'TASK-1')

    expect(store.state.densityForceCollapsedCards['TASK-1']).toBeUndefined()
    expect(store.state.densityForceCollapsedCards['TASK-2']).toBe(true)

    store.commit('CLEAR_FORCE_DENSITY_COLLAPSE')
    expect(store.state.densityForceCollapsedCards).toEqual({})
  })

  test('turning minimize off clears force-collapse and hold', () => {
    const store = createStore()
    store.commit('SET_MINIMIZE_CARDS', true)
    store.commit('SET_DENSITY_HOLD_EXPANDED', 'TASK-1')
    store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-2')
    store.commit('SET_MINIMIZE_CARDS', false)

    expect(store.state.densityHoldExpandedCard).toBeNull()
    expect(store.state.densityForceCollapsedCards).toEqual({})
  })

  test('BEGIN_BOARD_CONTEXT clears force-collapse map', () => {
    const store = createStore()
    store.commit('FORCE_DENSITY_COLLAPSE', 'TASK-1')
    store.commit('BEGIN_BOARD_CONTEXT')

    expect(store.state.densityForceCollapsedCards).toEqual({})
  })
})

describe('swimlane expand state', () => {
  test('expandedLaneKeys supports many persisted lanes plus drag overlay', () => {
    const store = createStore()
    store.commit('SET_EXPANDED_LANE_KEYS', ['alice', 'carol'])
    expect(store.getters.expandedLaneKeys).toEqual(['alice', 'carol'])
    store.commit('SET_DRAG_EXPANDED_LANE', 'bob')
    expect(store.getters.expandedLaneKeys).toEqual(['alice', 'carol', 'bob'])
    store.commit('SET_DRAG_EXPANDED_LANE', 'alice')
    expect(store.getters.expandedLaneKeys).toEqual(['alice', 'carol'])
    expect(store.getters.isLaneExpanded('bob')).toBe(false)
    expect(store.getters.isLaneExpanded('alice')).toBe(true)
  })

  test('toggleLaneExpanded opens without fetching; collapse keeps cards and hydration', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'status'],
      swimlane_field: 'project',
      swimlane_mode: 'field',
    })
    store.commit('SET_LANES', [
      {
        key: 'alice',
        label: 'Alice',
        columns: [{ name: 'open', column_name: 'Open', cards: [{ name: 'T1' }] }],
      },
      {
        key: 'bob',
        label: 'Bob',
        columns: [{ name: 'open', column_name: 'Open', cards: [] }],
      },
    ])
    store.commit('SET_CELL_PAGINATION', {
      'alice::Open': { offset: 1, hasMore: false, loading: false },
      'bob::Open': { offset: 0, hasMore: true, loading: false },
    })
    store.commit('SET_EXPANDED_LANE_KEYS', ['alice'])
    store.commit('SET_LANE_HYDRATION', { laneKey: 'alice', status: 'ready' })

    await store.dispatch('toggleLaneExpanded', { laneKey: 'bob' })
    expect(store.state.expandedLaneKeys).toEqual(['alice', 'bob'])
    expect(store.state.lanes[1].columns[0].cards).toEqual([])
    expect(frappe.call).not.toHaveBeenCalled()

    await store.dispatch('toggleLaneExpanded', { laneKey: 'alice' })
    expect(store.state.expandedLaneKeys).toEqual(['bob'])
    expect(store.state.lanes[0].columns[0].cards).toEqual([{ name: 'T1' }])
    expect(store.state.laneHydration.alice).toBe('ready')
    expect(store.state.cellPagination['alice::Open']).toEqual({
      offset: 1,
      hasMore: false,
      loading: false,
    })

    frappe.call.mockClear()
    await store.dispatch('toggleLaneExpanded', { laneKey: 'alice' })
    expect(store.state.expandedLaneKeys).toEqual(['bob', 'alice'])
    const hydrated = await store.dispatch('ensureLaneHydrated', { laneKey: 'alice' })
    expect(hydrated).toBe(true)
    expect(frappe.call).not.toHaveBeenCalled()
    expect(store.state.lanes[0].columns[0].cards).toEqual([{ name: 'T1' }])
  })

  test('toggleLaneExpanded collapse closes ChildPanel when depth-0 host is in that lane', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      parent_field: 'parent_task',
      fields: ['name', 'subject', 'status', 'parent_task'],
      swimlane_field: 'project',
      swimlane_mode: 'field',
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'alice',
        label: 'Alice',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ name: 'PARENT-A', subject: 'Parent A' }] },
        ],
      },
      {
        key: 'bob',
        label: 'Bob',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ name: 'OTHER', subject: 'Other' }] },
        ],
      },
    ])
    store.commit('SET_EXPANDED_LANE_KEYS', ['alice', 'bob'])
    window.cur_list = {
      doctype: 'Task',
      board_name: 'Task Board',
      get_args: () => ({
        doctype: 'Task',
        fields: ['name', 'subject', 'status', 'parent_task'],
        filters: [],
        page_length: 100,
      }),
    }
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_child_column_totals') {
        return { message: { Open: 1, Done: 0 } }
      }
      if (method === 'quick_kanban.api.get_child_column_page') {
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [],
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-A', depth: 0 })
    expect(store.getters.isChildPanelOpenFor('PARENT-A', 0)).toBe(true)
    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-A-CHILD', depth: 1 })
    expect(store.getters.isChildPanelOpenFor('PARENT-A-CHILD', 1)).toBe(true)

    await store.dispatch('toggleLaneExpanded', { laneKey: 'bob' })
    expect(store.state.expandedLaneKeys).toEqual(['alice'])
    expect(store.getters.isChildPanelOpenFor('PARENT-A', 0)).toBe(true)
    expect(store.getters.isChildPanelOpenFor('PARENT-A-CHILD', 1)).toBe(true)

    await store.dispatch('toggleLaneExpanded', { laneKey: 'alice' })
    expect(store.state.expandedLaneKeys).toEqual([])
    expect(store.getters.isChildPanelOpenFor('PARENT-A', 0)).toBe(false)
    expect(store.getters.isChildPanelOpenFor('PARENT-A-CHILD', 1)).toBe(false)
    expect(Object.keys(store.state.childPanels)).toEqual([])
  })

  test('toggleLaneExpanded collapse uses hostLaneKey for multi-lane duplicates', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      parent_field: 'parent_task',
      fields: ['name', 'subject', 'status', 'parent_task'],
      swimlane_field: '__assign',
      swimlane_mode: 'assign',
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'alice',
        label: 'Alice',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ name: 'PARENT-A', subject: 'Parent A' }] },
        ],
      },
      {
        key: 'bob',
        label: 'Bob',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ name: 'PARENT-A', subject: 'Parent A' }] },
        ],
      },
    ])
    store.commit('SET_EXPANDED_LANE_KEYS', ['alice', 'bob'])
    window.cur_list = {
      doctype: 'Task',
      board_name: 'Task Board',
      get_args: () => ({
        doctype: 'Task',
        fields: ['name', 'subject', 'status', 'parent_task'],
        filters: [],
        page_length: 100,
      }),
    }
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_child_column_totals') {
        return { message: { Open: 1, Done: 0 } }
      }
      if (method === 'quick_kanban.api.get_child_column_page') {
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [],
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('toggleChildPanel', {
      parentName: 'PARENT-A',
      depth: 0,
      laneKey: 'bob',
    })
    expect(store.getters.isChildPanelOpenFor('PARENT-A', 0)).toBe(true)
    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-A-CHILD', depth: 1 })
    expect(store.getters.isChildPanelOpenFor('PARENT-A-CHILD', 1)).toBe(true)

    // First lane in state is alice — must not close host-on-bob panel.
    await store.dispatch('toggleLaneExpanded', { laneKey: 'alice' })
    expect(store.state.expandedLaneKeys).toEqual(['bob'])
    expect(store.getters.isChildPanelOpenFor('PARENT-A', 0)).toBe(true)
    expect(store.getters.isChildPanelOpenFor('PARENT-A-CHILD', 1)).toBe(true)

    await store.dispatch('toggleLaneExpanded', { laneKey: 'bob' })
    expect(store.state.expandedLaneKeys).toEqual([])
    expect(store.getters.isChildPanelOpenFor('PARENT-A', 0)).toBe(false)
    expect(store.getters.isChildPanelOpenFor('PARENT-A-CHILD', 1)).toBe(false)
    expect(Object.keys(store.state.childPanels)).toEqual([])
  })

  test('toggleLaneExpanded expand keeps open ChildPanel for host lane', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      parent_field: 'parent_task',
      fields: ['name', 'subject', 'status', 'parent_task'],
      swimlane_field: 'project',
      swimlane_mode: 'field',
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'alice',
        label: 'Alice',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ name: 'PARENT-A' }] },
        ],
      },
    ])
    store.commit('SET_EXPANDED_LANE_KEYS', [])
    window.cur_list = {
      doctype: 'Task',
      board_name: 'Task Board',
      get_args: () => ({
        doctype: 'Task',
        fields: ['name', 'subject', 'status', 'parent_task'],
        filters: [],
        page_length: 100,
      }),
    }
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_child_column_totals') {
        return { message: { Open: 0 } }
      }
      if (method === 'quick_kanban.api.get_child_column_page') {
        return {
          message: { keys: ['name', 'subject', 'status'], values: [], user_info: {} },
        }
      }
      return { message: {} }
    })

    // Open panel while lane is collapsed is unusual; seed panel then expand.
    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-A', depth: 0 })
    expect(store.getters.isChildPanelOpenFor('PARENT-A', 0)).toBe(true)

    await store.dispatch('toggleLaneExpanded', { laneKey: 'alice' })
    expect(store.state.expandedLaneKeys).toEqual(['alice'])
    expect(store.getters.isChildPanelOpenFor('PARENT-A', 0)).toBe(true)
  })

  test('ensureLaneHydrated loads lane-wide then tops up cells; second call is no-op', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'status', 'subject'],
      swimlane_field: 'project',
      swimlane_mode: 'field',
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'proj-a',
        label: 'Proj A',
        columns: [
          { name: 'open', column_name: 'Open', cards: [] },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    store.commit('SET_CELL_PAGINATION', {
      'proj-a::Open': { offset: 0, hasMore: true, loading: false },
      'proj-a::Done': { offset: 0, hasMore: true, loading: false },
    })
    store.commit('SET_CELL_TOTALS', {
      'proj-a': { Open: 20, Done: 2 },
    })

    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'quick_kanban.api.get_swimlane_lane_page') {
        return {
          message: {
            keys: ['name', 'status', 'subject'],
            values: [
              ['T1', 'Open', 'One'],
              ['T2', 'Done', 'Two'],
            ],
          },
        }
      }
      if (method === 'quick_kanban.api.get_swimlane_column_page') {
        expect(args.column).toBe('Open')
        const start = Number(args.start) || 0
        const pageLength = Number(args.page_length) || 0
        const values = []
        for (let index = 0; index < pageLength; index += 1) {
          values.push([`TX-${start + index}`, 'Open', `Extra ${start + index}`])
        }
        return {
          message: {
            keys: ['name', 'status', 'subject'],
            values,
          },
        }
      }
      return { message: {} }
    })

    await store.dispatch('ensureLaneHydrated', { laneKey: 'proj-a' })

    const laneCalls = frappe.call.mock.calls.filter(
      ([payload]) => payload.method === 'quick_kanban.api.get_swimlane_lane_page',
    )
    expect(laneCalls).toHaveLength(1)
    expect(laneCalls[0][0].args.page_length).toBe(100)
    expect(laneCalls[0][0].args.board_name).toBe('Task Board')

    const openCards = store.state.lanes[0].columns[0].cards
    const doneCards = store.state.lanes[0].columns[1].cards
    expect(openCards.length).toBe(15)
    expect(doneCards.map((card) => card.name)).toEqual(['T2'])
    expect(store.state.laneHydration['proj-a']).toBe('ready')

    frappe.call.mockClear()
    await store.dispatch('ensureLaneHydrated', { laneKey: 'proj-a' })
    expect(frappe.call).not.toHaveBeenCalled()
  })

  test('registers user info from swimlane lane page before grouping cards', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'status', '_assign'],
      swimlane_field: 'project',
      swimlane_mode: 'field',
      pageSize: 20,
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'proj-a',
        label: 'Proj A',
        columns: [{ name: 'open', column_name: 'Open', cards: [] }],
      },
    ])
    store.commit('SET_CELL_TOTALS', { 'proj-a': { Open: 1 } })

    const userInfo = {
      'one@example.com': {
        fullname: 'One User',
        image: '/files/one.png',
      },
    }
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_swimlane_lane_page') {
        return {
          message: {
            keys: ['name', 'status', '_assign'],
            values: [['TASK-1', 'Open', '["one@example.com"]']],
            user_info: userInfo,
          },
        }
      }
      return { message: {} }
    })

    await store.dispatch('fetchLaneKanban', { laneKey: 'proj-a' })

    expect(frappe.update_user_info).toHaveBeenCalledWith(userInfo)
    expect(store.state.lanes[0].columns[0].cards[0]._assign).toEqual({
      'one@example.com': 'One User',
    })
  })

  test('refreshSwimlaneBoard hydrates expanded lanes only', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'status'],
      swimlane_field: 'project',
      swimlane_mode: 'field',
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    store.commit('SET_EXPANDED_LANE_KEYS', ['proj-a'])

    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'quick_kanban.api.get_swimlane_lanes') {
        return {
          message: [
            { key: 'proj-a', label: 'Proj A' },
            { key: 'proj-b', label: 'Proj B' },
          ],
        }
      }
      if (method === 'quick_kanban.api.get_cell_totals') {
        return { message: { 'proj-a': { Open: 1 }, 'proj-b': { Open: 1 } } }
      }
      if (method === 'quick_kanban.api.get_swimlane_lane_page') {
        expect(args.lane_key).toBe('proj-a')
        return {
          message: {
            keys: ['name', 'status'],
            values: [['TASK-1', 'Open']],
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      throw new Error(`Unexpected method ${method}`)
    })

    await store.dispatch('refreshSwimlaneBoard', { args: { filters: [] } })

    expect(store.state.lanes).toHaveLength(2)
    expect(store.state.lanes[0].columns[0].cards.map(({ name }) => name)).toEqual(['TASK-1'])
    expect(store.state.lanes[1].columns[0].cards).toEqual([])
    expect(store.state.laneHydration['proj-a']).toBe('ready')
    expect(store.state.laneHydration['proj-b']).toBeUndefined()
    const methods = frappe.call.mock.calls.map(([payload]) => payload.method)
    expect(methods).toContain('quick_kanban.api.get_swimlane_lane_page')
    expect(methods.filter((method) => method === 'quick_kanban.api.get_swimlane_lane_page')).toHaveLength(1)
  })

  test('refreshSwimlaneBoard prefetches user_info for assign lanes', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'status'],
      swimlane_field: '__assign',
      swimlane_mode: 'assign',
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])

    const userInfo = {
      'alice@example.com': {
        fullname: 'Alice',
        image: '/files/alice.jpg',
      },
    }

    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'quick_kanban.api.get_swimlane_lanes') {
        return {
          message: [
            { key: 'alice@example.com', label: 'Alice' },
            { key: '', label: 'Unassigned' },
          ],
        }
      }
      if (method === 'frappe.desk.form.load.get_user_info_for_viewers') {
        expect(JSON.parse(args.users)).toEqual(['alice@example.com'])
        return { message: userInfo }
      }
      if (method === 'quick_kanban.api.get_cell_totals') {
        return { message: {} }
      }
      throw new Error(`Unexpected method ${method}`)
    })

    await store.dispatch('refreshSwimlaneBoard', { args: { filters: [] } })

    expect(frappe.update_user_info).toHaveBeenCalledWith(userInfo)
    const methods = frappe.call.mock.calls.map(([payload]) => payload.method)
    expect(methods).toEqual([
      'quick_kanban.api.get_swimlane_lanes',
      'frappe.desk.form.load.get_user_info_for_viewers',
      'quick_kanban.api.get_cell_totals',
    ])
  })

  test('forEachCardInstance updates assignments across lanes', () => {
    const store = createStore()
    store.commit('SET_LANES', [
      {
        key: 'alice',
        label: 'Alice',
        columns: [
          {
            column_name: 'Open',
            cards: [{ name: 'TASK-1', _assign: { alice: 'Alice' } }],
          },
        ],
      },
      {
        key: 'bob',
        label: 'Bob',
        columns: [
          {
            column_name: 'Open',
            cards: [{ name: 'TASK-1', _assign: { alice: 'Alice', bob: 'Bob' } }],
          },
        ],
      },
    ])
    store.commit('UPDATE_CARD_ASSIGNMENTS', {
      cardName: 'TASK-1',
      assignments: { bob: 'Bob' },
    })
    expect(store.state.lanes[0].columns[0].cards[0]._assign).toEqual({ bob: 'Bob' })
    expect(store.state.lanes[1].columns[0].cards[0]._assign).toEqual({ bob: 'Bob' })
  })

  test('assign swimlane column move reconciles sibling copies into the new column', async () => {
    const store = createStore()
    frappe.model.can_write.mockReturnValue(true)
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      swimlane_mode: 'assign',
      swimlane_field: '__assign',
      swimlane_is_multi: true,
      swimlane_field_meta: null,
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    const card = {
      name: 'TASK-1',
      subject: 'One',
      status: 'Open',
      modified: '2026-01-01',
      _assign: { alice: 'Alice', bob: 'Bob' },
    }
    store.commit('SET_LANES', [
      {
        key: 'alice',
        label: 'Alice',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ ...card }] },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
      {
        key: 'bob',
        label: 'Bob',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ ...card }] },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    seedMoveOptions(store, ['TASK-1'])
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.move_card_to_cell') {
        return {
          message: {
            name: 'TASK-1',
            status: 'Done',
            modified: '2026-01-02',
            _assign: JSON.stringify(['alice', 'bob']),
          },
        }
      }
      return { message: {} }
    })

    const result = await store.dispatch('persistMovedCardToCell', {
      cardName: 'TASK-1',
      fromLaneIndex: 0,
      toLaneIndex: 0,
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(result.ok).toBe(true)
    expect(store.state.lanes[0].columns[0].cards).toEqual([])
    expect(store.state.lanes[0].columns[1].cards.map(({ name }) => name)).toEqual(['TASK-1'])
    expect(store.state.lanes[1].columns[0].cards).toEqual([])
    expect(store.state.lanes[1].columns[1].cards.map(({ name }) => name)).toEqual(['TASK-1'])
    expect(store.state.lanes[1].columns[1].cards[0].status).toBe('Done')
  })

  test('assign swimlane lane move prunes source and keeps other membership lanes', async () => {
    const store = createStore()
    frappe.model.can_write.mockReturnValue(true)
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      swimlane_mode: 'assign',
      swimlane_field: '__assign',
      swimlane_is_multi: true,
      swimlane_field_meta: null,
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    const card = {
      name: 'TASK-1',
      subject: 'One',
      status: 'Open',
      modified: '2026-01-01',
      _assign: { alice: 'Alice', charlie: 'Charlie' },
    }
    store.commit('SET_LANES', [
      {
        key: 'alice',
        label: 'Alice',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ ...card }] },
        ],
      },
      {
        key: 'bob',
        label: 'Bob',
        columns: [
          { name: 'open', column_name: 'Open', cards: [] },
        ],
      },
      {
        key: 'charlie',
        label: 'Charlie',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ ...card }] },
        ],
      },
    ])
    store.commit('SET_CELL_PAGINATION', {
      'alice::Open': { offset: 1, hasMore: false, loading: false },
      'bob::Open': { offset: 0, hasMore: false, loading: false },
      'charlie::Open': { offset: 1, hasMore: false, loading: false },
    })
    store.commit('SET_LANE_HYDRATION', { laneKey: 'bob', status: 'idle' })
    seedMoveOptions(store, ['TASK-1'])

    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.move_card_to_cell') {
        return {
          message: {
            name: 'TASK-1',
            status: 'Open',
            modified: '2026-01-02',
            _assign: JSON.stringify(['bob', 'charlie']),
          },
        }
      }
      if (method === 'quick_kanban.api.get_swimlane_lane_page') {
        return {
          message: {
            keys: ['name', 'subject', 'status', '_assign'],
            values: [
              ['TASK-1', 'One', 'Open', JSON.stringify(['bob', 'charlie'])],
            ],
          },
        }
      }
      if (method === 'quick_kanban.api.get_cell_totals') {
        return {
          message: {
            alice: { Open: 0 },
            bob: { Open: 1 },
            charlie: { Open: 1 },
          },
        }
      }
      return { message: {} }
    })

    store.commit('MOVE_CARD_CELL', {
      cardName: 'TASK-1',
      fromLaneIndex: 0,
      toLaneIndex: 1,
      fromColumn: 0,
      toColumn: 0,
      fromIndex: 0,
      toIndex: 0,
    })
    expect(store.state.lanes[0].columns[0].cards.map(({ name }) => name)).toEqual([])
    expect(store.state.lanes[1].columns[0].cards.map(({ name }) => name)).toEqual(['TASK-1'])

    const result = await store.dispatch('persistMovedCardToCell', {
      cardName: 'TASK-1',
      fromLaneIndex: 0,
      toLaneIndex: 1,
      fromColumn: 0,
      toColumn: 0,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(result.ok).toBe(true)
    const byKey = Object.fromEntries(
      store.state.lanes.map((lane) => [
        lane.key,
        lane.columns[0].cards.map(({ name, _assign }) => ({ name, _assign })),
      ]),
    )
    expect(byKey.alice).toEqual([])
    expect(byKey.bob).toEqual([{
      name: 'TASK-1',
      _assign: { bob: 'bob', charlie: 'charlie' },
    }])
    expect(byKey.charlie).toEqual([{
      name: 'TASK-1',
      _assign: { bob: 'bob', charlie: 'charlie' },
    }])
  })

  test('refreshCard prunes lanes after assignment shrinks membership', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      swimlane_mode: 'assign',
      swimlane_field: '__assign',
      swimlane_is_multi: true,
      highlight_table: [],
    })
    const card = {
      name: 'TASK-1',
      status: 'Open',
      _assign: { alice: 'Alice', bob: 'Bob' },
    }
    store.commit('SET_LANES', [
      {
        key: 'alice',
        columns: [{ column_name: 'Open', cards: [{ ...card }] }],
      },
      {
        key: 'bob',
        columns: [{ column_name: 'Open', cards: [{ ...card }] }],
      },
    ])
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'frappe.client.get_value') {
        return { message: { _assign: JSON.stringify(['bob']) } }
      }
      if (method === 'frappe.desk.form.load.get_user_info_for_viewers') {
        return { message: { bob: { fullname: 'Bob' } } }
      }
      return { message: {} }
    })

    await store.dispatch('refreshCard', { cardName: 'TASK-1' })

    expect(store.state.lanes[0].columns[0].cards).toEqual([])
    expect(store.state.lanes[1].columns[0].cards).toHaveLength(1)
    expect(store.state.lanes[1].columns[0].cards[0]._assign).toEqual({ bob: 'Bob' })
  })

  test('moveCard uses fromLaneIndex when the same card exists in multiple lanes', async () => {
    const store = createStore()
    frappe.model.can_write.mockReturnValue(true)
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      title_field: 'subject',
      fields: ['name', 'subject', 'status'],
      swimlane_mode: 'assign',
      swimlane_field: '__assign',
      swimlane_is_multi: true,
      swimlane_field_meta: null,
      highlight_table: [],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    const card = {
      name: 'TASK-1',
      subject: 'One',
      status: 'Open',
      modified: '2026-01-01',
      _assign: { alice: 'Alice', bob: 'Bob' },
    }
    store.commit('SET_LANES', [
      {
        key: 'alice',
        label: 'Alice',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ ...card }] },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
      {
        key: 'bob',
        label: 'Bob',
        columns: [
          { name: 'open', column_name: 'Open', cards: [{ ...card }] },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    seedMoveOptions(store, ['TASK-1'])
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.move_card_to_cell') {
        return {
          message: {
            name: 'TASK-1',
            status: 'Done',
            modified: '2026-01-02',
            _assign: JSON.stringify(['alice', 'bob']),
          },
        }
      }
      return { message: {} }
    })

    const moved = await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
      fromLaneIndex: 1,
    })

    expect(moved).toBe(true)
    // Optimistic source was bob; after reconcile both lanes show Done.
    expect(store.state.lanes[0].columns[1].cards.map(({ name }) => name)).toEqual(['TASK-1'])
    expect(store.state.lanes[1].columns[1].cards.map(({ name }) => name)).toEqual(['TASK-1'])
    expect(store.state.lanes[0].columns[0].cards).toEqual([])
    expect(store.state.lanes[1].columns[0].cards).toEqual([])
  })

  test('loadCellPage fills cards and bumps dragSyncGeneration for VirtualList remount', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'status', 'subject'],
      swimlane_field: 'project',
      swimlane_mode: 'field',
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'PL-RACE-TEST-2026',
        label: 'PL-RACE-TEST-2026',
        columns: [{ name: 'open', column_name: 'Open', cards: [] }],
      },
    ])
    store.commit('SET_CELL_PAGINATION', {
      'PL-RACE-TEST-2026::Open': { offset: 0, hasMore: true, loading: false },
    })
    store.commit('SET_CELL_TOTALS', {
      'PL-RACE-TEST-2026': { Open: 2 },
    })
    const before = store.state.dragSyncGeneration
    frappe.call.mockResolvedValueOnce({
      message: {
        keys: ['name', 'status', 'subject'],
        values: [
          ['TASK-1', 'Open', 'One'],
          ['TASK-2', 'Open', 'Two'],
        ],
      },
    })

    await store.dispatch('loadCellPage', {
      laneIndex: 0,
      columnIndex: 0,
      reset: true,
      pageSize: 30,
    })

    expect(store.state.lanes[0].columns[0].cards.map((card) => card.name)).toEqual([
      'TASK-1',
      'TASK-2',
    ])
    expect(store.state.dragSyncGeneration).toBe(before + 1)
  })

  test('loadCellPage append does not bump dragSyncGeneration', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'status', 'subject'],
      swimlane_field: 'project',
      swimlane_mode: 'field',
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'PL-APPEND-TEST',
        label: 'PL-APPEND-TEST',
        columns: [{
          name: 'open',
          column_name: 'Open',
          cards: [{ name: 'TASK-1', status: 'Open', subject: 'One' }],
        }],
      },
    ])
    store.commit('SET_CELL_PAGINATION', {
      'PL-APPEND-TEST::Open': { offset: 1, hasMore: true, loading: false },
    })
    store.commit('SET_CELL_TOTALS', {
      'PL-APPEND-TEST': { Open: 3 },
    })
    const before = store.state.dragSyncGeneration
    frappe.call.mockResolvedValueOnce({
      message: {
        keys: ['name', 'status', 'subject'],
        values: [
          ['TASK-2', 'Open', 'Two'],
          ['TASK-3', 'Open', 'Three'],
        ],
      },
    })

    await store.dispatch('loadCellPage', {
      laneIndex: 0,
      columnIndex: 0,
      pageSize: 30,
    })

    expect(store.state.lanes[0].columns[0].cards.map((card) => card.name)).toEqual([
      'TASK-1',
      'TASK-2',
      'TASK-3',
    ])
    expect(store.state.dragSyncGeneration).toBe(before)
  })
})

describe('show child tasks visibility', () => {
  const treeMeta = {
    title_field: 'subject',
    is_tree: 1,
    nsm_parent_field: 'parent_task',
    fields: [
      { fieldname: 'subject', fieldtype: 'Data' },
      { fieldname: 'status', fieldtype: 'Select' },
      { fieldname: 'parent_task', fieldtype: 'Link' },
    ],
  }

  test('hydrateFromList hides children whose parent is on the board by default', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue(treeMeta)
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_board_document_names') {
        return { message: ['PARENT-1', 'CHILD-1'] }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      if (method === 'quick_kanban.api.get_create_options') {
        return { message: { Open: { allowed: true, form_mode: 'quick_entry' } } }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: { 'PARENT-1': 1 } }
      }
      return { message: {} }
    })

    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [
        { name: 'PARENT-1', subject: 'Parent', status: 'Open', parent_task: '' },
        { name: 'CHILD-1', subject: 'Child', status: 'Open', parent_task: 'PARENT-1' },
        { name: 'ORPHAN-1', subject: 'Orphan', status: 'Open', parent_task: 'OFF-BOARD' },
      ],
      args: { page_length: 100, filters: [] },
    })

    expect(store.state.config.parent_field).toBe('parent_task')
    expect(store.state.show_child_tasks).toBe(false)
    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'PARENT-1',
      'ORPHAN-1',
    ])
  })

  test('hydrateFromList keeps children when show_child_tasks is enabled', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue(treeMeta)
    store.commit('SET_SHOW_CHILD_TASKS', true)
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      if (method === 'quick_kanban.api.get_create_options') {
        return { message: { Open: { allowed: true, form_mode: 'quick_entry' } } }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [
        { name: 'PARENT-1', subject: 'Parent', status: 'Open', parent_task: '' },
        { name: 'CHILD-1', subject: 'Child', status: 'Open', parent_task: 'PARENT-1' },
      ],
      args: { page_length: 100 },
    })

    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'PARENT-1',
      'CHILD-1',
    ])
    expect(frappe.call.mock.calls.some(
      ([request]) => request.method === 'quick_kanban.api.get_board_document_names',
    )).toBe(false)
  })

  test('fetchKanban requests parent_task and hides on-board children', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue(treeMeta)
    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'frappe.client.get') {
        return { message: boardDocument }
      }
      if (method === 'quick_kanban.api.get_create_options') {
        return { message: { Open: { allowed: true, form_mode: 'quick_entry' } } }
      }
      if (method === 'quick_kanban.api.get_board_document_names') {
        return { message: ['PARENT-1', 'CHILD-1'] }
      }
      if (method === 'quick_kanban.api.get_hidden_board_child_names') {
        return { message: ['CHILD-1'] }
      }
      if (method === 'quick_kanban.api.get_column_page') {
        expect(args.hide_board_children).toBe(true)
        expect(args.fields).toEqual(expect.arrayContaining(['parent_task']))
        if (args.column !== 'Open') {
          return { message: { keys: ['name', 'subject', 'status', 'parent_task'], values: [], user_info: {} } }
        }
        // Server already excluded on-board children.
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [
              ['PARENT-1', 'Parent', 'Open', ''],
              ['ORPHAN-1', 'Orphan', 'Open', 'OFF-BOARD'],
            ],
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    await store.dispatch('fetchKanban', {
      args: { fields: ['name', 'subject', 'status'], page_length: 100 },
    })

    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'PARENT-1',
      'ORPHAN-1',
    ])
  })

  test('loadCellPage hydrates board names before hiding children', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue(treeMeta)
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      parent_field: 'parent_task',
      title_field: 'subject',
      fields: ['name', 'subject', 'status', 'parent_task'],
      swimlane_field: '__assign',
      swimlane_mode: 'assign',
      highlight_table: [],
    })
    store.commit('SET_SHOW_CHILD_TASKS', false)
    store.commit('SET_BOARD_DOCUMENT_NAMES', [])
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'user@example.com',
        label: 'User',
        columns: [
          { name: 'open', column_name: 'Open', cards: [] },
          { name: 'done', column_name: 'Done', cards: [] },
        ],
      },
    ])
    store.commit('SET_CELL_PAGINATION', {
      'user@example.com::Open': { offset: 0, hasMore: true, loading: false },
    })
    store.commit('SET_CELL_TOTALS', {
      'user@example.com': { Open: 3 },
    })

    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_board_document_names') {
        return { message: ['PARENT-1', 'CHILD-1'] }
      }
      if (method === 'quick_kanban.api.get_swimlane_column_page') {
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [
              ['PARENT-1', 'Parent', 'Open', ''],
              ['CHILD-1', 'Child', 'Open', 'PARENT-1'],
              ['ORPHAN-1', 'Orphan', 'Open', 'OFF-BOARD'],
            ],
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('loadCellPage', {
      laneIndex: 0,
      columnIndex: 0,
      pageSize: 30,
    })

    expect(store.state.boardDocumentNames).toEqual(['PARENT-1', 'CHILD-1'])
    expect(store.state.lanes[0].columns[0].cards.map(({ name }) => name)).toEqual([
      'PARENT-1',
      'ORPHAN-1',
    ])
  })

  test('refreshBoard without payload reuses current board and hides children', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue(treeMeta)
    window.cur_list = {
      doctype: 'Task',
      board_name: 'Task Board',
      get_args: () => ({
        doctype: 'Task',
        fields: ['name', 'subject', 'status'],
        filters: [],
        page_length: 100,
      }),
    }
    const getCalls = []
    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'frappe.client.get') {
        getCalls.push(args.name)
        return { message: boardDocument }
      }
      if (method === 'quick_kanban.api.get_create_options') {
        return { message: { Open: { allowed: true, form_mode: 'quick_entry' } } }
      }
      if (method === 'quick_kanban.api.get_board_document_names') {
        return { message: ['PARENT-1', 'CHILD-1'] }
      }
      if (method === 'quick_kanban.api.get_hidden_board_child_names') {
        return { message: ['CHILD-1'] }
      }
      if (method === 'quick_kanban.api.get_column_page') {
        expect(args.hide_board_children).toBe(true)
        if (args.column !== 'Open') {
          return {
            message: {
              keys: ['name', 'subject', 'status', 'parent_task'],
              values: [],
              user_info: {},
            },
          }
        }
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [
              ['PARENT-1', 'Parent', 'Open', ''],
            ],
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_column_totals') {
        return { message: { Open: 2, Done: 0 } }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    getCalls.length = 0
    store.commit('SET_SHOW_CHILD_TASKS', false)

    await expect(store.dispatch('refreshBoard')).resolves.toBeUndefined()

    expect(getCalls).toEqual([])
    expect(store.state.config.board_name).toBe('Task Board')
    expect(store.state.show_child_tasks).toBe(false)
    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual(['PARENT-1'])
  })

  test('toggling show_child_tasks via refreshBoard without payload shows children', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue(treeMeta)
    window.cur_list = {
      doctype: 'Task',
      board_name: 'Task Board',
      get_args: () => ({
        doctype: 'Task',
        fields: ['name', 'subject', 'status'],
        filters: [],
        page_length: 100,
      }),
    }
    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'frappe.client.get') {
        return { message: boardDocument }
      }
      if (method === 'quick_kanban.api.get_create_options') {
        return { message: { Open: { allowed: true, form_mode: 'quick_entry' } } }
      }
      if (method === 'quick_kanban.api.get_board_document_names') {
        return { message: ['PARENT-1', 'CHILD-1'] }
      }
      if (method === 'quick_kanban.api.get_hidden_board_child_names') {
        return { message: ['CHILD-1'] }
      }
      if (method === 'quick_kanban.api.get_column_page') {
        if (args.column !== 'Open') {
          return {
            message: {
              keys: ['name', 'subject', 'status', 'parent_task'],
              values: [],
              user_info: {},
            },
          }
        }
        const values = args.hide_board_children
          ? [['PARENT-1', 'Parent', 'Open', '']]
          : [
              ['PARENT-1', 'Parent', 'Open', ''],
              ['CHILD-1', 'Child', 'Open', 'PARENT-1'],
            ]
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values,
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_column_totals') {
        return {
          message: args.hide_board_children
            ? { Open: 1, Done: 0 }
            : { Open: 2, Done: 0 },
        }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    store.commit('SET_SHOW_CHILD_TASKS', false)
    await store.dispatch('refreshBoard')
    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual(['PARENT-1'])

    store.commit('SET_SHOW_CHILD_TASKS', true)
    await store.dispatch('refreshBoard')
    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'PARENT-1',
      'CHILD-1',
    ])
  })

  test('swimlane refreshBoard without payload refills expanded lane and filters children', async () => {
    const store = createStore()
    frappe.get_meta.mockReturnValue(treeMeta)
    window.cur_list = {
      doctype: 'Task',
      board_name: 'Task Board',
      get_args: () => ({
        doctype: 'Task',
        fields: ['name', 'subject', 'status', 'parent_task'],
        filters: [],
        page_length: 100,
      }),
    }
    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'frappe.client.get') {
        return {
          message: {
            ...boardDocument,
            custom_swimlane_field: '__assign',
          },
        }
      }
      if (method === 'quick_kanban.api.get_create_options') {
        return { message: { Open: { allowed: true, form_mode: 'quick_entry' } } }
      }
      if (method === 'quick_kanban.api.get_swimlane_lanes') {
        return { message: [{ key: 'alice@example.com', label: 'Alice' }] }
      }
      if (method === 'frappe.desk.form.load.get_user_info_for_viewers') {
        return { message: {} }
      }
      if (method === 'quick_kanban.api.get_cell_totals') {
        return { message: { 'alice@example.com': { Open: 2, Done: 0 } } }
      }
      if (method === 'quick_kanban.api.get_board_document_names') {
        return { message: ['PARENT-1', 'CHILD-1'] }
      }
      if (method === 'quick_kanban.api.get_swimlane_lane_page') {
        expect(args.lane_key).toBe('alice@example.com')
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [
              ['PARENT-1', 'Parent', 'Open', ''],
              ['CHILD-1', 'Child', 'Open', 'PARENT-1'],
            ],
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_move_options') {
        return { message: {} }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    store.commit('SET_SHOW_CHILD_TASKS', false)
    store.commit('SET_EXPANDED_LANE_KEYS', ['alice@example.com'])

    await store.dispatch('refreshBoard')

    expect(store.state.lanes[0].columns[0].cards.map(({ name }) => name)).toEqual([
      'PARENT-1',
    ])
    expect(store.state.laneHydration['alice@example.com']).toBe('ready')

    store.commit('SET_SHOW_CHILD_TASKS', true)
    await store.dispatch('refreshBoard')
    expect(store.state.lanes[0].columns[0].cards.map(({ name }) => name)).toEqual([
      'PARENT-1',
      'CHILD-1',
    ])
  })

  test('toggleChildPanel opens one panel per depth and replaces sibling', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      parent_field: 'parent_task',
      fields: ['name', 'subject', 'status', 'parent_task'],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    window.cur_list = {
      doctype: 'Task',
      board_name: 'Task Board',
      get_args: () => ({
        doctype: 'Task',
        fields: ['name', 'subject', 'status', 'parent_task'],
        filters: [],
        page_length: 100,
      }),
    }
    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'quick_kanban.api.get_child_column_totals') {
        return { message: { Open: 1, Done: 0 } }
      }
      if (method === 'quick_kanban.api.get_child_column_page') {
        expect(args.parent_name).toBeTruthy()
        expect(args.hide_board_children).toBeUndefined()
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: args.column === 'Open'
              ? [[`${args.parent_name}-CHILD`, 'Child', 'Open', args.parent_name]]
              : [],
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-A', depth: 0 })
    expect(store.getters.isChildPanelOpenFor('PARENT-A', 0)).toBe(true)
    const scopeA = store.getters.getChildPanelScopeId('PARENT-A', 0)
    expect(store.state.childPanels[scopeA].columns[0].cards[0].name).toBe('PARENT-A-CHILD')

    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-B', depth: 0 })
    expect(store.getters.isChildPanelOpenFor('PARENT-A', 0)).toBe(false)
    expect(store.getters.isChildPanelOpenFor('PARENT-B', 0)).toBe(true)

    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-B-CHILD', depth: 1 })
    expect(store.getters.isChildPanelOpenFor('PARENT-B', 0)).toBe(true)
    expect(store.getters.isChildPanelOpenFor('PARENT-B-CHILD', 1)).toBe(true)

    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-B', depth: 0 })
    expect(store.getters.isChildPanelOpenFor('PARENT-B', 0)).toBe(false)
    expect(store.getters.isChildPanelOpenFor('PARENT-B-CHILD', 1)).toBe(false)
  })

  test('toggleChildPanel hydrates all columns with first page + top-up, not full drain', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      parent_field: 'parent_task',
      fields: ['name', 'subject', 'status', 'parent_task'],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    // Smaller first page so top-up to 15 needs a second request (like flat top-up).
    store.state.columnPageSize = 10
    window.cur_list = {
      doctype: 'Task',
      board_name: 'Task Board',
      get_args: () => ({
        doctype: 'Task',
        fields: ['name', 'subject', 'status', 'parent_task'],
        filters: [],
        page_length: 100,
      }),
    }
    const openTotal = 40
    const pageCalls = []
    frappe.call.mockImplementation(async ({ method, args }) => {
      if (method === 'quick_kanban.api.get_child_column_totals') {
        return { message: { Open: openTotal, Done: 2 } }
      }
      if (method === 'quick_kanban.api.get_child_column_page') {
        pageCalls.push({
          column: args.column,
          start: args.start,
          page_length: args.page_length,
        })
        const start = Number(args.start) || 0
        const length = Number(args.page_length) || 10
        const total = args.column === 'Open' ? openTotal : 2
        const count = Math.max(0, Math.min(length, total - start))
        const values = Array.from({ length: count }, (_, index) => ([
          `${args.parent_name}-${args.column}-${start + index + 1}`,
          `${args.column} ${start + index + 1}`,
          args.column,
          args.parent_name,
        ]))
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values,
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-A', depth: 0 })
    const scopeId = store.getters.getChildPanelScopeId('PARENT-A', 0)
    const panel = store.state.childPanels[scopeId]
    const openCards = panel.columns[0].cards
    const doneCards = panel.columns[1].cards
    const openPagination = panel.columnPagination.Open
    const donePagination = panel.columnPagination.Done

    expect(openCards).toHaveLength(15)
    expect(doneCards).toHaveLength(2)
    expect(openPagination.hasMore).toBe(true)
    expect(openPagination.offset).toBe(15)
    expect(donePagination.hasMore).toBe(false)
    expect(pageCalls.filter((call) => call.column === 'Open').length).toBe(2)
    const firstOpenIdx = pageCalls.findIndex((call) => call.column === 'Open' && call.start === 0)
    const firstDoneIdx = pageCalls.findIndex((call) => call.column === 'Done' && call.start === 0)
    const openTopUpIdx = pageCalls.findIndex((call) => call.column === 'Open' && call.start > 0)
    // First pages for every column are issued together before any top-up page.
    expect(firstOpenIdx).toBeGreaterThanOrEqual(0)
    expect(firstDoneIdx).toBeGreaterThanOrEqual(0)
    expect(openTopUpIdx).toBeGreaterThan(Math.max(firstOpenIdx, firstDoneIdx))

    await store.dispatch('loadChildColumnPage', { scopeId, columnIndex: 0 })
    expect(store.state.childPanels[scopeId].columns[0].cards.length).toBeGreaterThan(15)
    expect(store.state.childPanels[scopeId].columns[0].cards.length).toBeLessThan(openTotal)
  })

  test('getCardChildPanelMode: deepest panel active, ancestors semi-active, others inert', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      parent_field: 'parent_task',
      fields: ['name', 'subject', 'status', 'parent_task'],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
      { name: 'done', column_name: 'Done', cards: [] },
    ])
    window.cur_list = {
      doctype: 'Task',
      board_name: 'Task Board',
      get_args: () => ({
        doctype: 'Task',
        fields: ['name', 'subject', 'status', 'parent_task'],
        filters: [],
        page_length: 100,
      }),
    }
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_child_column_totals') {
        return { message: { Open: 1, Done: 0 } }
      }
      if (method === 'quick_kanban.api.get_child_column_page') {
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [],
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    expect(store.getters.maxOpenChildPanelDepth).toBeNull()
    expect(store.getters.getCardChildPanelMode('BOARD-1', 0)).toBe('active')

    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-A', depth: 0 })
    expect(store.getters.maxOpenChildPanelDepth).toBe(0)
    expect(store.getters.getCardChildPanelMode('PARENT-A', 0)).toBe('ancestor')
    expect(store.getters.getCardChildPanelMode('BOARD-OTHER', 0)).toBe('inert')
    expect(store.getters.getCardChildPanelMode('PARENT-A-CHILD', 1)).toBe('active')
    expect(store.getters.getCardChildPanelMode('OTHER-CHILD', 1)).toBe('active')

    await store.dispatch('toggleChildPanel', { parentName: 'PARENT-A-CHILD', depth: 1 })
    expect(store.getters.maxOpenChildPanelDepth).toBe(1)
    expect(store.getters.childPanelAncestorNames.has('PARENT-A')).toBe(true)
    expect(store.getters.childPanelAncestorNames.has('PARENT-A-CHILD')).toBe(true)
    expect(store.getters.getCardChildPanelMode('PARENT-A', 0)).toBe('ancestor')
    expect(store.getters.getCardChildPanelMode('PARENT-A-CHILD', 1)).toBe('ancestor')
    expect(store.getters.getCardChildPanelMode('SIBLING-IN-DEPTH0', 1)).toBe('inert')
    expect(store.getters.getCardChildPanelMode('BOARD-OTHER', 0)).toBe('inert')
    expect(store.getters.getCardChildPanelMode('NESTED-CHILD', 2)).toBe('active')
  })

  test('getCardChildPanelMode: swimlane non-host duplicates are inert', async () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      parent_field: 'parent_task',
      fields: ['name', 'subject', 'status', 'parent_task'],
      swimlane_mode: 'assign',
      swimlane_field: '__assign',
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    window.cur_list = {
      doctype: 'Task',
      board_name: 'Task Board',
      get_args: () => ({
        doctype: 'Task',
        fields: ['name', 'subject', 'status', 'parent_task'],
        filters: [],
        page_length: 100,
      }),
    }
    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_child_column_totals') {
        return { message: { Open: 0 } }
      }
      if (method === 'quick_kanban.api.get_child_column_page') {
        return {
          message: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [],
            user_info: {},
          },
        }
      }
      if (method === 'quick_kanban.api.get_child_counts') {
        return { message: {} }
      }
      return { message: {} }
    })

    await store.dispatch('toggleChildPanel', {
      parentName: 'PARENT-A',
      depth: 0,
      laneKey: 'alice',
    })
    expect(store.getters.isChildPanelHostFor('PARENT-A', 0, 'alice')).toBe(true)
    expect(store.getters.isChildPanelHostFor('PARENT-A', 0, 'bob')).toBe(false)
    expect(store.getters.getCardChildPanelMode('PARENT-A', 0, 'alice')).toBe('ancestor')
    expect(store.getters.getCardChildPanelMode('PARENT-A', 0, 'bob')).toBe('inert')
    // Without laneKey, keep ancestor (flat / legacy callers).
    expect(store.getters.getCardChildPanelMode('PARENT-A', 0)).toBe('ancestor')
  })
})

describe('live deadline highlight on field update', () => {
  test('UPDATE_CARD_FIELD refreshes _deadline_bucket from new date', () => {
    const store = createStore()
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      deadline_field: 'exp_end_date',
      deadline_enabled: true,
      deadline_attention_days: 3,
      deadline_columns: ['Open', 'Working'],
      display_fields: [{ fieldname: 'exp_end_date', fieldtype: 'Date' }],
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        cards: [{
          name: 'TASK-D',
          status: 'Open',
          exp_end_date: '2026-07-27',
          _deadline_bucket: 'attention',
        }],
      },
    ])

    store.commit('UPDATE_CARD_FIELD', {
      cardName: 'TASK-D',
      fieldname: 'exp_end_date',
      value: '2026-12-31',
    })

    const card = store.state.columns[0].cards[0]
    expect(card.exp_end_date).toBe('2026-12-31')
    expect(card._deadline_bucket).toBe('planned')

    store.commit('UPDATE_CARD_FIELD', {
      cardName: 'TASK-D',
      fieldname: 'exp_end_date',
      value: null,
    })
    expect(store.state.columns[0].cards[0]._deadline_bucket).toBe('none')
  })
})

describe('deadline swimlane relocate on date change', () => {
  function seedDeadlineLanes(store) {
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      deadline_field: 'exp_end_date',
      deadline_enabled: true,
      deadline_attention_days: 3,
      deadline_columns: ['Open', 'Working'],
      swimlane_mode: 'deadlines',
      swimlane_field: '__deadlines',
      display_fields: [{ fieldname: 'exp_end_date', fieldtype: 'Date' }],
    })
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'attention',
        label: 'Approaching',
        columns: [
          {
            name: 'open',
            column_name: 'Open',
            cards: [{
              name: 'TASK-D',
              status: 'Open',
              exp_end_date: '2026-07-27',
              _deadline_bucket: 'attention',
            }],
          },
        ],
      },
      {
        key: 'planned',
        label: 'On Track',
        columns: [
          { name: 'open', column_name: 'Open', cards: [] },
        ],
      },
    ])
    store.commit('SET_EXPANDED_LANE_KEYS', ['attention'])
    store.commit('SET_LANE_HYDRATION', { laneKey: 'attention', status: 'ready' })
    store.commit('SET_LANE_HYDRATION', { laneKey: 'planned', status: 'idle' })
  }

  test('relocateDeadlineSwimlaneCard moves card to planned top and reveals', async () => {
    const store = createStore()
    seedDeadlineLanes(store)

    frappe.call.mockImplementation(async ({ method }) => {
      if (method === 'quick_kanban.api.get_swimlane_lane_page') {
        return {
          message: {
            keys: ['name', 'status', 'exp_end_date', '_deadline_bucket'],
            values: [],
          },
        }
      }
      if (method === 'quick_kanban.api.get_cell_totals') {
        return { message: {} }
      }
      return { message: {} }
    })

    store.commit('UPDATE_CARD_FIELD', {
      cardName: 'TASK-D',
      fieldname: 'exp_end_date',
      value: '2026-12-31',
    })
    expect(store.state.lanes[0].columns[0].cards[0]._deadline_bucket).toBe('planned')

    const moved = await store.dispatch('relocateDeadlineSwimlaneCard', {
      cardName: 'TASK-D',
    })
    expect(moved).toBe(true)
    expect(store.state.expandedLaneKeys).toContain('planned')
    expect(store.state.lanes[0].columns[0].cards.map((c) => c.name)).not.toContain('TASK-D')
    expect(store.state.lanes[1].columns[0].cards[0]?.name).toBe('TASK-D')
    expect(store.state.lanes[1].columns[0].cards[0]?._deadline_bucket).toBe('planned')
    expect(store.state.revealCreatedCard).toEqual({
      cardName: 'TASK-D',
      laneIndex: 1,
      columnIndex: 0,
      cardIndex: 0,
      flash: true,
    })
  })

  test('relocateDeadlineSwimlaneCard no-ops when lane unchanged', async () => {
    const store = createStore()
    seedDeadlineLanes(store)
    store.commit('UPDATE_CARD_FIELD', {
      cardName: 'TASK-D',
      fieldname: 'exp_end_date',
      value: '2026-07-26',
    })
    // Without holidays both stay attention if within 3 days from "today" — force bucket
    store.state.lanes[0].columns[0].cards[0]._deadline_bucket = 'attention'

    const moved = await store.dispatch('relocateDeadlineSwimlaneCard', {
      cardName: 'TASK-D',
    })
    expect(moved).toBe(false)
    expect(store.state.revealCreatedCard).toBeNull()
    expect(store.state.lanes[0].columns[0].cards[0]?.name).toBe('TASK-D')
  })
})
