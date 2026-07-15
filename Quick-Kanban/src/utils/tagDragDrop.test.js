import { expect, test } from 'vitest'
import {
  TAG_DRAG_MODE_COPY,
  TAG_DRAG_MODE_MOVE,
  TAG_DRAG_THRESHOLD_PX,
  appendTagToList,
  applyGhostColors,
  canDropTag,
  cardHasTag,
  darkenGhostBackground,
  findCardNameFromPoint,
  findTagPillFromEventTarget,
  getTagLabelFromPill,
  getTagPillColors,
  hasCrossedDragThreshold,
  modeFromPointerButton,
  parseTagList,
  removeTagFromList,
} from './tagDragDrop'

test('modeFromPointerButton maps LMB to copy and RMB to move', () => {
  expect(modeFromPointerButton(0)).toBe(TAG_DRAG_MODE_COPY)
  expect(modeFromPointerButton(2)).toBe(TAG_DRAG_MODE_MOVE)
  expect(modeFromPointerButton(1)).toBeNull()
})

test('parseTagList and cardHasTag work with list-shaped and editor-shaped tags', () => {
  expect(parseTagList(',alpha,beta')).toEqual(['alpha', 'beta'])
  expect(parseTagList('alpha,beta')).toEqual(['alpha', 'beta'])
  expect(cardHasTag(',alpha,beta', 'alpha')).toBe(true)
  expect(cardHasTag(',alpha,beta', 'gamma')).toBe(false)
  expect(cardHasTag('', 'alpha')).toBe(false)
})

test('appendTagToList and removeTagFromList keep list shape', () => {
  expect(appendTagToList(',alpha', 'beta')).toBe(',alpha,beta')
  expect(appendTagToList(',alpha', 'alpha')).toBe(',alpha')
  expect(removeTagFromList(',alpha,beta', 'alpha')).toBe(',beta')
  expect(removeTagFromList(',alpha', 'alpha')).toBe('')
})

test('canDropTag rejects same card, missing target, and duplicate tag', () => {
  expect(canDropTag({
    tag: 'alpha',
    sourceName: 'TASK-1',
    targetName: 'TASK-1',
    targetUserTags: '',
  })).toBe(false)
  expect(canDropTag({
    tag: 'alpha',
    sourceName: 'TASK-1',
    targetName: null,
    targetUserTags: '',
  })).toBe(false)
  expect(canDropTag({
    tag: 'alpha',
    sourceName: 'TASK-1',
    targetName: 'TASK-2',
    targetUserTags: ',alpha,beta',
  })).toBe(false)
  expect(canDropTag({
    tag: 'alpha',
    sourceName: 'TASK-1',
    targetName: 'TASK-2',
    targetUserTags: ',beta',
  })).toBe(true)
})

test('canDropTag does not depend on density metadata', () => {
  // Density is UI-only; helpers only receive tag payload.
  expect(canDropTag({
    tag: 'urgent',
    sourceName: 'TASK-A',
    targetName: 'TASK-B',
    targetUserTags: '',
  })).toBe(true)
})

test('hasCrossedDragThreshold uses configured pixel distance', () => {
  expect(hasCrossedDragThreshold(0, 0, 3, 0)).toBe(false)
  expect(hasCrossedDragThreshold(0, 0, TAG_DRAG_THRESHOLD_PX, 0)).toBe(true)
  expect(hasCrossedDragThreshold(10, 10, 13, 14)).toBe(true)
})

test('getTagPillColors and applyGhostColors darken source pill background', () => {
  const pill = document.createElement('button')
  pill.className = 'data-pill'
  document.body.appendChild(pill)

  const colors = getTagPillColors(pill, () => ({
    backgroundColor: 'rgb(200, 220, 255)',
    color: 'rgb(20, 40, 80)',
  }))
  expect(colors).toEqual({
    backgroundColor: 'rgb(200, 220, 255)',
    color: 'rgb(20, 40, 80)',
  })
  expect(darkenGhostBackground(colors.backgroundColor)).toBe(
    'color-mix(in srgb, rgb(200, 220, 255) 82%, black)',
  )

  const ghost = document.createElement('div')
  applyGhostColors(ghost, colors)
  expect(ghost.style.color).toBe('rgb(20, 40, 80)')
  expect(ghost.style.backgroundColor).toBe(
    'color-mix(in srgb, rgb(200, 220, 255) 82%, black)',
  )
  pill.remove()
})

