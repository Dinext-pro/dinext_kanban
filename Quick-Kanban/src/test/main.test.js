import { afterEach, beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = ''
  delete window.mountQuickKanban
  delete window.unmountQuickKanban
  delete window.isQuickKanbanMountedOn
  delete window.refreshKanbanBoard
  delete window.hydrateQuickKanban
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
