import { createStore } from 'vuex'
import {
  attachColumnDisplayNames,
  cardMatchesLane,
  cellKey,
  flattenCardsFromColumns,
  getAddableColumnCandidates,
  groupCardsByColumn,
  getColumnKey,
  filterBoardChildCards,
  filterColumnsChildCards,
  ensureArgsIncludeParentField,
  isActiveColumn,
  mapAssignments,
  normalizeBoardConfig,
  parseSelectOptions,
  resolveCardLinkTitles,
} from './kanban'
import {
  buildEmptyLaneColumns,
  cardsFromPageMessage,
  createCellPagination,
  forEachCardInstance,
  getCellPaginationKey,
  getExpandedLaneKeys,
  laneTotalFromCells,
  normalizeExpandedLaneKeys,
  reconcileCardInstancesAcrossLanes,
  removeAllCardInstances,
  resolveExpandedLaneKeys,
  restoreCardInstances,
  sortLanesByOccupancy,
  findCardInLanes,
} from './swimlaneBoard'
import {
  buildMoveFailureAnnouncement,
  showMoveFailureAlert,
} from './moveFailure'
import {
  buildParentCreateDefaults,
  listParentCreateCandidateFields,
  openCreateForm,
  resolveCreateFormMode,
  showCreateBlockedMessage,
} from './createValidation'
import { buildSwimlaneCreateDefaults } from './swimlaneCreate'
import { validateMoveMandatory } from './moveValidation'
import {
  TAG_DRAG_MODE_MOVE,
  appendTagToList,
  canDropTag,
  removeTagFromList,
} from './tagDragDrop'
import {
  buildEmptyChildColumns,
  childPanelKey,
  createChildColumnPagination,
} from './childPanelBoard'
import {
  hydrateDeadlineHolidayContext,
  fieldAffectsDeadlineBucket,
  refreshCardDeadlineBucket,
} from './deadline'

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
  parent_field: '',
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
  show_extra_info: false,
  swimlane_field: '',
  swimlane_field_meta: null,
  swimlane_mode: 'off',
  swimlane_is_multi: false,
  swimlane_link_field: '',
  deadline_field: '',
  deadline_attention_days: 3,
  deadline_columns: [],
  deadline_enabled: false,
})

function withColumnDisplayNames(columns, config) {
  return attachColumnDisplayNames(columns, config.status_field_meta)
}

function visibleBoardColumns(columns) {
  return (columns || []).filter(isActiveColumn)
}

function applyChildTaskVisibility(columns, state) {
  return filterColumnsChildCards(columns, {
    showChildTasks: state.show_child_tasks,
    parentField: state.config?.parent_field,
    boardNames: state.boardDocumentNames,
  })
}

function filterCardsForChildVisibility(cards, state) {
  return filterBoardChildCards(cards, {
    showChildTasks: state.show_child_tasks,
    parentField: state.config?.parent_field,
    boardNames: state.boardDocumentNames,
  })
}

