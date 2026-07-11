import { createStore } from 'vuex'
import {
  groupCardsByColumn,
  mapAssignments,
  normalizeBoardConfig,
} from './kanban'

const initialColumnCardMinimum = 15

const emptyConfig = () => ({
  board_name: '',
  ref_doctype: '',
  field_name: '',
  title_field: 'name',
  fields: [],
  highlighted_field: '',
  highlight_table: [],
  show_labels: false,
})

const getErrorMessage = (error) =>
  error?.message || __('Unable to load the Kanban board.')

function cacheUserInfo(userInfo) {
  if (userInfo && globalThis.frappe?.update_user_info) {
    frappe.update_user_info(userInfo)
  }
}

export function createKanbanStore() {
  return createStore({
    state: () => ({
      columns: [],
      config: emptyConfig(),
      loading: false,
      error: '',
      announcement: '',
      pageSize: 100,
      columnPageSize: 30,
      columnPagination: {},
      columnTotals: {},
      boardGeneration: 0,
      dataRequestId: 0,
      columnRequestGeneration: 0,
      countRequestGeneration: 0,
      configRequestBoard: '',
      pendingMoves: {},
    }),
    mutations: {
      SET_COLUMNS(state, columns) {
        state.columns = columns
      },
      SET_COLUMN_CARDS(state, { columnIndex, cards }) {
        state.columns[columnIndex].cards = cards
      },
      APPEND_COLUMN_CARDS(state, { columnIndex, cards }) {
        state.columns[columnIndex].cards = mergeCards(
          state.columns[columnIndex].cards,
          cards,
        )
      },
      SET_COLUMN_PAGINATION(state, pagination) {
        state.columnPagination = pagination
      },
      SET_COLUMN_TOTALS(state, totals) {
        state.columnTotals = totals
        state.columnPagination = Object.fromEntries(
          Object.entries(state.columnPagination).map(([key, pagination]) => [
            key,
            {
              ...pagination,
              hasMore: Number.isFinite(totals[key])
                ? pagination.offset < totals[key]
                : pagination.hasMore,
            },
          ]),
        )
      },
      BEGIN_COUNT_REQUEST(state) {
        state.countRequestGeneration += 1
      },
      INVALIDATE_COUNT_RESPONSES(state) {
        state.countRequestGeneration += 1
      },
      ADJUST_COLUMN_TOTAL(state, { columnIndex, delta }) {
        const column = state.columns[columnIndex]
        if (!column) return
        const key = getColumnKey(column)
        if (!Number.isFinite(state.columnTotals[key])) return
        state.columnTotals = {
          ...state.columnTotals,
          [key]: Math.max(0, state.columnTotals[key] + delta),
        }
      },
      SET_COLUMN_PAGE_STATE(state, { key, changes }) {
        state.columnPagination = {
          ...state.columnPagination,
          [key]: {
            ...state.columnPagination[key],
            ...changes,
          },
        }
      },
      ADJUST_COLUMN_OFFSET(state, { columnIndex, delta }) {
        const column = state.columns[columnIndex]
        if (!column) return
        const key = getColumnKey(column)
        const pagination = state.columnPagination[key]
        if (!pagination) return
        pagination.offset = Math.max(0, pagination.offset + delta)
      },
      SET_KANBAN_CONFIG(state, config) {
        state.config = config
      },
      SET_LOADING(state, loading) {
        if (state.loading === loading) return
        state.loading = loading
      },
      SET_ERROR(state, error) {
        if (state.error === error) return
        state.error = error
      },
      SET_ANNOUNCEMENT(state, announcement) {
        if (state.announcement === announcement) return
        state.announcement = announcement
      },
      BEGIN_BOARD_CONTEXT(state) {
        state.boardGeneration += 1
        state.dataRequestId += 1
        state.columnRequestGeneration += 1
        state.countRequestGeneration += 1
        state.pendingMoves = {}
        state.columnPagination = {}
        state.columnTotals = {}
      },
      SET_DATA_REQUEST_ID(state, requestId) {
        state.dataRequestId = requestId
      },
      INVALIDATE_COLUMN_REQUESTS(state) {
        state.columnRequestGeneration += 1
        state.columnPagination = Object.fromEntries(
          Object.entries(state.columnPagination).map(([key, pagination]) => [
            key,
            { ...pagination, loading: false },
          ]),
        )
      },
      SET_CONFIG_REQUEST_BOARD(state, boardName) {
        state.configRequestBoard = boardName
      },
      SET_MOVE_PENDING(state, { cardName, pending }) {
        if (pending) {
          state.pendingMoves = { ...state.pendingMoves, [cardName]: true }
        } else {
          const pendingMoves = { ...state.pendingMoves }
          delete pendingMoves[cardName]
          state.pendingMoves = pendingMoves
        }
      },
      MOVE_CARD(state, { cardName, fromColumn, toColumn, fromIndex, toIndex }) {
        const source = state.columns[fromColumn]?.cards || []
        const sourceIndex = source.findIndex(({ name }) => name === cardName)
        const [card] = source.splice(sourceIndex >= 0 ? sourceIndex : fromIndex, 1)
        if (!card) return

        card[state.config.field_name] = state.columns[toColumn].column_name
        state.columns[toColumn].cards.splice(toIndex ?? state.columns[toColumn].cards.length, 0, card)
      },
      ROLLBACK_CARD_MOVE(state, { cardName, fromColumn, toColumn, fromIndex }) {
        const destination = state.columns[toColumn]?.cards || []
        const destinationIndex = destination.findIndex(({ name }) => name === cardName)
        if (destinationIndex < 0) return
        const [card] = destination.splice(destinationIndex, 1)

        card[state.config.field_name] = state.columns[fromColumn].column_name
        state.columns[fromColumn].cards.splice(fromIndex, 0, card)
      },
      UPDATE_COLUMN_INDICATOR(state, { columnIndex, indicator }) {
        state.columns[columnIndex].indicator = indicator
      },
      UPDATE_CARD_ASSIGNMENTS(state, { cardName, assignments }) {
        for (const column of state.columns) {
          const card = column.cards.find(({ name }) => name === cardName)
          if (card) {
            card._assign = assignments
            break
          }
        }
      },
      UPDATE_CARD_MODIFIED(state, { cardName, modified }) {
        for (const column of state.columns) {
          const card = column.cards.find(({ name }) => name === cardName)
          if (card) {
            card.modified = modified
            break
          }
        }
      },
    },
    actions: {
      hydrateFromList({ commit, state }, { board, cards = [], args = {} }) {
        commit('BEGIN_BOARD_CONTEXT')
        commit('SET_CONFIG_REQUEST_BOARD', '')
        commit('SET_LOADING', false)
        const config = normalizeBoardConfig(
          board,
          frappe.get_meta(board.reference_doctype),
        )
        const columns = board.columns.map((column) => ({ ...column, cards: [] }))
        const columnsByName = new Map(
          columns.map((column) => [column.column_name, column]),
        )

        for (const sourceCard of cards) {
          const column = columnsByName.get(sourceCard[config.field_name])
          if (!column) continue
          const card = { ...sourceCard }
          card._assign = mapAssignments(card._assign)
          column.cards.push(card)
        }

        const pageSize = Number(args.page_length) || state.pageSize
        commit('SET_KANBAN_CONFIG', config)
        commit('SET_COLUMNS', columns)
        commit(
          'SET_COLUMN_PAGINATION',
          createColumnPagination(columns, cards.length >= pageSize),
        )
        commit('SET_ERROR', '')
      },
      async ensureBoard({ commit, state }, { board_name }) {
        if (
          state.config.board_name === board_name &&
          state.columns.length &&
          !state.configRequestBoard
        ) {
          return
        }

        const boardGeneration = state.boardGeneration + 1
        commit('BEGIN_BOARD_CONTEXT')
        commit('SET_CONFIG_REQUEST_BOARD', board_name)
        commit('SET_LOADING', true)
        commit('SET_ERROR', '')
        try {
          const response = await frappe.call({
            method: 'frappe.client.get',
            args: { doctype: 'Kanban Board', name: board_name },
          })
          if (state.boardGeneration !== boardGeneration) return false
          const board = response.message
          const config = normalizeBoardConfig(
            { ...board, name: board_name },
            frappe.get_meta(board.reference_doctype),
          )

          commit('SET_COLUMNS', board.columns.map((column) => ({ ...column, cards: [] })))
          commit(
            'SET_COLUMN_PAGINATION',
            createColumnPagination(state.columns, true),
          )
          commit('SET_KANBAN_CONFIG', config)
          return true
        } catch (error) {
          if (state.boardGeneration !== boardGeneration) return false
          commit('SET_ERROR', getErrorMessage(error))
          throw error
        } finally {
          if (state.boardGeneration === boardGeneration) {
            commit('SET_CONFIG_REQUEST_BOARD', '')
            commit('SET_LOADING', false)
          }
        }
      },
      async fetchKanban({ commit, state }, { args } = {}) {
        commit('INVALIDATE_COLUMN_REQUESTS')
        commit('BEGIN_COUNT_REQUEST')
        const sourceArgs = args || window.cur_list.get_args()
        const requestedPageSize = Number(
          sourceArgs.page_length ?? sourceArgs.limit_page_length ?? 0,
        )
        const pageSize = Math.max(requestedPageSize, state.pageSize)
        const requestArgs = {
          ...sourceArgs,
          start: 0,
          page_length: pageSize,
        }
        delete requestArgs.limit_start
        delete requestArgs.limit_page_length
        const requestId = state.dataRequestId + 1
        const boardGeneration = state.boardGeneration
        commit('SET_DATA_REQUEST_ID', requestId)
        commit('SET_LOADING', true)
        commit('SET_ERROR', '')

        try {
          const response = await frappe.call({
            method: 'frappe.desk.reportview.get',
            args: requestArgs,
          })
          if (
            state.dataRequestId !== requestId ||
            state.boardGeneration !== boardGeneration
          ) return false
          const board = response.message || {}
          cacheUserInfo(board.user_info)
          const pageColumns = groupCardsByColumn({
            columns: state.columns,
            keys: board.keys,
            values: board.values,
            statusField: state.config.field_name,
            userInfo: board.user_info,
          })
          const columns = pageColumns
          const resultCount = board.values?.length || 0

          commit('SET_COLUMNS', columns)
          commit(
            'SET_COLUMN_PAGINATION',
            createColumnPagination(columns, resultCount >= pageSize),
          )
          return true
        } catch (error) {
          if (
            state.dataRequestId !== requestId ||
            state.boardGeneration !== boardGeneration
          ) return false
          commit('SET_ERROR', getErrorMessage(error))
          throw error
        } finally {
          if (
            state.dataRequestId === requestId &&
            state.boardGeneration === boardGeneration
          ) {
            commit('SET_LOADING', false)
          }
        }
      },
      async refreshBoard({ dispatch }, { board_name, args, forceConfig = false }) {
        if (forceConfig) {
          await dispatch('resetBoard')
        }
        const ready = await dispatch('ensureBoard', { board_name })
        if (ready === false) return
        const fresh = await dispatch('fetchKanban', { args })
        if (fresh === false) return
        const current = await dispatch('fetchColumnTotals', { args })
        if (current === false) return
        await dispatch('topUpInitialColumns', { args })
      },
      async fetchColumnTotals({ commit, state }, { args } = {}) {
        const sourceArgs = args || window.cur_list.get_args()
        const boardGeneration = state.boardGeneration
        commit('BEGIN_COUNT_REQUEST')
        const countRequestGeneration = state.countRequestGeneration

        const response = await frappe.call({
          method: 'quick_kanban.api.get_column_totals',
          args: buildColumnTotalsArgs(sourceArgs, state.config, state.columns),
        })
        if (
          state.boardGeneration !== boardGeneration ||
          state.countRequestGeneration !== countRequestGeneration
        ) return false

        const counts = response.message || {}
        const totals = Object.fromEntries(
          state.columns.map((column) => [
            getColumnKey(column),
            Number(counts[column.column_name]) || 0,
          ]),
        )
        commit('SET_COLUMN_TOTALS', totals)
        return true
      },
      async topUpInitialColumns({ dispatch, state }, { args } = {}) {
        const requests = state.columns.map(async (column, columnIndex) => {
          const key = getColumnKey(column)
          const total = state.columnTotals[key]
          if (!Number.isFinite(total) || total <= 0) return

          const target = Math.min(initialColumnCardMinimum, total)
          let loaded = column.cards?.length || 0
          while (loaded < target) {
            const pagination = state.columnPagination[key]
            if (!pagination?.hasMore || pagination.loading) return
            const previousOffset = pagination.offset

            await dispatch('loadColumnPage', {
              columnIndex,
              args,
              pageSize: target - loaded,
            })

            loaded = state.columns[columnIndex]?.cards?.length || 0
            if (state.columnPagination[key]?.offset === previousOffset) return
          }
        })

        return Promise.allSettled(requests)
      },
      async loadColumnPage(
        { commit, state },
        { columnIndex, args, pageSize = state.columnPageSize } = {},
      ) {
        const column = state.columns[columnIndex]
        if (!column) return
        const key = getColumnKey(column)
        const pagination = state.columnPagination[key]
        if (!pagination || pagination.loading || !pagination.hasMore) return

        const sourceArgs = args || window.cur_list.get_args()
        const requestArgs = {
          ...sourceArgs,
          filters: buildColumnFilters(sourceArgs.filters, state.config, column),
          start: pagination.offset,
          page_length: pageSize,
        }
        delete requestArgs.limit_start
        delete requestArgs.limit_page_length
        const boardGeneration = state.boardGeneration
        const columnRequestGeneration = state.columnRequestGeneration
        commit('SET_COLUMN_PAGE_STATE', {
          key,
          changes: { loading: true },
        })

        try {
          const response = await frappe.call({
            method: 'frappe.desk.reportview.get',
            args: requestArgs,
          })
          if (
            state.boardGeneration !== boardGeneration ||
            state.columnRequestGeneration !== columnRequestGeneration
          ) return
          const page = response.message || {}
          cacheUserInfo(page.user_info)
          const pageColumn = groupCardsByColumn({
            columns: [column],
            keys: page.keys,
            values: page.values,
            statusField: state.config.field_name,
            userInfo: page.user_info,
          })[0]
          const resultCount = page.values?.length || 0
          const nextOffset = pagination.offset + resultCount
          const total = state.columnTotals[key]

          commit('APPEND_COLUMN_CARDS', {
            columnIndex,
            cards: pageColumn.cards,
          })
          commit('SET_COLUMN_PAGE_STATE', {
            key,
            changes: {
              offset: nextOffset,
              loading: false,
              hasMore:
                resultCount >= pageSize &&
                (!Number.isFinite(total) || nextOffset < total),
            },
          })
        } catch (error) {
          if (
            state.boardGeneration === boardGeneration &&
            state.columnRequestGeneration === columnRequestGeneration
          ) {
            commit('SET_COLUMN_PAGE_STATE', {
              key,
              changes: { loading: false },
            })
            commit('SET_ERROR', getErrorMessage(error))
          }
          throw error
        }
      },
      resetBoard({ commit }) {
        commit('BEGIN_BOARD_CONTEXT')
        commit('SET_CONFIG_REQUEST_BOARD', '')
        commit('SET_LOADING', false)
        commit('SET_COLUMNS', [])
        commit('SET_KANBAN_CONFIG', emptyConfig())
        commit('SET_COLUMN_PAGINATION', {})
      },
      async persistMove(
        { commit, state },
        { cardName, fromColumn, toColumn, fromIndex },
      ) {
        const boardGeneration = state.boardGeneration
        commit('SET_MOVE_PENDING', { cardName, pending: true })
        const card = state.columns[toColumn].cards.find(({ name }) => name === cardName)
        try {
          const response = await frappe.call({
            method: 'quick_kanban.api.move_card',
            args: {
              doctype: state.config.ref_doctype,
              name: cardName,
              fieldname: state.config.field_name,
              value: state.columns[toColumn].column_name,
              expected_modified: card?.modified,
            },
          })
          if (state.boardGeneration !== boardGeneration) return
          if (response?.message?.modified) {
            commit('UPDATE_CARD_MODIFIED', {
              cardName,
              modified: response.message.modified,
            })
          }
          commit('INVALIDATE_COUNT_RESPONSES')
          commit('ADJUST_COLUMN_OFFSET', {
            columnIndex: fromColumn,
            delta: -1,
          })
          commit('ADJUST_COLUMN_TOTAL', {
            columnIndex: fromColumn,
            delta: -1,
          })
          commit('ADJUST_COLUMN_TOTAL', {
            columnIndex: toColumn,
            delta: 1,
          })
          frappe.show_alert({
            message: __('Card moved to {0}', [state.columns[toColumn].column_name]),
            indicator: 'green',
          })
          commit(
            'SET_ANNOUNCEMENT',
            __('Card moved to {0}', [state.columns[toColumn].column_name]),
          )
        } catch (error) {
          if (state.boardGeneration === boardGeneration) {
            commit('ROLLBACK_CARD_MOVE', {
              cardName,
              fromColumn,
              toColumn,
              fromIndex,
            })
            frappe.show_alert({
              message: __('Could not move card: {0}', [getErrorMessage(error)]),
              indicator: 'red',
            })
            commit(
              'SET_ANNOUNCEMENT',
              __('Card move failed. The previous position was restored.'),
            )
          }
          throw error
        } finally {
          if (state.boardGeneration === boardGeneration) {
            commit('SET_MOVE_PENDING', { cardName, pending: false })
          }
        }
      },
      async moveCard({ commit, dispatch, state }, payload) {
        if (state.pendingMoves[payload.cardName]) return false
        if (
          isColumnLoading(state, payload.fromColumn) ||
          isColumnLoading(state, payload.toColumn)
        ) return false
        commit('MOVE_CARD', payload)
        await dispatch('persistMove', payload)
      },
      async persistMovedCard({ commit, dispatch, state }, payload) {
        if (state.pendingMoves[payload.cardName]) {
          commit('ROLLBACK_CARD_MOVE', payload)
          return false
        }
        if (
          isColumnLoading(state, payload.fromColumn) ||
          isColumnLoading(state, payload.toColumn)
        ) {
          commit('ROLLBACK_CARD_MOVE', payload)
          return false
        }
        await dispatch('persistMove', payload)
      },
      async refreshCard({ commit, state }, { cardName }) {
        const response = await frappe.call({
          method: 'frappe.client.get_value',
          args: {
            doctype: state.config.ref_doctype,
            filters: { name: cardName },
            fieldname: ['_assign'],
          },
        })
        const assignees = JSON.stringify(
          Object.keys(mapAssignments(response.message?._assign)),
        )
        const userResponse = await frappe.call({
          method: 'frappe.desk.form.load.get_user_info_for_viewers',
          args: { users: assignees },
        })
        cacheUserInfo(userResponse.message)
        commit('UPDATE_CARD_ASSIGNMENTS', {
          cardName,
          assignments: mapAssignments(
            response.message?._assign,
            userResponse.message,
          ),
        })
      },
      async setIndicator({ commit, state }, { indicator, columnIndex }) {
        try {
          await frappe.call({
            method: 'frappe.desk.doctype.kanban_board.kanban_board.set_indicator',
            args: {
              board_name: state.config.board_name,
              column_name: state.columns[columnIndex].column_name,
              indicator,
            },
          })
          commit('UPDATE_COLUMN_INDICATOR', { columnIndex, indicator })
        } catch (error) {
          frappe.show_alert({
            message: __('Could not update the column color.'),
            indicator: 'red',
          })
          throw error
        }
      },
    },
    getters: {
      getColumns: (state) => state.columns,
      getConfig: (state) => state.config,
      isMovePending: (state) => (cardName) => Boolean(state.pendingMoves[cardName]),
    },
  })
}

