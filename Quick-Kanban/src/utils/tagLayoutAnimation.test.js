import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prefersReducedMotion } from './cardRollbackAnimation'
import {
  TAG_LAYOUT_ANIMATING_CLASS,
  captureTagLayoutPositions,
  isTagLayoutAnimating,
  listTagLayoutItems,
  playTagLayoutAnimation,
  scheduleTagLayoutAnimation,
} from './tagLayoutAnimation'

function mockRect(left, top, width = 40, height = 22) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

function createTagsRoot() {
  const root = document.createElement('ul')
  root.className = 'kanban-tags kanban-tags--editable'

  const toolbar = document.createElement('li')
  toolbar.className = 'kanban-tags-toolbar'
  const sidebar = document.createElement('span')
  sidebar.className = 'form-sidebar-items'
  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'add-tags-btn'
  addBtn.getBoundingClientRect = vi.fn(() => mockRect(200, 10, 22, 22))
  sidebar.appendChild(addBtn)
  toolbar.appendChild(sidebar)
  root.appendChild(toolbar)

  const inputLi = document.createElement('li')
  const input = document.createElement('input')
  input.className = 'tags-input'
  input.style.display = 'none'
  input.getBoundingClientRect = vi.fn(() => mockRect(0, 0, 0, 0))
  inputLi.appendChild(input)
  root.appendChild(inputLi)

  for (const [label, left] of [
    ['alpha', 80],
    ['beta', 130],
  ]) {
    const li = document.createElement('li')
    li.className = 'form-tag-row'
    const pill = document.createElement('div')
    pill.className = 'data-pill'
    const pillLabel = document.createElement('span')
    pillLabel.className = 'pill-label'
    pillLabel.textContent = label
    pill.appendChild(pillLabel)
    pill.getBoundingClientRect = vi.fn(() => mockRect(left, 10))
    li.appendChild(pill)
    root.appendChild(li)
  }

  document.body.appendChild(root)
  return { root, addBtn, input, pills: [...root.querySelectorAll('.data-pill')] }
}

beforeEach(() => {
  document.body.innerHTML = ''
  globalThis.matchMedia = vi.fn(() => ({ matches: false }))
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb) => globalThis.setTimeout(() => cb(0), 0),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('tag layout animation', () => {
  test('lists visible pills and add button', () => {
    const { root } = createTagsRoot()
    const keys = listTagLayoutItems(root).map((item) => item.key)
    expect(keys).toEqual([
      'pill:alpha',
      'pill:beta',
      'control:add-tags-btn',
    ])
  })

  test('captures layout positions by key', () => {
    const { root } = createTagsRoot()
    const positions = captureTagLayoutPositions(root)
    expect(positions.get('pill:alpha')).toMatchObject({ left: 80, top: 10 })
    expect(positions.get('pill:beta')).toMatchObject({ left: 130, top: 10 })
    expect(positions.get('control:add-tags-btn')).toMatchObject({ left: 200, top: 10 })
  })

  test('animates pills that moved and cleans up styles', async () => {
    const { root, pills } = createTagsRoot()
    const first = captureTagLayoutPositions(root)

    pills[1].getBoundingClientRect.mockReturnValue(mockRect(90, 10))

    const animated = await playTagLayoutAnimation(root, first)
    expect(animated).toBe(true)
    expect(pills[1].style.transform).toBe('')
    expect(pills[1].classList.contains(TAG_LAYOUT_ANIMATING_CLASS)).toBe(false)
    expect(isTagLayoutAnimating(root)).toBe(false)
  })

  test('skips animation when reduced motion is preferred', async () => {
    const { root, pills } = createTagsRoot()
    const first = captureTagLayoutPositions(root)
    pills[1].getBoundingClientRect.mockReturnValue(mockRect(90, 10))
    vi.mocked(globalThis.matchMedia).mockReturnValue({ matches: true })

    const animated = await playTagLayoutAnimation(root, first)
    expect(animated).toBe(false)
    expect(prefersReducedMotion()).toBe(true)
    expect(pills[1].style.transform).toBe('')
  })

  test('skips animation when delta is below threshold', async () => {
    const { root, pills } = createTagsRoot()
    const first = captureTagLayoutPositions(root)
    pills[1].getBoundingClientRect.mockReturnValue(mockRect(131, 10))

    const animated = await playTagLayoutAnimation(root, first)
    expect(animated).toBe(false)
  })

  test('scheduleTagLayoutAnimation waits for layout then plays', async () => {
    const { root, pills } = createTagsRoot()
    const first = captureTagLayoutPositions(root)
    pills[0].getBoundingClientRect.mockReturnValue(mockRect(40, 10))

    const animated = await scheduleTagLayoutAnimation(root, first)
    expect(animated).toBe(true)
  })

  test('does not start a second animation while one is in progress', async () => {
    const { root, pills } = createTagsRoot()
    const first = captureTagLayoutPositions(root)
    pills[1].getBoundingClientRect.mockReturnValue(mockRect(90, 10))

    let resolveRaf
    const rafPromise = new Promise((resolve) => {
      resolveRaf = resolve
    })
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      resolveRaf(cb)
      return 1
    })

    const firstPlay = playTagLayoutAnimation(root, first)
    expect(isTagLayoutAnimating(root)).toBe(true)

    pills[0].getBoundingClientRect.mockReturnValue(mockRect(20, 10))
    const second = await playTagLayoutAnimation(root, first)
    expect(second).toBe(false)

    const cb = await rafPromise
    cb(0)
    await firstPlay
  })
})
