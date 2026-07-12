import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import store from './store'
import { flashMovedCard } from './cardMoveFlash'

beforeEach(() => {
  vi.useFakeTimers()
  store.commit('CLEAR_CARD_MOVE_FLASH', 'TASK-1')
  store.commit('CLEAR_CARD_MOVE_FLASH', 'TASK-2')
  globalThis.matchMedia = vi.fn(() => ({ matches: false }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('card move flash', () => {
  test('stores success flash state and clears it after animation', async () => {
    const promise = flashMovedCard('TASK-1', { outcome: 'success' })

    expect(store.state.cardMoveFlash['TASK-1']).toEqual({
      outcome: 'success',
      instant: false,
    })

    await vi.advanceTimersByTimeAsync(2600)
    await promise

    expect(store.state.cardMoveFlash['TASK-1']).toBeUndefined()
  })

  test('stores failure flash state', async () => {
    const promise = flashMovedCard('TASK-1', { outcome: 'failure' })

    expect(store.state.cardMoveFlash['TASK-1']).toEqual({
      outcome: 'failure',
      instant: false,
    })

    await vi.advanceTimersByTimeAsync(2600)
    await promise
  })

  test('uses instant flash when reduced motion is preferred', async () => {
    vi.mocked(globalThis.matchMedia).mockReturnValue({ matches: true })

    const promise = flashMovedCard('TASK-1', { outcome: 'failure' })

    expect(store.state.cardMoveFlash['TASK-1']).toEqual({
      outcome: 'failure',
      instant: true,
    })

    await vi.advanceTimersByTimeAsync(400)
    await promise

    expect(store.state.cardMoveFlash['TASK-1']).toBeUndefined()
  })

  test('replaces an active flash timer for the same card', async () => {
    flashMovedCard('TASK-1', { outcome: 'success' })
    flashMovedCard('TASK-1', { outcome: 'failure' })

    expect(store.state.cardMoveFlash['TASK-1']).toEqual({
      outcome: 'failure',
      instant: false,
    })
  })

  test('returns false when card name is missing', async () => {
    const flashed = await flashMovedCard('')
    expect(flashed).toBe(false)
  })
})
