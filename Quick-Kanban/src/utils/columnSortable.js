import Sortable from 'sortablejs'

export function createColumnSortable(container, { onReorder }) {
  if (!container) {
    return null
  }

  const sortable = Sortable.create(container, {
    animation: 150,
    handle: '.column-title--draggable',
    draggable: '.kanban-column',
    dataIdAttr: 'data-column-value',
    ghostClass: 'sortable-column-ghost',
    forceFallback: Boolean(globalThis.__quickKanbanForceColumnSortableFallback),
    onEnd(event) {
      if (event.oldIndex === event.newIndex) {
        return
      }
      onReorder(sortable.toArray())
    },
  })

  return sortable
}

export function destroyColumnSortable(sortable) {
  sortable?.destroy()
}
