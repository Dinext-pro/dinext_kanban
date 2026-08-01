import { COLUMN_COLLAPSE_ANIMATION_MS } from './kanban'
import { prefersReducedMotion } from './cardRollbackAnimation'

/**
 * Ease-out cubic: fast start, settle at the end (matches board width feel).
 * @param {number} t 0..1
 * @returns {number}
 */
export function easeOutCubic(t) {
  const x = Math.min(1, Math.max(0, Number(t) || 0))
  return 1 - (1 - x) ** 3
}

/**
 * @param {number[]} from
 * @param {number[]} to
 * @param {number} progress 0..1
 * @returns {number[]}
 */
export function interpolateTrackWidths(from, to, progress) {
  const t = easeOutCubic(progress)
  const len = Math.max(from.length, to.length)
  const result = []
  for (let i = 0; i < len; i += 1) {
    const a = Number(from[i])
    const b = Number(to[i])
    const start = Number.isFinite(a) ? a : (Number.isFinite(b) ? b : 0)
    const end = Number.isFinite(b) ? b : start
    result.push(Math.round(start + (end - start) * t))
  }
  return result
}

/**
 * @param {number[]} widthsPx
 * @returns {string}
 */
export function formatTrackTemplate(widthsPx) {
  return (widthsPx || [])
    .map((w) => `${Math.round(Number(w) || 0)}px`)
    .join(' ')
}

/**
 * Animate column track widths with rAF. Cancelling stops further frames;
 * the last onFrame value is left as-is unless the caller snaps afterward.
 *
 * @param {{
 *   from: number[],
 *   to: number[],
 *   duration?: number,
 *   onFrame: (widthsPx: number[]) => void,
 *   onDone?: (widthsPx: number[]) => void,
 *   reducedMotion?: boolean,
 *   now?: () => number,
 *   requestFrame?: (cb: FrameRequestCallback) => number,
 *   cancelFrame?: (id: number) => void,
 * }} options
 * @returns {{ cancel: () => void }}
 */
export function animateColumnTracks({
  from,
  to,
  duration = COLUMN_COLLAPSE_ANIMATION_MS,
  onFrame,
  onDone,
  reducedMotion = prefersReducedMotion(),
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  requestFrame = (cb) => globalThis.requestAnimationFrame(cb),
  cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
} = {}) {
  const target = (to || []).map((w) => Math.round(Number(w) || 0))
  const apply = (widths) => {
    onFrame?.(widths)
  }
  const finish = (widths) => {
    apply(widths)
    onDone?.(widths)
  }

  if (
    reducedMotion
    || !duration
    || duration <= 0
    || !from?.length
    || from.length !== target.length
    || from.every((w, i) => Math.round(Number(w) || 0) === target[i])
  ) {
    finish(target)
    return { cancel() {} }
  }

  const start = (from || []).map((w) => Math.round(Number(w) || 0))
  const startedAt = now()
  let frameId = 0
  let cancelled = false

  const tick = (timestamp) => {
    if (cancelled) {
      return
    }
    const elapsed = Math.max(0, (Number.isFinite(timestamp) ? timestamp : now()) - startedAt)
    const progress = Math.min(1, elapsed / duration)
    const widths = interpolateTrackWidths(start, target, progress)
    if (progress >= 1) {
      finish(target)
      return
    }
    apply(widths)
    frameId = requestFrame(tick)
  }

  frameId = requestFrame(tick)

  return {
    cancel() {
      cancelled = true
      if (frameId) {
        cancelFrame(frameId)
        frameId = 0
      }
    },
  }
}
