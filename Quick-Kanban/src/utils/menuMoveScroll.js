import { nextTick } from 'vue'
import {
  findCardElement,
  prefersReducedMotion,
} from './cardRollbackAnimation'

const DEFAULT_MARGIN = 8
const DEFAULT_MAX_ATTEMPTS = 8

export function resolveScrollBehavior() {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

/**
 * Resolve a component root Element from a Vue component instance / expose proxy.
 * Script-setup + defineExpose refs often omit `$el`; prefer getRootEl when exposed.
 */
export function resolveComponentRootEl(component) {
  if (!component) {
    return null
  }
  if (typeof component.getRootEl === 'function') {
    const fromGetter = component.getRootEl()
    if (fromGetter instanceof Element) {
      return fromGetter
    }
  }
  const el = component.$el
  if (el instanceof Element) {
    return el
  }
  if (component instanceof Element) {
    return component
  }
  return null
}

const STUCK_LANE_STICKY_TOLERANCE_PX = 2
const DEFAULT_SWIMLANE_LANE_CHROME_HEIGHT_PX = 40

/**
 * Lane sticky currently stuck under the column header row (nested ChildPanel hosts
 * live outside .swimlane-lane, so closest-lane lookup fails).
 */
function findStuckLaneSticky(scroller, headerBottom) {
  if (!scroller?.querySelectorAll || !Number.isFinite(headerBottom)) {
    return null
  }
  const stickies = [...scroller.querySelectorAll('.swimlane-lane-sticky')]
  return stickies.find((sticky) => {
    const top = sticky.getBoundingClientRect?.().top
    return Number.isFinite(top) && Math.abs(top - headerBottom) <= STUCK_LANE_STICKY_TOLERANCE_PX
  }) || null
}

function readSwimlaneLaneChromeHeight(scroller) {
  if (!scroller || typeof globalThis.getComputedStyle !== 'function') {
    return DEFAULT_SWIMLANE_LANE_CHROME_HEIGHT_PX
  }
  try {
    const raw = globalThis.getComputedStyle(scroller)
      .getPropertyValue('--swimlane-lane-chrome-height')
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_SWIMLANE_LANE_CHROME_HEIGHT_PX
  } catch {
    return DEFAULT_SWIMLANE_LANE_CHROME_HEIGHT_PX
  }
}

/**
 * Bottom edge (viewport Y) of sticky swimlane chrome above cards.
 * Matches KanbanColumn scroll-to-top inset logic.
 */
export function getLaneStickyBottom(scroller, columnEl) {
  if (!scroller) {
    return 0
  }
  const laneSticky = columnEl?.closest?.('.swimlane-lane')
    ?.querySelector('.swimlane-lane-sticky')
  if (laneSticky) {
    return laneSticky.getBoundingClientRect().bottom
  }
  const header = scroller.querySelector?.('.swimlane-header-row')
  if (header) {
    const headerBottom = header.getBoundingClientRect().bottom
    const stuckSticky = findStuckLaneSticky(scroller, headerBottom)
    if (stuckSticky) {
      return stuckSticky.getBoundingClientRect().bottom
    }
    return headerBottom + readSwimlaneLaneChromeHeight(scroller)
  }
  return scroller.getBoundingClientRect().top
}

/**
 * Top inset (px inside scroller viewport) occupied by sticky chrome.
 */
export function getScrollerTopInset(scroller, columnEl) {
  if (!scroller) {
    return 0
  }
  const stickyBottom = getLaneStickyBottom(scroller, columnEl)
  const scrollerTop = scroller.getBoundingClientRect().top
  return Math.max(0, stickyBottom - scrollerTop)
}

export function scrollColumnIntoView(
  columnEl,
  boardEl,
  { behavior = resolveScrollBehavior(), margin = DEFAULT_MARGIN } = {},
) {
  if (!columnEl || !boardEl) {
    return false
  }

  const boardRect = boardEl.getBoundingClientRect()
  const columnRect = columnEl.getBoundingClientRect()
  let targetScrollLeft = boardEl.scrollLeft

  if (columnRect.left < boardRect.left + margin) {
    targetScrollLeft -= (boardRect.left + margin) - columnRect.left
  } else if (columnRect.right > boardRect.right - margin) {
    targetScrollLeft += columnRect.right - (boardRect.right - margin)
  } else {
    return false
  }

  if (typeof boardEl.scrollTo === 'function') {
    boardEl.scrollTo({
      left: Math.max(0, targetScrollLeft),
      behavior,
    })
  } else {
    boardEl.scrollLeft = Math.max(0, targetScrollLeft)
  }
  return true
}

export function revealMovedCard(cardName, root = globalThis.document) {
  const cardEl = findCardElement(cardName, root)
  if (!cardEl) {
    return false
  }
  cardEl.scrollIntoView({
    behavior: resolveScrollBehavior(),
    block: 'nearest',
    inline: 'nearest',
  })
  return true
}

export function isCardVisibleInList(cardEl, listEl, margin = DEFAULT_MARGIN) {
  if (!cardEl || !listEl) {
    return false
  }
  const cardRect = cardEl.getBoundingClientRect()
  const listRect = listEl.getBoundingClientRect()
  return (
    cardRect.bottom > listRect.top + margin
    && cardRect.top < listRect.bottom - margin
  )
}

export function isCardVisibleInScroller(
  cardEl,
  scrollerEl,
  {
    margin = DEFAULT_MARGIN,
    topInset = 0,
    bottomInset = 0,
  } = {},
) {
  if (!cardEl || !scrollerEl) {
    return false
  }
  const cardRect = cardEl.getBoundingClientRect()
  const scrollerRect = scrollerEl.getBoundingClientRect()
  const visibleTop = scrollerRect.top + topInset + margin
  const visibleBottom = scrollerRect.bottom - bottomInset - margin
  return cardRect.bottom > visibleTop && cardRect.top < visibleBottom
}

export function scrollCardIntoScroller(
  cardEl,
  scrollerEl,
  {
    behavior = 'auto',
    margin = DEFAULT_MARGIN,
    topInset = 0,
    bottomInset = 0,
  } = {},
) {
  if (!cardEl || !scrollerEl) {
    return false
  }

  const cardRect = cardEl.getBoundingClientRect()
  const scrollerRect = scrollerEl.getBoundingClientRect()
  const visibleTop = scrollerRect.top + topInset + margin
  const visibleBottom = scrollerRect.bottom - bottomInset - margin
  let delta = 0

  if (cardRect.top < visibleTop) {
    delta = cardRect.top - visibleTop
  } else if (cardRect.bottom > visibleBottom) {
    delta = cardRect.bottom - visibleBottom
  } else {
    return false
  }

  const nextTop = Math.max(0, scrollerEl.scrollTop + delta)
  if (typeof scrollerEl.scrollTo === 'function') {
    scrollerEl.scrollTo({ top: nextTop, behavior })
  } else {
    scrollerEl.scrollTop = nextTop
  }
  return true
}

/**
 * Align card top to the scroller visible top (topInset + margin), always.
 * Unlike scrollCardIntoScroller (nearest), this pulls the card as high as possible.
 */
export function scrollCardToScrollerTop(
  cardEl,
  scrollerEl,
  {
    behavior = resolveScrollBehavior(),
    margin = DEFAULT_MARGIN,
    topInset = 0,
  } = {},
) {
  if (!cardEl || !scrollerEl) {
    return false
  }

  const cardRect = cardEl.getBoundingClientRect()
  const scrollerRect = scrollerEl.getBoundingClientRect()
  const visibleTop = scrollerRect.top + topInset + margin
  const delta = cardRect.top - visibleTop
  if (Math.abs(delta) < 0.5) {
    return false
  }

  const maxScroll = Math.max(
    0,
    (scrollerEl.scrollHeight || 0) - (scrollerEl.clientHeight || 0),
  )
  const nextTop = Math.min(maxScroll, Math.max(0, scrollerEl.scrollTop + delta))
  if (Math.abs(nextTop - (scrollerEl.scrollTop || 0)) < 0.5) {
    return false
  }
  if (typeof scrollerEl.scrollTo === 'function') {
    scrollerEl.scrollTo({ top: nextTop, behavior })
  } else {
    scrollerEl.scrollTop = nextTop
  }
  return true
}

export function waitForPaint() {
  return new Promise((resolve) => {
    nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve)
      })
    })
  })
}

