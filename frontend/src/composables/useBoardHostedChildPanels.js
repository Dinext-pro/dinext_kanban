import {
  computed,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  watch,
} from 'vue'
import { prefersReducedMotion } from '../utils/cardRollbackAnimation'
import {
  getScrollerTopInset,
  scrollCardToScrollerTop,
  waitMs,
} from '../utils/menuMoveScroll'
import {
  escapePanelParentName,
  isUsableHostLayoutRect,
  measureVisibleColumnsContentWidth,
  mergeHostPinScrollSnapshots,
  resolveChildPanelHostWidth,
  resolveChildPanelSpacerHeight,
  resolvePanelHostCard,
  resolvePanelHostSpacer,
  shouldRememberHostPinScroll,
  stabilizeHostPanelRectOnColumnToggle,
} from '../utils/childPanelBoard'
import {
  CHILD_PANEL_ANIMATION_MS,
  CHILD_PANEL_PIN_MS,
  COLUMN_COLLAPSE_ANIMATION_MS,
  getColumnKey,
} from '../utils/kanban'
import {
  animateScrollTop,
  resolveCardPinScrollTop,
} from '../utils/childPanelAnimation'

const SWIMLANE_COLUMN_GAP_PX = 8

/**
 * Board-hosted ChildPanel overlay orchestration: spacer geometry, pin scroll,
 * nested-pin locks, enter/leave render list, and scroll/resize sync.
 */
