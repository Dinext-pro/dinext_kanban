import { createStore } from 'vuex'
import {
  attachColumnDisplayNames,
  flattenCardsFromColumns,
  getAddableColumnCandidates,
  groupCardsByColumn,
  getColumnKey,
  isActiveColumn,
  mapAssignments,
  normalizeBoardConfig,
  parseSelectOptions,
  resolveCardLinkTitles,
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
import {
  TAG_DRAG_MODE_MOVE,
  appendTagToList,
  canDropTag,
  removeTagFromList,
} from './tagDragDrop'

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
  color_field: '',
  color_field_meta: null,
  highlight_table: [],
  show_labels: false,
  show_tags: false,
})

function withColumnDisplayNames(columns, config) {
  return attachColumnDisplayNames(columns, config.status_field_meta)
}

function visibleBoardColumns(columns) {
  return (columns || []).filter(isActiveColumn)
}

function archivedBoardColumns(columns, config) {
  return withColumnDisplayNames(
    (columns || [])
      .filter((column) => column?.status === 'Archived')
      .map(({ cards: _cards, ...columnMeta }) => columnMeta),
    config,
  )
}

function resolveBoardPerms(overrides) {
  if (overrides && typeof overrides === 'object') {
    return { ...overrides, write: Boolean(overrides.write) }
  }
  const curListPerms = globalThis.window?.cur_list?.board_perms
  if (curListPerms && typeof curListPerms === 'object') {
    return { ...curListPerms, write: Boolean(curListPerms.write) }
  }
  return { write: false }
}

function mergeColumnsPreservingCards(savedColumns, currentColumns, config) {
  const cardsByName = new Map(
    currentColumns.map((column) => [column.column_name, column.cards || []]),
  )
  return withColumnDisplayNames(
    visibleBoardColumns(savedColumns).map((column) => ({
      ...column,
      cards: cardsByName.get(column.column_name) || [],
    })),
    config,
  )
}

/**
 * Keep Frappe ListView's cached board columns in sync after board mutations.
 * Returning to a cached Kanban page rehydrates from cur_list.board without
 * re-fetching the doc, so unsynced column metadata (indicator, order) would
 * overwrite Vuex with stale values.
 */
function syncCachedListBoardColumns(board) {
  const list = globalThis.window?.cur_list
  if (!list?.board || !Array.isArray(board?.columns)) {
    return
  }

  const cachedName = list.board_name || list.board.name
  const incomingName = board.name
  if (incomingName && cachedName && incomingName !== cachedName) {
    return
  }

  list.board.columns = board.columns.map((column) => ({ ...column }))
}