test('createTagDragController ghost uses source pill colors', async () => {
  const { createTagDragController } = await import('./tagDragDrop')
  const { createKanbanStore } = await import('./store')
  const store = createKanbanStore()
  store.commit('SET_COLUMNS', [
    {
      name: 'open',
      column_name: 'Open',
      cards: [
        { name: 'TASK-1', _user_tags: ',alpha', _assign: {} },
        { name: 'TASK-2', _user_tags: '', _assign: {} },
      ],
    },
  ])

  const controller = createTagDragController({
    store,
    getDoctype: () => 'Task',
    onDrop: () => true,
  })

  const sourcePill = document.createElement('button')
  sourcePill.className = 'data-pill'
  sourcePill.style.backgroundColor = 'rgb(180, 230, 200)'
  sourcePill.style.color = 'rgb(10, 60, 40)'
  document.body.appendChild(sourcePill)

  const target = document.createElement('article')
  target.className = 'kanban-card'
  target.setAttribute('data-card-name', 'TASK-2')
  document.body.appendChild(target)
  const original = document.elementFromPoint
  document.elementFromPoint = () => target

  // jsdom often returns transparent for styled elements; stub for this case.
  const realGetComputedStyle = globalThis.getComputedStyle
  globalThis.getComputedStyle = (el) => {
    if (el === sourcePill) {
      return {
        backgroundColor: 'rgb(180, 230, 200)',
        color: 'rgb(10, 60, 40)',
      }
    }
    return realGetComputedStyle(el)
  }

  controller.beginPending({
    button: 0,
    clientX: 10,
    clientY: 20,
    pointerId: 21,
  }, {
    tag: 'alpha',
    sourceCardName: 'TASK-1',
    sourcePill,
  })

  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 40,
    clientY: 80,
    pointerId: 21,
    bubbles: true,
  }))

  const ghost = document.querySelector('.kanban-tag-drag-ghost')
  expect(ghost).toBeTruthy()
  expect(ghost.style.color).toBe('rgb(10, 60, 40)')
  expect(ghost.style.backgroundColor).toContain('color-mix')
  expect(ghost.style.backgroundColor).toContain('rgb(180, 230, 200)')

  document.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 40,
    clientY: 80,
    pointerId: 21,
    bubbles: true,
  }))
  await Promise.resolve()
  await Promise.resolve()

  globalThis.getComputedStyle = realGetComputedStyle
  document.elementFromPoint = original
  sourcePill.remove()
  target.remove()
  controller.destroy()
})

test('findTagPillFromEventTarget ignores remove and add controls', () => {
  const root = document.createElement('div')
  root.innerHTML = `
    <div class="data-pill">
      <span class="pill-label">alpha</span>
      <button class="remove-btn" type="button">x</button>
    </div>
    <button class="add-tags-btn" type="button">+</button>
  `
  const pill = root.querySelector('.data-pill')
  const label = root.querySelector('.pill-label')
  const remove = root.querySelector('.remove-btn')
  const add = root.querySelector('.add-tags-btn')

  expect(findTagPillFromEventTarget(label)).toBe(pill)
  expect(findTagPillFromEventTarget(remove)).toBeNull()
  expect(findTagPillFromEventTarget(add)).toBeNull()
  expect(getTagLabelFromPill(pill)).toBe('alpha')
})

test('findCardNameFromPoint resolves nearest card under cursor', () => {
  const card = document.createElement('article')
  card.className = 'kanban-card'
  card.setAttribute('data-card-name', 'TASK-9')
  const child = document.createElement('span')
  child.textContent = 'title'
  card.appendChild(child)
  document.body.appendChild(card)

  const original = document.elementFromPoint
  document.elementFromPoint = () => child
  expect(findCardNameFromPoint(1, 1)).toBe('TASK-9')
  document.elementFromPoint = original
  card.remove()
})

