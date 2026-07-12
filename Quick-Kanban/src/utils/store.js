import { createStore } from 'vuex'
import {
  attachColumnDisplayNames,
  groupCardsByColumn,
  mapAssignments,
  normalizeBoardConfig,
} from './kanban'
import {
  buildMoveFailureAnnouncement,
  showMoveFailureAlert,
} from './moveFailure'
import {
  openCreateForm,
  resolveCreateFormMode,
  showCreateBlockedMessage,
} from './createValidation'
import { validateMoveMandatory } from './moveValidation'

const initialColumnCardMinimum = 15
const moveOptionsDebounceMs = 50
const moveOptionsBatchSize = 50

function chunkList(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const emptyConfig = () => ({
  board_name: '',
  ref_doctype: '',
  field_name: '',
  title_field: 'name',
  title_field_meta: { fieldname: 'name' },
  status_field_meta: { fieldname: '' },
  highlighted_field_meta: null,
  fields: [],
  highlighted_field: '',
  highlight_table: [],
  show_labels: false,
})

function withColumnDisplayNames(columns, config) {
  return attachColumnDisplayNames(columns, config.status_field_meta)
}

const getErrorMessage = (error) =>
  error?.message || __('Unable to load the Kanban board.')

function cacheUserInfo(userInfo) {
  if (userInfo && globalThis.frappe?.update_user_info) {
    frappe.update_user_info(userInfo)
  }
}

function findCard(state, cardName) {
  for (const column of state.columns) {
    const card = column.cards.find(({ name }) => name === cardName)
    if (card) {
      return card
    }
  }
  return null
}

function collectVisibleCardNames(state) {
  const names = new Set()
  for (const column of state.columns) {
    for (const card of column.cards || []) {
      if (card?.name) {
        names.add(card.name)
      }
    }
  }
  return [...names]
}

function defaultDestinationOptions(columnName) {
  return {
    allowed: true,
    mode: 'field_update',
    actions: [],
    missing_mandatory: [],
    reason: null,
    column_name: columnName,
  }
}

export function buildPermissiveMoveOptions(state) {
  const destinations = Object.fromEntries(
    state.columns.map((column) => [
      column.column_name,
      defaultDestinationOptions(column.column_name),
    ]),
  )
  return { can_drag: state.columns.length > 1, destinations }
}

let moveOptionsTimer = null
let pendingMoveOptionNames = new Set()

function getDestinationPolicy(state, cardName, column) {
  const cardOptions = state.moveOptionsByCard[cardName]
  const columnName = column.column_name
  if (!cardOptions) {
    if (globalThis.__quickKanbanPermissiveMoves) {
      return defaultDestinationOptions(columnName)
    }
    if (!state.moveOptionsLoaded) {
      return {
        allowed: false,
        reason: 'loading',
        mode: 'field_update',
        actions: [],
        missing_mandatory: [],
      }
    }
    return {
      allowed: false,
      reason: 'no_permission',
      mode: 'field_update',
      actions: [],
      missing_mandatory: [],
    }
  }
  return cardOptions.destinations?.[columnName] || {
    allowed: false,
    reason: 'workflow_denied',
    mode: 'field_update',
    actions: [],
    missing_mandatory: [],
  }
}

function isMoveReady(state, cardName) {
  if (globalThis.__quickKanbanPermissiveMoves) {
    return true
  }
  if (state.moveOptionsByCard[cardName]) {
    return true
  }
  return state.moveOptionsLoaded
}

function runPreflightMove(state, _commit, payload) {
  const { cardName, toColumn, workflowAction = null } = payload
  const column = state.columns[toColumn]
  if (!column) {
    return { allowed: false, reason: 'invalid_column' }
  }

  const card = findCard(state, cardName)
  if (!card) {
    return { allowed: false, reason: 'missing_card' }
  }

  if (!isMoveReady(state, cardName)) {
    return { allowed: false, reason: 'loading' }
  }

  const policy = getDestinationPolicy(state, cardName, column)
  if (!policy.allowed) {
    return { allowed: false, reason: policy.reason, policy }
  }

  const validation = validateMoveMandatory(
    card,
    { ...column, moveOptions: policy },
    state.config,
    workflowAction,
    policy.missing_mandatory,
  )
  if (!validation.valid) {
    return {
      allowed: false,
      reason: 'missing_mandatory',
      missingLabels: validation.missingLabels,
    }
  }

  return { allowed: true, policy, workflowAction }
}

function reportMoveFailure(commit, preflight, config, error = null) {
  showMoveFailureAlert(preflight, config, error)
  commit(
    'SET_ANNOUNCEMENT',
    buildMoveFailureAnnouncement(preflight, error),
  )
}

function promoteRecentCreatesToTop(columns, recentCreatedCards, fieldName) {
  if (!recentCreatedCards || !Object.keys(recentCreatedCards).length) {
    return columns
  }

  for (const column of columns) {
    const trackedNames = Object.entries(recentCreatedCards)
      .filter(([, columnName]) => columnName === column.column_name)
      .map(([cardName]) => cardName)
    if (!trackedNames.length) {
      continue
    }

    const cards = [...(column.cards || [])]
    const pinned = []
    const remaining = []

    for (const card of cards) {
      if (trackedNames.includes(card.name)) {
        pinned.push(card)
      } else {
        remaining.push(card)
      }
    }

    const orderedPinned = trackedNames
      .map((cardName) => pinned.find((card) => card.name === cardName))
      .filter(Boolean)

    column.cards = [...orderedPinned, ...remaining]
  }

  return columns
}

function docToCard(doc, config) {
  const card = { name: doc.name, modified: doc.modified }
  for (const field of config.fields || []) {
    if (field in doc) {
      card[field] = doc[field]
    }
  }
  if (config.field_name in doc) {
    card[config.field_name] = doc[config.field_name]
  }
  if (config.title_field in doc) {
    card[config.title_field] = doc[config.title_field]
  }
  card._assign = mapAssignments(doc._assign)
  return card
}

function findColumnIndexByName(state, columnName) {
  return state.columns.findIndex((column) => column.column_name === columnName)
}

function buildDragMoveFailureResult(payload, preflight = null, error = null) {
  return {
    ok: false,
    needsAnimatedRollback: true,
    preflight,
    error,
    payload,
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
      moveOptionsByCard: {},
      moveOptionsLoading: false,
      moveOptionsGeneration: 0,
      moveOptionsLoaded: false,
      activeDrag: null,
      dragSyncGeneration: 0,
      createOptionsByColumn: {},
      pendingCreate: null,
      recentCreatedCards: {},
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
        promoteRecentCreatesToTop(
          state.columns,
          state.recentCreatedCards,
          state.config.field_name,
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
        state.moveOptionsByCard = {}
        state.moveOptionsLoading = false
        state.moveOptionsGeneration += 1
        state.moveOptionsLoaded = false
        state.activeDrag = null
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
      SET_MOVE_OPTIONS_LOADING(state, loading) {
        state.moveOptionsLoading = loading
      },
      SET_MOVE_OPTIONS_BATCH(state, { options, generation }) {
        if (generation !== state.moveOptionsGeneration) {
          return
        }
        state.moveOptionsByCard = {
          ...state.moveOptionsByCard,
          ...options,
        }
        state.moveOptionsLoaded = true
      },
      CLEAR_CARD_MOVE_OPTIONS(state, cardName) {
        const moveOptionsByCard = { ...state.moveOptionsByCard }
        delete moveOptionsByCard[cardName]
        state.moveOptionsByCard = moveOptionsByCard
      },
      SET_ACTIVE_DRAG(state, activeDrag) {
        state.activeDrag = activeDrag
      },
      MOVE_CARD(state, { cardName, fromColumn, toColumn, fromIndex, toIndex }) {
        const source = state.columns[fromColumn]?.cards || []
        const sourceIndex = source.findIndex(({ name }) => name === cardName)
        const [card] = source.splice(sourceIndex >= 0 ? sourceIndex : fromIndex, 1)
        if (!card) return

        card[state.config.field_name] = state.columns[toColumn].column_name
        state.columns[toColumn].cards.splice(toIndex ?? state.columns[toColumn].cards.length, 0, card)
        state.columns[fromColumn].cards = [...state.columns[fromColumn].cards]
        state.columns[toColumn].cards = [...state.columns[toColumn].cards]
        state.dragSyncGeneration += 1
      },
      ROLLBACK_CARD_MOVE(state, { cardName, fromColumn, toColumn, fromIndex }) {
        let destinationColumnIndex = toColumn
        let destination = state.columns[toColumn]?.cards || []
        let destinationIndex = destination.findIndex(({ name }) => name === cardName)

        if (destinationIndex < 0) {
          destinationColumnIndex = state.columns.findIndex((column) =>
            column.cards.some(({ name }) => name === cardName),
          )
          if (destinationColumnIndex < 0) {
            return
          }
          if (destinationColumnIndex === fromColumn) {
            state.dragSyncGeneration += 1
            return
          }
          destination = state.columns[destinationColumnIndex].cards
          destinationIndex = destination.findIndex(({ name }) => name === cardName)
          if (destinationIndex < 0) {
            return
          }
        }

        const [card] = destination.splice(destinationIndex, 1)
        card[state.config.field_name] = state.columns[fromColumn].column_name
        state.columns[fromColumn].cards.splice(fromIndex, 0, card)
        state.columns[fromColumn].cards = [...state.columns[fromColumn].cards]
        state.columns[destinationColumnIndex].cards = [...destination]
        state.dragSyncGeneration += 1
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
      SET_CREATE_OPTIONS_BY_COLUMN(state, options) {
        state.createOptionsByColumn = options || {}
      },
      SET_PENDING_CREATE(state, pendingCreate) {
        state.pendingCreate = pendingCreate
      },
      CLEAR_PENDING_CREATE(state) {
        state.pendingCreate = null
      },
      TRACK_RECENT_CREATED_CARD(state, { cardName, columnName }) {
        state.recentCreatedCards = {
          ...state.recentCreatedCards,
          [cardName]: columnName,
        }
      },
      CLEAR_RECENT_CREATED_CARDS(state) {
        state.recentCreatedCards = {}
      },
      PREPEND_CREATED_CARD(state, { columnIndex, card, incrementTotal = true }) {
        const column = state.columns[columnIndex]
        if (!column) return

        const cards = [...(column.cards || [])]
        const existingIndex = cards.findIndex(({ name }) => name === card.name)
        if (existingIndex >= 0) {
          cards.splice(existingIndex, 1)
        } else if (incrementTotal) {
          const key = getColumnKey(column)
          if (Number.isFinite(state.columnTotals[key])) {
            state.columnTotals = {
              ...state.columnTotals,
              [key]: state.columnTotals[key] + 1,
            }
          }
        }
        cards.unshift(card)
        column.cards = cards
        state.dragSyncGeneration += 1
      },
    },
    actions: {
      hydrateFromList({ commit, dispatch, state }, { board, cards = [], args = {} }) {
        commit('BEGIN_BOARD_CONTEXT')
        commit('SET_CONFIG_REQUEST_BOARD', '')
        commit('SET_LOADING', false)
        const config = normalizeBoardConfig(
          board,
          frappe.get_meta(board.reference_doctype),
        )
        const columns = withColumnDisplayNames(
          board.columns.map((column) => ({ ...column, cards: [] })),
          config,
        )
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

        promoteRecentCreatesToTop(
          columns,
          state.recentCreatedCards,
          config.field_name,
        )

        const pageSize = Number(args.page_length) || state.pageSize
        commit('SET_KANBAN_CONFIG', config)
        if (globalThis.frappe?.workflow?.setup) {
          frappe.workflow.setup(board.reference_doctype)
        }
        commit('SET_COLUMNS', columns)
        commit(
          'SET_COLUMN_PAGINATION',
          createColumnPagination(columns, cards.length >= pageSize),
        )
        commit('SET_ERROR', '')
        dispatch('fetchCreateOptions', { board_name: config.board_name })
        dispatch('scheduleMoveOptionsRefresh')
        dispatch('fetchMoveOptions', { names: collectVisibleCardNames({
          ...state,
          columns,
          config,
        }) })
      },
      async ensureBoard({ commit, dispatch, state }, { board_name }) {
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

          commit('SET_COLUMNS', withColumnDisplayNames(
            board.columns.map((column) => ({ ...column, cards: [] })),
            config,
          ))
          commit(
            'SET_COLUMN_PAGINATION',
            createColumnPagination(state.columns, true),
          )
          commit('SET_KANBAN_CONFIG', config)
          if (globalThis.frappe?.workflow?.setup) {
            frappe.workflow.setup(board.reference_doctype)
          }
          dispatch('fetchCreateOptions', { board_name })
          dispatch('scheduleMoveOptionsRefresh')
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
      async fetchKanban({ commit, dispatch, state }, { args } = {}) {
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
          const columns = promoteRecentCreatesToTop(
            pageColumns,
            state.recentCreatedCards,
            state.config.field_name,
          )
          const resultCount = board.values?.length || 0

          commit('SET_COLUMNS', columns)
          commit(
            'SET_COLUMN_PAGINATION',
            createColumnPagination(columns, resultCount >= pageSize),
          )
          dispatch('scheduleMoveOptionsRefresh')
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
        { commit, dispatch, state },
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
          dispatch('scheduleMoveOptionsRefresh')
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
        commit('SET_CREATE_OPTIONS_BY_COLUMN', {})
        commit('CLEAR_PENDING_CREATE')
        commit('CLEAR_RECENT_CREATED_CARDS')
      },
      async fetchCreateOptions({ commit, state }, { board_name } = {}) {
        const targetBoard = board_name || state.config.board_name
        if (!targetBoard) {
          return
        }

        try {
          const response = await frappe.call({
            method: 'quick_kanban.api.get_create_options',
            args: { board_name: targetBoard },
          })
          commit('SET_CREATE_OPTIONS_BY_COLUMN', response.message || {})
        } catch {
          commit('SET_CREATE_OPTIONS_BY_COLUMN', {})
        }
      },
      startCreateCard({ commit, dispatch, state }, { columnIndex, column }) {
        const formMode = resolveCreateFormMode(
          column,
          state.config,
          state.createOptionsByColumn,
        )
        if (formMode.mode === 'blocked') {
          showCreateBlockedMessage(
            formMode.reason,
            state.config.ref_doctype,
            formMode.missingLabels,
          )
          return false
        }

        const defaults = {
          [state.config.field_name]: column.column_name,
        }
        commit('SET_PENDING_CREATE', {
          column_name: column.column_name,
          columnIndex,
          board_name: state.config.board_name,
          form_mode: formMode.mode,
        })

        return openCreateForm({
          doctype: state.config.ref_doctype,
          defaults,
          mode: formMode.mode,
          onCreated: (doc) => {
            dispatch('handleCardCreated', { doc })
          },
        })
      },
      handleCardCreated({ commit, dispatch, state }, { doc }) {
        if (!doc?.name || !state.config?.field_name) {
          return false
        }

        const pending = state.pendingCreate
        const statusValue = doc[state.config.field_name]
        const targetColumnName = pending?.column_name
        const matchesInitiatedColumn = !targetColumnName || statusValue === targetColumnName
        if (!matchesInitiatedColumn) {
          commit('CLEAR_PENDING_CREATE')
          return false
        }

        if (pending?.board_name && pending.board_name !== state.config.board_name) {
          return false
        }

        const columnIndex = Number.isFinite(pending?.columnIndex)
          ? pending.columnIndex
          : findColumnIndexByName(state, statusValue)
        if (columnIndex < 0) {
          commit('CLEAR_PENDING_CREATE')
          return false
        }

        const card = docToCard(doc, state.config)
        commit('PREPEND_CREATED_CARD', { columnIndex, card })
        commit('TRACK_RECENT_CREATED_CARD', {
          cardName: card.name,
          columnName: state.columns[columnIndex]?.column_name || statusValue,
        })
        commit('CLEAR_PENDING_CREATE')
        dispatch('scheduleMoveOptionsRefresh')
        return true
      },
      scheduleMoveOptionsRefresh({ dispatch, state }) {
        if (!state.config.board_name) {
          return
        }
        const names = collectVisibleCardNames(state)
        for (const name of names) {
          pendingMoveOptionNames.add(name)
        }
        if (moveOptionsTimer) {
          clearTimeout(moveOptionsTimer)
        }
        moveOptionsTimer = setTimeout(() => {
          const batch = [...pendingMoveOptionNames]
          pendingMoveOptionNames = new Set()
          moveOptionsTimer = null
          if (batch.length) {
            dispatch('fetchMoveOptions', { names: batch })
          }
        }, moveOptionsDebounceMs)
      },
      async fetchMoveOptions({ commit, state }, { names } = {}) {
        const requestedNames = (names || collectVisibleCardNames(state))
          .filter((name) => name && !state.moveOptionsByCard[name])
        if (!requestedNames.length || !state.config.board_name) {
          return
        }

        const generation = state.moveOptionsGeneration
        const boardGeneration = state.boardGeneration
        commit('SET_MOVE_OPTIONS_LOADING', true)
        try {
          for (const batch of chunkList(requestedNames, moveOptionsBatchSize)) {
            if (
              state.boardGeneration !== boardGeneration ||
              state.moveOptionsGeneration !== generation
            ) {
              return
            }
            const response = await frappe.call({
              method: 'quick_kanban.api.get_move_options',
              args: {
                board_name: state.config.board_name,
                names: batch,
              },
            })
            if (
              state.boardGeneration !== boardGeneration ||
              state.moveOptionsGeneration !== generation
            ) {
              return
            }
            commit('SET_MOVE_OPTIONS_BATCH', {
              options: response.message || {},
              generation,
            })
          }
        } catch (error) {
          if (state.boardGeneration === boardGeneration) {
            commit('SET_MOVE_OPTIONS_LOADING', false)
            frappe.show_alert({
              message: getErrorMessage(error),
              indicator: 'red',
            })
          }
        } finally {
          if (
            state.boardGeneration === boardGeneration &&
            state.moveOptionsGeneration === generation
          ) {
            commit('SET_MOVE_OPTIONS_LOADING', false)
          }
        }
      },
      getDestinationPolicy({ state }, { cardName, column }) {
        return getDestinationPolicy(state, cardName, column)
      },
      resolveWorkflowAction({ state }, { cardName, column }) {
        const policy = state.moveOptionsByCard[cardName]
          ?.destinations?.[column.column_name]
        const actions = policy?.actions || []
        if (actions.length <= 1) {
          return actions[0]?.action || null
        }
        return new Promise((resolve, reject) => {
          const dialog = new frappe.ui.Dialog({
            title: __('Select Workflow Action'),
            fields: [{
              fieldtype: 'Select',
              fieldname: 'action',
              label: __('Action'),
              options: actions.map((row) => row.action),
              reqd: 1,
            }],
            primary_action_label: __('Apply'),
            primary_action(values) {
              dialog.hide()
              resolve(values.action)
            },
          })
          dialog.show()
          dialog.$wrapper.on('hide.bs.modal', () => {
            reject(new Error('cancelled'))
          })
        })
      },
      preflightMove({ commit, state }, payload) {
        return runPreflightMove(state, commit, payload)
      },
      async persistMove(
        { commit, dispatch, state },
        { cardName, fromColumn, toColumn, fromIndex, workflowAction = null },
      ) {
        const boardGeneration = state.boardGeneration
        commit('SET_MOVE_PENDING', { cardName, pending: true })
        const card = state.columns[toColumn].cards.find(({ name }) => name === cardName)
        try {
          const response = await frappe.call({
            method: 'quick_kanban.api.move_card',
            args: {
              board_name: state.config.board_name,
              name: cardName,
              value: state.columns[toColumn].column_name,
              expected_modified: card?.modified,
              workflow_action: workflowAction || undefined,
            },
          })
          if (state.boardGeneration !== boardGeneration) return
          if (response?.message?.modified) {
            commit('UPDATE_CARD_MODIFIED', {
              cardName,
              modified: response.message.modified,
            })
          }
          commit('CLEAR_CARD_MOVE_OPTIONS', cardName)
          commit('INVALIDATE_COUNT_RESPONSES')
          commit('ADJUST_COLUMN_OFFSET', {
            columnIndex: fromColumn,
            delta: -1,
          })
          commit('ADJUST_COLUMN_OFFSET', {
            columnIndex: toColumn,
            delta: 1,
          })
          commit('ADJUST_COLUMN_TOTAL', {
            columnIndex: fromColumn,
            delta: -1,
          })
          commit('ADJUST_COLUMN_TOTAL', {
            columnIndex: toColumn,
            delta: 1,
          })
          const destinationColumn = state.columns[toColumn]
          const destinationLabel = destinationColumn.display_name
            || destinationColumn.column_name
          frappe.show_alert({
            message: __('Card moved to {0}', [destinationLabel]),
            indicator: 'green',
          })
          commit(
            'SET_ANNOUNCEMENT',
            __('Card moved to {0}', [destinationLabel]),
          )
          dispatch('scheduleMoveOptionsRefresh')
        } catch (error) {
          if (state.boardGeneration === boardGeneration) {
            commit('ROLLBACK_CARD_MOVE', {
              cardName,
              fromColumn,
              toColumn,
              fromIndex,
            })
            reportMoveFailure(commit, null, state.config, error)
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

        const preflight = runPreflightMove(state, commit, payload)
        if (!preflight.allowed) {
          reportMoveFailure(commit, preflight, state.config)
          return false
        }

        let workflowAction = payload.workflowAction || null
        const policy = preflight.policy
        if (policy?.mode === 'workflow' && (policy.actions?.length || 0) > 1) {
          try {
            workflowAction = await dispatch('resolveWorkflowAction', {
              cardName: payload.cardName,
              column: state.columns[payload.toColumn],
            })
          } catch {
            return false
          }
        } else if (policy?.actions?.length === 1) {
          workflowAction = policy.actions[0].action
        }

        const movePayload = { ...payload, workflowAction }
        const recheck = runPreflightMove(state, commit, movePayload)
        if (!recheck.allowed) {
          reportMoveFailure(commit, recheck, state.config)
          return false
        }

        commit('MOVE_CARD', movePayload)
        await dispatch('persistMove', movePayload)
        return true
      },
      async persistMovedCard({ commit, dispatch, state }, payload) {
        if (state.pendingMoves[payload.cardName]) {
          commit('ROLLBACK_CARD_MOVE', payload)
          return buildDragMoveFailureResult(payload)
        }
        if (
          isColumnLoading(state, payload.fromColumn) ||
          isColumnLoading(state, payload.toColumn)
        ) {
          commit('ROLLBACK_CARD_MOVE', payload)
          return buildDragMoveFailureResult(payload, { reason: 'loading' })
        }

        const preflight = runPreflightMove(state, commit, payload)
        if (!preflight.allowed) {
          commit('ROLLBACK_CARD_MOVE', payload)
          reportMoveFailure(commit, preflight, state.config)
          return buildDragMoveFailureResult(payload, preflight)
        }

        let workflowAction = payload.workflowAction || null
        const policy = preflight.policy
        if (policy?.mode === 'workflow' && (policy.actions?.length || 0) > 1) {
          try {
            workflowAction = await dispatch('resolveWorkflowAction', {
              cardName: payload.cardName,
              column: state.columns[payload.toColumn],
            })
          } catch {
            commit('ROLLBACK_CARD_MOVE', payload)
            return {
              ok: false,
              cancelled: true,
              needsAnimatedRollback: true,
              payload,
            }
          }
        } else if (policy?.actions?.length === 1) {
          workflowAction = policy.actions[0].action
        }

        const movePayload = { ...payload, workflowAction }
        const recheck = runPreflightMove(state, commit, movePayload)
        if (!recheck.allowed) {
          commit('ROLLBACK_CARD_MOVE', movePayload)
          reportMoveFailure(commit, recheck, state.config)
          return buildDragMoveFailureResult(movePayload, recheck)
        }

        try {
          await dispatch('persistMove', movePayload)
          return { ok: true }
        } catch (error) {
          return buildDragMoveFailureResult(movePayload, null, error)
        }
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
      isMoveOptionsLoading: (state) => state.moveOptionsLoading,
      getCardMoveOptions: (state) => (cardName) => state.moveOptionsByCard[cardName],
      getAllowedDestinations: (state) => (cardName) => {
        if (
          !state.moveOptionsByCard[cardName] &&
          !state.moveOptionsLoaded &&
          !globalThis.__quickKanbanPermissiveMoves
        ) {
          return []
        }
        return state.columns
          .map((column, columnIndex) => {
            const policy = getDestinationPolicy(state, cardName, column)
            const card = findCard(state, cardName)
            if (!card || !policy.allowed) {
              return null
            }
            const validation = validateMoveMandatory(
              card,
              { ...column, moveOptions: policy },
              state.config,
              null,
              policy.missing_mandatory,
            )
            if (!validation.valid) {
              return null
            }
            return { columnIndex, column, policy }
          })
          .filter(Boolean)
      },
      canDragCard: (state, getters) => (cardName) => {
        if (!isMoveReady(state, cardName)) {
          return false
        }
        return getters.getAllowedDestinations(cardName).length > 0
      },
      isDropAllowed: (state) => ({ cardName, columnIndex }) => {
        const column = state.columns[columnIndex]
        if (!column || !cardName) {
          return false
        }
        const policy = getDestinationPolicy(state, cardName, column)
        if (!policy.allowed) {
          return false
        }
        const card = findCard(state, cardName)
        if (!card) {
          return false
        }
        return validateMoveMandatory(
          card,
          { ...column, moveOptions: policy },
          state.config,
          null,
          policy.missing_mandatory,
        ).valid
      },
      activeDragCard: (state) => state.activeDrag,
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