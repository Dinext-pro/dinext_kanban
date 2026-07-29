import store from './store'
import { prefersReducedMotion } from './cardRollbackAnimation'

const ANIMATION_DURATION_MS = 2400
const INSTANT_DURATION_MS = 400
const SAFETY_BUFFER_MS = 200

const activeFlashTimers = new Map()

export function flashMovedCard(
  cardName,
  { outcome = 'success' } = {},
) {
  if (!cardName) {
    return Promise.resolve(false)
  }

  const instant = prefersReducedMotion()
  const duration = instant
    ? INSTANT_DURATION_MS
    : ANIMATION_DURATION_MS + SAFETY_BUFFER_MS

  const existingTimer = activeFlashTimers.get(cardName)
  if (existingTimer) {
    globalThis.clearTimeout(existingTimer)
  }

  store.commit('SET_CARD_MOVE_FLASH', { cardName, outcome, instant })

  return new Promise((resolve) => {
    const timerId = globalThis.setTimeout(() => {
      activeFlashTimers.delete(cardName)
      store.commit('CLEAR_CARD_MOVE_FLASH', cardName)
      resolve(true)
    }, duration)
    activeFlashTimers.set(cardName, timerId)
  })
}