test('createTagDragController copy drop persists and move removes source', async () => {
  const { createTagDragController } = await import('./tagDragDrop')
  const { createKanbanStore } = await import('./store')
  const store = createKanbanStore()
  store.commit('SET_KANBAN_CONFIG', {
    board_name: 'Task Board',
    ref_doctype: 'Task',
    field_name: 'status',
    title_field: 'subject',
    fields: [],
    show_tags: true,
  })
  store.commit('SET_COLUMNS', [
    {
      name: 'open',
      column_name: 'Open',
      cards: [
        { name: 'TASK-1', _user_tags: ',alpha', _assign: {} },
        { name: 'TASK-2', _user_tags: '', _assign: {} },
      ],
    },
  ])

  const drops = []
  const controller = createTagDragController({
    store,
    getDoctype: () => 'Task',
    onDrop: (payload) => {
      drops.push(payload)
      return true
    },
  })

  const target = document.createElement('article')
  target.className = 'kanban-card'
  target.setAttribute('data-card-name', 'TASK-2')
  document.body.appendChild(target)
  const original = document.elementFromPoint
  document.elementFromPoint = () => target

  expect(controller.beginPending({
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerId: 7,
  }, { tag: 'alpha', sourceCardName: 'TASK-1' })).toBe(true)
  expect(store.state.densityHoldExpandedCard).toBeNull()

  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 20,
    clientY: 0,
    pointerId: 7,
    bubbles: true,
  }))
  expect(store.state.activeTagDrag).toEqual({
    tag: 'alpha',
    sourceCardName: 'TASK-1',
    mode: 'copy',
  })
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')
  expect(store.state.tagDragHoverCard).toBe('TASK-2')

  document.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 20,
    clientY: 0,
    pointerId: 7,
    bubbles: true,
  }))

  await Promise.resolve()
  await Promise.resolve()

  expect(drops).toEqual([{
    tag: 'alpha',
    mode: 'copy',
    doctype: 'Task',
    sourceCardName: 'TASK-1',
    targetCardName: 'TASK-2',
  }])
  expect(store.state.activeTagDrag).toBeNull()
  expect(store.state.densityForceCollapsedCards['TASK-1']).toBe(true)
  expect(store.state.densityHoldExpandedCard).toBe('TASK-2')

  document.elementFromPoint = original
  target.remove()
  controller.destroy()
})

test('createTagDragController move drop force-collapses source and holds target', async () => {
  const { createTagDragController } = await import('./tagDragDrop')
  const { createKanbanStore } = await import('./store')
  const store = createKanbanStore()
  store.commit('SET_COLUMNS', [
    {
      name: 'open',
      column_name: 'Open',
      cards: [
        { name: 'TASK-1', _user_tags: ',alpha', _assign: {} },
        { name: 'TASK-2', _user_tags: '', _assign: {} },
      ],
    },
  ])

  const drops = []
  const controller = createTagDragController({
    store,
    getDoctype: () => 'Task',
    onDrop: (payload) => {
      drops.push(payload)
      return true
    },
  })

  const target = document.createElement('article')
  target.className = 'kanban-card'
  target.setAttribute('data-card-name', 'TASK-2')
  document.body.appendChild(target)
  const original = document.elementFromPoint
  document.elementFromPoint = () => target

  expect(controller.beginPending({
    button: 2,
    clientX: 0,
    clientY: 0,
    pointerId: 11,
  }, { tag: 'alpha', sourceCardName: 'TASK-1' })).toBe(true)

  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 20,
    clientY: 0,
    pointerId: 11,
    bubbles: true,
  }))
  expect(store.state.activeTagDrag?.mode).toBe('move')

  document.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 20,
    clientY: 0,
    pointerId: 11,
    bubbles: true,
  }))

  await Promise.resolve()
  await Promise.resolve()

  expect(drops).toEqual([{
    tag: 'alpha',
    mode: 'move',
    doctype: 'Task',
    sourceCardName: 'TASK-1',
    targetCardName: 'TASK-2',
  }])
  expect(store.state.densityForceCollapsedCards['TASK-1']).toBe(true)
  expect(store.state.densityHoldExpandedCard).toBe('TASK-2')

  document.elementFromPoint = original
  target.remove()
  controller.destroy()
})