export function waitMs(ms) {
  if (!(ms > 0)) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function revealCardInColumn({
  cardName,
  cardIndex,
  listEl,
  getListEl,
  getScrollerEl,
  getTopInset,
  getBottomInset,
  root = globalThis.document,
  scrollToCard,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) {
  const resolveListEl = () => (typeof getListEl === 'function' ? getListEl() : listEl)
  const resolveScrollerEl = () => (
    typeof getScrollerEl === 'function' ? getScrollerEl() : null
  )
  const resolveInsets = (scrollerEl, cardEl) => {
    const columnEl = cardEl?.closest?.('.kanban-column') || resolveListEl()
    const topInset = typeof getTopInset === 'function'
      ? Number(getTopInset(scrollerEl, columnEl)) || 0
      : (scrollerEl ? getScrollerTopInset(scrollerEl, columnEl) : 0)
    const bottomInset = typeof getBottomInset === 'function'
      ? Number(getBottomInset(scrollerEl, columnEl)) || 0
      : 0
    return { topInset, bottomInset }
  }

  const isVisible = (cardEl, currentListEl, scrollerEl) => {
    if (scrollerEl) {
      const { topInset, bottomInset } = resolveInsets(scrollerEl, cardEl)
      return isCardVisibleInScroller(cardEl, scrollerEl, { topInset, bottomInset })
    }
    return isCardVisibleInList(cardEl, currentListEl)
  }

  if (!scrollToCard) {
    const scrollerEl = resolveScrollerEl()
    if (scrollerEl) {
      const cardEl = findCardElement(cardName, root || scrollerEl)
      if (!cardEl) {
        return false
      }
      const { topInset, bottomInset } = resolveInsets(scrollerEl, cardEl)
      scrollCardIntoScroller(cardEl, scrollerEl, {
        behavior: 'auto',
        topInset,
        bottomInset,
      })
      return isCardVisibleInScroller(cardEl, scrollerEl, { topInset, bottomInset })
    }
    return revealMovedCard(cardName, root || resolveListEl())
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForPaint()
    scrollToCard(cardName, cardIndex)
    await waitForPaint()

    const currentListEl = resolveListEl()
    const scrollerEl = resolveScrollerEl()
    const cardEl = findCardElement(cardName, root || currentListEl || scrollerEl)
    if (!cardEl) {
      continue
    }

    if (scrollerEl && !isVisible(cardEl, currentListEl, scrollerEl)) {
      const { topInset, bottomInset } = resolveInsets(scrollerEl, cardEl)
      scrollCardIntoScroller(cardEl, scrollerEl, {
        behavior: 'auto',
        topInset,
        bottomInset,
      })
      await waitForPaint()
    }

    if (isVisible(cardEl, currentListEl, scrollerEl)) {
      return true
    }
  }

  const finalListEl = resolveListEl()
  const finalScroller = resolveScrollerEl()
  const cardEl = findCardElement(cardName, root || finalListEl || finalScroller)
  if (finalScroller && cardEl) {
    const { topInset, bottomInset } = resolveInsets(finalScroller, cardEl)
    scrollCardIntoScroller(cardEl, finalScroller, {
      behavior: 'auto',
      topInset,
      bottomInset,
    })
    await waitForPaint()
    return isCardVisibleInScroller(cardEl, finalScroller, { topInset, bottomInset })
  }

  revealMovedCard(cardName, root || finalListEl)
  const revealedEl = findCardElement(cardName, root || finalListEl)
  return isCardVisibleInList(revealedEl, finalListEl)
}