async function ensureChildFilterReady({ dispatch, state }, args) {
  if (state.show_child_tasks || !state.config?.parent_field) {
    return true
  }
  if ((state.boardDocumentNames || []).length > 0) {
    return true
  }
  const names = await dispatch('hydrateBoardDocumentNames', { args })
  return Array.isArray(names) && names.length > 0
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

function forEachChildPanel(state, visitor) {
  for (const panel of Object.values(state.childPanels || {})) {
    if (panel) {
      visitor(panel)
    }
  }
}

function findCard(state, cardName) {
  if (state.lanes?.length) {
    for (const lane of state.lanes) {
      for (const column of lane.columns || []) {
        const card = column.cards.find(({ name }) => name === cardName)
        if (card) {
          return card
        }
      }
    }
  }
  for (const column of state.columns) {
    const card = column.cards.find(({ name }) => name === cardName)
    if (card) {
      return card
    }
  }
  for (const panel of Object.values(state.childPanels || {})) {
    for (const column of panel.columns || []) {
      const card = column.cards?.find(({ name }) => name === cardName)
      if (card) {
        return card
      }
    }
  }
  return null
}

function swimlanesActive(state) {
  return Boolean(state.config?.swimlane_mode && state.config.swimlane_mode !== 'off')
}

function isStatusFieldReadOnly(state) {
  return Boolean(state.config?.status_field_meta?.read_only)
}

function isSwimlaneFieldReadOnly(state) {
  if (state.config?.swimlane_mode === 'assign') {
    return false
  }
  if (state.config?.swimlane_mode === 'deadlines') {
    return true
  }
  return Boolean(state.config?.swimlane_field_meta?.read_only)
}

function canChangeLaneClient(state, _cardName) {
  if (!swimlanesActive(state)) {
    return false
  }
  if (state.config?.swimlane_mode === 'deadlines') {
    return false
  }
  if (isSwimlaneFieldReadOnly(state)) {
    return false
  }
  const doctype = state.config?.ref_doctype
  if (!doctype) {
    return false
  }
  const canWrite = globalThis.frappe?.model?.can_write
  if (typeof canWrite === 'function' && !canWrite(doctype)) {
    return false
  }
  return true
}

function findLaneIndexForCard(state, cardName) {
  for (let laneIndex = 0; laneIndex < (state.lanes || []).length; laneIndex += 1) {
    const lane = state.lanes[laneIndex]
    for (const column of lane.columns || []) {
      if ((column.cards || []).some((card) => card.name === cardName)) {
        return laneIndex
      }
    }
  }
  return -1
}

function multiSwimlaneActive(state) {
  return Boolean(
    swimlanesActive(state)
    && state.config?.swimlane_is_multi
    && state.lanes?.length,
  )
}

function canPrependReconcileCell(state, laneKey, columnName) {
  const lane = (state.lanes || []).find(
    (row) => String(row.key ?? '') === String(laneKey ?? ''),
  )
  if (!lane) {
    return false
  }
  const column = (lane.columns || []).find(
    (row) => row.column_name === columnName,
  )
  if (!column) {
    return false
  }
  const pagination = state.cellPagination[cellKey(laneKey, columnName)]
  if (!pagination || pagination.loading) {
    return false
  }
  if ((column.cards || []).length > 0) {
    return true
  }
  if (pagination.offset > 0) {
    return true
  }
  return pagination.hasMore === false
}

/**
 * Lane key that currently holds a board card by name, or null if not found.
 */
function findLaneKeyForCard(state, cardName) {
  const name = String(cardName || '').trim()
  if (!name) {
    return null
  }
  for (const lane of state.lanes || []) {
    for (const column of lane.columns || []) {
      if ((column.cards || []).some((card) => String(card?.name || '') === name)) {
        return String(lane.key ?? '')
      }
    }
  }
  return null
}

function fieldAffectsSwimlaneLayout(state, fieldname) {
  if (!fieldname) {
    return false
  }
  if (fieldname === state.config?.field_name) {
    return true
  }
  if (fieldname === '_assign' && state.config?.swimlane_mode === 'assign') {
    return true
  }
  if (
    state.config?.swimlane_mode === 'multi'
    && fieldname === state.config?.swimlane_field
  ) {
    return true
  }
  if (state.config?.swimlane_mode === 'deadlines') {
    if (fieldname === state.config?.deadline_field) {
      return true
    }
    if (fieldname === 'project') {
      return true
    }
  }
  return false
}

function collectVisibleCardNames(state) {
  const names = new Set()
  const visit = (columns) => {
    for (const column of columns || []) {
      for (const card of column.cards || []) {
        if (card?.name) {
          names.add(card.name)
        }
      }
    }
  }
  // Gate on swimlane_mode, not lanes.length — stale lanes after leaving
  // swimlane UI must not hide flat-board column cards from move-options.
  if (swimlanesActive(state) && state.lanes?.length) {
    for (const lane of state.lanes) {
      visit(lane.columns)
    }
  } else {
    visit(state.columns)
  }
  for (const panel of Object.values(state.childPanels || {})) {
    visit(panel?.columns)
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

  if (isStatusFieldReadOnly(state)) {
    return { allowed: false, reason: 'field_readonly' }
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
  if (
    config.swimlane_field
    && config.swimlane_field !== '__assign'
    && config.swimlane_field in doc
  ) {
    card[config.swimlane_field] = doc[config.swimlane_field]
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
      revealCreatedCard: null,
      recentCreatedCards: {},
      boardPerms: { write: false },
      cardMoveFlash: {},
      minimize_cards: false,
      show_child_tasks: false,
      boardDocumentNames: [],
      hiddenBoardChildNames: [],
      // Card name that should stay expanded across drag remounts (minimize mode).
      densityHoldExpandedCard: null,
      // Cards that must stay minimized after tag-drag until intentional expand.
      densityForceCollapsedCards: {},
      collapsedColumns: {},
      archivedColumns: [],
      activeInlineEdit: null,
      pendingFieldUpdates: {},
      linkTitlesVersion: 0,
      lanes: [],
      expandedLaneKeys: [],
      dragExpandedLaneKey: null,
      cellPagination: {},
      cellTotals: {},
      laneHydration: {},
      dragSourceLaneKey: null,
      childPanels: {},
      childPanelByDepth: {},
      nextChildPanelOrdinal: 0,
    }),
    mutations: {
      SET_MINIMIZE_CARDS(state, minimizeCards) {
        state.minimize_cards = Boolean(minimizeCards)
        if (!state.minimize_cards) {
          state.densityHoldExpandedCard = null
          state.densityForceCollapsedCards = {}
        }
      },
      SET_SHOW_CHILD_TASKS(state, showChildTasks) {
        state.show_child_tasks = Boolean(showChildTasks)
      },
      OPEN_CHILD_PANEL(state, panel) {
        if (!panel?.scopeId) {
          return
        }
        state.childPanels = {
          ...state.childPanels,
          [panel.scopeId]: panel,
        }
        state.childPanelByDepth = {
          ...state.childPanelByDepth,
          [panel.depth]: panel.scopeId,
        }
      },
      CLOSE_CHILD_PANELS_FROM_DEPTH(state, depth) {
        const minDepth = Number(depth)
        if (!Number.isFinite(minDepth)) {
          return
        }
        const nextByDepth = { ...state.childPanelByDepth }
        const nextPanels = { ...state.childPanels }
        for (const [depthKey, scopeId] of Object.entries(nextByDepth)) {
          if (Number(depthKey) >= minDepth) {
            delete nextByDepth[depthKey]
            delete nextPanels[scopeId]
          }
        }
        state.childPanelByDepth = nextByDepth
        state.childPanels = nextPanels
      },
      SET_CHILD_COLUMN_TOTALS(state, { scopeId, totals }) {
        const panel = state.childPanels[scopeId]
        if (!panel) {
          return
        }
        panel.columnTotals = { ...(totals || {}) }
      },
      SET_CHILD_COLUMN_PAGE_STATE(state, { scopeId, columnName, changes }) {
        const panel = state.childPanels[scopeId]
        if (!panel || !columnName) {
          return
        }
        panel.columnPagination = {
          ...panel.columnPagination,
          [columnName]: {
            ...(panel.columnPagination?.[columnName] || {
              offset: 0,
              hasMore: true,
              loading: false,
            }),
            ...changes,
          },
        }
      },
      BUMP_CHILD_PANEL_ORDINAL(state) {
        state.nextChildPanelOrdinal += 1
      },
      SET_BOARD_DOCUMENT_NAMES(state, names) {
        state.boardDocumentNames = Array.isArray(names)
          ? names.map((name) => String(name)).filter(Boolean)
          : []
      },
      SET_HIDDEN_BOARD_CHILD_NAMES(state, names) {
        state.hiddenBoardChildNames = Array.isArray(names)
          ? names.map((name) => String(name)).filter(Boolean)
          : []
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
        for (const lane of state.lanes || []) {
          lane.columns = reorderColumnsByName(lane.columns || [], columnNames)
        }
      },
      SET_COLUMN_CARDS(state, {
        columnIndex,
        cards,
        laneIndex = null,
        childScopeId = null,
      }) {
        if (childScopeId && state.childPanels[childScopeId]) {
          state.childPanels[childScopeId].columns[columnIndex].cards = cards
          return
        }
        if (laneIndex != null && state.lanes[laneIndex]) {
          state.lanes[laneIndex].columns[columnIndex].cards = cards
          return
        }
        state.columns[columnIndex].cards = cards
      },
      APPEND_COLUMN_CARDS(state, {
        columnIndex,
        cards,
        laneIndex = null,
        childScopeId = null,
      }) {
        if (childScopeId && state.childPanels[childScopeId]) {
          const column = state.childPanels[childScopeId].columns[columnIndex]
          column.cards = mergeCards(column.cards, cards)
          return
        }
        if (laneIndex != null && state.lanes[laneIndex]) {
          const column = state.lanes[laneIndex].columns[columnIndex]
          column.cards = mergeCards(column.cards, cards)
          promoteRecentCreatesToTop(
            state.lanes[laneIndex].columns,
            state.recentCreatedCards,
            state.config.field_name,
          )
          return
        }
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
      BUMP_DRAG_SYNC(state) {
        state.dragSyncGeneration += 1
      },
      SET_LANES(state, lanes) {
        state.lanes = lanes || []
      },
      CLEAR_LANE_HYDRATION(state) {
        state.laneHydration = {}
      },
      SET_LANE_HYDRATION(state, { laneKey, status }) {
        const key = String(laneKey ?? '')
        if (!status || status === 'idle') {
          const { [key]: _removed, ...rest } = state.laneHydration
          state.laneHydration = rest
          return
        }
        state.laneHydration = {
          ...state.laneHydration,
          [key]: status,
        }
      },
      SET_EXPANDED_LANE_KEYS(state, keys) {
        state.expandedLaneKeys = normalizeExpandedLaneKeys(keys)
      },
      TOGGLE_LANE_EXPANDED(state, laneKey) {
        const key = String(laneKey ?? '')
        if (state.expandedLaneKeys.includes(key)) {
          state.expandedLaneKeys = state.expandedLaneKeys.filter((item) => item !== key)
          return
        }
        state.expandedLaneKeys = [...state.expandedLaneKeys, key]
      },
      ADD_EXPANDED_LANE(state, laneKey) {
        const key = String(laneKey ?? '')
        if (!state.expandedLaneKeys.includes(key)) {
          state.expandedLaneKeys = [...state.expandedLaneKeys, key]
        }
      },
      SET_DRAG_EXPANDED_LANE(state, laneKey) {
        state.dragExpandedLaneKey = laneKey == null ? null : String(laneKey)
      },
      SET_DRAG_SOURCE_LANE(state, laneKey) {
        state.dragSourceLaneKey = laneKey == null ? null : String(laneKey)
      },
      SET_CELL_PAGINATION(state, pagination) {
        state.cellPagination = pagination || {}
      },
      SET_CELL_PAGE_STATE(state, { key, changes }) {
        state.cellPagination = {
          ...state.cellPagination,
          [key]: {
            ...state.cellPagination[key],
            ...changes,
          },
        }
      },
      SET_CELL_TOTALS(state, totals) {
        state.cellTotals = totals || {}
        state.cellPagination = Object.fromEntries(
          Object.entries(state.cellPagination).map(([key, pagination]) => {
            const [laneKey, columnName] = key.split('::')
            const total = state.cellTotals?.[laneKey]?.[columnName]
            return [
              key,
              {
                ...pagination,
                hasMore: Number.isFinite(total)
                  ? pagination.offset < total
                  : pagination.hasMore,
              },
            ]
          }),
        )
      },
      CLEAR_LANE_CARDS(state, laneKey) {
        const key = String(laneKey ?? '')
        const lane = state.lanes.find((row) => String(row.key) === key)
        if (!lane) return
        for (const column of lane.columns || []) {
          column.cards = []
        }
        for (const column of lane.columns || []) {
          const paginationKey = getCellPaginationKey(lane.key, column)
          if (state.cellPagination[paginationKey]) {
            state.cellPagination[paginationKey] = {
              ...state.cellPagination[paginationKey],
              offset: 0,
              hasMore: true,
              loading: false,
            }
          }
        }
        const { [key]: _removed, ...rest } = state.laneHydration
        state.laneHydration = rest
      },
      MOVE_CARD_CELL(state, {
        cardName,
        fromLaneIndex,
        toLaneIndex,
        fromColumn,
        toColumn,
        fromIndex,
        toIndex,
      }) {
        const sourceLane = state.lanes[fromLaneIndex]
        const destLane = state.lanes[toLaneIndex]
        if (!sourceLane || !destLane) return
        const source = sourceLane.columns[fromColumn]?.cards || []
        const sourceIndex = source.findIndex(({ name }) => name === cardName)
        const [card] = source.splice(sourceIndex >= 0 ? sourceIndex : fromIndex, 1)
        if (!card) return

        card[state.config.field_name] = destLane.columns[toColumn].column_name
        destLane.columns[toColumn].cards.splice(
          toIndex ?? destLane.columns[toColumn].cards.length,
          0,
          card,
        )
        sourceLane.columns[fromColumn].cards = [...sourceLane.columns[fromColumn].cards]
        destLane.columns[toColumn].cards = [...destLane.columns[toColumn].cards]
        state.dragSyncGeneration += 1
      },
      ROLLBACK_CARD_CELL(state, {
        cardName,
        fromLaneIndex,
        toLaneIndex,
        fromColumn,
        toColumn,
        fromIndex,
      }) {
        const destLane = state.lanes[toLaneIndex]
        const sourceLane = state.lanes[fromLaneIndex]
        if (!destLane || !sourceLane) return
        const destination = destLane.columns[toColumn]?.cards || []
        let destinationIndex = destination.findIndex(({ name }) => name === cardName)
        if (destinationIndex < 0) return
        const [card] = destination.splice(destinationIndex, 1)
        card[state.config.field_name] = sourceLane.columns[fromColumn].column_name
        sourceLane.columns[fromColumn].cards.splice(fromIndex, 0, card)
        sourceLane.columns[fromColumn].cards = [...sourceLane.columns[fromColumn].cards]
        destLane.columns[toColumn].cards = [...destination]
        state.dragSyncGeneration += 1
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
        state.lanes = []
        state.expandedLaneKeys = []
        state.dragExpandedLaneKey = null
        state.dragSourceLaneKey = null
        state.cellPagination = {}
        state.cellTotals = {}
        state.laneHydration = {}
        state.moveOptionsByCard = {}
        state.moveOptionsLoading = false
        state.moveOptionsGeneration += 1
        state.moveOptionsLoaded = false
        state.activeDrag = null
        state.activeTagDrag = null
        state.tagDragHoverCard = null
        state.densityHoldExpandedCard = null
        state.densityForceCollapsedCards = {}
        state.boardDocumentNames = []
        state.hiddenBoardChildNames = []
        state.activeInlineEdit = null
        state.pendingFieldUpdates = {}
        state.linkTitlesVersion = 0
        state.revealCreatedCard = null
        state.childPanels = {}
        state.childPanelByDepth = {}
        state.nextChildPanelOrdinal = 0
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
        const refreshDeadline = fieldAffectsDeadlineBucket(state.config, fieldname)
        forEachCardInstance(state.lanes, state.columns, cardName, (card) => {
          card[fieldname] = value
          if (modified) {
            card.modified = modified
          }
          if (refreshDeadline) {
            refreshCardDeadlineBucket(card, state.config)
          }
        })
        forEachChildPanel(state, (panel) => {
          forEachCardInstance(null, panel.columns, cardName, (card) => {
            card[fieldname] = value
            if (modified) {
              card.modified = modified
            }
            if (refreshDeadline) {
              refreshCardDeadlineBucket(card, state.config)
            }
          })
        })
      },
      APPLY_ATTACHMENT_COUNTS(state, counts = {}) {
        const apply = (columns) => {
          for (const column of columns || []) {
            for (const card of column.cards || []) {
              if (card?.name && Object.prototype.hasOwnProperty.call(counts, card.name)) {
                card._attachment_count = Number(counts[card.name]) || 0
              }
            }
          }
        }
        if (state.lanes?.length) {
          for (const lane of state.lanes) {
            apply(lane.columns)
          }
        } else {
          apply(state.columns)
        }
        forEachChildPanel(state, (panel) => apply(panel.columns))
      },
      APPLY_CHILD_COUNTS(state, counts = {}) {
        const apply = (columns) => {
          for (const column of columns || []) {
            for (const card of column.cards || []) {
              if (card?.name && Object.prototype.hasOwnProperty.call(counts, card.name)) {
                card._child_count = Number(counts[card.name]) || 0
              }
            }
          }
        }
        if (state.lanes?.length) {
          for (const lane of state.lanes) {
            apply(lane.columns)
          }
        } else {
          apply(state.columns)
        }
        forEachChildPanel(state, (panel) => apply(panel.columns))
      },
      ADJUST_CHILD_COUNT(state, { cardName, delta = 0 } = {}) {
        const name = String(cardName || '').trim()
        if (!name || !Number.isFinite(delta) || delta === 0) {
          return
        }
        const card = findCard(state, name)
        if (!card) {
          return
        }
        card._child_count = Math.max(0, (Number(card._child_count) || 0) + delta)
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
      MOVE_CARD(state, {
        cardName,
        fromColumn,
        toColumn,
        fromIndex,
        toIndex,
        childScopeId = null,
      }) {
        const columns = childScopeId && state.childPanels[childScopeId]
          ? state.childPanels[childScopeId].columns
          : state.columns
        const source = columns[fromColumn]?.cards || []
        const sourceIndex = source.findIndex(({ name }) => name === cardName)
        const [card] = source.splice(sourceIndex >= 0 ? sourceIndex : fromIndex, 1)
        if (!card) return

        const toMeta = columns[toColumn]
        if (!toMeta) return
        card[state.config.field_name] = toMeta.column_name
        columns[toColumn].cards.splice(toIndex ?? columns[toColumn].cards.length, 0, card)
        columns[fromColumn].cards = [...columns[fromColumn].cards]
        columns[toColumn].cards = [...columns[toColumn].cards]
        state.dragSyncGeneration += 1
      },
      ROLLBACK_CARD_MOVE(state, {
        cardName,
        fromColumn,
        toColumn,
        fromIndex,
        childScopeId = null,
      }) {
        const columns = childScopeId && state.childPanels[childScopeId]
          ? state.childPanels[childScopeId].columns
          : state.columns
        let destinationColumnIndex = toColumn
        let destination = columns[toColumn]?.cards || []
        let destinationIndex = destination.findIndex(({ name }) => name === cardName)

        if (destinationIndex < 0) {
          destinationColumnIndex = columns.findIndex((column) =>
            column.cards.some(({ name }) => name === cardName),
          )
          if (destinationColumnIndex < 0) {
            return
          }
          if (destinationColumnIndex === fromColumn) {
            state.dragSyncGeneration += 1
            return
          }
          destination = columns[destinationColumnIndex].cards
          destinationIndex = destination.findIndex(({ name }) => name === cardName)
          if (destinationIndex < 0) {
            return
          }
        }

        const [card] = destination.splice(destinationIndex, 1)
        card[state.config.field_name] = columns[fromColumn].column_name
        columns[fromColumn].cards.splice(fromIndex, 0, card)
        columns[fromColumn].cards = [...columns[fromColumn].cards]
        columns[destinationColumnIndex].cards = [...destination]
        state.dragSyncGeneration += 1
      },
      /**
       * Restore a child-panel card after an invalid Sortable drop
       * (e.g. leaked onto the main board under an overlapping list).
       */
      RECOVER_CHILD_PANEL_DRAG(state, {
        cardName,
        fromColumn,
        fromIndex,
        childScopeId,
      }) {
        const panel = childScopeId ? state.childPanels[childScopeId] : null
        if (!panel?.columns?.[fromColumn] || !cardName) {
          return
        }

        const alreadyAt = panel.columns[fromColumn].cards.findIndex(
          ({ name }) => name === cardName,
        )
        if (alreadyAt >= 0) {
          state.dragSyncGeneration += 1
          return
        }

        let card = null
        for (let columnIndex = 0; columnIndex < panel.columns.length; columnIndex += 1) {
          const cards = panel.columns[columnIndex].cards || []
          const index = cards.findIndex(({ name }) => name === cardName)
          if (index >= 0) {
            ;[card] = cards.splice(index, 1)
            panel.columns[columnIndex].cards = [...cards]
            break
          }
        }

        if (!card) {
          for (const column of state.columns || []) {
            const cards = column.cards || []
            const index = cards.findIndex(({ name }) => name === cardName)
            if (index >= 0) {
              ;[card] = cards.splice(index, 1)
              column.cards = [...cards]
              break
            }
          }
        }

        if (!card && state.lanes?.length) {
          for (const lane of state.lanes) {
            for (const column of lane.columns || []) {
              const cards = column.cards || []
              const index = cards.findIndex(({ name }) => name === cardName)
              if (index >= 0) {
                ;[card] = cards.splice(index, 1)
                column.cards = [...cards]
                break
              }
            }
            if (card) {
              break
            }
          }
        }

        if (!card) {
          state.dragSyncGeneration += 1
          return
        }

        const insertAt = Number.isFinite(fromIndex)
          ? Math.max(0, Math.min(fromIndex, panel.columns[fromColumn].cards.length))
          : panel.columns[fromColumn].cards.length
        card[state.config.field_name] = panel.columns[fromColumn].column_name
        panel.columns[fromColumn].cards.splice(insertAt, 0, card)
        panel.columns[fromColumn].cards = [...panel.columns[fromColumn].cards]
        state.dragSyncGeneration += 1
      },
      UPDATE_COLUMN_INDICATOR(state, { columnIndex, indicator }) {
        state.columns[columnIndex].indicator = indicator
      },
      UPDATE_COLUMN_WIDTHS(state, widthsByName) {
        if (!widthsByName || typeof widthsByName !== 'object') {
          return
        }
        state.columns = state.columns.map((column) => {
          if (!(column.column_name in widthsByName)) {
            return column
          }
          return {
            ...column,
            custom_column_width: widthsByName[column.column_name],
          }
        })
      },
      UPDATE_CARD_ASSIGNMENTS(state, { cardName, assignments }) {
        forEachCardInstance(state.lanes, state.columns, cardName, (card) => {
          card._assign = assignments
        })
      },
      RECONCILE_CARD_INSTANCES(state, cardName) {
        if (!multiSwimlaneActive(state) || !cardName) {
          return
        }
        const touched = reconcileCardInstancesAcrossLanes(
          state.lanes,
          state.config,
          cardName,
          {
            canPrependToCell: (laneKey, columnName) =>
              canPrependReconcileCell(state, laneKey, columnName),
          },
        )
        if (touched) {
          state.dragSyncGeneration += 1
        }
      },
      UPDATE_CARD_MODIFIED(state, { cardName, modified }) {
        forEachCardInstance(state.lanes, state.columns, cardName, (card) => {
          card.modified = modified
        })
        forEachChildPanel(state, (panel) => {
          forEachCardInstance(null, panel.columns, cardName, (card) => {
            card.modified = modified
          })
        })
      },
      REMOVE_CARD(state, payload) {
        const cardName = typeof payload === 'string' ? payload : payload?.cardName
        const snapshot = removeAllCardInstances(state.lanes, state.columns, cardName)
        if (snapshot && payload && typeof payload === 'object') {
          payload.snapshot = snapshot
        }
        if (snapshot) {
          state.dragSyncGeneration += 1
        }
      },
      RESTORE_CARD(state, snapshot) {
        if (restoreCardInstances(state.lanes, state.columns, snapshot)) {
          state.dragSyncGeneration += 1
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
      SET_REVEAL_CREATED_CARD(state, payload) {
        state.revealCreatedCard = payload || null
      },
      CLEAR_REVEAL_CREATED_CARD(state) {
        state.revealCreatedCard = null
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
      PREPEND_CREATED_CARD_TO_CELL(state, {
        laneKey,
        columnName,
        card,
        incrementTotal = true,
      }) {
        const lane = (state.lanes || []).find(
          (row) => String(row.key ?? '') === String(laneKey ?? ''),
        )
        if (!lane) return

        const column = (lane.columns || []).find(
          (row) => row.column_name === columnName,
        )
        if (!column) return

        const cards = [...(column.cards || [])]
        const existingIndex = cards.findIndex(({ name }) => name === card.name)
        if (existingIndex >= 0) {
          cards.splice(existingIndex, 1)
        } else if (incrementTotal) {
          const key = String(laneKey ?? '')
          const colKey = column.column_name
          const laneTotals = { ...(state.cellTotals[key] || {}) }
          if (Number.isFinite(laneTotals[colKey])) {
            laneTotals[colKey] += 1
            state.cellTotals = {
              ...state.cellTotals,
              [key]: laneTotals,
            }
          }
          if (Number.isFinite(state.columnTotals[colKey])) {
            state.columnTotals = {
              ...state.columnTotals,
              [colKey]: state.columnTotals[colKey] + 1,
            }
          }
        }
        cards.unshift(card)
        column.cards = cards
        state.dragSyncGeneration += 1
      },
      PREPEND_CREATED_CARD_TO_CHILD(state, {
        childScopeId,
        columnIndex,
        card,
        incrementTotal = true,
      }) {
        const panel = childScopeId ? state.childPanels[childScopeId] : null
        const column = panel?.columns?.[columnIndex]
        if (!panel || !column) return

        const cards = [...(column.cards || [])]
        const existingIndex = cards.findIndex(({ name }) => name === card.name)
        if (existingIndex >= 0) {
          cards.splice(existingIndex, 1)
        } else if (incrementTotal) {
          const colKey = column.column_name
          const totals = { ...(panel.columnTotals || {}) }
          if (Number.isFinite(totals[colKey])) {
            totals[colKey] += 1
            panel.columnTotals = totals
          }
        }
        cards.unshift(card)
        column.cards = cards
        state.dragSyncGeneration += 1
      },
    },
    actions: {
      async hydrateFromList({ commit, dispatch, state }, {
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
        commit('SET_KANBAN_CONFIG', config)
        if (globalThis.frappe?.workflow?.setup) {
          frappe.workflow.setup(board.reference_doctype)
        }
        commit('SET_COLUMNS', columns)
        commit(
          'SET_ARCHIVED_COLUMNS',
          archivedBoardColumns(board.columns, config),
        )
        commit('SET_ERROR', '')
        dispatch('fetchCreateOptions', { board_name: config.board_name })

        if (config.swimlane_mode && config.swimlane_mode !== 'off') {
          await dispatch('refreshSwimlaneBoard', { args })
          return
        }

        await dispatch('hydrateBoardDocumentNames', { args })

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

        const visibleColumns = applyChildTaskVisibility(columns, state)

        promoteRecentCreatesToTop(
          visibleColumns,
          state.recentCreatedCards,
          config.field_name,
        )

        const pageSize = Number(args.page_length) || state.pageSize
        commit('SET_COLUMNS', visibleColumns)
        commit(
          'SET_COLUMN_PAGINATION',
          createColumnPagination(visibleColumns, cards.length >= pageSize),
        )
        dispatch('scheduleMoveOptionsRefresh')
        dispatch('fetchMoveOptions', { names: collectVisibleCardNames({
          ...state,
          columns: visibleColumns,
          config,
        }) })
        dispatch('hydrateCardLinkTitles', {
          cards: flattenCardsFromColumns(visibleColumns),
          boardGeneration: state.boardGeneration,
        })
        dispatch('hydrateAttachmentCounts', {
          cards: flattenCardsFromColumns(visibleColumns),
          boardGeneration: state.boardGeneration,
        })
        dispatch('hydrateChildCounts', {
          cards: flattenCardsFromColumns(visibleColumns),
          boardGeneration: state.boardGeneration,
        })
      },
      async hydrateAttachmentCounts(
        { commit, state },
        {
          cards,
          boardGeneration = state.boardGeneration,
          dataRequestId = null,
          columnRequestGeneration = null,
        } = {},
      ) {
        if (!state.config.show_extra_info) {
          return false
        }
        const doctype = state.config.ref_doctype
        const names = [...new Set(
          (cards || [])
            .map((card) => card?.name)
            .filter(Boolean)
            .map((name) => String(name)),
        )]
        if (!doctype || !names.length) {
          return false
        }

        try {
          const counts = {}
          for (const chunk of chunkList(names, 100)) {
            const response = await frappe.call({
              method: 'quick_kanban.api.get_attachment_counts',
              args: { doctype, names: chunk },
            })
            Object.assign(counts, response.message || {})
          }
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
          commit('APPLY_ATTACHMENT_COUNTS', counts)
          return true
        } catch {
          return false
        }
      },
      async hydrateChildCounts(
        { commit, state },
        {
          cards,
          boardGeneration = state.boardGeneration,
          dataRequestId = null,
          columnRequestGeneration = null,
        } = {},
      ) {
        const doctype = state.config.ref_doctype
        const meta = doctype && globalThis.frappe?.get_meta?.(doctype)
        if (!meta?.is_tree || !meta?.nsm_parent_field) {
          return false
        }
        const names = [...new Set(
          (cards || [])
            .map((card) => card?.name)
            .filter(Boolean)
            .map((name) => String(name)),
        )]
        if (!doctype || !names.length) {
          return false
        }

        try {
          const counts = {}
          for (const chunk of chunkList(names, 100)) {
            const response = await frappe.call({
              method: 'quick_kanban.api.get_child_counts',
              args: { doctype, names: chunk },
            })
            Object.assign(counts, response.message || {})
          }
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
          commit('APPLY_CHILD_COUNTS', counts)
          return true
        } catch {
          return false
        }
      },
      async hydrateBoardDocumentNames({ commit, state }, { args } = {}) {
        if (state.show_child_tasks || !state.config?.parent_field) {
          commit('SET_BOARD_DOCUMENT_NAMES', [])
          commit('SET_HIDDEN_BOARD_CHILD_NAMES', [])
          return []
        }
        const doctype = state.config.ref_doctype
        const fieldName = state.config.field_name
        const columnValues = visibleBoardColumns(state.columns)
          .map((column) => column.column_name)
          .filter(Boolean)
        if (!doctype || !fieldName || !columnValues.length) {
          commit('SET_BOARD_DOCUMENT_NAMES', [])
          commit('SET_HIDDEN_BOARD_CHILD_NAMES', [])
          return []
        }
        const sourceArgs = args || globalThis.window?.cur_list?.get_args?.() || {}
        const sharedArgs = {
          doctype,
          filters: sourceArgs.filters || [],
          field_name: fieldName,
          column_values: columnValues,
        }
        if (sourceArgs.or_filters !== undefined && sourceArgs.or_filters !== null) {
          sharedArgs.or_filters = sourceArgs.or_filters
        }
        try {
          const [namesResponse, hiddenResponse] = await Promise.all([
            frappe.call({
              method: 'quick_kanban.api.get_board_document_names',
              args: sharedArgs,
            }),
            frappe.call({
              method: 'quick_kanban.api.get_hidden_board_child_names',
              args: sharedArgs,
            }),
          ])
          const names = namesResponse.message || []
          commit('SET_BOARD_DOCUMENT_NAMES', names)
          commit('SET_HIDDEN_BOARD_CHILD_NAMES', hiddenResponse.message || [])
          return names
        } catch {
          commit('SET_BOARD_DOCUMENT_NAMES', [])
          commit('SET_HIDDEN_BOARD_CHILD_NAMES', [])
          return []
        }
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
        // Flat path only — drop leftover swimlane state from a prior session
        // on the same board (ensureBoard may early-return without reset).
        commit('SET_LANES', [])
        commit('CLEAR_LANE_HYDRATION')
        commit('SET_EXPANDED_LANE_KEYS', [])
        commit('SET_DRAG_EXPANDED_LANE', null)
        commit('SET_DRAG_SOURCE_LANE', null)
        commit('SET_CELL_PAGINATION', {})
        commit('SET_CELL_TOTALS', {})
        commit('INVALIDATE_COLUMN_REQUESTS')
        commit('BEGIN_COUNT_REQUEST')
        const sourceArgs = args || window.cur_list.get_args()
        const requestedPageSize = Number(
          sourceArgs.page_length ?? sourceArgs.limit_page_length ?? 0,
        )
        const pageSize = Math.max(requestedPageSize, state.pageSize)
        const requestId = state.dataRequestId + 1
        const boardGeneration = state.boardGeneration
        commit('SET_DATA_REQUEST_ID', requestId)
        commit('SET_LOADING', true)
        commit('SET_ERROR', '')

        try {
          // Only await when tree parent filtering is active — an extra yield here
          // would reorder concurrent frappe.call registrations in race tests / dual fetch.
          if (!state.show_child_tasks && state.config?.parent_field) {
            await dispatch('hydrateBoardDocumentNames', { args: sourceArgs })
            if (
              state.dataRequestId !== requestId ||
              state.boardGeneration !== boardGeneration
            ) return false
          } else {
            commit('SET_BOARD_DOCUMENT_NAMES', [])
            commit('SET_HIDDEN_BOARD_CHILD_NAMES', [])
          }
          const pageResponses = await Promise.all(
            state.columns.map((column) => frappe.call({
              method: 'quick_kanban.api.get_column_page',
              args: buildFlatColumnPageArgs(
                state,
                column.column_name,
                sourceArgs,
                { start: 0, pageLength: pageSize },
              ),
            })),
          )
          if (
            state.dataRequestId !== requestId ||
            state.boardGeneration !== boardGeneration
          ) return false
          const resultCounts = []
          const pageColumns = state.columns.map((column, index) => {
            const page = pageResponses[index]?.message || {}
            cacheUserInfo(page.user_info)
            resultCounts.push(page.values?.length || 0)
            const cards = filterCardsForChildVisibility(
              cardsFromPageMessage(page, page.user_info),
              state,
            )
            return { ...column, cards }
          })
          const columns = promoteRecentCreatesToTop(
            pageColumns,
            state.recentCreatedCards,
            state.config.field_name,
          )

          if (state.config?.deadline_enabled) {
            const projects = flattenCardsFromColumns(columns)
              .map((card) => card.project)
              .filter(Boolean)
            await hydrateDeadlineHolidayContext(projects)
          }
          commit('SET_COLUMNS', columns)
          commit(
            'SET_COLUMN_PAGINATION',
            createColumnPaginationFromLoaded(columns, pageSize, resultCounts),
          )
          dispatch('scheduleMoveOptionsRefresh')
          dispatch('hydrateCardLinkTitles', {
            cards: flattenCardsFromColumns(columns),
            boardGeneration,
            dataRequestId: requestId,
          })
          dispatch('hydrateAttachmentCounts', {
            cards: flattenCardsFromColumns(columns),
            boardGeneration,
            dataRequestId: requestId,
          })
          dispatch('hydrateChildCounts', {
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
      async refreshBoard({ dispatch, state }, { board_name, args, forceConfig = false } = {}) {
        if (forceConfig) {
          await dispatch('resetBoard')
        }
        const targetBoard =
          board_name || state.config.board_name || window.cur_list?.board_name
        const ready = await dispatch('ensureBoard', { board_name: targetBoard })
        if (ready === false) return
        if (state.config.swimlane_mode && state.config.swimlane_mode !== 'off') {
          await dispatch('refreshSwimlaneBoard', { args })
          return
        }
        const fresh = await dispatch('fetchKanban', { args })
        if (fresh === false) return
        const current = await dispatch('fetchColumnTotals', { args })
        if (current === false) return
        await dispatch('topUpInitialColumns', { args })
      },
      async refreshSwimlaneBoard({ commit, dispatch, state }, { args } = {}) {
        const sourceArgs = args || window.cur_list?.get_args?.() || {}
        commit('SET_LOADING', true)
        commit('SET_ERROR', '')
        try {
          const lanesResponse = await frappe.call({
            method: 'quick_kanban.api.get_swimlane_lanes',
            args: {
              doctype: state.config.ref_doctype,
              swimlane_field: state.config.swimlane_field,
              filters: sourceArgs.filters,
              or_filters: sourceArgs.or_filters,
              board_name: state.config.board_name,
            },
          })
          const laneRows = lanesResponse.message || []
          const columnTemplates = withColumnDisplayNames(
            state.columns.map(({ cards: _c, ...meta }) => ({ ...meta, cards: [] })),
            state.config,
          )
          const lanes = laneRows.map((lane) => ({
            key: lane.key == null ? '' : String(lane.key),
            label: lane.label || lane.key || __('Unassigned'),
            columns: buildEmptyLaneColumns(columnTemplates),
          }))
          if (state.config.swimlane_mode === 'assign') {
            const assigneeUsers = lanes.map((lane) => lane.key).filter(Boolean)
            if (assigneeUsers.length) {
              const userResponse = await frappe.call({
                method: 'frappe.desk.form.load.get_user_info_for_viewers',
                args: { users: JSON.stringify(assigneeUsers) },
              })
              cacheUserInfo(userResponse.message)
            }
          }
          commit('CLEAR_LANE_HYDRATION')
          commit('SET_LANES', lanes)
          commit('SET_CELL_PAGINATION', createCellPagination(lanes, true))
          commit(
            'SET_EXPANDED_LANE_KEYS',
            resolveExpandedLaneKeys(lanes, state.expandedLaneKeys),
          )
          commit('SET_DRAG_EXPANDED_LANE', null)

          await dispatch('hydrateBoardDocumentNames', { args: sourceArgs })
          // Card pages load lazily via ensureLaneHydrated when a lane is expanded
          // and visible in the board scroller. Expanded lanes must refill immediately
          // after a refresh — IntersectionObserver alone does not re-fire when a lane
          // stays on screen while hydration state is cleared.
          await dispatch('fetchCellTotals', { args: sourceArgs })
          const expandedKeys = [...(state.expandedLaneKeys || [])]
          if (expandedKeys.length) {
            await Promise.all(
              expandedKeys.map((laneKey) =>
                dispatch('ensureLaneHydrated', { laneKey, args: sourceArgs }),
              ),
            )
          }
        } catch (error) {
          commit('SET_ERROR', getErrorMessage(error))
          throw error
        } finally {
          commit('SET_LOADING', false)
        }
      },
      async fetchCellTotals({ commit, state }, { args } = {}) {
        const sourceArgs = args || window.cur_list?.get_args?.() || {}
        const boardGeneration = state.boardGeneration
        commit('BEGIN_COUNT_REQUEST')
        const countRequestGeneration = state.countRequestGeneration
        const response = await frappe.call({
          method: 'quick_kanban.api.get_cell_totals',
          args: {
            doctype: state.config.ref_doctype,
            status_field: state.config.field_name,
            columns: state.columns.map((column) => column.column_name),
            swimlane_field: state.config.swimlane_field,
            lane_keys: state.lanes.map((lane) => lane.key),
            filters: sourceArgs.filters,
            or_filters: sourceArgs.or_filters,
            hide_board_children: shouldHideBoardChildren(state),
            board_name: state.config.board_name,
          },
        })
        if (
          state.boardGeneration !== boardGeneration
          || state.countRequestGeneration !== countRequestGeneration
        ) {
          return false
        }
        const totals = response.message || {}
        commit('SET_CELL_TOTALS', totals)
        if (state.lanes?.length) {
          const sorted = sortLanesByOccupancy(state.lanes, totals)
          const orderChanged = sorted.some(
            (lane, index) => String(lane.key) !== String(state.lanes[index]?.key),
          )
          if (orderChanged) {
            commit('SET_LANES', sorted)
          }
          const resolved = resolveExpandedLaneKeys(
            orderChanged ? sorted : state.lanes,
            state.expandedLaneKeys,
          )
          if (
            resolved.length !== state.expandedLaneKeys.length
            || resolved.some((key, index) => key !== state.expandedLaneKeys[index])
          ) {
            commit('SET_EXPANDED_LANE_KEYS', resolved)
          }
        }
        return true
      },
      async fetchLaneKanban({ commit, dispatch, state }, { laneKey, args } = {}) {
        const key = String(laneKey ?? '')
        const laneIndex = state.lanes.findIndex((lane) => String(lane.key) === key)
        if (laneIndex < 0) return false

        const sourceArgs = args || window.cur_list?.get_args?.() || {}
        await ensureChildFilterReady({ dispatch, state }, sourceArgs)
        const requestedPageSize = Number(
          sourceArgs.page_length ?? sourceArgs.limit_page_length ?? 0,
        )
        const pageSize = Math.max(requestedPageSize, state.pageSize)
        const boardGeneration = state.boardGeneration
        const columnRequestGeneration = state.columnRequestGeneration

        const response = await frappe.call({
          method: 'quick_kanban.api.get_swimlane_lane_page',
          args: {
            doctype: state.config.ref_doctype,
            status_field: state.config.field_name,
            swimlane_field: state.config.swimlane_field,
            lane_key: key,
            fields: state.config.fields,
            filters: sourceArgs.filters,
            or_filters: sourceArgs.or_filters,
            start: 0,
            page_length: pageSize,
            board_name: state.config.board_name,
            ...buildSwimlanePageHideArgs(state, sourceArgs),
          },
        })
        if (
          state.boardGeneration !== boardGeneration
          || state.columnRequestGeneration !== columnRequestGeneration
        ) {
          return false
        }

        const resolvedLaneIndex = state.lanes.findIndex((lane) => String(lane.key) === key)
        if (resolvedLaneIndex < 0) return false

        const page = response.message || {}
        cacheUserInfo(page.user_info)
        const laneColumns = state.lanes[resolvedLaneIndex].columns
        const grouped = applyChildTaskVisibility(
          groupCardsByColumn({
            columns: laneColumns.map(({ cards: _c, ...meta }) => ({ ...meta, cards: [] })),
            keys: page.keys,
            values: page.values,
            statusField: state.config.field_name,
            userInfo: page.user_info,
          }),
          state,
        )
        if (state.config?.deadline_enabled) {
          const projects = flattenCardsFromColumns(grouped)
            .map((card) => card.project)
            .filter(Boolean)
          await hydrateDeadlineHolidayContext(projects)
        }
        const resultCount = page.values?.length || 0
        const pageWasFull = resultCount >= pageSize

        for (let columnIndex = 0; columnIndex < grouped.length; columnIndex += 1) {
          const column = grouped[columnIndex]
          const loaded = column.cards?.length || 0
          commit('SET_COLUMN_CARDS', {
            laneIndex: resolvedLaneIndex,
            columnIndex,
            cards: column.cards,
          })
          const paginationKey = getCellPaginationKey(key, column)
          const total = state.cellTotals?.[key]?.[column.column_name]
          commit('SET_CELL_PAGE_STATE', {
            key: paginationKey,
            changes: {
              offset: loaded,
              loading: false,
              // Prefer cell totals when known (same idea as SET_COLUMN_TOTALS after
              // a wide fetch); otherwise fall back to whether the lane page was full.
              hasMore: Number.isFinite(total)
                ? loaded < total
                : pageWasFull,
            },
          })
        }

        commit('BUMP_DRAG_SYNC')
        const flatCards = flattenCardsFromColumns(grouped)
        dispatch('scheduleMoveOptionsRefresh')
        dispatch('hydrateCardLinkTitles', {
          cards: flatCards,
          boardGeneration,
          columnRequestGeneration,
        })
        dispatch('hydrateAttachmentCounts', {
          cards: flatCards,
          boardGeneration,
          columnRequestGeneration,
        })
        dispatch('hydrateChildCounts', {
          cards: flatCards,
          boardGeneration,
          columnRequestGeneration,
        })
        return true
      },
      async topUpInitialLaneCells({ dispatch, state }, { laneKey, args } = {}) {
        const key = String(laneKey ?? '')
        const laneIndex = state.lanes.findIndex((lane) => String(lane.key) === key)
        if (laneIndex < 0) return

        const lane = state.lanes[laneIndex]
        const requests = (lane.columns || []).map(async (column, columnIndex) => {
          const total = state.cellTotals?.[key]?.[column.column_name]
          if (!Number.isFinite(total) || total <= 0) return

          const target = Math.min(initialColumnCardMinimum, total)
          let loaded = column.cards?.length || 0
          while (loaded < target) {
            const paginationKey = getCellPaginationKey(key, column)
            const pagination = state.cellPagination[paginationKey]
            if (!pagination?.hasMore || pagination.loading) return
            const previousOffset = pagination.offset

            await dispatch('loadCellPage', {
              laneIndex,
              columnIndex,
              args,
              pageSize: target - loaded,
            })

            const currentLaneIndex = state.lanes.findIndex((row) => String(row.key) === key)
            if (currentLaneIndex < 0) return
            loaded = state.lanes[currentLaneIndex]?.columns?.[columnIndex]?.cards?.length || 0
            if (state.cellPagination[paginationKey]?.offset === previousOffset) return
          }
        })

        return Promise.allSettled(requests)
      },
      async ensureLaneHydrated({ commit, dispatch, state }, { laneKey, args } = {}) {
        const key = String(laneKey ?? '')
        const status = state.laneHydration[key]
        if (status === 'loading' || status === 'ready') {
          return status === 'ready'
        }
        if (state.lanes.findIndex((lane) => String(lane.key) === key) < 0) {
          return false
        }

        commit('SET_LANE_HYDRATION', { laneKey: key, status: 'loading' })
        try {
          const fetched = await dispatch('fetchLaneKanban', { laneKey: key, args })
          if (fetched === false) {
            commit('SET_LANE_HYDRATION', { laneKey: key, status: 'idle' })
            return false
          }
          await dispatch('topUpInitialLaneCells', { laneKey: key, args })
          if (state.lanes.findIndex((lane) => String(lane.key) === key) < 0) {
            commit('SET_LANE_HYDRATION', { laneKey: key, status: 'idle' })
            return false
          }
          commit('SET_LANE_HYDRATION', { laneKey: key, status: 'ready' })
          return true
        } catch (error) {
          commit('SET_LANE_HYDRATION', { laneKey: key, status: 'idle' })
          throw error
        }
      },
      async toggleLaneExpanded({ commit, state }, { laneKey } = {}) {
        const key = String(laneKey ?? '')
        commit('TOGGLE_LANE_EXPANDED', key)
        if (String(state.dragExpandedLaneKey) === key) {
          commit('SET_DRAG_EXPANDED_LANE', null)
        }
        // Collapse only toggles UI preference; cards and laneHydration stay cached
        // so re-expand can show previously loaded data without refetch.
        // Child panels hosted by a card in this lane must close with the lane.
        if (!state.expandedLaneKeys.includes(key)) {
          const depth0ScopeId = state.childPanelByDepth?.[0]
          const depth0Panel = depth0ScopeId ? state.childPanels?.[depth0ScopeId] : null
          if (depth0Panel) {
            const hostKey = depth0Panel.hostLaneKey != null
              && String(depth0Panel.hostLaneKey).trim() !== ''
              ? String(depth0Panel.hostLaneKey)
              : findLaneKeyForCard(state, depth0Panel.parentName)
            if (hostKey === key) {
              commit('CLOSE_CHILD_PANELS_FROM_DEPTH', 0)
            }
          }
        }
      },
      async setDragExpandedLane({ commit, dispatch, state }, { laneKey, args } = {}) {
        if (laneKey == null) {
          commit('SET_DRAG_EXPANDED_LANE', null)
          return
        }
        const key = String(laneKey)
        if (state.expandedLaneKeys.includes(key)) {
          commit('SET_DRAG_EXPANDED_LANE', null)
          return
        }
        commit('SET_DRAG_EXPANDED_LANE', key)
        await dispatch('ensureLaneHydrated', { laneKey: key, args })
      },
      async loadCellPage(
        { commit, dispatch, state },
        {
          laneIndex,
          columnIndex,
          args,
          pageSize = state.columnPageSize,
          reset = false,
        } = {},
      ) {
        const lane = state.lanes[laneIndex]
        const column = lane?.columns?.[columnIndex]
        if (!lane || !column) return
        const laneKey = lane.key
        const key = getCellPaginationKey(laneKey, column)
        if (reset) {
          commit('SET_CELL_PAGE_STATE', {
            key,
            changes: { offset: 0, hasMore: true, loading: false },
          })
          commit('SET_COLUMN_CARDS', { laneIndex, columnIndex, cards: [] })
        }
        const pagination = state.cellPagination[key]
        if (!pagination || pagination.loading || (!reset && !pagination.hasMore)) return

        const sourceArgs = args || window.cur_list?.get_args?.() || {}
        await ensureChildFilterReady({ dispatch, state }, sourceArgs)
        const boardGeneration = state.boardGeneration
        const columnRequestGeneration = state.columnRequestGeneration
        commit('SET_CELL_PAGE_STATE', { key, changes: { loading: true } })

        try {
          const response = await frappe.call({
            method: 'quick_kanban.api.get_swimlane_column_page',
            args: {
              doctype: state.config.ref_doctype,
              status_field: state.config.field_name,
              column: column.column_name,
              swimlane_field: state.config.swimlane_field,
              lane_key: laneKey,
              fields: state.config.fields,
              filters: sourceArgs.filters,
              or_filters: sourceArgs.or_filters,
              start: reset ? 0 : pagination.offset,
              page_length: pageSize,
              board_name: state.config.board_name,
              ...buildSwimlanePageHideArgs(state, sourceArgs),
            },
          })
          if (
            state.boardGeneration !== boardGeneration
            || state.columnRequestGeneration !== columnRequestGeneration
          ) {
            return
          }
          // Lane order may change while the request is in flight (occupancy sort).
          const resolvedLaneIndex = state.lanes.findIndex(
            (row) => String(row.key) === String(laneKey),
          )
          if (resolvedLaneIndex < 0) return
          const page = response.message || {}
          cacheUserInfo(page.user_info)
          const cards = filterCardsForChildVisibility(
            cardsFromPageMessage(page, page.user_info),
            state,
          )
          if (state.config?.deadline_enabled) {
            await hydrateDeadlineHolidayContext(
              cards.map((card) => card.project).filter(Boolean),
            )
          }
          const resultCount = page.values?.length || 0
          const nextOffset = (reset ? 0 : pagination.offset) + resultCount
          const total = state.cellTotals?.[laneKey]?.[column.column_name]
          if (reset) {
            commit('SET_COLUMN_CARDS', {
              laneIndex: resolvedLaneIndex,
              columnIndex,
              cards,
            })
            // Full replace: remount VirtualList so Sortable/virtual state resets.
            commit('BUMP_DRAG_SYNC')
          } else {
            commit('APPEND_COLUMN_CARDS', {
              laneIndex: resolvedLaneIndex,
              columnIndex,
              cards,
            })
            // Incremental append: do not remount — key bump collapses sticky Add.
          }
          commit('SET_CELL_PAGE_STATE', {
            key,
            changes: {
              offset: nextOffset,
              loading: false,
              hasMore:
                resultCount >= pageSize
                && (!Number.isFinite(total) || nextOffset < total),
            },
          })
          dispatch('scheduleMoveOptionsRefresh')
          dispatch('hydrateCardLinkTitles', {
            cards,
            boardGeneration,
            columnRequestGeneration,
          })
          dispatch('hydrateAttachmentCounts', {
            cards,
            boardGeneration,
            columnRequestGeneration,
          })
          dispatch('hydrateChildCounts', {
            cards,
            boardGeneration,
            columnRequestGeneration,
          })
        } catch (error) {
          if (
            state.boardGeneration === boardGeneration
            && state.columnRequestGeneration === columnRequestGeneration
          ) {
            commit('SET_CELL_PAGE_STATE', {
              key,
              changes: { loading: false },
            })
          }
          throw error
        }
      },
      async persistMovedCardToCell({ commit, dispatch, state }, payload) {
        const {
          cardName,
          fromLaneIndex,
          toLaneIndex,
          fromColumn,
          toColumn,
          fromIndex,
          toIndex,
        } = payload
        if (state.pendingMoves[cardName]) {
          commit('ROLLBACK_CARD_CELL', payload)
          return buildDragMoveFailureResult(payload)
        }

        const fromLane = state.lanes[fromLaneIndex]
        const toLane = state.lanes[toLaneIndex]
        if (!fromLane || !toLane) {
          return buildDragMoveFailureResult(payload)
        }

        const columnChanged = fromColumn !== toColumn
        const laneChanged = String(fromLane.key) !== String(toLane.key)
        const destName = toLane.columns[toColumn]?.column_name
        const sourceName = fromLane.columns[fromColumn]?.column_name
        const flatTo = state.columns.findIndex((column) => column.column_name === destName)
        const flatFrom = state.columns.findIndex((column) => column.column_name === sourceName)

        let workflowAction = payload.workflowAction || null

        if (columnChanged) {
          if (flatTo < 0 || flatFrom < 0) {
            commit('ROLLBACK_CARD_CELL', payload)
            return buildDragMoveFailureResult(payload, { reason: 'invalid_column' })
          }
          const preflight = runPreflightMove(state, commit, {
            cardName,
            fromColumn: flatFrom,
            toColumn: flatTo,
            fromIndex,
            toIndex,
            workflowAction,
          })
          if (!preflight.allowed) {
            commit('ROLLBACK_CARD_CELL', payload)
            reportMoveFailure(commit, preflight, state.config)
            return buildDragMoveFailureResult(payload, preflight)
          }
          const policy = preflight.policy
          if (policy?.mode === 'workflow' && (policy.actions?.length || 0) > 1) {
            try {
              workflowAction = await dispatch('resolveWorkflowAction', {
                cardName,
                column: state.columns[flatTo],
              })
            } catch {
              commit('ROLLBACK_CARD_CELL', payload)
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
          const recheck = runPreflightMove(state, commit, {
            cardName,
            fromColumn: flatFrom,
            toColumn: flatTo,
            fromIndex,
            toIndex,
            workflowAction,
          })
          if (!recheck.allowed) {
            commit('ROLLBACK_CARD_CELL', payload)
            reportMoveFailure(commit, recheck, state.config)
            return buildDragMoveFailureResult(payload, recheck)
          }
        } else if (laneChanged && !canChangeLaneClient(state, cardName)) {
          commit('ROLLBACK_CARD_CELL', payload)
          reportMoveFailure(commit, { reason: 'no_permission' }, state.config)
          return buildDragMoveFailureResult(payload, { reason: 'no_permission' })
        }

        // VirtualList already moved the card instance via SET_COLUMN_CARDS.
        commit('SET_MOVE_PENDING', { cardName, pending: true })
        const boardGeneration = state.boardGeneration
        const card = toLane.columns[toColumn].cards.find(({ name }) => name === cardName)
          || fromLane.columns[fromColumn].cards.find(({ name }) => name === cardName)
        try {
          const response = await frappe.call({
            method: 'quick_kanban.api.move_card_to_cell',
            args: {
              board_name: state.config.board_name,
              name: cardName,
              to_column: columnChanged ? toLane.columns[toColumn].column_name : undefined,
              from_lane: laneChanged ? fromLane.key : undefined,
              to_lane: laneChanged ? toLane.key : undefined,
              expected_modified: card?.modified,
              workflow_action: workflowAction || undefined,
            },
          })
          if (state.boardGeneration !== boardGeneration) return { ok: true }
          if (response?.message?.modified) {
            commit('UPDATE_CARD_MODIFIED', {
              cardName,
              modified: response.message.modified,
            })
          }
          if (response?.message?._assign != null) {
            commit('UPDATE_CARD_ASSIGNMENTS', {
              cardName,
              assignments: mapAssignments(response.message._assign),
            })
          }
          const statusField = state.config.field_name
          if (
            columnChanged
            && statusField
            && Object.prototype.hasOwnProperty.call(response?.message || {}, statusField)
          ) {
            commit('UPDATE_CARD_FIELD', {
              cardName,
              fieldname: statusField,
              value: response.message[statusField],
            })
          }
          const swimlaneField = state.config.swimlane_field
          if (
            swimlaneField
            && swimlaneField !== '__assign'
            && Object.prototype.hasOwnProperty.call(response?.message || {}, swimlaneField)
          ) {
            commit('UPDATE_CARD_FIELD', {
              cardName,
              fieldname: swimlaneField,
              value: response.message[swimlaneField],
            })
          }
          if (laneChanged) {
            commit('ADD_EXPANDED_LANE', toLane.key)
            commit('SET_DRAG_EXPANDED_LANE', null)
            commit('CLEAR_LANE_CARDS', toLane.key)
            await dispatch('ensureLaneHydrated', {
              laneKey: toLane.key,
            })
          }
          if (multiSwimlaneActive(state)) {
            commit('RECONCILE_CARD_INSTANCES', cardName)
          }
          if (columnChanged) {
            commit('CLEAR_CARD_MOVE_OPTIONS', cardName)
          }
          commit('INVALIDATE_COUNT_RESPONSES')
          dispatch('hydrateBoardDocumentNames')
          dispatch('fetchCellTotals')
          dispatch('scheduleMoveOptionsRefresh')
          frappe.show_alert({
            message: __('Card updated'),
            indicator: 'green',
          })
          return { ok: true }
        } catch (error) {
          if (state.boardGeneration === boardGeneration) {
            commit('ROLLBACK_CARD_CELL', payload)
            reportMoveFailure(commit, null, state.config, error)
          }
          return buildDragMoveFailureResult(payload, null, error)
        } finally {
          if (state.boardGeneration === boardGeneration) {
            commit('SET_MOVE_PENDING', { cardName, pending: false })
          }
        }
      },
      async fetchColumnTotals({ commit, state }, { args } = {}) {
        const sourceArgs = args || window.cur_list.get_args()
        const boardGeneration = state.boardGeneration
        commit('BEGIN_COUNT_REQUEST')
        const countRequestGeneration = state.countRequestGeneration

        const response = await frappe.call({
          method: 'quick_kanban.api.get_column_totals',
          args: buildColumnTotalsArgs(sourceArgs, state.config, state.columns, state),
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
        const boardGeneration = state.boardGeneration
        const columnRequestGeneration = state.columnRequestGeneration
        commit('SET_COLUMN_PAGE_STATE', {
          key,
          changes: { loading: true },
        })

        try {
          await ensureChildFilterReady({ dispatch, state }, sourceArgs)
          if (
            state.boardGeneration !== boardGeneration ||
            state.columnRequestGeneration !== columnRequestGeneration
          ) {
            commit('SET_COLUMN_PAGE_STATE', {
              key,
              changes: { loading: false },
            })
            return
          }
          const response = await frappe.call({
            method: 'quick_kanban.api.get_column_page',
            args: buildFlatColumnPageArgs(
              state,
              column.column_name,
              sourceArgs,
              { start: pagination.offset, pageLength: pageSize },
            ),
          })
          if (
            state.boardGeneration !== boardGeneration ||
            state.columnRequestGeneration !== columnRequestGeneration
          ) {
            commit('SET_COLUMN_PAGE_STATE', {
              key,
              changes: { loading: false },
            })
            return
          }
          const page = response.message || {}
          cacheUserInfo(page.user_info)
          const visibleCards = filterCardsForChildVisibility(
            cardsFromPageMessage(page, page.user_info),
            state,
          )
          const resultCount = page.values?.length || 0
          const nextOffset = pagination.offset + resultCount
          const total = state.columnTotals[key]

          commit('APPEND_COLUMN_CARDS', {
            columnIndex,
            cards: visibleCards,
          })
          // Incremental append: do not remount VirtualList (sticky Add flicker).
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
            cards: visibleCards,
            boardGeneration,
            columnRequestGeneration,
          })
          dispatch('hydrateAttachmentCounts', {
            cards: visibleCards,
            boardGeneration,
            columnRequestGeneration,
          })
          dispatch('hydrateChildCounts', {
            cards: visibleCards,
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
      async toggleChildPanel(
        { commit, dispatch, state, getters },
        { parentName, depth = 0, laneKey = null, args } = {},
      ) {
        const parent = String(parentName || '').trim()
        if (!parent || !state.config?.parent_field) {
          return false
        }
        const level = Math.max(0, Number(depth) || 0)
        const existingScopeId = state.childPanelByDepth[level]
        const existing = existingScopeId ? state.childPanels[existingScopeId] : null
        if (existing?.parentName === parent) {
          commit('CLOSE_CHILD_PANELS_FROM_DEPTH', level)
          return false
        }
        commit('CLOSE_CHILD_PANELS_FROM_DEPTH', level)
        commit('BUMP_CHILD_PANEL_ORDINAL')
        const scopeId = childPanelKey(parent, level)
        const columns = buildEmptyChildColumns(state.columns)
        let hostLaneKey = null
        if (
          level === 0
          && getters.swimlanesEnabled
          && laneKey != null
          && String(laneKey).trim() !== ''
        ) {
          hostLaneKey = String(laneKey)
        }
        commit('OPEN_CHILD_PANEL', {
          scopeId,
          parentName: parent,
          depth: level,
          hostLaneKey,
          ordinal: state.nextChildPanelOrdinal,
          columns,
          columnPagination: createChildColumnPagination(columns, true),
          columnTotals: {},
        })
        // Flat-style: wait for all first pages, then one sync paint (not per-column).
        await dispatch('fetchChildPanelFirstPages', { scopeId, args })
        await dispatch('topUpInitialChildColumns', { scopeId, args })
        return true
      },
      closeChildPanelsFromDepth({ commit }, depth = 0) {
        commit('CLOSE_CHILD_PANELS_FROM_DEPTH', depth)
      },
      async fetchChildColumnTotals({ commit, state }, { scopeId, args } = {}) {
        const panel = state.childPanels[scopeId]
        if (!panel || !state.config?.parent_field) {
          return false
        }
        const sourceArgs = args || window.cur_list?.get_args?.() || {}
        const boardGeneration = state.boardGeneration
        const response = await frappe.call({
          method: 'quick_kanban.api.get_child_column_totals',
          args: {
            doctype: state.config.ref_doctype,
            fieldname: state.config.field_name,
            columns: state.columns.map((column) => column.column_name),
            parent_name: panel.parentName,
            parent_field: state.config.parent_field,
            filters: Array.isArray(sourceArgs.filters) ? sourceArgs.filters : [],
            or_filters: sourceArgs.or_filters,
          },
        })
        if (state.boardGeneration !== boardGeneration || !state.childPanels[scopeId]) {
          return false
        }
        const counts = response.message || {}
        const totals = Object.fromEntries(
          state.columns.map((column) => [
            column.column_name,
            Number(counts[column.column_name]) || 0,
          ]),
        )
        commit('SET_CHILD_COLUMN_TOTALS', { scopeId, totals })
        return true
      },
      /**
       * Like fetchKanban: parallel get_child_column_page for every column, then
       * commit all cards/pagination in one sync pass so columns paint together.
       * Totals run in parallel so hasMore can use counts at commit time.
       */
      async fetchChildPanelFirstPages({ commit, dispatch, state }, { scopeId, args } = {}) {
        const panel = state.childPanels[scopeId]
        if (!panel || !state.config?.parent_field) {
          return false
        }
        const sourceArgs = args || window.cur_list?.get_args?.() || {}
        const pageSize = state.columnPageSize
        const boardGeneration = state.boardGeneration
        const columnRequestGeneration = state.columnRequestGeneration
        const filters = Array.isArray(sourceArgs.filters) ? sourceArgs.filters : []
        const columnValues = activeColumnValues(state)

        for (const column of panel.columns) {
          commit('SET_CHILD_COLUMN_PAGE_STATE', {
            scopeId,
            columnName: column.column_name,
            changes: { loading: true },
          })
        }

        let pageResponses
        try {
          const [, responses] = await Promise.all([
            dispatch('fetchChildColumnTotals', { scopeId, args: sourceArgs }),
            Promise.all(
              panel.columns.map((column) => frappe.call({
                method: 'quick_kanban.api.get_child_column_page',
                args: {
                  doctype: state.config.ref_doctype,
                  status_field: state.config.field_name,
                  column: column.column_name,
                  parent_name: panel.parentName,
                  parent_field: state.config.parent_field,
                  fields: state.config.fields,
                  filters,
                  or_filters: sourceArgs.or_filters,
                  start: 0,
                  page_length: pageSize,
                  column_values: columnValues,
                },
              })),
            ),
          ])
          pageResponses = responses
        } catch (error) {
          if (
            state.boardGeneration === boardGeneration
            && state.columnRequestGeneration === columnRequestGeneration
            && state.childPanels[scopeId]
          ) {
            for (const column of panel.columns) {
              commit('SET_CHILD_COLUMN_PAGE_STATE', {
                scopeId,
                columnName: column.column_name,
                changes: { loading: false },
              })
            }
          }
          throw error
        }

        if (
          state.boardGeneration !== boardGeneration
          || state.columnRequestGeneration !== columnRequestGeneration
          || !state.childPanels[scopeId]
        ) {
          return false
        }

        const hydrated = state.childPanels[scopeId]
        const allCards = []
        for (let columnIndex = 0; columnIndex < hydrated.columns.length; columnIndex += 1) {
          const column = hydrated.columns[columnIndex]
          const columnName = column.column_name
          const page = pageResponses[columnIndex]?.message || {}
          cacheUserInfo(page.user_info)
          const cards = cardsFromPageMessage(page, page.user_info)
          const resultCount = page.values?.length || 0
          const total = hydrated.columnTotals?.[columnName]
          commit('SET_COLUMN_CARDS', {
            childScopeId: scopeId,
            columnIndex,
            cards,
          })
          commit('SET_CHILD_COLUMN_PAGE_STATE', {
            scopeId,
            columnName,
            changes: {
              offset: resultCount,
              loading: false,
              hasMore:
                resultCount >= pageSize
                && (!Number.isFinite(total) || resultCount < total),
            },
          })
          allCards.push(...cards)
        }
        commit('BUMP_DRAG_SYNC')
        dispatch('scheduleMoveOptionsRefresh')
        dispatch('hydrateCardLinkTitles', {
          cards: allCards,
          boardGeneration,
          columnRequestGeneration,
        })
        dispatch('hydrateAttachmentCounts', {
          cards: allCards,
          boardGeneration,
          columnRequestGeneration,
        })
        dispatch('hydrateChildCounts', {
          cards: allCards,
          boardGeneration,
          columnRequestGeneration,
        })
        return true
      },
      /**
       * After first pages: top-up each column to initialColumnCardMinimum.
       * Remaining pages load on column scroll via loadChildColumnPage.
       */
      async topUpInitialChildColumns({ dispatch, state }, { scopeId, args } = {}) {
        const hydrated = state.childPanels[scopeId]
        if (!hydrated) {
          return
        }
        await Promise.allSettled(
          hydrated.columns.map(async (column, columnIndex) => {
            const columnName = column.column_name
            const total = hydrated.columnTotals?.[columnName]
            if (!Number.isFinite(total) || total <= 0) {
              return
            }
            const target = Math.min(initialColumnCardMinimum, total)
            let loaded = column.cards?.length || 0
            while (loaded < target) {
              const current = state.childPanels[scopeId]
              if (!current) {
                return
              }
              const pagination = current.columnPagination?.[columnName]
              if (!pagination?.hasMore || pagination.loading) {
                return
              }
              const previousOffset = pagination.offset
              await dispatch('loadChildColumnPage', {
                scopeId,
                columnIndex,
                args,
                pageSize: target - loaded,
              })
              loaded = state.childPanels[scopeId]?.columns?.[columnIndex]?.cards?.length || 0
              if (state.childPanels[scopeId]?.columnPagination?.[columnName]?.offset === previousOffset) {
                return
              }
            }
          }),
        )
      },
      async loadChildColumnPage(
        { commit, dispatch, state },
        {
          scopeId,
          columnIndex,
          args,
          pageSize = state.columnPageSize,
          reset = false,
        } = {},
      ) {
        const panel = state.childPanels[scopeId]
        const column = panel?.columns?.[columnIndex]
        if (!panel || !column || !state.config?.parent_field) {
          return
        }
        const columnName = column.column_name
        if (reset) {
          commit('SET_COLUMN_CARDS', {
            childScopeId: scopeId,
            columnIndex,
            cards: [],
          })
          commit('SET_CHILD_COLUMN_PAGE_STATE', {
            scopeId,
            columnName,
            changes: { offset: 0, hasMore: true, loading: false },
          })
        }
        const pagination = panel.columnPagination?.[columnName]
        if (!pagination || pagination.loading || (!reset && !pagination.hasMore)) {
          return
        }

        const sourceArgs = args || window.cur_list?.get_args?.() || {}
        const boardGeneration = state.boardGeneration
        const columnRequestGeneration = state.columnRequestGeneration
        commit('SET_CHILD_COLUMN_PAGE_STATE', {
          scopeId,
          columnName,
          changes: { loading: true },
        })

        try {
          const response = await frappe.call({
            method: 'quick_kanban.api.get_child_column_page',
            args: {
              doctype: state.config.ref_doctype,
              status_field: state.config.field_name,
              column: columnName,
              parent_name: panel.parentName,
              parent_field: state.config.parent_field,
              fields: state.config.fields,
              filters: Array.isArray(sourceArgs.filters) ? sourceArgs.filters : [],
              or_filters: sourceArgs.or_filters,
              start: reset ? 0 : pagination.offset,
              page_length: pageSize,
              column_values: activeColumnValues(state),
            },
          })
          if (
            state.boardGeneration !== boardGeneration
            || state.columnRequestGeneration !== columnRequestGeneration
            || !state.childPanels[scopeId]
          ) {
            commit('SET_CHILD_COLUMN_PAGE_STATE', {
              scopeId,
              columnName,
              changes: { loading: false },
            })
            return
          }
          const page = response.message || {}
          cacheUserInfo(page.user_info)
          const cards = cardsFromPageMessage(page, page.user_info)
          const resultCount = page.values?.length || 0
          const nextOffset = (reset ? 0 : pagination.offset) + resultCount
          const total = panel.columnTotals?.[columnName]

          if (reset) {
            commit('SET_COLUMN_CARDS', {
              childScopeId: scopeId,
              columnIndex,
              cards,
            })
            commit('BUMP_DRAG_SYNC')
          } else {
            commit('APPEND_COLUMN_CARDS', {
              childScopeId: scopeId,
              columnIndex,
              cards,
            })
          }
          commit('SET_CHILD_COLUMN_PAGE_STATE', {
            scopeId,
            columnName,
            changes: {
              offset: nextOffset,
              loading: false,
              hasMore:
                resultCount >= pageSize
                && (!Number.isFinite(total) || nextOffset < total),
            },
          })
          dispatch('scheduleMoveOptionsRefresh')
          dispatch('hydrateCardLinkTitles', {
            cards,
            boardGeneration,
            columnRequestGeneration,
          })
          dispatch('hydrateAttachmentCounts', {
            cards,
            boardGeneration,
            columnRequestGeneration,
          })
          dispatch('hydrateChildCounts', {
            cards,
            boardGeneration,
            columnRequestGeneration,
          })
        } catch (error) {
          if (
            state.boardGeneration === boardGeneration
            && state.columnRequestGeneration === columnRequestGeneration
          ) {
            commit('SET_CHILD_COLUMN_PAGE_STATE', {
              scopeId,
              columnName,
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
      async startCreateCard(
        { commit, dispatch, state },
        { columnIndex, column, laneKey = null, childScopeId = null },
      ) {
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

        const scopeId = childScopeId ? String(childScopeId) : null
        const panel = scopeId ? state.childPanels?.[scopeId] : null
        const parentName = panel?.parentName ? String(panel.parentName) : null
        const parentField = state.config?.parent_field

        let parentDefaults = {}
        if (scopeId && parentName && state.config?.ref_doctype) {
          const card = findCard(state, parentName) || { name: parentName }
          const candidates = listParentCreateCandidateFields(state.config)
          const missing = candidates.filter((fieldname) => {
            const value = card[fieldname]
            return value == null || value === ''
          })
          let fetched = {}
          if (missing.length && typeof frappe?.db?.get_value === 'function') {
            try {
              if (typeof frappe?.model?.with_doctype === 'function') {
                await frappe.model.with_doctype(state.config.ref_doctype)
              }
              const response = await frappe.db.get_value(
                state.config.ref_doctype,
                parentName,
                missing,
              )
              fetched = response?.message && typeof response.message === 'object'
                ? response.message
                : {}
            } catch {
              fetched = {}
            }
          }
          parentDefaults = buildParentCreateDefaults(
            { ...card, ...fetched },
            state.config,
          )
        }

        const swimlanePlan = buildSwimlaneCreateDefaults(state.config, laneKey)
        const defaults = {
          [state.config.field_name]: column.column_name,
          ...parentDefaults,
          ...swimlanePlan.defaults,
        }
        if (scopeId && parentName && parentField) {
          defaults[parentField] = parentName
        }
        commit('SET_PENDING_CREATE', {
          column_name: column.column_name,
          columnIndex,
          board_name: state.config.board_name,
          form_mode: formMode.mode,
          laneKey: laneKey != null ? String(laneKey) : null,
          assign_to: swimlanePlan.assignTo,
          childScopeId: scopeId,
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
      async handleCardCreated({ commit, dispatch, state }, { doc }) {
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
        const childScopeId = pending?.childScopeId || null
        if (
          !childScopeId
          && !filterCardsForChildVisibility([card], state).length
        ) {
          commit('CLEAR_PENDING_CREATE')
          return false
        }
        if (childScopeId && !state.childPanels?.[childScopeId]) {
          commit('CLEAR_PENDING_CREATE')
          return false
        }

        const assignTo = pending?.assign_to
        if (assignTo && state.config.swimlane_mode === 'assign') {
          try {
            await frappe.call({
              method: 'frappe.desk.form.assign_to.add',
              args: {
                doctype: state.config.ref_doctype,
                name: doc.name,
                assign_to: [assignTo],
                description: doc.description || doc.name,
              },
            })
            const existing = Object.keys(card._assign || {})
            if (!existing.includes(assignTo)) {
              card._assign = mapAssignments(
                JSON.stringify([...existing, assignTo]),
              )
            }
          } catch {
            // Card was created; assignment failure should not block board update.
          }
        }

        const columnName = childScopeId
          ? (state.childPanels[childScopeId]?.columns?.[columnIndex]?.column_name
            || state.columns[columnIndex]?.column_name
            || statusValue)
          : (state.columns[columnIndex]?.column_name || statusValue)
        if (childScopeId) {
          commit('PREPEND_CREATED_CARD_TO_CHILD', {
            childScopeId,
            columnIndex,
            card,
          })
        } else if (swimlanesActive(state) && pending?.laneKey != null) {
          if (!cardMatchesLane(card, pending.laneKey, state.config)) {
            commit('CLEAR_PENDING_CREATE')
            return false
          }
          commit('PREPEND_CREATED_CARD_TO_CELL', {
            laneKey: pending.laneKey,
            columnName,
            card,
          })
        } else {
          commit('PREPEND_CREATED_CARD', { columnIndex, card })
        }
        commit('TRACK_RECENT_CREATED_CARD', {
          cardName: card.name,
          columnName,
        })
        let laneIndex = null
        if (!childScopeId && pending?.laneKey != null) {
          const found = (state.lanes || []).findIndex(
            (lane) => String(lane.key ?? '') === String(pending.laneKey),
          )
          laneIndex = found >= 0 ? found : null
        }
        commit('SET_REVEAL_CREATED_CARD', {
          cardName: card.name,
          columnIndex,
          cardIndex: 0,
          laneIndex,
          childScopeId,
        })
        commit('CLEAR_PENDING_CREATE')
        if (childScopeId) {
          const parentName = String(
            state.childPanels[childScopeId]?.parentName || '',
          ).trim()
          if (parentName) {
            commit('ADJUST_CHILD_COUNT', { cardName: parentName, delta: 1 })
            dispatch('hydrateChildCounts', { cards: [{ name: parentName }] })
          }
        }
        dispatch('scheduleMoveOptionsRefresh')
        dispatch('hydrateCardLinkTitles', {
          cards: [card],
          boardGeneration: state.boardGeneration,
        })
        dispatch('hydrateBoardDocumentNames')
        if (!childScopeId && !swimlanesActive(state)) {
          dispatch('fetchColumnTotals')
        }
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
      async deleteCard({ commit, dispatch, state }, { cardName } = {}) {
        if (!cardName || state.pendingMoves[cardName]) {
          return false
        }
        const card = findCard(state, cardName)
        if (!card) {
          return false
        }
        const parentField = state.config?.parent_field
        const parentName = parentField
          ? String(card[parentField] || '').trim()
          : ''
        const expectedModified = card.modified
        const boardGeneration = state.boardGeneration
        const removal = { cardName }
        commit('SET_MOVE_PENDING', { cardName, pending: true })
        commit('REMOVE_CARD', removal)
        const snapshot = removal.snapshot
        if (!snapshot) {
          commit('SET_MOVE_PENDING', { cardName, pending: false })
          return false
        }
        try {
          await frappe.call({
            method: 'quick_kanban.api.delete_card',
            args: {
              board_name: state.config.board_name,
              name: cardName,
              expected_modified: expectedModified || undefined,
            },
          })
          if (state.boardGeneration !== boardGeneration) {
            return true
          }
          commit('CLEAR_CARD_MOVE_OPTIONS', cardName)
          commit('INVALIDATE_COUNT_RESPONSES')
          for (const placement of snapshot.placements) {
            if (placement.type === 'column') {
              commit('ADJUST_COLUMN_OFFSET', {
                columnIndex: placement.columnIndex,
                delta: -1,
              })
              commit('ADJUST_COLUMN_TOTAL', {
                columnIndex: placement.columnIndex,
                delta: -1,
              })
            }
          }
          if (parentName) {
            commit('ADJUST_CHILD_COUNT', { cardName: parentName, delta: -1 })
            dispatch('hydrateChildCounts', { cards: [{ name: parentName }] })
          }
          if (typeof frappe.show_alert === 'function') {
            frappe.show_alert({
              message: __('Card deleted', null, 'QuickKanban.ExtraInfo'),
              indicator: 'green',
            })
          }
          dispatch('scheduleMoveOptionsRefresh')
          dispatch('hydrateBoardDocumentNames')
          if (swimlanesActive(state)) {
            dispatch('fetchCellTotals')
          } else {
            dispatch('fetchColumnTotals')
          }
          return true
        } catch (error) {
          if (state.boardGeneration === boardGeneration) {
            commit('RESTORE_CARD', snapshot)
            if (typeof frappe.show_alert === 'function') {
              frappe.show_alert({
                message: __('Could not delete the card.', null, 'QuickKanban.ExtraInfo'),
                indicator: 'red',
              })
            }
          }
          return false
        } finally {
          if (state.boardGeneration === boardGeneration) {
            commit('SET_MOVE_PENDING', { cardName, pending: false })
          }
        }
      },
      async persistMove(
        { commit, dispatch, state },
        { cardName, fromColumn, toColumn, fromIndex, workflowAction = null },
      ) {
        const boardGeneration = state.boardGeneration
        commit('SET_MOVE_PENDING', { cardName, pending: true })
        const card = findCard(state, cardName)
          || state.columns[toColumn]?.cards?.find(({ name }) => name === cardName)
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
          dispatch('hydrateBoardDocumentNames')
          dispatch('fetchColumnTotals')
          // Refresh open child panel totals so column hasMore stays accurate.
          for (const scopeId of Object.keys(state.childPanels || {})) {
            dispatch('fetchChildColumnTotals', { scopeId })
          }
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

        if (payload.childScopeId && state.childPanels[payload.childScopeId]) {
          const panel = state.childPanels[payload.childScopeId]
          const fromColumn = payload.fromColumn
          const toColumn = payload.toColumn
          if (!panel.columns[fromColumn] || !panel.columns[toColumn]) {
            return false
          }
          if (fromColumn === toColumn) {
            return false
          }
          const boardPayload = {
            ...payload,
            // Map to board column indices by column_name for policy/persist.
            fromColumn: state.columns.findIndex(
              (column) => column.column_name === panel.columns[fromColumn].column_name,
            ),
            toColumn: state.columns.findIndex(
              (column) => column.column_name === panel.columns[toColumn].column_name,
            ),
          }
          if (boardPayload.fromColumn < 0 || boardPayload.toColumn < 0) {
            return false
          }
          const preflight = runPreflightMove(state, commit, boardPayload)
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
                column: state.columns[boardPayload.toColumn],
              })
            } catch {
              return false
            }
          } else if (policy?.actions?.length === 1) {
            workflowAction = policy.actions[0].action
          }
          commit('MOVE_CARD', { ...payload, workflowAction })
          await dispatch('persistMove', { ...boardPayload, workflowAction })
          return true
        }

        if (swimlanesActive(state) && state.lanes?.length) {
          const fromLaneIndex = Number.isFinite(payload.fromLaneIndex)
            ? payload.fromLaneIndex
            : findLaneIndexForCard(state, payload.cardName)
          if (fromLaneIndex < 0) return false
          const fromLane = state.lanes[fromLaneIndex]
          if (!fromLane) return false
          const toLaneIndex = fromLaneIndex
          const toLane = state.lanes[toLaneIndex]
          const fromColumn = payload.fromColumn
          const toColumn = payload.toColumn
          if (!fromLane.columns[fromColumn] || !toLane.columns[toColumn]) {
            return false
          }
          const fromIndex = fromLane.columns[fromColumn].cards.findIndex(
            ({ name }) => name === payload.cardName,
          )
          if (fromIndex < 0) return false
          const toIndex = Number.isFinite(payload.toIndex) ? payload.toIndex : 0
          const cellPayload = {
            cardName: payload.cardName,
            fromLaneIndex,
            toLaneIndex,
            fromColumn,
            toColumn,
            fromIndex,
            toIndex,
            workflowAction: payload.workflowAction || null,
          }
          commit('MOVE_CARD_CELL', cellPayload)
          const result = await dispatch('persistMovedCardToCell', cellPayload)
          return Boolean(result?.ok)
        }

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
        if (payload.childScopeId && state.childPanels[payload.childScopeId]) {
          const panel = state.childPanels[payload.childScopeId]
          const childFrom = payload.fromColumn
          const childTo = payload.toColumn
          const boardFrom = state.columns.findIndex(
            (column) => column.column_name === panel.columns[childFrom]?.column_name,
          )
          const boardTo = state.columns.findIndex(
            (column) => column.column_name === panel.columns[childTo]?.column_name,
          )
          if (boardFrom < 0 || boardTo < 0) {
            commit('ROLLBACK_CARD_MOVE', payload)
            return buildDragMoveFailureResult(payload)
          }
          const boardPayload = {
            cardName: payload.cardName,
            fromColumn: boardFrom,
            toColumn: boardTo,
            fromIndex: payload.fromIndex,
            toIndex: payload.toIndex,
            workflowAction: payload.workflowAction || null,
          }
          if (state.pendingMoves[payload.cardName]) {
            commit('ROLLBACK_CARD_MOVE', payload)
            return buildDragMoveFailureResult(payload)
          }
          const preflight = runPreflightMove(state, commit, boardPayload)
          if (!preflight.allowed) {
            commit('ROLLBACK_CARD_MOVE', payload)
            reportMoveFailure(commit, preflight, state.config)
            return buildDragMoveFailureResult(payload, preflight)
          }
          let workflowAction = boardPayload.workflowAction
          const policy = preflight.policy
          if (policy?.mode === 'workflow' && (policy.actions?.length || 0) > 1) {
            try {
              workflowAction = await dispatch('resolveWorkflowAction', {
                cardName: payload.cardName,
                column: state.columns[boardTo],
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
          const movePayload = { ...boardPayload, workflowAction }
          const recheck = runPreflightMove(state, commit, movePayload)
          if (!recheck.allowed) {
            commit('ROLLBACK_CARD_MOVE', payload)
            reportMoveFailure(commit, recheck, state.config)
            return buildDragMoveFailureResult(payload, recheck)
          }
          try {
            const card = panel.columns[childTo]?.cards?.find(
              ({ name }) => name === payload.cardName,
            )
            if (card) {
              card[state.config.field_name] = state.columns[boardTo].column_name
            }
            const boardGeneration = state.boardGeneration
            commit('SET_MOVE_PENDING', { cardName: payload.cardName, pending: true })
            try {
              const response = await frappe.call({
                method: 'quick_kanban.api.move_card',
                args: {
                  board_name: state.config.board_name,
                  name: payload.cardName,
                  value: state.columns[boardTo].column_name,
                  expected_modified: card?.modified,
                  workflow_action: workflowAction || undefined,
                },
              })
              if (state.boardGeneration !== boardGeneration) {
                return { ok: true }
              }
              if (response?.message?.modified) {
                commit('UPDATE_CARD_MODIFIED', {
                  cardName: payload.cardName,
                  modified: response.message.modified,
                })
              }
              commit('CLEAR_CARD_MOVE_OPTIONS', payload.cardName)
              commit('INVALIDATE_COUNT_RESPONSES')
              const destinationColumn = state.columns[boardTo]
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
              dispatch('fetchChildColumnTotals', { scopeId: payload.childScopeId })
              return { ok: true }
            } finally {
              if (state.boardGeneration === boardGeneration) {
                commit('SET_MOVE_PENDING', { cardName: payload.cardName, pending: false })
              }
            }
          } catch (error) {
            commit('ROLLBACK_CARD_MOVE', payload)
            reportMoveFailure(commit, null, state.config, error)
            return buildDragMoveFailureResult(payload, null, error)
          }
        }
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
        if (multiSwimlaneActive(state)) {
          commit('RECONCILE_CARD_INSTANCES', cardName)
        }
      },
      async relocateDeadlineSwimlaneCard({ commit, dispatch, state }, { cardName } = {}) {
        if (
          state.config?.swimlane_mode !== 'deadlines'
          || !cardName
          || !state.lanes?.length
        ) {
          return false
        }
        const found = findCardInLanes(state.lanes, cardName)
        if (!found) {
          return false
        }
        const template = { ...found.card }
        refreshCardDeadlineBucket(template, state.config)
        const targetKey = String(template._deadline_bucket ?? 'none')
        const sourceKey = String(found.lane.key ?? '')
        if (targetKey === sourceKey) {
          return false
        }

        const statusField = state.config.field_name
        const columnName = template[statusField]
        if (!columnName) {
          return false
        }

        commit('ADD_EXPANDED_LANE', targetKey)
        await dispatch('ensureLaneHydrated', { laneKey: targetKey })

        if (state.lanes.findIndex((lane) => String(lane.key) === targetKey) < 0) {
          return false
        }

        // Re-read after hydrate; always re-place at top of target column.
        const latest = findCard(state, cardName)
        const card = latest ? { ...latest } : template
        refreshCardDeadlineBucket(card, state.config)
        const finalTarget = String(card._deadline_bucket ?? 'none')
        commit('REMOVE_CARD', cardName)
        commit('PREPEND_CREATED_CARD_TO_CELL', {
          laneKey: finalTarget,
          columnName,
          card,
          incrementTotal: false,
        })

        const laneIndex = state.lanes.findIndex(
          (lane) => String(lane.key) === finalTarget,
        )
        const columnIndex = laneIndex >= 0
          ? (state.lanes[laneIndex].columns || []).findIndex(
            (column) => column.column_name === columnName,
          )
          : -1
        if (laneIndex >= 0 && columnIndex >= 0) {
          commit('SET_REVEAL_CREATED_CARD', {
            cardName,
            laneIndex,
            columnIndex,
            cardIndex: 0,
            flash: true,
          })
        }
        commit('INVALIDATE_COUNT_RESPONSES')
        dispatch('fetchCellTotals')
        dispatch('scheduleMoveOptionsRefresh')
        return true
      },
      async updateCardField(
        { commit, dispatch, state },
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
          if (
            multiSwimlaneActive(state)
            && fieldAffectsSwimlaneLayout(state, fieldname)
          ) {
            commit('RECONCILE_CARD_INSTANCES', cardName)
          }
          if (
            state.config.swimlane_mode === 'deadlines'
            && fieldAffectsSwimlaneLayout(state, fieldname)
          ) {
            await dispatch('relocateDeadlineSwimlaneCard', { cardName })
          }
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
          if (
            multiSwimlaneActive(state)
            && fieldAffectsSwimlaneLayout(state, fieldname)
          ) {
            commit('RECONCILE_CARD_INSTANCES', cardName)
          }
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

        const canWrite = Boolean(globalThis.frappe?.model?.can_write?.(doctype))
        const previousSourceTags = sourceCard._user_tags || ''
        const previousTargetTags = targetCard._user_tags || ''
        if (!canDropTag({
          tag,
          sourceName: sourceCardName,
          targetName: targetCardName,
          targetUserTags: previousTargetTags,
          canWriteTarget: canWrite,
          canWriteSource: canWrite,
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

        let addSucceeded = false
        try {
          await frappe.call({
            method: 'frappe.desk.doctype.tag.tag.add_tag',
            args: {
              tag,
              dt: doctype,
              dn: targetCardName,
            },
          })
          addSucceeded = true
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
          frappe.show_alert({
            message: __('Could not update tags.', null, 'QuickKanban.Tags'),
            indicator: 'red',
          })
          if (addSucceeded && mode === TAG_DRAG_MODE_MOVE) {
            // Target kept the tag on the server; source remove failed — match that.
            commit('UPDATE_CARD_FIELD', {
              cardName: targetCardName,
              fieldname: '_user_tags',
              value: nextTargetTags,
            })
            commit('UPDATE_CARD_FIELD', {
              cardName: sourceCardName,
              fieldname: '_user_tags',
              value: previousSourceTags,
            })
            return false
          }
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
      async setColumnWidths({ commit, state, getters }, widths) {
        if (!getters.canEditBoard) {
          return
        }
        if (!widths || typeof widths !== 'object' || !Object.keys(widths).length) {
          return
        }

        const previousWidths = {}
        for (const column of state.columns) {
          if (column.column_name in widths) {
            previousWidths[column.column_name] = column.custom_column_width
          }
        }

        commit('UPDATE_COLUMN_WIDTHS', widths)
        try {
          const response = await frappe.call({
            method: 'quick_kanban.api.set_column_widths',
            args: {
              board_name: state.config.board_name,
              widths,
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
            syncCachedListBoardColumns(savedBoard)
          } else {
            syncCachedListBoardColumns({
              name: state.config.board_name,
              columns: state.columns.map(({ cards: _cards, ...columnMeta }) => columnMeta),
            })
          }
        } catch (error) {
          commit('UPDATE_COLUMN_WIDTHS', previousWidths)
          frappe.show_alert({
            message: __('Could not update the column width.'),
            indicator: 'red',
          })
          throw error
        }
      },
    },
    getters: {
      getColumns: (state) => state.columns,
      getLanes: (state) => state.lanes,
      swimlanesEnabled: (state) =>
        Boolean(state.config?.swimlane_mode && state.config.swimlane_mode !== 'off'),
      expandedLaneKeys: (state) =>
        getExpandedLaneKeys(state.expandedLaneKeys, state.dragExpandedLaneKey),
      isLaneExpanded: (state, getters) => (laneKey) =>
        getters.expandedLaneKeys.includes(String(laneKey ?? '')),
      getLaneTotal: (state) => (laneKey) =>
        laneTotalFromCells(state.cellTotals, laneKey),
      getCellTotal: (state) => (laneKey, columnName) =>
        Number(state.cellTotals?.[laneKey]?.[columnName]) || 0,
      getCellPagination: (state) => (laneKey, columnName) =>
        state.cellPagination[cellKey(laneKey, columnName)] || {
          offset: 0,
          hasMore: false,
          loading: false,
        },
      getArchivedColumns: (state) => state.archivedColumns,
      getAddableColumns: (state) => getAddableColumnCandidates({
        options: parseSelectOptions(state.config?.status_field_meta),
        activeNames: state.columns.map((column) => column.column_name),
        archivedColumns: state.archivedColumns,
        statusFieldMeta: state.config?.status_field_meta,
      }),
      getConfig: (state) => state.config,
      isMinimizeCards: (state) => state.minimize_cards,
      isShowChildTasks: (state) => state.show_child_tasks,
      getChildPanel: (state) => (scopeId) => state.childPanels[scopeId] || null,
      getChildPanelAtDepth: (state) => (depth) => {
        const scopeId = state.childPanelByDepth[depth]
        return scopeId ? state.childPanels[scopeId] || null : null
      },
      isChildPanelOpenFor: (state) => (parentName, depth = 0) => {
        const scopeId = state.childPanelByDepth[depth]
        const panel = scopeId ? state.childPanels[scopeId] : null
        return Boolean(panel && panel.parentName === String(parentName || ''))
      },
      isChildPanelHostFor: (state) => (parentName, depth = 0, laneKey = null) => {
        const scopeId = state.childPanelByDepth[depth]
        const panel = scopeId ? state.childPanels[scopeId] : null
        if (!panel || panel.parentName !== String(parentName || '')) {
          return false
        }
        const hostKey = panel.hostLaneKey != null && String(panel.hostLaneKey).trim() !== ''
          ? String(panel.hostLaneKey)
          : null
        if (hostKey == null) {
          return true
        }
        if (laneKey == null || String(laneKey).trim() === '') {
          return false
        }
        return String(laneKey) === hostKey
      },
      getChildPanelScopeId: (state) => (parentName, depth = 0) => {
        const scopeId = state.childPanelByDepth[depth]
        const panel = scopeId ? state.childPanels[scopeId] : null
        if (panel && panel.parentName === String(parentName || '')) {
          return scopeId
        }
        return null
      },
      maxOpenChildPanelDepth: (state) => {
        const depths = Object.keys(state.childPanelByDepth || {})
          .map((key) => Number(key))
          .filter((depth) => Number.isFinite(depth))
        return depths.length ? Math.max(...depths) : null
      },
      childPanelAncestorNames: (state) => {
        const names = new Set()
        for (const scopeId of Object.values(state.childPanelByDepth || {})) {
          const panel = scopeId ? state.childPanels?.[scopeId] : null
          const parentName = String(panel?.parentName || '').trim()
          if (parentName) {
            names.add(parentName)
          }
        }
        return names
      },
      getCardChildPanelMode: (state, getters) => (cardName, childDepth = 0, laneKey = null) => {
        const maxDepth = getters.maxOpenChildPanelDepth
        if (maxDepth == null) {
          return 'active'
        }
        const name = String(cardName || '').trim()
        if (name && getters.childPanelAncestorNames.has(name)) {
          let hostLaneKey = null
          for (const scopeId of Object.values(state.childPanelByDepth || {})) {
            const panel = scopeId ? state.childPanels?.[scopeId] : null
            if (panel && String(panel.parentName || '').trim() === name) {
              hostLaneKey = panel.hostLaneKey != null && String(panel.hostLaneKey).trim() !== ''
                ? String(panel.hostLaneKey)
                : null
              break
            }
          }
          if (
            hostLaneKey != null
            && laneKey != null
            && String(laneKey).trim() !== ''
            && String(laneKey) !== hostLaneKey
          ) {
            return 'inert'
          }
          return 'ancestor'
        }
        if (Number(childDepth) === maxDepth + 1) {
          return 'active'
        }
        return 'inert'
      },
      getChildColumnPagination: (state) => (scopeId, columnName) => (
        state.childPanels[scopeId]?.columnPagination?.[columnName] || {
          offset: 0,
          hasMore: false,
          loading: false,
        }
      ),
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
        if (isStatusFieldReadOnly(state)) {
          return []
        }
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
        if (
          !isStatusFieldReadOnly(state)
          && getters.getAllowedDestinations(cardName).length > 0
        ) {
          return true
        }
        return canChangeLaneClient(state, cardName)
      },
      isDropAllowed: (state) => ({ cardName, columnIndex }) => {
        if (isStatusFieldReadOnly(state)) {
          return false
        }
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
      isCellDropAllowed: (state, getters) => ({
        cardName,
        columnIndex,
        laneColumnIndex,
        laneKey,
      }) => {
        if (!cardName || columnIndex < 0) {
          return false
        }
        const active = state.activeDrag
        const laneChanged = active?.fromLaneKey != null
          && laneKey != null
          && String(active.fromLaneKey) !== String(laneKey)
        const columnChanged = active?.fromColumn != null
          && laneColumnIndex != null
          && active.fromColumn !== laneColumnIndex

        if (columnChanged) {
          if (isStatusFieldReadOnly(state)) {
            return false
          }
          if (!getters.isDropAllowed({ cardName, columnIndex })) {
            return false
          }
          if (laneChanged && !canChangeLaneClient(state, cardName)) {
            return false
          }
          return true
        }
        if (laneChanged) {
          return canChangeLaneClient(state, cardName)
        }
        return true
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

function activeColumnValues(state) {
  return (state.columns || []).map((column) => column.column_name).filter(Boolean)
}

function buildFlatColumnPageArgs(state, columnName, sourceArgs, { start, pageLength }) {
  const args = {
    doctype: state.config.ref_doctype,
    status_field: state.config.field_name,
    column: columnName,
    fields: state.config.fields,
    filters: Array.isArray(sourceArgs.filters) ? sourceArgs.filters : [],
    start,
    page_length: pageLength,
    hide_board_children: shouldHideBoardChildren(state),
    column_values: activeColumnValues(state),
    board_name: state.config.board_name,
  }
  if (sourceArgs.or_filters !== undefined && sourceArgs.or_filters !== null) {
    args.or_filters = sourceArgs.or_filters
  }
  return args
}

function buildSwimlanePageHideArgs(state, sourceArgs) {
  const args = {
    hide_board_children: shouldHideBoardChildren(state),
    column_values: activeColumnValues(state),
  }
  if (sourceArgs.or_filters !== undefined && sourceArgs.or_filters !== null) {
    args.or_filters = sourceArgs.or_filters
  }
  return args
}

function createColumnPaginationFromLoaded(columns, pageSize, resultCounts) {
  return Object.fromEntries(
    columns.map((column, index) => {
      const loaded = column.cards?.length || 0
      const resultCount = Number.isFinite(resultCounts?.[index])
        ? resultCounts[index]
        : loaded
      return [
        getColumnKey(column),
        {
          offset: loaded,
          loading: false,
          hasMore: resultCount >= pageSize,
        },
      ]
    }),
  )
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

function buildColumnTotalsArgs(sourceArgs, config, columns, state = null) {
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
  if (state) {
    args.hide_board_children = shouldHideBoardChildren(state)
  }
  return args
}

function shouldHideBoardChildren(state) {
  return Boolean(!state.show_child_tasks && state.config?.parent_field)
}

export default createKanbanStore()