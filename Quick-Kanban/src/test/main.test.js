import { afterEach, beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = ''
  delete window.mountQuickKanban
  delete window.unmountQuickKanban
  delete window.isQuickKanbanMountedOn
  delete window.refreshKanbanBoard
  delete window.hydrateQuickKanban
  delete window.setQuickKanbanMinimizeCards
  vi.resetModules()
})

afterEach(() => {
  window.unmountQuickKanban?.()
})

test('mountQuickKanban mounts onto the provided element', async () => {
  await import('../main.js')
  const target = document.createElement('div')
  target.id = 'kanbanapp'
  document.body.appendChild(target)

  window.mountQuickKanban(target)

  expect(window.isQuickKanbanMountedOn(target)).toBe(true)
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

  window.mountQuickKanban(firstBoard)
  window.mountQuickKanban(secondBoard)

  expect(window.isQuickKanbanMountedOn(firstBoard)).toBe(false)
  expect(window.isQuickKanbanMountedOn(secondBoard)).toBe(true)
  expect(firstBoard.__vue_app__).toBeUndefined()
  expect(secondBoard.__vue_app__).toBeDefined()
})

test('binds persistent create form hooks for the configured doctype', async () => {
  await import('../main.js')
  window.__quickKanbanStore.commit('SET_KANBAN_CONFIG', {
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

test('setQuickKanbanMinimizeCards updates store, storage, and checkbox', async () => {
  localStorage.clear()
  await import('../main.js')
  window.__quickKanbanStore.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: ['name'],
    highlight_table: [],
  })

  const label = document.createElement('label')
  label.className = 'quick-kanban-minimize-control'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  label.append(checkbox)
  document.body.appendChild(label)

  window.setQuickKanbanMinimizeCards(true)

  expect(window.__quickKanbanStore.state.minimize_cards).toBe(true)
  expect(localStorage.getItem('quick_kanban:minimize_cards:Task Board')).toBe('1')
  expect(checkbox.checked).toBe(true)

  window.setQuickKanbanMinimizeCards(false)
  expect(window.__quickKanbanStore.state.minimize_cards).toBe(false)
  expect(localStorage.getItem('quick_kanban:minimize_cards:Task Board')).toBeNull()
  expect(checkbox.checked).toBe(false)
})
