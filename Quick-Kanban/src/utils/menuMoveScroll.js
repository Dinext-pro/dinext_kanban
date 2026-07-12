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

  boardEl.scrollTo({
    left: Math.max(0, targetScrollLeft),
    behavior,
  })
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

export function waitForPaint() {
  return new Promise((resolve) => {
    nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve)
      })
    })
  })
}

export async function revealCardInColumn({
  cardName,
  cardIndex,
  listEl,
  root = globalThis.document,
  scrollToCard,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) {
  if (!scrollToCard) {
    return revealMovedCard(cardName, root || listEl)
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForPaint()
    scrollToCard(cardName, cardIndex)
    await waitForPaint()

    const cardEl = findCardElement(cardName, root || listEl)
    if (isCardVisibleInList(cardEl, listEl)) {
      return true
    }
  }

  revealMovedCard(cardName, root || listEl)
  const cardEl = findCardElement(cardName, root || listEl)
  return isCardVisibleInList(cardEl, listEl)
}