export function useBoardHostedChildPanels({
  kanbanBoard,
  swimlanesEnabled,
  animatedSwimlaneTrackWidths,
  store,
}) {
  const boardHostedPanelRects = ref({})
  const childPanelSpacerHeights = ref({})
  /** Last known host pin scrolls while host column was expanded (survive VL reset). */
  let lastGoodHostPinScrolls = []
  /** Freeze panel Y across collapse/expand settle; skip quiet pin while set. */
  let columnCollapseVerticalLock = false
  let columnCollapseSettleGeneration = 0
  provide('childPanelSpacerHeights', childPanelSpacerHeights)
  /** Parents whose spacer height should CSS-animate (open 0→H / close H→0 only). */
  const childPanelSpacerAnimatingParents = ref({})
  provide('childPanelSpacerAnimatingParents', childPanelSpacerAnimatingParents)
  const spacerAnimateClearTimers = new Map()
  const boardHostedChildPanels = computed(() => {
    const byDepth = store.state.childPanelByDepth || {}
    return Object.keys(byDepth)
      .map((depthKey) => Number(depthKey))
      .filter((depth) => Number.isFinite(depth))
      .sort((a, b) => a - b)
      .map((depth) => {
        const scopeId = byDepth[depth]
        const panel = scopeId ? store.state.childPanels?.[scopeId] : null
        if (!panel) {
          return null
        }
        const hostLaneKey = panel.hostLaneKey != null && String(panel.hostLaneKey).trim() !== ''
          ? String(panel.hostLaneKey)
          : null
        return {
          scopeId,
          parentName: panel.parentName,
          depth: panel.depth ?? depth,
          hostLaneKey,
        }
      })
      .filter(Boolean)
  })
  /** Store panels plus short-lived exiting shells for leave animation. */
  const renderedChildPanels = ref([])
  /** parentName → hostLaneKey for open/exiting spacers (null = any/flat lane). */
  const childPanelSpacerHostLanes = computed(() => {
    const map = {}
    for (const panel of renderedChildPanels.value || []) {
      const parent = String(panel?.parentName || '').trim()
      if (!parent) {
        continue
      }
      map[parent] = panel.hostLaneKey != null && String(panel.hostLaneKey).trim() !== ''
        ? String(panel.hostLaneKey)
        : null
    }
    return map
  })
  provide('childPanelSpacerHostLanes', childPanelSpacerHostLanes)
  const childPanelChromeOpen = computed(() => renderedChildPanels.value.length > 0)
  let pinScrollCancel = null
  let spacerOpenRaf = 0
  let boardHostedGeometryRaf = 0
  let boardHostedScrollBound = false
  let boardHostedPanelsSignature = ''
  /**
   * Parent-panel lists kept as bounded scrollports while nested hosts are pinned.
   * Multi-level open needs a stack: clearing an ancestor lock re-grows that list
   * (maxScroll 0) and unpins the mid-host.
   */
  const nestedPinListLocks = new Set()

  function unlockNestedPinListEl(el) {
    if (!el?.style) {
      nestedPinListLocks.delete(el)
      return
    }
    el.classList.remove('kanban-card-list--nested-pin')
    el.style.removeProperty('--nested-pin-h')
    nestedPinListLocks.delete(el)
  }

  function clearNestedPinListLocks() {
    for (const el of [...nestedPinListLocks]) {
      unlockNestedPinListEl(el)
    }
  }

  /** Keep locks only for lists that still host an open nested (depth >= 1) panel. */
  function pruneNestedPinListLocks() {
    const board = kanbanBoard.value
    const panels = boardHostedChildPanels.value || []
    const hasNested = panels.some((panel) => (Number(panel.depth) || 0) >= 1)
    const needed = new Set()
    for (const panel of panels) {
      const depth = Number(panel.depth) || 0
      if (depth < 1) {
        continue
      }
      const parent = String(panel.parentName || '').trim()
      if (!parent || !board) {
        continue
      }
      const host = resolvePanelHostCard(board, parent, depth, panel.hostLaneKey)
      const list = host?.closest?.('.kanban-card-list')
      if (list?.closest?.('.child-panel')) {
        needed.add(list)
      }
    }
    for (const el of [...nestedPinListLocks]) {
      if (!el?.isConnected) {
        unlockNestedPinListEl(el)
        continue
      }
      if (needed.has(el)) {
        continue
      }
      // Retain through brief VL remounts while any nested panel is still open.
      if (hasNested && el.closest?.('.child-panel')) {
        continue
      }
      unlockNestedPinListEl(el)
    }
  }

  /** Re-apply nested-pin scrollports for every open depth>=1 host (no scroll). */
  function ensureNestedPinLocks() {
    const board = kanbanBoard.value
    if (!board) {
      return
    }
    for (const host of resolveOpenPanelHosts()) {
      if (host.depth < 1) {
        continue
      }
      const card = resolvePanelHostCard(
        board,
        host.parentName,
        host.depth,
        host.hostLaneKey,
      )
      const list = card?.closest?.('.kanban-card-list')
      if (list?.closest?.('.child-panel')) {
        lockNestedPinListScroller(list)
      }
    }
  }

  function resolveHostPinScroller(hostCard) {
    if (!hostCard) {
      return null
    }
    if (hostCard.closest?.('.child-panel')) {
      return hostCard.closest('.kanban-card-list')
    }
    if (swimlanesEnabled.value) {
      return kanbanBoard.value
    }
    return hostCard.closest?.('.kanban-card-list') || kanbanBoard.value
  }

  /**
   * Spacer-map / VL updates can reset scrollTop on open hosts. Capture pin scrolls
   * for every open host except an optional pin target we are about to move.
   * Restore skips saved 0 so a fresh pin from the top is not undone.
   */
  function captureHostPinScrolls({ excludeParentName = '' } = {}) {
    const board = kanbanBoard.value
    const saved = []
    if (!board) {
      return saved
    }
    for (const host of resolveOpenPanelHosts()) {
      if (excludeParentName && host.parentName === excludeParentName) {
        continue
      }
      const card = resolvePanelHostCard(
        board,
        host.parentName,
        host.depth,
        host.hostLaneKey,
      )
      const scroller = resolveHostPinScroller(card)
      if (!scroller) {
        continue
      }
      saved.push({
        parentName: host.parentName,
        depth: host.depth,
        hostLaneKey: host.hostLaneKey,
        scrollTop: scroller.scrollTop || 0,
      })
    }
    return saved
  }

  function restoreHostPinScrolls(saved) {
    const board = kanbanBoard.value
    if (!board) {
      return
    }
    for (const entry of saved || []) {
      if (!entry || !(entry.scrollTop > 0)) {
        continue
      }
      const card = resolvePanelHostCard(
        board,
        entry.parentName,
        entry.depth,
        entry.hostLaneKey ?? hostLaneKeyForPanel(entry.parentName, entry.depth),
      )
      const scroller = resolveHostPinScroller(card)
      if (scroller && scroller.scrollTop !== entry.scrollTop) {
        scroller.scrollTop = entry.scrollTop
      }
    }
  }

  function hostPinScrollEntryKey(entry) {
    return `${Number(entry?.depth) || 0}::${String(entry?.parentName || '')}::${
      entry?.hostLaneKey != null ? String(entry.hostLaneKey) : ''
    }`
  }

  function rememberGoodHostPinScroll(entry, { hostNearTop = false } = {}) {
    if (!entry?.parentName) {
      return
    }
    const scrollTop = Math.max(0, Number(entry.scrollTop) || 0)
    if (!shouldRememberHostPinScroll({ scrollTop, hostNearTop })) {
      return
    }
    const key = hostPinScrollEntryKey(entry)
    const next = {
      parentName: String(entry.parentName).trim(),
      depth: Number(entry.depth) || 0,
      hostLaneKey: entry.hostLaneKey ?? null,
      scrollTop,
    }
    const idx = lastGoodHostPinScrolls.findIndex(
      (item) => hostPinScrollEntryKey(item) === key,
    )
    if (idx >= 0) {
      lastGoodHostPinScrolls[idx] = next
    } else {
      lastGoodHostPinScrolls.push(next)
    }
  }

  function restoreBoardHostedPanelPinScrolls() {
    restoreHostPinScrolls(lastGoodHostPinScrolls)
    applyBoardHostedPanelGeometry()
  }

  function pruneLastGoodHostPinScrolls() {
    const openKeys = new Set(
      resolveOpenPanelHosts().map((host) => hostPinScrollEntryKey(host)),
    )
    lastGoodHostPinScrolls = lastGoodHostPinScrolls.filter(
      (entry) => openKeys.has(hostPinScrollEntryKey(entry)),
    )
  }

  /**
   * Non-fill child-panel lists grow with content (overflow visible / height auto),
   * so scrollTop cannot move mid-host cards. Bound the list to the board
   * remainder and keep overflow auto while nested panels stay open.
   * When spacer moved to a deeper host, shrink height so cards above still scroll away.
   */
  function lockNestedPinListScroller(scroller) {
    const isNestedList = Boolean(
      scroller?.style
      && scroller !== kanbanBoard.value
      && scroller.classList?.contains('kanban-card-list')
      && scroller.closest?.('.child-panel'),
    )
    if (!isNestedList) {
      // Board / depth-0 column pin: drop nested scrollports only when store has
      // no nested panel — never infer from a board-first querySelector match.
      const hasNested = (boardHostedChildPanels.value || []).some(
        (panel) => (Number(panel.depth) || 0) >= 1,
      )
      if (!hasNested) {
        clearNestedPinListLocks()
      } else {
        pruneNestedPinListLocks()
      }
      return false
    }
    const board = kanbanBoard.value
    if (!board) {
      return false
    }
    const listRect = scroller.getBoundingClientRect()
    const boardRect = board.getBoundingClientRect()
    const boardRoom = Math.max(120, Math.floor(boardRect.bottom - listRect.top))
    const hostCard = scroller.querySelector?.('.kanban-vl-item--panel-host .kanban-card')
    // Measure before constraining — height:auto scrollHeight is full content.
    const naturalContentH = scroller.scrollHeight || 0
    const naturalHostOffset = hostCard
      ? Math.max(
        0,
        hostCard.getBoundingClientRect().top
          - scroller.getBoundingClientRect().top
          + (scroller.scrollTop || 0),
      )
      : 0
    let heightPx = boardRoom
    if (naturalHostOffset > 1 && naturalContentH > naturalHostOffset + 80) {
      // maxScroll must cover cards above; spacer may already be on a deeper host.
      heightPx = Math.max(80, Math.min(boardRoom, Math.floor(naturalContentH - naturalHostOffset)))
    }
    nestedPinListLocks.add(scroller)
    scroller.classList.add('kanban-card-list--nested-pin')
    scroller.style.setProperty('--nested-pin-h', `${heightPx}px`)
    void scroller.scrollHeight
    // Layout can shrink content after the first constrain — top up maxScroll if needed.
    if (hostCard && naturalHostOffset > 1) {
      const maxScroll = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0))
      if (maxScroll + 1 < naturalHostOffset) {
        heightPx = Math.max(
          80,
          Math.min(boardRoom, Math.floor((scroller.scrollHeight || 0) - naturalHostOffset)),
        )
        scroller.style.setProperty('--nested-pin-h', `${heightPx}px`)
      }
    }
    return true
  }

  function clearBoardHostedPanelChrome() {
    clearNestedPinListLocks()
    boardHostedPanelRects.value = {}
    childPanelSpacerHeights.value = {}
    clearSpacerAnimateParents()
  }

  function markSpacerAnimating(parents) {
    const names = (parents || []).map((name) => String(name || '').trim()).filter(Boolean)
    if (!names.length || prefersReducedMotion()) {
      return
    }
    const next = { ...childPanelSpacerAnimatingParents.value }
    for (const parent of names) {
      next[parent] = true
      if (spacerAnimateClearTimers.has(parent)) {
        clearTimeout(spacerAnimateClearTimers.get(parent))
      }
      spacerAnimateClearTimers.set(parent, setTimeout(() => {
        spacerAnimateClearTimers.delete(parent)
        const current = { ...childPanelSpacerAnimatingParents.value }
        delete current[parent]
        childPanelSpacerAnimatingParents.value = current
      }, CHILD_PANEL_ANIMATION_MS + 40))
    }
    childPanelSpacerAnimatingParents.value = next
  }

  function clearSpacerAnimateParents() {
    for (const timer of spacerAnimateClearTimers.values()) {
      clearTimeout(timer)
    }
    spacerAnimateClearTimers.clear()
    childPanelSpacerAnimatingParents.value = {}
  }

  function cancelPinScrollTween() {
    pinScrollCancel?.()
    pinScrollCancel = null
  }

  function finishPanelExitCleanup(scopeId) {
    renderedChildPanels.value = renderedChildPanels.value.filter(
      (panel) => panel.scopeId !== scopeId,
    )
    // Drop spacer keys that only belonged to finished exits.
    const openParents = new Set(
      boardHostedChildPanels.value.map((panel) => String(panel.parentName || '').trim()),
    )
    const exitingParents = new Set(
      renderedChildPanels.value
        .filter((panel) => panel.exiting)
        .map((panel) => String(panel.parentName || '').trim())
        .filter(Boolean),
    )
    const nextSpacer = { ...childPanelSpacerHeights.value }
    let spacerChanged = false
    for (const key of Object.keys(nextSpacer)) {
      if (!openParents.has(key) && !exitingParents.has(key)) {
        delete nextSpacer[key]
        spacerChanged = true
      }
    }
    if (spacerChanged) {
      childPanelSpacerHeights.value = nextSpacer
    }
    const nextRects = { ...boardHostedPanelRects.value }
    let rectsChanged = false
    for (const key of Object.keys(nextRects)) {
      if (!renderedChildPanels.value.some((panel) => panel.scopeId === key)) {
        delete nextRects[key]
        rectsChanged = true
      }
    }
    if (rectsChanged) {
      boardHostedPanelRects.value = nextRects
    }
    if (!renderedChildPanels.value.length && !boardHostedChildPanels.value.length) {
      clearBoardHostedPanelChrome()
      boardHostedPanelsSignature = ''
      cancelPinScrollTween()
    }
  }

  function onChildPanelAfterLeave(scopeId) {
    if (!scopeId) {
      return
    }
    finishPanelExitCleanup(scopeId)
  }

  function syncRenderedChildPanels(storePanels) {
    const nextById = new Map((storePanels || []).map((panel) => [panel.scopeId, panel]))
    const nextRendered = []
    const seen = new Set()

    for (const prev of renderedChildPanels.value) {
      const live = nextById.get(prev.scopeId)
      if (live) {
        nextRendered.push({
          scopeId: live.scopeId,
          parentName: live.parentName,
          depth: live.depth,
          hostLaneKey: live.hostLaneKey ?? null,
          exiting: false,
        })
        seen.add(prev.scopeId)
        continue
      }
      if (prev.exiting) {
        nextRendered.push(prev)
        seen.add(prev.scopeId)
        continue
      }
      // Keep shell until Transition @after-leave finishes cleanup.
      nextRendered.push({ ...prev, exiting: true })
      seen.add(prev.scopeId)
    }

    for (const panel of storePanels || []) {
      if (seen.has(panel.scopeId)) {
        continue
      }
      nextRendered.push({
        scopeId: panel.scopeId,
        parentName: panel.parentName,
        depth: panel.depth,
        hostLaneKey: panel.hostLaneKey ?? null,
        exiting: false,
      })
    }

    nextRendered.sort((a, b) => {
      const depthDelta = (Number(a.depth) || 0) - (Number(b.depth) || 0)
      if (depthDelta !== 0) {
        return depthDelta
      }
      return String(a.scopeId).localeCompare(String(b.scopeId))
    })

    const prev = renderedChildPanels.value
    const same = prev.length === nextRendered.length
      && prev.every((panel, index) => (
        panel.scopeId === nextRendered[index].scopeId
        && Boolean(panel.exiting) === Boolean(nextRendered[index].exiting)
        && panel.parentName === nextRendered[index].parentName
        && Number(panel.depth) === Number(nextRendered[index].depth)
        && (panel.hostLaneKey ?? null) === (nextRendered[index].hostLaneKey ?? null)
      ))
    if (same) {
      return
    }
    renderedChildPanels.value = nextRendered
  }

  function exitingPanelParentNames() {
    return renderedChildPanels.value
      .filter((panel) => panel.exiting)
      .map((panel) => String(panel.parentName || '').trim())
      .filter(Boolean)
  }

  /**
   * Apply spacer heights with 0→H open phasing so CSS height transition can run.
   * Keep exiting parents at 0 until leave cleanup removes them.
   * Height CSS transition is gated by child-panel-spacer--animate (open/close only).
   * Fallback note: if VirtualList remounts make pin unstable, callers may snap
   * height immediately via prefers-reduced-motion or by skipping the open phase.
   */
  function commitChildPanelSpacerHeights(nextSpacerHeights) {
    const prev = childPanelSpacerHeights.value || {}
    const target = { ...(nextSpacerHeights || {}) }
    for (const parent of exitingPanelParentNames()) {
      if (!(parent in target)) {
        target[parent] = 0
      }
    }

    if (prefersReducedMotion()) {
      // Drop pure-exit keys immediately when reduced motion.
      const reducedTarget = { ...(nextSpacerHeights || {}) }
      childPanelSpacerHeights.value = reducedTarget
      return
    }

    const phased = { ...target }
    const toOpen = []
    for (const [parent, height] of Object.entries(nextSpacerHeights || {})) {
      const nextH = Math.max(0, Number(height) || 0)
      const prevH = Math.max(0, Number(prev[parent]) || 0)
      if (nextH > 0 && prevH <= 0 && !Object.prototype.hasOwnProperty.call(prev, parent)) {
        phased[parent] = 0
        toOpen.push([parent, nextH])
      }
    }

    // Closing parents kept at 0 in target while exiting — animate H→0.
    const toClose = exitingPanelParentNames().filter((parent) => {
      const prevH = Math.max(0, Number(prev[parent]) || 0)
      return prevH > 0 && (Number(target[parent]) || 0) === 0
    })
    if (toOpen.length || toClose.length) {
      markSpacerAnimating([
        ...toOpen.map(([parent]) => parent),
        ...toClose,
      ])
    }

    // Nested spacer 0→H can remount VL and drop shallower host pin scrolls.
    const pinnedScrolls = toOpen.length ? captureHostPinScrolls() : []
    childPanelSpacerHeights.value = phased
    restoreHostPinScrolls(pinnedScrolls)

    if (!toOpen.length) {
      return
    }
    if (spacerOpenRaf) {
      cancelAnimationFrame(spacerOpenRaf)
    }
    spacerOpenRaf = requestAnimationFrame(() => {
      spacerOpenRaf = requestAnimationFrame(() => {
        spacerOpenRaf = 0
        const current = { ...childPanelSpacerHeights.value }
        const openParents = new Set(
          boardHostedChildPanels.value.map((panel) => String(panel.parentName || '').trim()),
        )
        for (const [parent, height] of toOpen) {
          if (openParents.has(parent)) {
            current[parent] = height
          }
        }
        childPanelSpacerHeights.value = current
        restoreHostPinScrolls(pinnedScrolls)
      })
    })
  }

  /**
   * Newest open panel parent (deepest). Nested hosts pin inside the parent panel
   * list scroller; depth-0 pins on the board — never board-scroll a nested host.
   */
  function resolveNewestPanelParentName(panels = boardHostedChildPanels.value) {
    if (!panels?.length) {
      return ''
    }
    const newest = panels[panels.length - 1]
    return String(newest?.parentName || '').trim()
  }

  /** Open panels as { parentName, depth } shallow → deep. */
  function resolveOpenPanelHosts(panels = boardHostedChildPanels.value) {
    return (panels || [])
      .map((panel) => ({
        parentName: String(panel?.parentName || '').trim(),
        depth: Number(panel?.depth) || 0,
        hostLaneKey: panel?.hostLaneKey != null && String(panel.hostLaneKey).trim() !== ''
          ? String(panel.hostLaneKey)
          : null,
      }))
      .filter((panel) => panel.parentName)
      .sort((a, b) => a.depth - b.depth)
  }

  function hostLaneKeyForPanel(parentName, depth = 0) {
    const parent = String(parentName || '').trim()
    const level = Number(depth) || 0
    const fromOpen = (boardHostedChildPanels.value || []).find(
      (panel) => (
        String(panel.parentName || '').trim() === parent
        && (Number(panel.depth) || 0) === level
      ),
    )
    if (fromOpen) {
      return fromOpen.hostLaneKey ?? null
    }
    const fromRendered = (renderedChildPanels.value || []).find(
      (panel) => (
        String(panel.parentName || '').trim() === parent
        && (Number(panel.depth) || 0) === level
      ),
    )
    return fromRendered?.hostLaneKey ?? null
  }

  function isPanelHostNearTop(parentName, depth = 0) {
    const board = kanbanBoard.value
    const parent = String(parentName || '').trim()
    if (!board || !parent) {
      return true
    }
    const hostCard = resolvePanelHostCard(
      board,
      parent,
      depth,
      hostLaneKeyForPanel(parent, depth),
    )
    if (!hostCard) {
      return true
    }
    const insideChildPanel = Boolean(hostCard.closest?.('.child-panel'))
    let scroller
    let topInset = 0
    if (insideChildPanel) {
      scroller = hostCard.closest?.('.kanban-card-list') || board
    } else if (swimlanesEnabled.value) {
      scroller = board
      topInset = getScrollerTopInset(scroller, hostCard.closest?.('.kanban-column'))
    } else {
      scroller = hostCard.closest?.('.kanban-card-list') || board
      topInset = getScrollerTopInset(scroller, hostCard.closest?.('.kanban-column'))
    }
    const cardRect = hostCard.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()
    return Math.abs(cardRect.top - (scrollerRect.top + topInset)) < 1.5
  }

  function waitAnimationFrame() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }

  function panelRectsEqual(left, right) {
    const a = left || {}
    const b = right || {}
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) {
      return false
    }
    const near = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) < 0.5
    for (const key of aKeys) {
      const l = a[key]
      const r = b[key]
      if (!r) {
        return false
      }
      if (
        !near(l.top, r.top)
        || !near(l.left, r.left)
        || !near(l.width, r.width)
        || !near(l.height, r.height)
      ) {
        return false
      }
    }
    return true
  }

  let flushPinChain = Promise.resolve()
  let flushPinQueuedParent = null
  let flushPinQueuedAnimateOpen = false

  async function onBoardHostedPanelHeight(parentName, height) {
    const parent = String(parentName || '').trim()
    if (!parent) {
      return
    }
    // Emit height is a layout signal; viewport-fill spacer comes from apply.
    // Do not write emit height into spacer map (avoids fight + extra VL churn).
    void height
    if (columnCollapseVerticalLock) {
      applyBoardHostedPanelGeometry()
      return
    }
    // Cards hydrate after open — quiet sync only (no second open choreography).
    const newest = resolveNewestPanelParentName() || parent
    await flushGeometryThenPin(newest, { animateOpen: false })
  }

  function resolvePanelHostTop(
    board,
    boardRect,
    parentName,
    previousTop,
    depth = 0,
    hostLaneKey = null,
  ) {
    const spacer = resolvePanelHostSpacer(board, parentName, depth, hostLaneKey)
    const hostCard = resolvePanelHostCard(board, parentName, depth, hostLaneKey)
    if (spacer) {
      const spacerRect = spacer.getBoundingClientRect()
      if (isUsableHostLayoutRect(spacerRect)) {
        return spacerRect.top - boardRect.top + board.scrollTop
      }
    }
    if (hostCard) {
      const cardRect = hostCard.getBoundingClientRect()
      if (isUsableHostLayoutRect(cardRect)) {
        return cardRect.bottom - boardRect.top + board.scrollTop
      }
    }
    if (Number.isFinite(previousTop)) {
      return previousTop
    }
    return null
  }

  function resolveHostColumnCollapsed(hostCard, board, hostLaneKey = null) {
    if (!hostCard) {
      return false
    }
    const columnEl = hostCard.closest?.('.kanban-column')
    if (columnEl?.classList?.contains?.('kanban-column--collapsed')) {
      return true
    }
    const columnValue = hostCard.closest?.('[data-column-value]')
      ?.getAttribute?.('data-column-value')
    if (columnValue) {
      if (store.getters.isColumnCollapsed(getColumnKey({ column_name: columnValue }))) {
        return true
      }
      if (board?.querySelector) {
        const escaped = escapePanelParentName(columnValue)
        const laneKey = hostLaneKey != null && String(hostLaneKey).trim() !== ''
          ? String(hostLaneKey).trim()
          : ''
        const laneSelector = laneKey
          ? `.swimlane-lane[data-lane-key="${escapePanelParentName(laneKey)}"] `
          : ''
        if (board.querySelector(
          `${laneSelector}.swimlane-cell-spacer[data-column-value="${escaped}"]`,
        )) {
          return true
        }
      }
    }
    return false
  }

  /** Synchronous spacer/rect update — call before pin so maxScroll includes pad. */
  function applyBoardHostedPanelGeometry() {
    const board = kanbanBoard.value
    const panels = boardHostedChildPanels.value
    if (!board || !panels.length || typeof board.getBoundingClientRect !== 'function') {
      // Keep rects for exiting Transition leave; spacer close is handled by the watch.
      if (!renderedChildPanels.value.some((panel) => panel.exiting)) {
        if (Object.keys(boardHostedPanelRects.value || {}).length) {
          boardHostedPanelRects.value = {}
        }
      }
      return
    }
    const pinnedScrolls = captureHostPinScrolls()
    try {
      const boardRect = board.getBoundingClientRect()
      const overhangRaw = getComputedStyle(board).getPropertyValue('--swimlane-lane-overhang')
      const overhang = swimlanesEnabled.value
        ? Math.max(0, Number.parseFloat(overhangRaw) || 0)
        : 0
      const columnWidthsPx = animatedSwimlaneTrackWidths.value
      let width = resolveChildPanelHostWidth({
        columnWidthsPx,
        gutterPx: SWIMLANE_COLUMN_GAP_PX,
      })
      if (!(width > 0)) {
        width = measureVisibleColumnsContentWidth(board, {
          swimlanesEnabled: swimlanesEnabled.value,
        })
      }
      const nextRects = {}
      const previousRects = boardHostedPanelRects.value || {}
      const nextSpacerHeights = {}
      let spacerHeightsChanged = false
      for (const panel of panels) {
        const depth = Number(panel.depth) || 0
        const top = resolvePanelHostTop(
          board,
          boardRect,
          panel.parentName,
          previousRects[panel.scopeId]?.top,
          depth,
          panel.hostLaneKey,
        )
        if (top == null) {
          continue
        }
        const rect = {
          top,
          left: overhang,
          // Overhang is already applied via left; do not stretch to viewport.
          width: Math.max(0, width),
        }
        // Keep spacer + panel height for every open host (not only maxDepth).
        // Nested open must not drop the board pad under a mid-column depth-0 host
        // or scrollTop clamps and the parent panel jerks.
        const hostCard = resolvePanelHostCard(
          board,
          panel.parentName,
          depth,
          panel.hostLaneKey,
        )
        const hostCardRect = hostCard?.getBoundingClientRect?.()
        const hostLayoutUsable = isUsableHostLayoutRect(hostCardRect)
        const columnEl = hostCard?.closest?.('.kanban-column')
        const listEl = hostLayoutUsable
          ? hostCard?.closest?.('.kanban-card-list')
          : null
        // Pin target is list top (under column/lane chrome), not board top — flat headers ~52px.
        const topInset = listEl
          ? Math.max(0, listEl.getBoundingClientRect().top - boardRect.top)
          : getScrollerTopInset(board, columnEl)
        const hostHeight = hostLayoutUsable
          ? (hostCardRect.height || 0)
          : 0
        // Viewport fill as if host were pinned under sticky — not current Y.
        const height = resolveChildPanelSpacerHeight({
          scrollerClientHeight: board.clientHeight,
          topInset,
          hostHeight,
        })
        rect.height = height
        const hostColumnCollapsed = resolveHostColumnCollapsed(
          hostCard,
          board,
          panel.hostLaneKey,
        )
        const hostMissing = !hostCard || !hostLayoutUsable
        if (hostCard && hostLayoutUsable && !hostColumnCollapsed && !columnCollapseVerticalLock) {
          const scroller = resolveHostPinScroller(hostCard)
          if (scroller) {
            rememberGoodHostPinScroll(
              {
                parentName: panel.parentName,
                depth,
                hostLaneKey: panel.hostLaneKey,
                scrollTop: scroller.scrollTop || 0,
              },
              {
                hostNearTop: isPanelHostNearTop(panel.parentName, depth),
              },
            )
          }
        }
        const { rect: stableRect, verticalFrozen } = stabilizeHostPanelRectOnColumnToggle({
          previousRect: previousRects[panel.scopeId],
          nextRect: rect,
          hostColumnCollapsed,
          hostMissing,
          verticalLock: columnCollapseVerticalLock,
          swimlanesEnabled: swimlanesEnabled.value,
        })
        const parent = String(panel.parentName || '').trim()
        if (parent && !verticalFrozen) {
          nextSpacerHeights[parent] = stableRect.height
          if (childPanelSpacerHeights.value?.[parent] !== stableRect.height) {
            spacerHeightsChanged = true
          }
        } else if (parent && verticalFrozen) {
          // Keep prior pad so quiet re-pin cannot inflate spacer during collapse.
          const prior = childPanelSpacerHeights.value?.[parent]
          if (Number.isFinite(prior)) {
            nextSpacerHeights[parent] = prior
          } else {
            nextSpacerHeights[parent] = stableRect.height
          }
        }
        nextRects[panel.scopeId] = stableRect
      }
      pruneLastGoodHostPinScrolls()
      // Spacers live for every open host until close/exit cleanup.
      // Exiting hosts are kept at 0 inside commitChildPanelSpacerHeights for leave layout.
      const previousSpacer = childPanelSpacerHeights.value || {}
      const exitingParents = new Set(exitingPanelParentNames())
      const spacerComparablePrev = Object.fromEntries(
        Object.entries(previousSpacer).filter(([key]) => !exitingParents.has(key)),
      )
      if (
        Object.keys(spacerComparablePrev).length !== Object.keys(nextSpacerHeights).length
        || Object.keys(spacerComparablePrev).some(
          (key) => spacerComparablePrev[key] !== nextSpacerHeights[key],
        )
        || Object.keys(nextSpacerHeights).some(
          (key) => !Object.prototype.hasOwnProperty.call(previousSpacer, key),
        )
      ) {
        spacerHeightsChanged = true
      }
      // Skip identical rect writes — ChildPanel watches hostRect and would re-emit height.
      if (!panelRectsEqual(previousRects, nextRects)) {
        boardHostedPanelRects.value = nextRects
      }
      if (spacerHeightsChanged) {
        commitChildPanelSpacerHeights(nextSpacerHeights)
      }
    } finally {
      restoreHostPinScrolls(pinnedScrolls)
    }
  }

  /** Debounced for scroll/resize; open/height path uses flushGeometryThenPin instead. */
  function syncBoardHostedPanelGeometry() {
    if (boardHostedGeometryRaf) {
      cancelAnimationFrame(boardHostedGeometryRaf)
    }
    boardHostedGeometryRaf = requestAnimationFrame(() => {
      boardHostedGeometryRaf = 0
      applyBoardHostedPanelGeometry()
    })
  }

  /**
   * Cancel pending rAF sync, apply spacer now, optionally run open choreography, then pin.
   * Single-flight + trailing parent so hostRect/height feedback cannot stack flushes.
   * animateOpen: true only when panel signature changes; height-change uses false.
   */
  function flushGeometryThenPin(parentName, { animateOpen = false } = {}) {
    if (!parentName) {
      return flushPinChain
    }
    flushPinQueuedParent = parentName
    // Prefer open choreography if any queued flush in the chain requested it.
    flushPinQueuedAnimateOpen = flushPinQueuedAnimateOpen || Boolean(animateOpen)
    flushPinChain = flushPinChain
      .catch(() => {})
      .then(async () => {
        const parent = flushPinQueuedParent
        const doAnimateOpen = flushPinQueuedAnimateOpen
        flushPinQueuedParent = null
        flushPinQueuedAnimateOpen = false
        if (!parent) {
          return
        }
        if (boardHostedGeometryRaf) {
          cancelAnimationFrame(boardHostedGeometryRaf)
          boardHostedGeometryRaf = 0
        }
        pruneNestedPinListLocks()
        const openHosts = () => {
          const hosts = resolveOpenPanelHosts()
          // Ensure trailing flush target is included even if panels lag one tick.
          if (parent && !hosts.some((host) => host.parentName === parent)) {
            const queuedDepth = (boardHostedChildPanels.value || []).find(
              (panel) => String(panel.parentName || '').trim() === parent,
            )
            hosts.push({
              parentName: parent,
              depth: Number(queuedDepth?.depth) || 0,
              hostLaneKey: queuedDepth?.hostLaneKey ?? null,
            })
          }
          return hosts
        }
        // Pin only the flush target (newest/deepest). Re-pinning shallower hosts
        // after nested open jerks mid-column depth-0 cards and parent panels.
        const resolvePinTarget = () => {
          const hosts = openHosts()
          const queued = hosts.find((host) => host.parentName === parent)
          if (queued) {
            return queued
          }
          return hosts.reduce(
            (best, host) => (!best || host.depth >= best.depth ? host : best),
            null,
          )
        }
        const pinTargetNearTop = () => {
          const target = resolvePinTarget()
          if (!target) {
            return true
          }
          return isPanelHostNearTop(target.parentName, target.depth)
        }
        // Snapshot shallower pin scrolls once up front — later captures may already
        // see VL-reset scrollTop=0; merge last-good so nested drag cannot drop depth-0.
        const preservedScrolls = mergeHostPinScrollSnapshots({
          captured: captureHostPinScrolls({ excludeParentName: parent }),
          lastGood: lastGoodHostPinScrolls,
          excludeParentName: parent,
        })
        const restorePreserved = () => restoreHostPinScrolls(preservedScrolls)
        const pinTarget = async (behavior) => {
          const target = resolvePinTarget()
          if (!target) {
            return
          }
          try {
            await ensureBoardHostedPanelAnchorVisible(target.parentName, {
              behavior,
              depth: target.depth,
            })
          } finally {
            restorePreserved()
          }
        }
        // Wait until spacer is in layout (needed for short columns; also gates VL height).
        for (let i = 0; i < 8; i += 1) {
          applyBoardHostedPanelGeometry()
          ensureNestedPinLocks()
          await nextTick()
          await waitAnimationFrame()
          restorePreserved()
          const board = kanbanBoard.value
          const target = resolvePinTarget()
          const spacer = target
            ? resolvePanelHostSpacer(
              board,
              target.parentName,
              target.depth,
              target.hostLaneKey ?? hostLaneKeyForPanel(target.parentName, target.depth),
            )
            : null
          if (spacer && (spacer.getBoundingClientRect().height || 0) > 1) {
            break
          }
        }

        if (!doAnimateOpen) {
          // Quiet path: geometry only + instant pin if VL dropped the host.
          ensureNestedPinLocks()
          if (!columnCollapseVerticalLock && !pinTargetNearTop()) {
            await pinTarget('auto')
          }
          restorePreserved()
          return
        }

        // Let host densify + spacer/panel enter run before pin scroll.
        if (!prefersReducedMotion()) {
          await waitMs(CHILD_PANEL_ANIMATION_MS)
          applyBoardHostedPanelGeometry()
          ensureNestedPinLocks()
          await nextTick()
          await waitAnimationFrame()
          restorePreserved()
        }
        // Smooth pin once (manual scrollTop tween — native smooth breaks on VL remount).
        ensureNestedPinLocks()
        await pinTarget('tween')
        // Instant correction if VL remount dropped scroll mid/after tween.
        const deadline = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 800
        let stableFrames = 0
        while ((typeof performance !== 'undefined' ? performance.now() : Date.now()) < deadline) {
          applyBoardHostedPanelGeometry()
          ensureNestedPinLocks()
          pruneNestedPinListLocks()
          restorePreserved()
          if (pinTargetNearTop()) {
            stableFrames += 1
            if (stableFrames >= 2) {
              restorePreserved()
              return
            }
          } else {
            stableFrames = 0
            await pinTarget('auto')
          }
          await waitAnimationFrame()
        }
        await pinTarget('auto')
        restorePreserved()
      })
    return flushPinChain
  }

  provide('syncChildPanelGeometry', syncBoardHostedPanelGeometry)

  let boardHostedResizeObserver = null

  function bindBoardHostedGeometryListeners() {
    const board = kanbanBoard.value
    if (!board || boardHostedScrollBound) {
      return
    }
    board.addEventListener('scroll', syncBoardHostedPanelGeometry, { passive: true })
    window.addEventListener('resize', syncBoardHostedPanelGeometry, { passive: true })
    if (typeof ResizeObserver !== 'undefined') {
      boardHostedResizeObserver = new ResizeObserver(() => syncBoardHostedPanelGeometry())
      boardHostedResizeObserver.observe(board)
    }
    boardHostedScrollBound = true
  }

  function unbindBoardHostedGeometryListeners() {
    const board = kanbanBoard.value
    if (board && boardHostedScrollBound) {
      board.removeEventListener('scroll', syncBoardHostedPanelGeometry)
    }
    window.removeEventListener('resize', syncBoardHostedPanelGeometry)
    boardHostedResizeObserver?.disconnect()
    boardHostedResizeObserver = null
    boardHostedScrollBound = false
  }

  async function ensureBoardHostedPanelAnchorVisible(
    parentName,
    { behavior = 'auto', depth = 0 } = {},
  ) {
    const board = kanbanBoard.value
    if (!board || !parentName) {
      return
    }
    const hostDepth = Number(depth) || 0
    const hostLaneKey = hostLaneKeyForPanel(parentName, hostDepth)
    const useTween = behavior === 'tween' && !prefersReducedMotion()

    const resolveAlignContext = (hostCard) => {
      const insideChildPanel = Boolean(hostCard.closest?.('.child-panel'))
      let scroller
      let topInset = 0
      if (insideChildPanel) {
        // Nested host: pin inside the parent panel column list (not the board).
        scroller = hostCard.closest?.('.kanban-card-list') || board
        topInset = 0
      } else if (swimlanesEnabled.value) {
        scroller = board
        topInset = getScrollerTopInset(scroller, hostCard.closest?.('.kanban-column'))
      } else {
        scroller = hostCard.closest?.('.kanban-card-list') || board
        topInset = getScrollerTopInset(scroller, hostCard.closest?.('.kanban-column'))
      }
      return { scroller, topInset }
    }

    /**
     * Unlock scroller for programmatic pin.
     * Nested mid-host: keep a bounded scrollport on the parent list (non-fill
     * lists grow with content → maxScroll 0 unless height is constrained).
     * Board: temporary overflow-y unlock with !important, then restore.
     */
    const withScrollerYScrollUnlock = async (scroller, run) => {
      if (!scroller?.style?.setProperty) {
        return run()
      }
      if (lockNestedPinListScroller(scroller)) {
        void scroller.scrollHeight
        return run()
      }
      scroller.style.setProperty('overflow-y', 'auto', 'important')
      void scroller.scrollHeight
      try {
        return await run()
      } finally {
        const keptTop = scroller.scrollTop
        scroller.style.removeProperty('overflow-y')
        scroller.scrollTop = keptTop
      }
    }

    const alignHostInstant = async () => {
      const hostCard = resolvePanelHostCard(board, parentName, hostDepth, hostLaneKey)
      if (!hostCard) {
        return false
      }
      const { scroller, topInset } = resolveAlignContext(hostCard)
      // auto: VirtualList remounts (minimize/spacer) cancel smooth mid-flight.
      return withScrollerYScrollUnlock(scroller, () => scrollCardToScrollerTop(hostCard, scroller, {
        topInset,
        behavior: 'auto',
        margin: 0,
      }))
    }

    const alignHostTween = async () => {
      const hostCard = resolvePanelHostCard(board, parentName, hostDepth, hostLaneKey)
      if (!hostCard) {
        return false
      }
      const { scroller, topInset } = resolveAlignContext(hostCard)
      return withScrollerYScrollUnlock(scroller, async () => {
        // Recompute after unlock — nested pin height may change maxScroll.
        const unlockedTarget = resolveCardPinScrollTop(hostCard, scroller, {
          topInset,
          margin: 0,
        })
        if (unlockedTarget == null) {
          return true
        }
        cancelPinScrollTween()
        const anim = animateScrollTop(scroller, unlockedTarget, {
          duration: CHILD_PANEL_PIN_MS,
        })
        pinScrollCancel = () => anim.cancel()
        const moved = await anim.done
        if (pinScrollCancel) {
          pinScrollCancel = null
        }
        return moved
      })
    }

    const hostNearTop = () => {
      const hostCard = resolvePanelHostCard(board, parentName, hostDepth, hostLaneKey)
      if (!hostCard) {
        return true
      }
      const { scroller, topInset } = resolveAlignContext(hostCard)
      const cardRect = hostCard.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      const visibleTop = scrollerRect.top + topInset
      return Math.abs(cardRect.top - visibleTop) < 1
    }

    const spacerLaidOut = () => {
      const spacer = resolvePanelHostSpacer(board, parentName, hostDepth, hostLaneKey)
      return Boolean(spacer && (spacer.getBoundingClientRect().height || 0) > 1)
    }

    if (useTween) {
      if (!spacerLaidOut()) {
        applyBoardHostedPanelGeometry()
        await nextTick()
        await waitAnimationFrame()
      }
      await alignHostTween()
      return
    }

    // Retry while spacer/maxScroll catch up (short columns fit viewport without pad).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await alignHostInstant()
      if (hostNearTop()) {
        return
      }
      if (!spacerLaidOut()) {
        applyBoardHostedPanelGeometry()
      }
      await nextTick()
      await waitAnimationFrame()
    }
    await alignHostInstant()
  }

  watch(
    () => boardHostedChildPanels.value.map((panel) => panel.scopeId).join('|'),
    async (signature) => {
      const panels = boardHostedChildPanels.value
      if (!panels.length) {
        syncRenderedChildPanels(panels)
        boardHostedPanelsSignature = ''
        cancelPinScrollTween()
        // Animate spacer closed; keep keys until leave cleanup removes hosts.
        if (prefersReducedMotion()) {
          renderedChildPanels.value = []
          clearBoardHostedPanelChrome()
          return
        }
        const zeroed = {}
        for (const key of Object.keys(childPanelSpacerHeights.value || {})) {
          zeroed[key] = 0
        }
        for (const panel of renderedChildPanels.value) {
          const parent = String(panel.parentName || '').trim()
          if (parent) {
            zeroed[parent] = 0
          }
        }
        markSpacerAnimating(Object.keys(zeroed))
        childPanelSpacerHeights.value = zeroed
        return
      }
      const previousSignature = boardHostedPanelsSignature
      boardHostedPanelsSignature = signature
      await nextTick()
      bindBoardHostedGeometryListeners()
      // Resolve hostRect before mounting teleported panels. Mounting with
      // display:none (old v-show until hostRect) aborted Vue enter and left
      // enter-from/opacity:0 stuck on the panel root.
      applyBoardHostedPanelGeometry()
      syncRenderedChildPanels(panels)
      // Spacer mounts after VirtualList paints; apply synchronously then pin.
      // Signature-only watch: hydrate of cards does not re-run open choreography.
      if (signature !== previousSignature) {
        await flushGeometryThenPin(resolveNewestPanelParentName(panels), { animateOpen: true })
      } else {
        syncBoardHostedPanelGeometry()
      }
    },
    { immediate: true },
  )

  watch(
    () => store.state.collapsedColumns,
    async () => {
      if (!boardHostedChildPanels.value.length) {
        return
      }
      const generation = ++columnCollapseSettleGeneration
      columnCollapseVerticalLock = true
      await nextTick()
      await waitAnimationFrame()
      if (generation !== columnCollapseSettleGeneration) {
        return
      }
      restoreHostPinScrolls(lastGoodHostPinScrolls)
      applyBoardHostedPanelGeometry()
      await waitMs(COLUMN_COLLAPSE_ANIMATION_MS)
      if (generation !== columnCollapseSettleGeneration) {
        return
      }
      restoreHostPinScrolls(lastGoodHostPinScrolls)
      if (generation !== columnCollapseSettleGeneration) {
        return
      }
      columnCollapseVerticalLock = false
      applyBoardHostedPanelGeometry()
    },
    { deep: true },
  )

  function disposeBoardHostedChildPanels() {
    if (boardHostedGeometryRaf) {
      cancelAnimationFrame(boardHostedGeometryRaf)
      boardHostedGeometryRaf = 0
    }
    if (spacerOpenRaf) {
      cancelAnimationFrame(spacerOpenRaf)
      spacerOpenRaf = 0
    }
    cancelPinScrollTween()
    clearSpacerAnimateParents()
    unbindBoardHostedGeometryListeners()
    clearNestedPinListLocks()
  }

  onBeforeUnmount(disposeBoardHostedChildPanels)

  return {
    renderedChildPanels,
    boardHostedPanelRects,
    childPanelChromeOpen,
    boardHostedChildPanels,
    onBoardHostedPanelHeight,
    onChildPanelAfterLeave,
    applyBoardHostedPanelGeometry,
    restoreBoardHostedPanelPinScrolls,
    disposeBoardHostedChildPanels,
  }
}
