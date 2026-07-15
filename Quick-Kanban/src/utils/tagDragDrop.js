import {
  normalizeUserTagsForEditor,
  toListUserTags,
} from './kanban'

export const TAG_DRAG_THRESHOLD_PX = 5
export const TAG_DRAG_MODE_COPY = 'copy'
export const TAG_DRAG_MODE_MOVE = 'move'
export const TAG_DRAG_CARD_SELECTOR = '.kanban-card[data-card-name]'

/**
 * @param {number} button PointerEvent.button
 * @returns {'copy'|'move'|null}
 */
export function modeFromPointerButton(button) {
  if (button === 2) {
    return TAG_DRAG_MODE_MOVE
  }
  if (button === 0) {
    return TAG_DRAG_MODE_COPY
  }
  return null
}

/**
 * @param {string|null|undefined} userTags
 * @returns {string[]}
 */
export function parseTagList(userTags) {
  const normalized = normalizeUserTagsForEditor(userTags)
  if (!normalized) {
    return []
  }
  return normalized.split(',')
}

/**
 * @param {string|null|undefined} userTags
 * @param {string} tag
 * @returns {boolean}
 */
export function cardHasTag(userTags, tag) {
  if (!tag) {
    return false
  }
  return parseTagList(userTags).includes(tag)
}

/**
 * @param {string|null|undefined} userTags
 * @param {string} tag
 * @returns {string} list-shaped `_user_tags`
 */
export function appendTagToList(userTags, tag) {
  if (!tag || cardHasTag(userTags, tag)) {
    return toListUserTags(userTags)
  }
  const tags = parseTagList(userTags)
  tags.push(tag)
  return toListUserTags(tags.join(','))
}

/**
 * @param {string|null|undefined} userTags
 * @param {string} tag
 * @returns {string} list-shaped `_user_tags`
 */
export function removeTagFromList(userTags, tag) {
  if (!tag) {
    return toListUserTags(userTags)
  }
  const tags = parseTagList(userTags).filter((item) => item !== tag)
  return toListUserTags(tags.join(','))
}

/**
 * Drop eligibility ignores card density (expanded / minimized).
 * @param {{ tag: string, sourceName: string, targetName: string|null|undefined, targetUserTags: string|null|undefined }} args
 * @returns {boolean}
 */
export function canDropTag({ tag, sourceName, targetName, targetUserTags }) {
  if (!tag || !sourceName || !targetName || sourceName === targetName) {
    return false
  }
  return !cardHasTag(targetUserTags, tag)
}

/**
 * @param {number} startX
 * @param {number} startY
 * @param {number} x
 * @param {number} y
 * @param {number} [threshold=TAG_DRAG_THRESHOLD_PX]
 * @returns {boolean}
 */
export function hasCrossedDragThreshold(
  startX,
  startY,
  x,
  y,
  threshold = TAG_DRAG_THRESHOLD_PX,
) {
  const dx = x - startX
  const dy = y - startY
  return (dx * dx) + (dy * dy) >= threshold * threshold
}

/**
 * @param {Element|null|undefined} target
 * @returns {Element|null}
 */
export function findTagPillFromEventTarget(target) {
  if (!(target instanceof Element)) {
    return null
  }
  if (target.closest('.remove-btn') || target.closest('.add-tags-btn') || target.closest('input.tags-input')) {
    return null
  }
  return target.closest('.data-pill')
}

/**
 * @param {Element|null|undefined} pill
 * @returns {string}
 */
export function getTagLabelFromPill(pill) {
  if (!pill) {
    return ''
  }
  const label = pill.querySelector('.pill-label')
  const text = (label?.textContent || pill.getAttribute('data-tag') || '').trim()
  return text
}

/**
 * Read resolved pill colors for the drag ghost.
 * @param {Element|null|undefined} pill
 * @param {typeof globalThis.getComputedStyle} [getComputedStyleFn=getComputedStyle]
 * @returns {{ backgroundColor: string, color: string }}
 */
export function getTagPillColors(pill, getComputedStyleFn = globalThis.getComputedStyle) {
  if (!(pill instanceof Element) || typeof getComputedStyleFn !== 'function') {
    return { backgroundColor: '', color: '' }
  }
  const styles = getComputedStyleFn(pill)
  return {
    backgroundColor: styles?.backgroundColor || '',
    color: styles?.color || '',
  }
}

