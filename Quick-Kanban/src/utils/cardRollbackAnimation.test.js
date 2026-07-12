import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  animateCardRollback,
  captureCardRect,
  findCardElement,
  prefersReducedMotion,
} from './cardRollbackAnimation'

function createCardElement(cardName) {
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-key', cardName)
  const card = document.createElement('article')
  card.className = 'kanban-card'
  card.setAttribute('data-card-name', cardName)
  card.getBoundingClientRect = vi.fn(() => ({
    left: 100,
    top: 200,
    width: 180,
    height: 96,
    right: 280,
    bottom: 296,
  }))
  wrapper.appendChild(card)
  document.body.appendChild(wrapper)
  return card
}

beforeEach(() => {
  document.body.innerHTML = ''
  globalThis.matchMedia = vi.fn(() => ({ matches: false }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('card rollback animation', () => {
  test('finds cards by virtual list data-key', () => {
    createCardElement('TASK-1')
    expect(findCardElement('TASK-1')?.classList.contains('kanban-card')).toBe(true)
  })

  test('captures card bounding rect', () => {
    createCardElement('TASK-1')
    expect(captureCardRect('TASK-1')).toMatchObject({ left: 100, top: 200 })
  })

  test('animates from destination rect back to source rect', async () => {
    const card = createCardElement('TASK-1')
    card.getBoundingClientRect.mockReturnValue({
      left: 100,
      top: 200,
      width: 180,
      height: 96,
      right: 280,
      bottom: 296,
    })

    vi.mocked(globalThis.matchMedia).mockReturnValue({ matches: false })
    const destinationRect = {
      left: 420,
      top: 240,
      width: 180,
      height: 96,
      right: 600,
      bottom: 336,
    }

    const animated = await animateCardRollback('TASK-1', destinationRect)
    expect(animated).toBe(true)
    expect(card.style.transform).toBe('')
    expect(card.classList.contains('kanban-card-rollback-animating')).toBe(false)
  })

  test('skips animation when reduced motion is preferred', async () => {
    createCardElement('TASK-1')
    vi.mocked(globalThis.matchMedia).mockReturnValue({ matches: true })

    const animated = await animateCardRollback('TASK-1', {
      left: 420,
      top: 240,
      width: 180,
      height: 96,
      right: 600,
      bottom: 336,
    })

    expect(animated).toBe(false)
    expect(prefersReducedMotion()).toBe(true)
  })
})
