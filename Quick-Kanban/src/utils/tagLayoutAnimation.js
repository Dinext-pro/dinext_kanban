import { prefersReducedMotion } from './cardRollbackAnimation'

export const TAG_LAYOUT_ANIMATION_MS = 180
export const TAG_LAYOUT_ANIMATING_CLASS = 'kanban-tag-layout-animating'

const DELTA_THRESHOLD_PX = 2
const animatingRoots = new WeakSet()

/**
 * @param {Element|null|undefined} el
 * @returns {boolean}
 */
function isLaidOut(el) {
  if (!(el instanceof HTMLElement)) {
    return false
  }
  const style = globalThis.getComputedStyle?.(el)
  if (style?.display === 'none' || style?.visibility === 'hidden') {
    return false
  }
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

/**
 * @param {Element|null|undefined} root
 * @returns {{ key: string, el: HTMLElement }[]}
 */
export function listTagLayoutItems(root) {
  const items = []
  if (!root?.querySelectorAll) {
    return items
  }

  for (const pill of root.querySelectorAll('.data-pill')) {
    if (!(pill instanceof HTMLElement) || !isLaidOut(pill)) {
      continue
    }
    const label = pill.querySelector('.pill-label')?.textContent?.trim()
    if (!label) {
      continue
    }
    items.push({ key: `pill:${label}`, el: pill })
  }

  const addBtn = root.querySelector('.add-tags-btn')
  if (addBtn instanceof HTMLElement && isLaidOut(addBtn)) {
    items.push({ key: 'control:add-tags-btn', el: addBtn })
  }

  const input = root.querySelector('input.tags-input')
  if (input instanceof HTMLElement) {
    const awesomplete = input.closest('.awesomplete')
    const control =
      awesomplete instanceof HTMLElement ? awesomplete : input
    if (isLaidOut(control)) {
      items.push({
        key: awesomplete ? 'control:awesomplete' : 'control:tags-input',
        el: control,
      })
    }
  }

  return items
}

/**
 * @param {Element|null|undefined} root
 * @returns {Map<string, { left: number, top: number, width: number, height: number }>}
 */
export function captureTagLayoutPositions(root) {
  const map = new Map()
  for (const { key, el } of listTagLayoutItems(root)) {
    const rect = el.getBoundingClientRect()
    map.set(key, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    })
  }
  return map
}

/**
 * @param {Element|null|undefined} root
 * @returns {boolean}
 */
export function isTagLayoutAnimating(root) {
  return Boolean(root && animatingRoots.has(root))
}

/**
 * FLIP remaining tag pills / controls from previously captured positions.
 * @param {Element|null|undefined} root
 * @param {Map<string, { left: number, top: number }>|null|undefined} firstPositions
 * @param {{ duration?: number }} [options]
 * @returns {Promise<boolean>}
 */
export function playTagLayoutAnimation(
  root,
  firstPositions,
  { duration = TAG_LAYOUT_ANIMATION_MS } = {},
) {
  if (!root || !firstPositions?.size || prefersReducedMotion()) {
    return Promise.resolve(false)
  }
  if (animatingRoots.has(root)) {
    return Promise.resolve(false)
  }

  const moves = []
  for (const { key, el } of listTagLayoutItems(root)) {
    const first = firstPositions.get(key)
    if (!first) {
      continue
    }
    const last = el.getBoundingClientRect()
    const dx = first.left - last.left
    const dy = first.top - last.top
    if (Math.abs(dx) < DELTA_THRESHOLD_PX && Math.abs(dy) < DELTA_THRESHOLD_PX) {
      continue
    }
    moves.push({ el, dx, dy })
  }

  if (!moves.length) {
    return Promise.resolve(false)
  }

  animatingRoots.add(root)
  for (const { el, dx, dy } of moves) {
    el.classList.add(TAG_LAYOUT_ANIMATING_CLASS)
    el.style.transform = `translate(${dx}px, ${dy}px)`
    el.style.transition = 'none'
  }

  return new Promise((resolve) => {
    let finished = false
    const finish = () => {
      if (finished) {
        return
      }
      finished = true
      for (const { el } of moves) {
        el.classList.remove(TAG_LAYOUT_ANIMATING_CLASS)
        el.style.transition = ''
        el.style.transform = ''
      }
      animatingRoots.delete(root)
      resolve(true)
    }

    requestAnimationFrame(() => {
      for (const { el } of moves) {
        el.style.transition = `transform ${duration}ms ease-out`
        el.style.transform = ''
      }
    })

    moves[0].el.addEventListener('transitionend', finish, { once: true })
    globalThis.setTimeout(finish, duration + 60)
  })
}

/**
 * Wait two animation frames for layout, then play FLIP.
 * @param {Element|null|undefined} root
 * @param {Map<string, { left: number, top: number }>|null|undefined} firstPositions
 * @param {{ duration?: number }} [options]
 * @returns {Promise<boolean>}
 */
export function scheduleTagLayoutAnimation(root, firstPositions, options) {
  const snapshot =
    firstPositions instanceof Map ? new Map(firstPositions) : firstPositions
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve(playTagLayoutAnimation(root, snapshot, options))
      })
    })
  })
}
