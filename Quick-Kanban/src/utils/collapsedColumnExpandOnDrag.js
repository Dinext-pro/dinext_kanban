import { COLUMN_DRAG_EXPAND_DELAY_MS } from './kanban'

/**
 * Shared "hover/drag over collapsed column → expand after delay" timer.
 * Callers supply schedule/expand predicates so board, panel, and swimlane
 * contexts can share the same timing without duplicating setTimeout logic.
 *
 * @param {{
 *   shouldSchedule: (...args: any[]) => boolean,
 *   shouldExpand: (...args: any[]) => boolean,
 *   expand: (...args: any[]) => void,
 *   delayMs?: number,
 * }} options
 */
export function createCollapsedColumnExpandOnDrag({
  shouldSchedule,
  shouldExpand,
  expand,
  delayMs = COLUMN_DRAG_EXPAND_DELAY_MS,
} = {}) {
  let timer = null

  function clear() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule(...args) {
    if (typeof shouldSchedule === 'function' && !shouldSchedule(...args)) {
      return
    }
    if (timer) {
      return
    }
    timer = setTimeout(() => {
      timer = null
      if (typeof shouldExpand === 'function' && !shouldExpand(...args)) {
        return
      }
      expand?.(...args)
    }, delayMs)
  }

  return { clear, schedule }
}