/**
 * Darken a CSS color via color-mix for the floating ghost.
 * @param {string} backgroundColor
 * @param {number} [percent=82]
 * @returns {string}
 */
export function darkenGhostBackground(backgroundColor, percent = 82) {
  if (!backgroundColor || backgroundColor === 'transparent' || backgroundColor === 'rgba(0, 0, 0, 0)') {
    return ''
  }
  return `color-mix(in srgb, ${backgroundColor} ${percent}%, black)`
}

/**
 * @param {HTMLElement|null|undefined} ghost
 * @param {{ backgroundColor?: string, color?: string }|null|undefined} colors
 */
export function applyGhostColors(ghost, colors) {
  if (!(ghost instanceof HTMLElement) || !colors) {
    return
  }
  if (colors.color) {
    ghost.style.color = colors.color
  }
  const darkened = darkenGhostBackground(colors.backgroundColor || '')
  if (darkened) {
    ghost.style.backgroundColor = darkened
  } else if (colors.backgroundColor) {
    ghost.style.backgroundColor = colors.backgroundColor
  }
}

/**
 * Prefer the card under the pointer; ignore the floating ghost (pointer-events: none).
 * @param {number} x
 * @param {number} y
 * @param {Document} [doc=document]
 * @returns {string|null}
 */
export function findCardNameFromPoint(x, y, doc = document) {
  const el = doc.elementFromPoint?.(x, y)
  if (!(el instanceof Element)) {
    return null
  }
  const card = el.closest(TAG_DRAG_CARD_SELECTOR)
  return card?.getAttribute('data-card-name') || null
}

/**
 * @param {string} cardName
 * @param {import('vuex').Store} store
 * @returns {string}
 */
export function getCardUserTags(store, cardName) {
  for (const column of store.state.columns || []) {
    const card = column.cards?.find(({ name }) => name === cardName)
    if (card) {
      return card._user_tags || ''
    }
  }
  return ''
}

/**
 * @param {{ store: import('vuex').Store, getDoctype: () => string, onDrop?: (payload: object) => Promise<void>|void }} options
 */