function mergeCards(existingCards, newCards) {
  const cards = new Map(existingCards.map((card) => [card.name, card]))
  for (const card of newCards) {
    cards.set(card.name, card)
  }
  return [...cards.values()]
}

function getColumnKey(column) {
  return column.name || column.column_name
}

function createColumnPagination(columns, hasMore) {
  return Object.fromEntries(
    columns.map((column) => [
      getColumnKey(column),
      {
        offset: column.cards?.length || 0,
        loading: false,
        hasMore,
      },
    ]),
  )
}

function isColumnLoading(state, columnIndex) {
  const column = state.columns[columnIndex]
  if (!column) return false
  return Boolean(state.columnPagination[getColumnKey(column)]?.loading)
}

function buildColumnFilters(filters, config, column) {
  return [
    ...(Array.isArray(filters) ? filters : []),
    [
      config.ref_doctype,
      config.field_name,
      '=',
      column.column_name,
    ],
  ]
}

function buildColumnTotalsArgs(sourceArgs, config, columns) {
  const args = {
    doctype: sourceArgs.doctype || config.ref_doctype,
    fieldname: config.field_name,
    columns: columns.map((column) => column.column_name),
    filters: Array.isArray(sourceArgs.filters) ? sourceArgs.filters : [],
  }
  for (const key of ['or_filters']) {
    if (sourceArgs[key] !== undefined && sourceArgs[key] !== null) {
      args[key] = sourceArgs[key]
    }
  }
  return args
}

export default createKanbanStore()