test('createTagDragController releases source hold before deferred onDrop resolves', async () => {
  const { createTagDragController } = await import('./tagDragDrop')
  const { createKanbanStore } = await import('./store')
  const store = createKanbanStore()
  store.commit('SET_COLUMNS', [
    {
      name: 'open',
      column_name: 'Open',
      cards: [
        { name: 'TASK-1', _user_tags: ',alpha', _assign: {} },
        { name: 'TASK-2', _user_tags: '', _assign: {} },
      ],
    },
  ])

  let resolveDrop
  const controller = createTagDragController({
    store,
    getDoctype: () => 'Task',
    onDrop: () => new Promise((resolve) => {
      resolveDrop = resolve
    }),
  })

  const target = document.createElement('article')
  target.className = 'kanban-card'
  target.setAttribute('data-card-name', 'TASK-2')
  document.body.appendChild(target)
  const original = document.elementFromPoint
  document.elementFromPoint = () => target

  controller.beginPending({
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerId: 9,
  }, { tag: 'alpha', sourceCardName: 'TASK-1' })

  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 20,
    clientY: 0,
    pointerId: 9,
    bubbles: true,
  }))
  expect(store.state.densityHoldExpandedCard).toBe('TASK-1')

  document.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 20,
    clientY: 0,
    pointerId: 9,
    bubbles: true,
  }))

  await Promise.resolve()
  expect(store.state.activeTagDrag).toBeNull()
  expect(store.state.densityHoldExpandedCard).toBeNull()
  expect(store.state.densityForceCollapsedCards['TASK-1']).toBe(true)

  resolveDrop(true)
  await Promise.resolve()
  await Promise.resolve()

  expect(store.state.densityHoldExpandedCard).toBe('TASK-2')
  expect(store.state.densityForceCollapsedCards['TASK-1']).toBe(true)

  document.elementFromPoint = original
  target.remove()
  controller.destroy()
})

test('createTagDragController does not hold target after failed drop', async () => {
  const { createTagDragController } = await import('./tagDragDrop')
  const { createKanbanStore } = await import('./store')
  const store = createKanbanStore()
  store.commit('SET_COLUMNS', [
    {
      name: 'open',
      column_name: 'Open',
      cards: [
        { name: 'TASK-1', _user_tags: ',alpha', _assign: {} },
        { name: 'TASK-2', _user_tags: '', _assign: {} },
      ],
    },
  ])

  const controller = createTagDragController({
    store,
    getDoctype: () => 'Task',
    onDrop: async () => false,
  })

  const target = document.createElement('article')
  target.className = 'kanban-card'
  target.setAttribute('data-card-name', 'TASK-2')
  document.body.appendChild(target)
  const original = document.elementFromPoint
  document.elementFromPoint = () => target

  controller.beginPending({
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerId: 8,
  }, { tag: 'alpha', sourceCardName: 'TASK-1' })

  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 20,
    clientY: 0,
    pointerId: 8,
    bubbles: true,
  }))
  document.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 20,
    clientY: 0,
    pointerId: 8,
    bubbles: true,
  }))

  await Promise.resolve()
  await Promise.resolve()

  expect(store.state.densityHoldExpandedCard).toBeNull()
  expect(store.state.densityForceCollapsedCards['TASK-1']).toBe(true)

  document.elementFromPoint = original
  target.remove()
  controller.destroy()
})

test('createTagDragController ghost follows pointermove coordinates', async () => {
  const { createTagDragController } = await import('./tagDragDrop')
  const { createKanbanStore } = await import('./store')
  const store = createKanbanStore()
  store.commit('SET_COLUMNS', [
    {
      name: 'open',
      column_name: 'Open',
      cards: [
        { name: 'TASK-1', _user_tags: ',alpha', _assign: {} },
        { name: 'TASK-2', _user_tags: '', _assign: {} },
      ],
    },
  ])

  const controller = createTagDragController({
    store,
    getDoctype: () => 'Task',
    onDrop: () => true,
  })

  const target = document.createElement('article')
  target.className = 'kanban-card'
  target.setAttribute('data-card-name', 'TASK-2')
  document.body.appendChild(target)
  const original = document.elementFromPoint
  document.elementFromPoint = () => target

  controller.beginPending({
    button: 0,
    clientX: 10,
    clientY: 20,
    pointerId: 11,
  }, { tag: 'alpha', sourceCardName: 'TASK-1' })

  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 40,
    clientY: 80,
    pointerId: 11,
    bubbles: true,
  }))

  const ghost = document.querySelector('.kanban-tag-drag-ghost')
  expect(ghost).toBeTruthy()
  expect(ghost.textContent).toBe('alpha')
  expect(ghost.style.left).toBe('52px')
  expect(ghost.style.top).toBe('80px')

  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 120,
    clientY: 200,
    pointerId: 11,
    bubbles: true,
  }))

  expect(ghost.style.left).toBe('132px')
  expect(ghost.style.top).toBe('200px')

  document.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 120,
    clientY: 200,
    pointerId: 11,
    bubbles: true,
  }))
  await Promise.resolve()
  await Promise.resolve()

  expect(document.querySelector('.kanban-tag-drag-ghost')).toBeNull()

  document.elementFromPoint = original
  target.remove()
  controller.destroy()
})
