import { afterEach, beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = ''
  delete window.mountDinextKanban
  delete window.unmountDinextKanban
  delete window.isDinextKanbanMountedOn
  delete window.refreshKanbanBoard
  delete window.hydrateDinextKanban
  delete window.setDinextKanbanMinimizeCards
  delete window.setDinextKanbanShowChildTasks
  delete window.setDinextKanbanColumnCollapsed
  vi.resetModules()
})

afterEach(() => {
  window.unmountDinextKanban?.()
})

test('mountDinextKanban mounts onto the provided element', async () => {
  await import('../main.js')
  const target = document.createElement('div')
  target.id = 'kanbanapp'
  document.body.appendChild(target)

  window.mountDinextKanban(target)

  expect(window.isDinextKanbanMountedOn(target)).toBe(true)
  expect(target.__vue_app__).toBeDefined()
})

test('remounts when the active board container changes', async () => {
  await import('../main.js')
  const firstBoard = document.createElement('div')
  firstBoard.id = 'kanbanapp'
  const secondBoard = document.createElement('div')
  secondBoard.id = 'kanbanapp'
  document.body.appendChild(firstBoard)
  document.body.appendChild(secondBoard)

  window.mountDinextKanban(firstBoard)
  window.mountDinextKanban(secondBoard)

  expect(window.isDinextKanbanMountedOn(firstBoard)).toBe(false)
  expect(window.isDinextKanbanMountedOn(secondBoard)).toBe(true)
  expect(firstBoard.__vue_app__).toBeUndefined()
  expect(secondBoard.__vue_app__).toBeDefined()
})

test('binds persistent create form hooks for the configured doctype', async () => {
  await import('../main.js')
  window.__dinextKanbanStore.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: ['name', 'subject', 'status'],
    highlight_table: [],
  })

  expect(frappe.ui.form.on).toHaveBeenCalledWith(
    'Task',
    expect.objectContaining({
      after_save: expect.any(Function),
      after_cancel: expect.any(Function),
    }),
  )
})

test('setDinextKanbanMinimizeCards updates store, storage, and checkbox', async () => {
  localStorage.clear()
  await import('../main.js')
  window.__dinextKanbanStore.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: ['name'],
    highlight_table: [],
  })

  const label = document.createElement('label')
  label.className = 'dinext-kanban-minimize-control'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  label.append(checkbox)
  document.body.appendChild(label)

  window.setDinextKanbanMinimizeCards(true)

  expect(window.__dinextKanbanStore.state.minimize_cards).toBe(true)
  expect(localStorage.getItem('dinext_kanban:minimize_cards:Task Board')).toBe('1')
  expect(checkbox.checked).toBe(true)

  window.setDinextKanbanMinimizeCards(false)
  expect(window.__dinextKanbanStore.state.minimize_cards).toBe(false)
  expect(localStorage.getItem('dinext_kanban:minimize_cards:Task Board')).toBeNull()
  expect(checkbox.checked).toBe(false)
})

test('setDinextKanbanShowChildTasks updates store, storage, checkbox, and refreshes', async () => {
  localStorage.clear()
  await import('../main.js')
  const refreshBoard = vi.fn()
  window.__dinextKanbanStore.dispatch = refreshBoard
  window.__dinextKanbanStore.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: ['name'],
    parent_field: 'parent_task',
    highlight_table: [],
  })

  const label = document.createElement('label')
  label.className = 'dinext-kanban-show-child-tasks-control'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  label.append(checkbox)
  document.body.appendChild(label)

  await expect(window.setDinextKanbanShowChildTasks(true)).resolves.toBe(true)

  expect(window.__dinextKanbanStore.state.show_child_tasks).toBe(true)
  expect(localStorage.getItem('dinext_kanban:show_child_tasks:Task Board')).toBe('1')
  expect(checkbox.checked).toBe(true)
  // Checkbox path must call refreshBoard with no payload (payload default = {}).
  expect(refreshBoard).toHaveBeenCalledWith('refreshBoard')
  expect(refreshBoard.mock.calls[0]).toHaveLength(1)

  await expect(window.setDinextKanbanShowChildTasks(false)).resolves.toBe(false)
  expect(window.__dinextKanbanStore.state.show_child_tasks).toBe(false)
  expect(localStorage.getItem('dinext_kanban:show_child_tasks:Task Board')).toBeNull()
  expect(checkbox.checked).toBe(false)
})

test('setDinextKanbanColumnCollapsed updates store and storage', async () => {
  localStorage.clear()
  await import('../main.js')
  window.__dinextKanbanStore.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: ['name'],
    highlight_table: [],
  })

  window.setDinextKanbanColumnCollapsed('Open', true)

  expect(window.__dinextKanbanStore.state.collapsedColumns).toEqual({ Open: true })
  expect(localStorage.getItem('dinext_kanban:collapsed_columns:Task Board')).toBe(
    JSON.stringify(['Open']),
  )

  window.setDinextKanbanColumnCollapsed('Open', false)
  expect(window.__dinextKanbanStore.state.collapsedColumns).toEqual({})
  expect(localStorage.getItem('dinext_kanban:collapsed_columns:Task Board')).toBeNull()
})

test('loads collapsed columns preference when board config is set', async () => {
  localStorage.clear()
  localStorage.setItem(
    'dinext_kanban:collapsed_columns:Task Board',
    JSON.stringify(['Done']),
  )
  await import('../main.js')

  window.__dinextKanbanStore.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: ['name'],
    highlight_table: [],
  })

  expect(window.__dinextKanbanStore.state.collapsedColumns).toEqual({ Done: true })
})
