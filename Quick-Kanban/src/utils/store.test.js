import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createKanbanStore } from './store'

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

function createStore() {
  frappe.get_meta.mockReturnValue({ title_field: 'subject' })
  return createKanbanStore()
}

beforeEach(() => {
  frappe.call.mockReset()
  frappe.get_meta.mockReset()
  frappe.show_alert.mockReset()
  frappe.update_user_info.mockClear()
  frappe.avatar_group.mockClear()
  frappe.boot.user_info = {}
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

    expect(frappe.call).not.toHaveBeenCalled()
    expect(store.state.config.board_name).toBe('Task Board')
    expect(store.state.columns[0].cards[0]._assign).toEqual({
      'one@example.com': 'one@example.com',
    })
    expect(store.state.columnPagination.open.offset).toBe(1)
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

    expect(store.state.columnPagination.open).toEqual({
      offset: 2,
      loading: false,
      hasMore: true,
    })
    expect(store.state.columnPagination.done).toEqual({
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
    store.commit('SET_COLUMN_TOTALS', { open: 31, done: 1 })
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
      method: 'frappe.desk.reportview.get',
      args: {
        doctype: 'Task',
        filters: [
          ['priority', '=', 'High'],
          ['Task', 'status', '=', 'Open'],
        ],
        start: 1,
        page_length: 30,
      },
    })
    expect(store.state.columns[0].cards.map(({ name }) => name)).toEqual([
      'TASK-1',
      'TASK-3',
    ])
    expect(store.state.columns[1].cards.map(({ name }) => name)).toEqual([
      'TASK-2',
    ])
    expect(store.state.columnPagination.open).toEqual({
      offset: 3,
      loading: false,
      hasMore: false,
    })
    expect(store.state.columnTotals).toEqual({ open: 31, done: 1 })
    expect(frappe.update_user_info).toHaveBeenCalledWith({})
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
      },
    })
    expect(frappe.call).toHaveBeenCalledTimes(1)
    expect(store.state.columnTotals).toEqual({ open: 51, done: 12 })
  })

  test('enables pagination when totals reveal more cards in a hydrated column', async () => {
    const store = createStore()
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [{ name: 'TASK-1', subject: 'First', status: 'Open' }],
      args: { page_length: 100 },
    })

    store.commit('SET_COLUMN_TOTALS', { open: 51, done: 0 })

    expect(store.state.columnPagination.open.hasMore).toBe(true)
    expect(store.state.columnPagination.done.hasMore).toBe(false)
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
    store.commit('SET_COLUMN_TOTALS', { open: 40, done: 18 })
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
      method: 'frappe.desk.reportview.get',
      args: {
        doctype: 'Task',
        filters: [
          ['priority', '=', 'High'],
          ['Task', 'status', '=', 'Done'],
        ],
        or_filters: [['owner', '=', 'user@example.com']],
        start: 5,
        page_length: 10,
      },
    })
  })

  test('loads all available cards when a column total is below the minimum', async () => {
    const store = createStore()
    await store.dispatch('hydrateFromList', {
      board: boardDocument,
      cards: [],
      args: { page_length: 100 },
    })
    store.commit('SET_COLUMN_TOTALS', { open: 3, done: 0 })
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
    store.commit('SET_COLUMN_TOTALS', { open: 20, done: 20 })
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
    expect(store.state.columnPagination.open.hasMore).toBe(true)
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

    expect(store.state.columnPagination.open.hasMore).toBe(false)
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

    expect(store.state.columnTotals).toEqual({ open: 7, done: 3 })
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
    store.commit('SET_COLUMN_TOTALS', { open: 51, done: 10 })
    const oldCounts = deferred()
    frappe.call
      .mockImplementationOnce(() => oldCounts.promise)
      .mockResolvedValueOnce({ message: { modified: '2026-07-10 10:01:00' } })

    const counting = store.dispatch('fetchColumnTotals', { args: {} })
    await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })
    oldCounts.resolve({ message: { Open: 99, Done: 88 } })
    await counting

    expect(store.state.columnTotals).toEqual({ open: 50, done: 11 })
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
    store.commit('SET_COLUMN_TOTALS', { open: 60, done: 0 })
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

    expect(store.state.columnPagination.open).toEqual({
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
    store.commit('SET_COLUMN_TOTALS', { open: 150, done: 49 })
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
      expect(store.state.columnPagination.open.offset).toBe(expectedOffset)
    }
    await store.dispatch('loadColumnPage', { columnIndex: 0, args: {} })

    expect(store.state.columns[0].cards).toHaveLength(150)
    expect(new Set(store.state.columns[0].cards.map(({ name }) => name)).size).toBe(150)
    expect(store.state.columnPagination.open.hasMore).toBe(false)
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
    const page = deferred()
    frappe.call.mockImplementationOnce(() => page.promise)

    const first = store.dispatch('loadColumnPage', { columnIndex: 0, args: {} })
    const second = store.dispatch('loadColumnPage', { columnIndex: 0, args: {} })
    expect(frappe.call).toHaveBeenCalledTimes(1)

    page.resolve({
      message: { keys: [], values: [], user_info: {} },
    })
    await Promise.all([first, second])
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
    frappe.call
      .mockImplementationOnce(() => stalePage.promise)
      .mockResolvedValueOnce({
        message: {
          keys: ['name', 'subject', 'status'],
          values: [['TASK-NEW', 'New filter', 'Open']],
          user_info: {},
        },
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

    expect(frappe.call).toHaveBeenCalledTimes(1)
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

      const status = args.filters?.find(
        (filter) => filter.at(-3) === 'status',
      )?.at(-1)
      const count = status === 'Open' ? 14 : status === 'Done' ? 3 : 1
      const prefix = status === 'Done' ? 'DONE' : 'OPEN'
      const start = status ? args.start : 0
      return Promise.resolve({
        message: {
          keys: ['name', 'subject', 'status'],
          values: Array.from({ length: count }, (_, index) => [
            `${prefix}-${start + index + 1}`,
            `${status || 'Open'} ${start + index + 1}`,
            status || 'Open',
          ]),
          user_info: {},
        },
      })
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
    const columnCalls = frappe.call.mock.calls
      .map(([request]) => request)
      .filter(({ method }) => method === 'frappe.desk.reportview.get')
      .slice(1)
    expect(columnCalls.map(({ args }) => args.page_length)).toEqual([14, 3])
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

      const priority = args.filters?.[0]?.at(-1)
      const isColumnPage = args.filters?.some(
        (filter) => filter.at(-3) === 'status',
      )
      if (isColumnPage && priority === 'High' && rejectLatestTopUp) {
        rejectLatestTopUp = false
        return Promise.reject(new Error('Latest top-up unavailable'))
      }
      const count = isColumnPage ? 14 : 1
      return Promise.resolve({
        message: {
          keys: ['name', 'subject', 'status'],
          values: Array.from({ length: count }, (_, index) => [
            `${priority}-${args.start + index + 1}`,
            `${priority} ${args.start + index + 1}`,
            'Open',
          ]),
          user_info: {},
        },
      })
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
      request.method === 'frappe.desk.reportview.get' &&
      request.args.filters?.some((filter) => filter.at(-1) === 'Low') &&
      request.args.filters?.some((filter) => filter.at(-3) === 'status'),
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
    frappe.call
      .mockResolvedValueOnce({ message: boardDocument })
      .mockResolvedValueOnce({
        message: {
          keys: ['name', 'subject', 'status'],
          values: rows,
          user_info: {},
        },
      })
    const store = createStore()

    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    await store.dispatch('fetchKanban', {
      args: { page_length: 20, start: 0 },
    })

    expect(store.state.columns[0].cards[0].name).toBe('TASK-1')
    expect(store.state.columnPagination.open).toEqual({
      offset: 100,
      loading: false,
      hasMore: true,
    })
    expect(frappe.call).toHaveBeenLastCalledWith({
      method: 'frappe.desk.reportview.get',
      args: { page_length: 100, start: 0 },
    })
    expect(store.state.loading).toBe(false)
  })

  test('registers user info from reportview before grouping cards', async () => {
    frappe.call
      .mockResolvedValueOnce({ message: boardDocument })
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

  test('discards a slower response from obsolete filters', async () => {
    frappe.call.mockResolvedValueOnce({ message: boardDocument })
    const store = createStore()
    await store.dispatch('ensureBoard', { board_name: 'Task Board' })
    const first = deferred()
    const second = deferred()
    frappe.call
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

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
    frappe.call
      .mockImplementationOnce(() => boardB.promise)
      .mockImplementationOnce(() => boardA.promise)

    const openingB = store.dispatch('ensureBoard', { board_name: 'Board B' })
    const reopeningA = store.dispatch('ensureBoard', { board_name: 'Task Board' })
    boardA.resolve({ message: boardDocument })
    await reopeningA
    boardB.resolve({ message: { ...boardDocument, name: 'Board B' } })
    await openingB

    expect(frappe.call).toHaveBeenCalledTimes(2)
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
    return store
  }

  test('optimistically moves a card and persists its status', async () => {
    frappe.call.mockResolvedValue({ message: { status: 'Done' } })
    const store = hydratedStore()
    store.commit('SET_COLUMN_PAGINATION', {
      open: { offset: 30, loading: false, hasMore: true },
      done: { offset: 10, loading: false, hasMore: true },
    })
    store.commit('SET_COLUMN_TOTALS', { open: 51, done: 10 })

    await store.dispatch('moveCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(store.state.columns[0].cards).toEqual([])
    expect(store.state.columns[1].cards[0].status).toBe('Done')
    expect(store.state.columnPagination.open.offset).toBe(29)
    expect(store.state.columnPagination.done.offset).toBe(10)
    expect(store.state.columnTotals).toEqual({ open: 50, done: 11 })
    expect(frappe.call).toHaveBeenCalledWith(expect.objectContaining({
      method: 'quick_kanban.api.move_card',
      args: expect.objectContaining({
        value: 'Done',
        expected_modified: '2026-07-10 10:00:00',
      }),
    }))
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

    await expect(store.dispatch('persistMovedCard', {
      cardName: 'TASK-1',
      fromColumn: 0,
      toColumn: 1,
      fromIndex: 0,
    })).rejects.toThrow('Conflict')

    expect(store.state.columns[0].cards[0].name).toBe('TASK-1')
    expect(store.state.columns[1].cards).toEqual([])
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
      open: { offset: 1, loading: true, hasMore: true },
      done: { offset: 0, loading: false, hasMore: true },
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
