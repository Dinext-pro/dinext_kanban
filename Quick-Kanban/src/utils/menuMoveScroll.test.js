import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  isCardVisibleInList,
  resolveScrollBehavior,
  revealCardInColumn,
  revealMovedCard,
  scrollColumnIntoView,
  waitForPaint,
} from './menuMoveScroll'

function mockRect({ left, right, top = 0, bottom = 100, width, height = 100 }) {
  return {
    left,
    right,
    top,
    bottom,
    width: width ?? right - left,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function createBoardPair({ boardLeft = 0, boardWidth = 400, columnLeft, columnWidth = 250 }) {
  const boardEl = {
    scrollLeft: 0,
    scrollTo: vi.fn(),
    getBoundingClientRect: () => mockRect({
      left: boardLeft,
      right: boardLeft + boardWidth,
      width: boardWidth,
    }),
  }
  const columnEl = {
    getBoundingClientRect: () => mockRect({
      left: columnLeft,
      right: columnLeft + columnWidth,
      width: columnWidth,
    }),
  }
  return { boardEl, columnEl }
}

beforeEach(() => {
  globalThis.matchMedia = vi.fn(() => ({ matches: false }))
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    callback(0)
    return 0
  })
})

describe('menu move scroll', () => {
  test('resolveScrollBehavior returns smooth by default', () => {
    expect(resolveScrollBehavior()).toBe('smooth')
  })

  test('resolveScrollBehavior returns auto when reduced motion is preferred', () => {
    globalThis.matchMedia = vi.fn(() => ({ matches: true }))
    expect(resolveScrollBehavior()).toBe('auto')
  })

  test('scrolls the board right when the column is off-screen to the right', () => {
    const { boardEl, columnEl } = createBoardPair({
      boardLeft: 0,
      boardWidth: 400,
      columnLeft: 420,
    })

    expect(scrollColumnIntoView(columnEl, boardEl)).toBe(true)
    expect(boardEl.scrollTo).toHaveBeenCalledWith({
      left: 278,
      behavior: 'smooth',
    })
  })

  test('scrolls the board left when the column is off-screen to the left', () => {
    const { boardEl, columnEl } = createBoardPair({
      boardLeft: 100,
      boardWidth: 400,
      columnLeft: 40,
    })
    boardEl.scrollLeft = 200

    expect(scrollColumnIntoView(columnEl, boardEl)).toBe(true)
    expect(boardEl.scrollTo).toHaveBeenCalledWith({
      left: 132,
      behavior: 'smooth',
    })
  })

  test('does not scroll when the column is already visible', () => {
    const { boardEl, columnEl } = createBoardPair({
      boardLeft: 0,
      boardWidth: 400,
      columnLeft: 120,
    })

    expect(scrollColumnIntoView(columnEl, boardEl)).toBe(false)
    expect(boardEl.scrollTo).not.toHaveBeenCalled()
  })

  test('revealMovedCard scrolls the card into view when present', () => {
    const scrollIntoView = vi.fn()
    const cardEl = { scrollIntoView }
    const root = {
      querySelector: vi.fn((selector) => (
        selector === 'article.kanban-card[data-card-name="TASK-1"]'
          ? cardEl
          : null
      )),
    }

    expect(revealMovedCard('TASK-1', root)).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  })

  test('isCardVisibleInList detects visible, above, and below cards', () => {
    const listEl = {
      getBoundingClientRect: () => mockRect({
        left: 0,
        right: 200,
        top: 100,
        bottom: 400,
      }),
    }
    const visibleCard = {
      getBoundingClientRect: () => mockRect({
        left: 10,
        right: 190,
        top: 150,
        bottom: 220,
      }),
    }
    const aboveCard = {
      getBoundingClientRect: () => mockRect({
        left: 10,
        right: 190,
        top: 20,
        bottom: 80,
      }),
    }
    const belowCard = {
      getBoundingClientRect: () => mockRect({
        left: 10,
        right: 190,
        top: 420,
        bottom: 500,
      }),
    }

    expect(isCardVisibleInList(visibleCard, listEl)).toBe(true)
    expect(isCardVisibleInList(aboveCard, listEl)).toBe(false)
    expect(isCardVisibleInList(belowCard, listEl)).toBe(false)
  })

  test('waitForPaint resolves after animation frames', async () => {
    await waitForPaint()
  })

  test('revealCardInColumn retries until the card becomes visible', async () => {
    const scrollToCard = vi.fn()
    const listEl = {
      getBoundingClientRect: () => mockRect({
        left: 0,
        right: 200,
        top: 100,
        bottom: 400,
      }),
    }
    const visibleCard = {
      getBoundingClientRect: () => mockRect({
        left: 10,
        right: 190,
        top: 150,
        bottom: 220,
      }),
    }
    let findCalls = 0
    const root = {
      querySelector: vi.fn((selector) => {
        if (selector.includes('data-key')) {
          return null
        }
        if (selector.includes('data-card-name')) {
          findCalls += 1
          return findCalls >= 3 ? visibleCard : null
        }
        return null
      }),
    }

    const revealed = await revealCardInColumn({
      cardName: 'TASK-1',
      cardIndex: 15,
      listEl,
      root,
      scrollToCard,
      maxAttempts: 6,
    })

    expect(revealed).toBe(true)
    expect(scrollToCard).toHaveBeenCalled()
    expect(scrollToCard.mock.calls[0]).toEqual(['TASK-1', 15])
  })
})