function reorderColumnsByName(columns, columnNames) {
  const byName = new Map(columns.map((column) => [column.column_name, column]))
  const reordered = columnNames
    .map((name) => byName.get(name))
    .filter(Boolean)
  for (const column of columns) {
    if (!reordered.includes(column)) {
      reordered.push(column)
    }
  }
  return reordered
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

function promoteRecentCreatesToTop(columns, recentCreatedCards, _fieldName) {
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
      activeTagDrag: null,
      tagDragHoverCard: null,
      dragSyncGeneration: 0,
      createOptionsByColumn: {},
      pendingCreate: null,
      recentCreatedCards: {},
      boardPerms: { write: false },
      cardMoveFlash: {},
      minimize_cards: false,
      // Card name that should stay expanded across drag remounts (minimize mode).
      densityHoldExpandedCard: null,
      // Cards that must stay minimized after tag-drag until intentional expand.
      densityForceCollapsedCards: {},
      collapsedColumns: {},
      archivedColumns: [],
      activeInlineEdit: null,
      pendingFieldUpdates: {},
      linkTitlesVersion: 0,
    }),
    mutations: {
      SET_MINIMIZE_CARDS(state, minimizeCards) {
        state.minimize_cards = Boolean(minimizeCards)
        if (!state.minimize_cards) {
          state.densityHoldExpandedCard = null
          state.densityForceCollapsedCards = {}
        }
      },
      SET_COLLAPSED_COLUMNS(state, collapsedColumns) {
        state.collapsedColumns = { ...(collapsedColumns || {}) }
      },
      SET_COLUMN_COLLAPSED(state, { columnKey, collapsed }) {
        if (!columnKey) {
          return
        }
        if (collapsed) {
          state.collapsedColumns = {
            ...state.collapsedColumns,
            [columnKey]: true,
          }
          return
        }
        const { [columnKey]: _removed, ...rest } = state.collapsedColumns
        state.collapsedColumns = rest
      },
      SET_DENSITY_HOLD_EXPANDED(state, cardName) {
        state.densityHoldExpandedCard = cardName || null
        if (cardName && state.densityForceCollapsedCards[cardName]) {
          const { [cardName]: _removed, ...rest } = state.densityForceCollapsedCards
          state.densityForceCollapsedCards = rest
        }
      },
      CLEAR_DENSITY_HOLD_EXPANDED(state, cardName = null) {
        if (cardName && state.densityHoldExpandedCard !== cardName) {
          return
        }
        state.densityHoldExpandedCard = null
      },
      FORCE_DENSITY_COLLAPSE(state, cardName) {
        if (!cardName) {
          return
        }
        state.densityForceCollapsedCards = {
          ...state.densityForceCollapsedCards,
          [cardName]: true,
        }
        if (state.densityHoldExpandedCard === cardName) {
          state.densityHoldExpandedCard = null
        }
      },
      CLEAR_FORCE_DENSITY_COLLAPSE(state, cardName = null) {
        if (!cardName) {
          state.densityForceCollapsedCards = {}
          return
        }
        if (!state.densityForceCollapsedCards[cardName]) {
          return
        }
        const { [cardName]: _removed, ...rest } = state.densityForceCollapsedCards
        state.densityForceCollapsedCards = rest
      },
      SET_COLUMNS(state, columns) {
        state.columns = columns
      },
      SET_ARCHIVED_COLUMNS(state, columns) {
        state.archivedColumns = columns || []
      },
      REMOVE_COLUMN(state, columnIndex) {
        const column = state.columns[columnIndex]
        if (!column) return
        const key = getColumnKey(column)
        state.columns = state.columns.filter((_, index) => index !== columnIndex)
        const { [key]: _removedPagination, ...columnPagination } = state.columnPagination
        state.columnPagination = columnPagination
        const { [key]: _removedTotal, ...columnTotals } = state.columnTotals
        state.columnTotals = columnTotals
        const { [key]: _removedCollapsed, ...collapsedColumns } = state.collapsedColumns
        state.collapsedColumns = collapsedColumns
      },
      RESTORE_COLUMN_LAYOUT(state, { columns, columnPagination, columnTotals }) {
        state.columns = columns
        state.columnPagination = columnPagination
        state.columnTotals = columnTotals
      },
      SET_BOARD_PERMS(state, boardPerms) {
        state.boardPerms = boardPerms
      },
      REORDER_COLUMNS(state, columnNames) {
        state.columns = reorderColumnsByName(state.columns, columnNames)
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
      BUMP_LINK_TITLES_VERSION(state) {
        state.linkTitlesVersion += 1
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
        state.activeTagDrag = null
        state.tagDragHoverCard = null
        state.densityHoldExpandedCard = null
        state.densityForceCollapsedCards = {}
        state.activeInlineEdit = null
        state.pendingFieldUpdates = {}
        state.linkTitlesVersion = 0
      },
      SET_ACTIVE_INLINE_EDIT(state, payload) {
        state.activeInlineEdit = payload
          ? {
              cardName: payload.cardName,
              fieldname: payload.fieldname,
            }
          : null
      },
      CLEAR_ACTIVE_INLINE_EDIT(state) {
        state.activeInlineEdit = null
      },
      SET_FIELD_UPDATE_PENDING(state, { cardName, fieldname, pending }) {
        const key = `${cardName}::${fieldname}`
        if (pending) {
          state.pendingFieldUpdates = {
            ...state.pendingFieldUpdates,
            [key]: true,
          }
          return
        }
        const pendingFieldUpdates = { ...state.pendingFieldUpdates }
        delete pendingFieldUpdates[key]
        state.pendingFieldUpdates = pendingFieldUpdates
      },
      UPDATE_CARD_FIELD(state, { cardName, fieldname, value, modified }) {
        for (const column of state.columns) {
          const card = column.cards.find(({ name }) => name === cardName)
          if (card) {
            card[fieldname] = value
            if (modified) {
              card.modified = modified
            }
            break
          }
        }
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
      SET_ACTIVE_TAG_DRAG(state, activeTagDrag) {
        state.activeTagDrag = activeTagDrag || null
        if (!activeTagDrag) {
          state.tagDragHoverCard = null
        }
      },
      CLEAR_ACTIVE_TAG_DRAG(state) {
        state.activeTagDrag = null
        state.tagDragHoverCard = null
      },
      SET_TAG_DRAG_HOVER(state, cardName) {
        state.tagDragHoverCard = cardName || null
      },
      SET_CARD_MOVE_FLASH(state, { cardName, outcome, instant }) {
        state.cardMoveFlash = {
          ...state.cardMoveFlash,
          [cardName]: { outcome, instant: Boolean(instant) },
        }
      },
      CLEAR_CARD_MOVE_FLASH(state, cardName) {
        if (!state.cardMoveFlash[cardName]) {
          return
        }
        const cardMoveFlash = { ...state.cardMoveFlash }
        delete cardMoveFlash[cardName]
        state.cardMoveFlash = cardMoveFlash
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
      hydrateFromList({ commit, dispatch, state }, {
        board,
        cards = [],
        args = {},
        board_perms,
      }) {
        commit('BEGIN_BOARD_CONTEXT')
        commit('SET_CONFIG_REQUEST_BOARD', '')
        commit('SET_LOADING', false)
        commit('SET_BOARD_PERMS', resolveBoardPerms(board_perms))
        const config = normalizeBoardConfig(
          board,
          frappe.get_meta(board.reference_doctype),
        )
        const columns = withColumnDisplayNames(
          visibleBoardColumns(board.columns).map((column) => ({ ...column, cards: [] })),
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
          'SET_ARCHIVED_COLUMNS',
          archivedBoardColumns(board.columns, config),
        )
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
        dispatch('hydrateCardLinkTitles', {
          cards: flattenCardsFromColumns(columns),
          boardGeneration: state.boardGeneration,
        })
      },
      async hydrateCardLinkTitles(
        { commit, state },
        {
          cards,
          boardGeneration = state.boardGeneration,
          dataRequestId = null,
          columnRequestGeneration = null,
        } = {},
      ) {
        const didFetch = await resolveCardLinkTitles(cards || [], state.config)
        if (
          state.boardGeneration !== boardGeneration
          || (dataRequestId != null && state.dataRequestId !== dataRequestId)
          || (
            columnRequestGeneration != null
            && state.columnRequestGeneration !== columnRequestGeneration
          )
        ) {
          return false
        }
        if (didFetch) {
          commit('BUMP_LINK_TITLES_VERSION')
        }
        return didFetch
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
            visibleBoardColumns(board.columns).map((column) => ({ ...column, cards: [] })),
            config,
          ))
          commit(
            'SET_ARCHIVED_COLUMNS',
            archivedBoardColumns(board.columns, config),
          )
          commit(
            'SET_COLUMN_PAGINATION',
            createColumnPagination(state.columns, true),
          )
          commit('SET_KANBAN_CONFIG', config)
          commit('SET_BOARD_PERMS', resolveBoardPerms())
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
          dispatch('hydrateCardLinkTitles', {
            cards: flattenCardsFromColumns(columns),
            boardGeneration,
            dataRequestId: requestId,
          })
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
          dispatch('hydrateCardLinkTitles', {
            cards: pageColumn.cards,
            boardGeneration,
            columnRequestGeneration,
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
        commit('SET_ARCHIVED_COLUMNS', [])
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
        dispatch('hydrateCardLinkTitles', {
          cards: [card],
          boardGeneration: state.boardGeneration,
        })
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
      async updateCardField(
        { commit, state },
        { cardName, fieldname, value, previousValue },
      ) {
        const card = findCard(state, cardName)
        if (!card || !state.config.ref_doctype || !fieldname) {
          return false
        }
        if (state.pendingFieldUpdates[`${cardName}::${fieldname}`]) {
          return false
        }

        const priorValue = previousValue !== undefined
          ? previousValue
          : card[fieldname]
        commit('SET_FIELD_UPDATE_PENDING', {
          cardName,
          fieldname,
          pending: true,
        })
        commit('UPDATE_CARD_FIELD', {
          cardName,
          fieldname,
          value,
        })

        try {
          const response = await frappe.db.set_value(
            state.config.ref_doctype,
            cardName,
            { [fieldname]: value },
          )
          const saved = response?.message || response
          commit('UPDATE_CARD_FIELD', {
            cardName,
            fieldname: fieldname,
            value: saved?.[fieldname] ?? value,
            modified: saved?.modified,
          })
          if (typeof frappe.model?.clear_doc === 'function') {
            frappe.model.clear_doc(state.config.ref_doctype, cardName)
          }
          frappe.show_alert({
            message: __('Field updated.', null, 'QuickKanban.Inline'),
            indicator: 'green',
          })
          return true
        } catch (error) {
          commit('UPDATE_CARD_FIELD', {
            cardName,
            fieldname,
            value: priorValue,
          })
          frappe.show_alert({
            message: __('Could not update the field.', null, 'QuickKanban.Inline'),
            indicator: 'red',
          })
          throw error
        } finally {
          commit('SET_FIELD_UPDATE_PENDING', {
            cardName,
            fieldname,
            pending: false,
          })
        }
      },
      async persistTagTransfer(
        { commit, state },
        { tag, mode, doctype, sourceCardName, targetCardName },
      ) {
        if (!tag || !doctype || !sourceCardName || !targetCardName) {
          return false
        }
        const sourceCard = findCard(state, sourceCardName)
        const targetCard = findCard(state, targetCardName)
        if (!sourceCard || !targetCard) {
          return false
        }

        const previousSourceTags = sourceCard._user_tags || ''
        const previousTargetTags = targetCard._user_tags || ''
        if (!canDropTag({
          tag,
          sourceName: sourceCardName,
          targetName: targetCardName,
          targetUserTags: previousTargetTags,
        })) {
          return false
        }

        const nextTargetTags = appendTagToList(previousTargetTags, tag)
        const nextSourceTags = mode === TAG_DRAG_MODE_MOVE
          ? removeTagFromList(previousSourceTags, tag)
          : previousSourceTags

        commit('UPDATE_CARD_FIELD', {
          cardName: targetCardName,
          fieldname: '_user_tags',
          value: nextTargetTags,
        })
        if (mode === TAG_DRAG_MODE_MOVE) {
          commit('UPDATE_CARD_FIELD', {
            cardName: sourceCardName,
            fieldname: '_user_tags',
            value: nextSourceTags,
          })
        }

        try {
          await frappe.call({
            method: 'frappe.desk.doctype.tag.tag.add_tag',
            args: {
              tag,
              dt: doctype,
              dn: targetCardName,
            },
          })
          if (mode === TAG_DRAG_MODE_MOVE) {
            await frappe.call({
              method: 'frappe.desk.doctype.tag.tag.remove_tag',
              args: {
                tag,
                dt: doctype,
                dn: sourceCardName,
              },
            })
          }
          return true
        } catch (_error) {
          commit('UPDATE_CARD_FIELD', {
            cardName: targetCardName,
            fieldname: '_user_tags',
            value: previousTargetTags,
          })
          if (mode === TAG_DRAG_MODE_MOVE) {
            commit('UPDATE_CARD_FIELD', {
              cardName: sourceCardName,
              fieldname: '_user_tags',
              value: previousSourceTags,
            })
          }
          frappe.show_alert({
            message: __('Could not update tags.', null, 'QuickKanban.Tags'),
            indicator: 'red',
          })
          return false
        }
      },
      async setIndicator({ commit, state }, { indicator, columnIndex }) {
        try {
          const response = await frappe.call({
            method: 'frappe.desk.doctype.kanban_board.kanban_board.set_indicator',
            args: {
              board_name: state.config.board_name,
              column_name: state.columns[columnIndex].column_name,
              indicator,
            },
          })
          commit('UPDATE_COLUMN_INDICATOR', { columnIndex, indicator })
          const savedBoard = response.message
          if (savedBoard?.columns) {
            syncCachedListBoardColumns(savedBoard)
          } else {
            syncCachedListBoardColumns({
              name: state.config.board_name,
              columns: state.columns.map(({ cards: _cards, ...columnMeta }) => columnMeta),
            })
          }
        } catch (error) {
          frappe.show_alert({
            message: __('Could not update the column color.'),
            indicator: 'red',
          })
          throw error
        }
      },
      async hideColumn({ commit, state, getters }, { columnIndex }) {
        if (!getters.canEditBoard) {
          return
        }
        const column = state.columns[columnIndex]
        if (!column) {
          return
        }

        const previousColumns = state.columns.map((item) => ({
          ...item,
          cards: [...(item.cards || [])],
        }))
        const previousArchived = state.archivedColumns.map((item) => ({ ...item }))
        const previousPagination = { ...state.columnPagination }
        const previousTotals = { ...state.columnTotals }
        const { cards: _cards, ...columnMeta } = column

        commit('REMOVE_COLUMN', columnIndex)
        commit('SET_ARCHIVED_COLUMNS', [
          ...previousArchived,
          { ...columnMeta, status: 'Archived' },
        ])
        try {
          const response = await frappe.call({
            method: 'frappe.desk.doctype.kanban_board.kanban_board.archive_restore_column',
            args: {
              board_name: state.config.board_name,
              column_title: column.column_name,
              status: 'Archived',
            },
          })
          const savedColumns = Array.isArray(response.message)
            ? response.message
            : response.message?.columns
          if (Array.isArray(savedColumns)) {
            syncCachedListBoardColumns({
              name: state.config.board_name,
              columns: savedColumns,
            })
            commit(
              'SET_ARCHIVED_COLUMNS',
              archivedBoardColumns(savedColumns, state.config),
            )
          } else {
            syncCachedListBoardColumns({
              name: state.config.board_name,
              columns: previousColumns.map(({ cards: _cards, ...meta }) => ({
                ...meta,
                status: meta.column_name === column.column_name
                  ? 'Archived'
                  : meta.status,
              })),
            })
          }
        } catch (error) {
          commit('RESTORE_COLUMN_LAYOUT', {
            columns: previousColumns,
            columnPagination: previousPagination,
            columnTotals: previousTotals,
          })
          commit('SET_ARCHIVED_COLUMNS', previousArchived)
          frappe.show_alert({
            message: __('Could not hide the column.'),
            indicator: 'red',
          })
          throw error
        }
      },
      async restoreColumn({ commit, dispatch, state, getters }, { column_title }) {
        if (!getters.canEditBoard || !column_title) {
          return
        }
        const archivedColumn = state.archivedColumns.find(
          (column) => column.column_name === column_title,
        )
        if (!archivedColumn) {
          return
        }

        const previousColumns = state.columns.map((item) => ({
          ...item,
          cards: [...(item.cards || [])],
        }))
        const previousArchived = state.archivedColumns.map((item) => ({ ...item }))
        const previousPagination = { ...state.columnPagination }
        const previousTotals = { ...state.columnTotals }
        const restoredMeta = {
          ...archivedColumn,
          status: 'Active',
          cards: [],
        }
        const restoredKey = getColumnKey(restoredMeta)

        commit(
          'SET_ARCHIVED_COLUMNS',
          previousArchived.filter((column) => column.column_name !== column_title),
        )
        commit(
          'SET_COLUMNS',
          withColumnDisplayNames(
            [...previousColumns, restoredMeta],
            state.config,
          ),
        )
        commit('SET_COLUMN_PAGINATION', {
          ...previousPagination,
          [restoredKey]: {
            offset: 0,
            loading: false,
            hasMore: true,
          },
        })

        try {
          const response = await frappe.call({
            method: 'frappe.desk.doctype.kanban_board.kanban_board.archive_restore_column',
            args: {
              board_name: state.config.board_name,
              column_title,
              status: 'Active',
            },
          })
          const savedColumns = Array.isArray(response.message)
            ? response.message
            : response.message?.columns
          if (Array.isArray(savedColumns)) {
            commit(
              'SET_COLUMNS',
              mergeColumnsPreservingCards(
                savedColumns,
                state.columns,
                state.config,
              ),
            )
            commit(
              'SET_ARCHIVED_COLUMNS',
              archivedBoardColumns(savedColumns, state.config),
            )
            syncCachedListBoardColumns({
              name: state.config.board_name,
              columns: savedColumns,
            })
          } else {
            syncCachedListBoardColumns({
              name: state.config.board_name,
              columns: [
                ...previousColumns.map(({ cards: _cards, ...meta }) => ({
                  ...meta,
                  status: meta.status === 'Archived' ? meta.status : 'Active',
                })),
                { ...archivedColumn, status: 'Active' },
                ...previousArchived
                  .filter((column) => column.column_name !== column_title)
                  .map((column) => ({ ...column, status: 'Archived' })),
              ],
            })
          }

          const pagination = { ...state.columnPagination }
          for (const column of state.columns) {
            const key = getColumnKey(column)
            if (!pagination[key]) {
              pagination[key] = {
                offset: column.cards?.length || 0,
                loading: false,
                hasMore: true,
              }
            }
          }
          for (const key of Object.keys(pagination)) {
            if (!state.columns.some((column) => getColumnKey(column) === key)) {
              delete pagination[key]
            }
          }
          commit('SET_COLUMN_PAGINATION', pagination)
        } catch (error) {
          commit('RESTORE_COLUMN_LAYOUT', {
            columns: previousColumns,
            columnPagination: previousPagination,
            columnTotals: previousTotals,
          })
          commit('SET_ARCHIVED_COLUMNS', previousArchived)
          frappe.show_alert({
            message: __('Could not add the column.'),
            indicator: 'red',
          })
          throw error
        }

        try {
          await dispatch('fetchColumnTotals')
          const restoredIndex = findColumnIndexByName(state, column_title)
          if (restoredIndex >= 0) {
            const total = state.columnTotals[restoredKey]
            const target = Number.isFinite(total)
              ? Math.min(initialColumnCardMinimum, total)
              : state.columnPageSize
            let loaded = state.columns[restoredIndex]?.cards?.length || 0
            while (loaded < target) {
              const pageState = state.columnPagination[restoredKey]
              if (!pageState?.hasMore || pageState.loading) {
                break
              }
              const previousOffset = pageState.offset
              await dispatch('loadColumnPage', {
                columnIndex: restoredIndex,
                pageSize: target - loaded,
              })
              loaded = state.columns[restoredIndex]?.cards?.length || 0
              if (state.columnPagination[restoredKey]?.offset === previousOffset) {
                break
              }
            }
          }
        } catch {
          // Column is already restored on the board; card loading can retry via refresh.
        }
      },
      async addColumn({ commit, dispatch, state, getters }, { column_title }) {
        if (!getters.canEditBoard || !column_title) {
          return
        }
        if (state.archivedColumns.some((column) => column.column_name === column_title)) {
          return dispatch('restoreColumn', { column_title })
        }
        if (state.columns.some((column) => column.column_name === column_title)) {
          return
        }

        const previousColumns = state.columns.map((item) => ({
          ...item,
          cards: [...(item.cards || [])],
        }))
        const previousArchived = state.archivedColumns.map((item) => ({ ...item }))
        const previousPagination = { ...state.columnPagination }
        const previousTotals = { ...state.columnTotals }
        const addedMeta = withColumnDisplayNames(
          [{ column_name: column_title, status: 'Active', cards: [] }],
          state.config,
        )[0]
        const addedKey = getColumnKey(addedMeta)

        commit(
          'SET_COLUMNS',
          withColumnDisplayNames(
            [...previousColumns, addedMeta],
            state.config,
          ),
        )
        commit('SET_COLUMN_PAGINATION', {
          ...previousPagination,
          [addedKey]: {
            offset: 0,
            loading: false,
            hasMore: true,
          },
        })

        try {
          const response = await frappe.call({
            method: 'frappe.desk.doctype.kanban_board.kanban_board.add_column',
            args: {
              board_name: state.config.board_name,
              column_title,
            },
          })
          const savedColumns = Array.isArray(response.message)
            ? response.message
            : response.message?.columns
          if (Array.isArray(savedColumns)) {
            commit(
              'SET_COLUMNS',
              mergeColumnsPreservingCards(
                savedColumns,
                state.columns,
                state.config,
              ),
            )
            commit(
              'SET_ARCHIVED_COLUMNS',
              archivedBoardColumns(savedColumns, state.config),
            )
            syncCachedListBoardColumns({
              name: state.config.board_name,
              columns: savedColumns,
            })
          } else {
            syncCachedListBoardColumns({
              name: state.config.board_name,
              columns: [
                ...previousColumns.map(({ cards: _cards, ...meta }) => meta),
                { column_name: column_title, status: 'Active' },
                ...previousArchived.map((column) => ({
                  ...column,
                  status: 'Archived',
                })),
              ],
            })
          }

          const pagination = { ...state.columnPagination }
          for (const column of state.columns) {
            const key = getColumnKey(column)
            if (!pagination[key]) {
              pagination[key] = {
                offset: column.cards?.length || 0,
                loading: false,
                hasMore: true,
              }
            }
          }
          for (const key of Object.keys(pagination)) {
            if (!state.columns.some((column) => getColumnKey(column) === key)) {
              delete pagination[key]
            }
          }
          commit('SET_COLUMN_PAGINATION', pagination)
        } catch (error) {
          commit('RESTORE_COLUMN_LAYOUT', {
            columns: previousColumns,
            columnPagination: previousPagination,
            columnTotals: previousTotals,
          })
          commit('SET_ARCHIVED_COLUMNS', previousArchived)
          frappe.show_alert({
            message: __('Could not add the column.'),
            indicator: 'red',
          })
          throw error
        }

        try {
          await dispatch('fetchColumnTotals')
          const addedIndex = findColumnIndexByName(state, column_title)
          if (addedIndex >= 0) {
            const total = state.columnTotals[addedKey]
            const target = Number.isFinite(total)
              ? Math.min(initialColumnCardMinimum, total)
              : state.columnPageSize
            let loaded = state.columns[addedIndex]?.cards?.length || 0
            while (loaded < target) {
              const pageState = state.columnPagination[addedKey]
              if (!pageState?.hasMore || pageState.loading) {
                break
              }
              const previousOffset = pageState.offset
              await dispatch('loadColumnPage', {
                columnIndex: addedIndex,
                pageSize: target - loaded,
              })
              loaded = state.columns[addedIndex]?.cards?.length || 0
              if (state.columnPagination[addedKey]?.offset === previousOffset) {
                break
              }
            }
          }
        } catch {
          // Column is already on the board; card loading can retry via refresh.
        }
      },
      async updateColumnOrder({ commit, state }, order) {
        if (!Array.isArray(order) || order.length < 2) {
          return
        }

        const previousOrder = state.columns.map((column) => column.column_name)
        if (order.join('\0') === previousOrder.join('\0')) {
          return
        }

        commit('REORDER_COLUMNS', order)
        try {
          const response = await frappe.call({
            method: 'frappe.desk.doctype.kanban_board.kanban_board.update_column_order',
            args: {
              board_name: state.config.board_name,
              order: JSON.stringify(order),
            },
          })
          const savedBoard = response.message
          if (savedBoard?.columns) {
            commit(
              'SET_COLUMNS',
              mergeColumnsPreservingCards(
                savedBoard.columns,
                state.columns,
                state.config,
              ),
            )
            syncCachedListBoardColumns({
              name: state.config.board_name,
              ...savedBoard,
            })
          }
        } catch (error) {
          commit('REORDER_COLUMNS', previousOrder)
          frappe.show_alert({
            message: __('Could not reorder the columns.'),
            indicator: 'red',
          })
          throw error
        }
      },
    },
    getters: {
      getColumns: (state) => state.columns,
      getArchivedColumns: (state) => state.archivedColumns,
      getAddableColumns: (state) => getAddableColumnCandidates({
        options: parseSelectOptions(state.config?.status_field_meta),
        activeNames: state.columns.map((column) => column.column_name),
        archivedColumns: state.archivedColumns,
        statusFieldMeta: state.config?.status_field_meta,
      }),
      getConfig: (state) => state.config,
      isMinimizeCards: (state) => state.minimize_cards,
      isColumnCollapsed: (state) => (columnKey) => Boolean(state.collapsedColumns[columnKey]),
      canEditBoard: (state) => Boolean(state.boardPerms?.write),
      isMovePending: (state) => (cardName) => Boolean(state.pendingMoves[cardName]),
      isFieldUpdatePending: (state) => (cardName, fieldname) =>
        Boolean(state.pendingFieldUpdates[`${cardName}::${fieldname}`]),
      isCardInlineBusy: (state) => (cardName) => {
        if (state.activeInlineEdit?.cardName === cardName) {
          return true
        }
        return Object.keys(state.pendingFieldUpdates).some((key) =>
          key.startsWith(`${cardName}::`),
        )
      },
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
        if (getters.isCardInlineBusy(cardName)) {
          return false
        }
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
      activeTagDrag: (state) => state.activeTagDrag,
      tagDragHoverCard: (state) => state.tagDragHoverCard,
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