export function createTagDragController({ store, getDoctype, onDrop }) {
  let pending = null
  let session = null
  let ghost = null
  let suppressContextMenu = false
  let hoverCardName = null

  function setHoverCard(cardName) {
    if (hoverCardName === cardName) {
      return
    }
    hoverCardName = cardName
    store.commit('SET_TAG_DRAG_HOVER', cardName)
  }

  function clearHoverCard() {
    if (!hoverCardName) {
      store.commit('SET_TAG_DRAG_HOVER', null)
      return
    }
    hoverCardName = null
    store.commit('SET_TAG_DRAG_HOVER', null)
  }

  function removeGhost() {
    ghost?.remove()
    ghost = null
  }

  function ensureGhost(tag, clientX, clientY, colors) {
    if (!ghost) {
      ghost = document.createElement('div')
      ghost.className = 'kanban-tag-drag-ghost'
      ghost.setAttribute('aria-hidden', 'true')
      ghost.textContent = tag
      applyGhostColors(ghost, colors)
      document.body.appendChild(ghost)
    }
    ghost.style.left = `${clientX + 12}px`
    ghost.style.top = `${clientY}px`
  }

  function activateSession(event) {
    if (!pending || session) {
      return
    }
    const { tag, sourceCardName, mode, pointerId, colors } = pending
    session = {
      tag,
      sourceCardName,
      mode,
      pointerId,
      colors,
      didDrag: true,
    }
    suppressContextMenu = mode === TAG_DRAG_MODE_MOVE
    store.commit('SET_ACTIVE_TAG_DRAG', {
      tag,
      sourceCardName,
      mode,
    })
    store.commit('SET_DENSITY_HOLD_EXPANDED', sourceCardName)
    ensureGhost(tag, event.clientX, event.clientY, colors)
    document.documentElement.classList.add('kanban-tag-drag-active')
    if (mode === TAG_DRAG_MODE_MOVE) {
      document.documentElement.classList.add('kanban-tag-drag-move')
    }
  }

  function updateHoverFromPoint(clientX, clientY) {
    if (!session) {
      return
    }
    const targetName = findCardNameFromPoint(clientX, clientY)
    setHoverCard(targetName)
  }

  function finish(event) {
    const active = session
    pending = null

    if (!active) {
      teardownVisual()
      return
    }

    const sourceCardName = active.sourceCardName
    const targetName = findCardNameFromPoint(event.clientX, event.clientY)
    const doctype = getDoctype?.() || ''
    const targetUserTags = targetName ? getCardUserTags(store, targetName) : ''
    const allowed = canDropTag({
      tag: active.tag,
      sourceName: sourceCardName,
      targetName,
      targetUserTags,
    })

    teardownVisual()
    // Source must collapse in store immediately so remounts cannot reopen it.
    store.commit('FORCE_DENSITY_COLLAPSE', sourceCardName)

    if (!allowed || !targetName || !doctype) {
      return
    }

    const payload = {
      tag: active.tag,
      mode: active.mode,
      doctype,
      sourceCardName,
      targetCardName: targetName,
    }

    Promise.resolve(onDrop?.(payload)).then((ok) => {
      if (ok) {
        store.commit('SET_DENSITY_HOLD_EXPANDED', targetName)
      }
    }).catch(() => {})
  }

  function releaseDensityHold(sourceCardName) {
    store.commit('CLEAR_DENSITY_HOLD_EXPANDED', sourceCardName)
  }

  function teardownVisual() {
    removeGhost()
    // Clear active drag first so hover-watch cannot re-hold density via
    // scheduleCollapseForHoverLeave → holdExpandedDensity while drag is ending.
    store.commit('CLEAR_ACTIVE_TAG_DRAG')
    clearHoverCard()
    document.documentElement.classList.remove(
      'kanban-tag-drag-active',
      'kanban-tag-drag-move',
    )
    session = null
  }

  function cancel() {
    const source = session?.sourceCardName || pending?.sourceCardName
    const hadActiveSession = Boolean(session)
    pending = null
    teardownVisual()
    if (source && hadActiveSession) {
      store.commit('FORCE_DENSITY_COLLAPSE', source)
    } else if (source) {
      releaseDensityHold(source)
    }
  }

  function onPointerMove(event) {
    if (pending && !session) {
      if (pending.pointerId != null && event.pointerId !== pending.pointerId) {
        return
      }
      if (hasCrossedDragThreshold(pending.x, pending.y, event.clientX, event.clientY)) {
        activateSession(event)
      } else {
        return
      }
    }
    if (!session) {
      return
    }
    if (session.pointerId != null && event.pointerId !== session.pointerId) {
      return
    }
    event.preventDefault()
    ensureGhost(session.tag, event.clientX, event.clientY, session.colors)
    updateHoverFromPoint(event.clientX, event.clientY)
  }

  function onPointerUp(event) {
    if (pending && !session) {
      if (pending.pointerId != null && event.pointerId !== pending.pointerId) {
        return
      }
      const source = pending.sourceCardName
      pending = null
      releaseDensityHold(source)
      return
    }
    if (!session) {
      return
    }
    if (session.pointerId != null && event.pointerId !== session.pointerId) {
      return
    }
    finish(event)
  }

  function onPointerCancel(event) {
    if (pending?.pointerId != null && event.pointerId !== pending.pointerId) {
      return
    }
    if (session?.pointerId != null && event.pointerId !== session.pointerId) {
      return
    }
    cancel()
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && (pending || session)) {
      cancel()
    }
  }

  function onContextMenu(event) {
    if (suppressContextMenu || session?.mode === TAG_DRAG_MODE_MOVE || pending?.mode === TAG_DRAG_MODE_MOVE) {
      event.preventDefault()
      suppressContextMenu = false
    }
  }

  function beginPending(event, { tag, sourceCardName, sourcePill }) {
    if (!tag || !sourceCardName || store.state.activeTagDrag || store.state.activeDrag) {
      return false
    }
    const mode = modeFromPointerButton(event.button)
    if (!mode) {
      return false
    }
    // Secondary button: prevent immediate browser menu; still allow click without drag.
    if (mode === TAG_DRAG_MODE_MOVE) {
      suppressContextMenu = true
    }
    pending = {
      tag,
      sourceCardName,
      mode,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      colors: getTagPillColors(sourcePill),
    }
    return true
  }

  document.addEventListener('pointermove', onPointerMove, { passive: false })
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('contextmenu', onContextMenu, true)

  return {
    beginPending,
    cancel,
    destroy() {
      cancel()
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('contextmenu', onContextMenu, true)
    },
  }
}
