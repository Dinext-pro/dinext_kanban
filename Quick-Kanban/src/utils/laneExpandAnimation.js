import { SWIMLANE_LANE_ANIMATION_MS } from './kanban'
import { prefersReducedMotion } from './cardRollbackAnimation'

/**
 * Animate a swimlane row open/closed via max-height (CSS transition).
 * On expand complete, clears inline maxHeight so layout can grow naturally.
 *
 * @param {HTMLElement | null | undefined} el
 * @param {{
 *   direction?: 'expand' | 'collapse',
 *   duration?: number,
 *   reducedMotion?: boolean,
 *   onDone?: () => void,
 * }} [options]
 * @returns {{ cancel: () => void }}
 */
export function animateLaneRowHeight(el, {
  direction = 'expand',
  duration = SWIMLANE_LANE_ANIMATION_MS,
  reducedMotion = prefersReducedMotion(),
  onDone,
} = {}) {
  if (!el) {
    onDone?.()
    return { cancel() {} }
  }

  let finished = false
  let failsafeTimer = null
  /** @type {((event: TransitionEvent) => void) | null} */
  let onTransitionEnd = null

  const cleanup = () => {
    if (onTransitionEnd) {
      el.removeEventListener('transitionend', onTransitionEnd)
      onTransitionEnd = null
    }
    if (failsafeTimer != null) {
      clearTimeout(failsafeTimer)
      failsafeTimer = null
    }
  }

  const finish = (clearMaxHeight) => {
    if (finished) {
      return
    }
    finished = true
    cleanup()
    if (clearMaxHeight) {
      el.style.maxHeight = ''
    }
    onDone?.()
  }

  const snapCollapse = () => {
    el.style.maxHeight = '0px'
    finish(false)
  }

  const snapExpand = () => {
    el.style.maxHeight = ''
    finish(true)
  }

  if (reducedMotion || !duration || duration <= 0) {
    if (direction === 'collapse') {
      snapCollapse()
    } else {
      snapExpand()
    }
    return { cancel() {} }
  }

  if (direction === 'collapse') {
    el.style.maxHeight = 'none'
    const from = el.scrollHeight
    el.style.maxHeight = `${Math.max(from, 0)}px`
    void el.offsetHeight
    el.style.maxHeight = '0px'
  } else {
    el.style.maxHeight = 'none'
    const to = el.scrollHeight
    el.style.maxHeight = '0px'
    void el.offsetHeight
    el.style.maxHeight = `${Math.max(to, 1)}px`
  }

  onTransitionEnd = (event) => {
    if (event.target !== el || event.propertyName !== 'max-height') {
      return
    }
    finish(direction === 'expand')
  }
  el.addEventListener('transitionend', onTransitionEnd)
  failsafeTimer = setTimeout(() => {
    finish(direction === 'expand')
  }, duration + 50)

  return {
    cancel() {
      if (finished) {
        return
      }
      finished = true
      cleanup()
    },
  }
}
