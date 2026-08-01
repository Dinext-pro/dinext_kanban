import { CHILD_PANEL_PIN_MS } from './kanban'
import { prefersReducedMotion } from './cardRollbackAnimation'
import { easeOutCubic } from './columnCollapseAnimation'

/**
 * Compute scroller scrollTop that aligns card top to visible top (inset + margin).
 * @returns {number|null} target scrollTop, or null when no movement needed / invalid
 */
export function resolveCardPinScrollTop(
  cardEl,
  scrollerEl,
  { margin = 0, topInset = 0 } = {},
) {
  if (!cardEl || !scrollerEl) {
    return null
  }
  const cardRect = cardEl.getBoundingClientRect()
  const scrollerRect = scrollerEl.getBoundingClientRect()
  const visibleTop = scrollerRect.top + topInset + margin
  const delta = cardRect.top - visibleTop
  if (Math.abs(delta) < 0.5) {
    return null
  }
  const maxScroll = Math.max(
    0,
    (scrollerEl.scrollHeight || 0) - (scrollerEl.clientHeight || 0),
  )
  const nextTop = Math.min(maxScroll, Math.max(0, scrollerEl.scrollTop + delta))
  if (Math.abs(nextTop - (scrollerEl.scrollTop || 0)) < 0.5) {
    return null
  }
  return nextTop
}

/**
 * Animate scroller.scrollTop with rAF (native smooth is cancelled by VirtualList remounts).
 *
 * @returns {{ cancel: () => void, done: Promise<boolean> }}
 */
export function animateScrollTop(
  scrollerEl,
  targetTop,
  {
    duration = CHILD_PANEL_PIN_MS,
    reducedMotion = prefersReducedMotion(),
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    requestFrame = (cb) => globalThis.requestAnimationFrame(cb),
    cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
  } = {},
) {
  let cancelled = false
  let frameId = 0

  const cancel = () => {
    cancelled = true
    if (frameId) {
      cancelFrame(frameId)
      frameId = 0
    }
  }

  if (!scrollerEl) {
    return { cancel, done: Promise.resolve(false) }
  }

  const to = Math.max(0, Number(targetTop) || 0)
  const from = scrollerEl.scrollTop || 0

  if (reducedMotion || !duration || duration <= 0 || Math.abs(to - from) < 0.5) {
    scrollerEl.scrollTop = to
    return { cancel, done: Promise.resolve(Math.abs(to - from) >= 0.5) }
  }

  const startedAt = now()
  const done = new Promise((resolve) => {
    const tick = (timestamp) => {
      if (cancelled) {
        resolve(false)
        return
      }
      const elapsed = Math.max(0, (Number.isFinite(timestamp) ? timestamp : now()) - startedAt)
      const progress = Math.min(1, elapsed / duration)
      const t = easeOutCubic(progress)
      scrollerEl.scrollTop = from + (to - from) * t
      if (progress >= 1) {
        scrollerEl.scrollTop = to
        frameId = 0
        resolve(true)
        return
      }
      frameId = requestFrame(tick)
    }
    frameId = requestFrame(tick)
  })

  return { cancel, done }
}
