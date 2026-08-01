import Sortable from 'sortablejs'
import { createSwimlaneColumnDragSync } from './swimlaneColumnDragSync'

export const COLUMN_SORTABLE_DRAG_CLASS = 'sortable-column-drag'
export const COLUMN_SORTABLE_CHOSEN_CLASS = 'sortable-column-chosen'
export const COLUMN_SORTABLE_GHOST_CLASS = 'sortable-column-ghost'
/** Hides Teleported collapsed chrome so elementFromPoint hits board columns. */
export const COLUMN_SORTABLE_DRAGGING_CLASS = 'kanban-column-sortable-dragging'

const COLUMN_SORTABLE_STALE_CLASSES = [
  'sortable-drag',
  'sortable-chosen',
  'sortable-ghost',
  COLUMN_SORTABLE_DRAG_CLASS,
  COLUMN_SORTABLE_CHOSEN_CLASS,
  COLUMN_SORTABLE_GHOST_CLASS,
]

const COLUMN_SORTABLE_BLOCK_INSERT_AFTER = [
  'add-column-control',
  'child-panel-portal',
]

export function clearColumnSortableDraggingClass() {
  document.documentElement?.classList?.remove?.(COLUMN_SORTABLE_DRAGGING_CLASS)
}

export function setColumnSortableDraggingClass() {
  document.documentElement?.classList?.add?.(COLUMN_SORTABLE_DRAGGING_CLASS)
}

/**
 * fallbackOnBody keeps the mirror off the swimlane header grid, but body is
 * outside #kanbanapp so scoped column/card CSS never applies. Move the mirror
 * under #kanbanapp (not the grid) once Sortable has appended it.
 * @returns {Element|null} the reparented fallback, or null if nothing to move
 */
export function reparentColumnSortableFallback(host) {
  if (!(host instanceof Element)) {
    return null
  }
  const fallback =
    document.body?.querySelector?.(':scope > .kanban-column.sortable-fallback')
    || document.body?.querySelector?.(':scope > .sortable-fallback.kanban-column')
  if (!(fallback instanceof Element) || fallback.parentElement === host) {
    return null
  }
  host.appendChild(fallback)
  return fallback
}

function resolveColumnSortableFallbackHost(boardRoot) {
  return (
    boardRoot?.closest?.('#kanbanapp')
    || document.getElementById?.('kanbanapp')
    || boardRoot
    || null
  )
}

/**
 * Keep columns from inserting after non-column board siblings (Add column, portal).
 * @returns {-1|true} -1 = insert before related; true = allow default
 */
export function columnSortableOnMove(evt) {
  const related = evt?.related
  if (!(related instanceof Element)) {
    return true
  }
  if (related.classList.contains('kanban-column')) {
    return true
  }
  for (const className of COLUMN_SORTABLE_BLOCK_INSERT_AFTER) {
    if (related.classList.contains(className) || related.closest(`.${className}`)) {
      return -1
    }
  }
  if (!related.classList.contains('kanban-column')) {
    return -1
  }
  return true
}

export function clearColumnSortableArtifacts(container, dragEl) {
  const columns = new Set()
  if (dragEl?.classList?.contains('kanban-column')) {
    columns.add(dragEl)
  }
  container?.querySelectorAll?.('.kanban-column').forEach((el) => {
    columns.add(el)
  })
  for (const el of columns) {
    el.classList.remove(...COLUMN_SORTABLE_STALE_CLASSES)
    el.draggable = false
  }
}

export function createColumnSortable(
  container,
  { onReorder, boardRoot, onDragStart, onDragEnd } = {},
) {
  if (!container) {
    return null
  }

  const swimlaneSync = boardRoot ? createSwimlaneColumnDragSync(boardRoot) : null

  const sortable = Sortable.create(container, {
    animation: 150,
    handle: '.column-title--draggable',
    draggable: '.kanban-column',
    filter: '.add-column-control',
    dataIdAttr: 'data-column-value',
    ghostClass: COLUMN_SORTABLE_GHOST_CLASS,
    dragClass: COLUMN_SORTABLE_DRAG_CLASS,
    chosenClass: COLUMN_SORTABLE_CHOSEN_CLASS,
    // Always use fallback DnD so synthetic pointerdown from floating collapsed
    // titles (Teleported outside the Sortable root) can start a reorder.
    forceFallback: true,
    // Keep the mirror off the swimlane header grid (extra child stretches tracks).
    fallbackOnBody: true,
    fallbackTolerance: 5,
    onMove: columnSortableOnMove,
    onStart() {
      setColumnSortableDraggingClass()
      reparentColumnSortableFallback(resolveColumnSortableFallbackHost(boardRoot))
      onDragStart?.()
      swimlaneSync?.start()
    },
    onChange() {
      swimlaneSync?.sync()
    },
    onEnd(event) {
      clearColumnSortableDraggingClass()
      const unchanged = event.oldIndex === event.newIndex
      if (swimlaneSync) {
        // Always clear transforms before Vue reorders from store.
        swimlaneSync.finish({ cancelled: unchanged })
      }
      clearColumnSortableArtifacts(container, event.item)
      onDragEnd?.({ cancelled: unchanged })
      if (unchanged) {
        return
      }
      onReorder?.(sortable.toArray())
    },
  })

  return sortable
}

export function destroyColumnSortable(sortable) {
  clearColumnSortableDraggingClass()
  sortable?.destroy()
}
