import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SWIMLANE_LANE_ANIMATION_MS } from './kanban'
import { animateLaneRowHeight } from './laneExpandAnimation'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function makeRow({ scrollHeight = 120 } = {}) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  })
  document.body.appendChild(el)
  return el
}

test('exports swimlane lane animation duration', () => {
  expect(SWIMLANE_LANE_ANIMATION_MS).toBe(220)
})

test('collapse sets max-height to 0 and calls onDone on transitionend', () => {
  const el = makeRow({ scrollHeight: 180 })
  const onDone = vi.fn()
  animateLaneRowHeight(el, { direction: 'collapse', onDone })

  expect(el.style.maxHeight).toBe('0px')
  expect(onDone).not.toHaveBeenCalled()

  el.dispatchEvent(new TransitionEvent('transitionend', {
    propertyName: 'max-height',
    bubbles: true,
  }))
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(el.style.maxHeight).toBe('0px')
  el.remove()
})

test('expand animates to scrollHeight then clears max-height', () => {
  const el = makeRow({ scrollHeight: 200 })
  const onDone = vi.fn()
  animateLaneRowHeight(el, { direction: 'expand', onDone })

  expect(el.style.maxHeight).toBe('200px')

  el.dispatchEvent(new TransitionEvent('transitionend', {
    propertyName: 'max-height',
    bubbles: true,
  }))
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(el.style.maxHeight).toBe('')
  el.remove()
})

test('reduced motion snaps without waiting for transition', () => {
  const el = makeRow()
  const onDone = vi.fn()
  animateLaneRowHeight(el, {
    direction: 'expand',
    reducedMotion: true,
    onDone,
  })
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(el.style.maxHeight).toBe('')

  const collapsed = makeRow()
  const onCollapseDone = vi.fn()
  animateLaneRowHeight(collapsed, {
    direction: 'collapse',
    reducedMotion: true,
    onDone: onCollapseDone,
  })
  expect(onCollapseDone).toHaveBeenCalledTimes(1)
  expect(collapsed.style.maxHeight).toBe('0px')
  el.remove()
  collapsed.remove()
})

test('cancel prevents onDone', () => {
  vi.useFakeTimers()
  const el = makeRow()
  const onDone = vi.fn()
  const { cancel } = animateLaneRowHeight(el, {
    direction: 'collapse',
    duration: 220,
    onDone,
  })
  cancel()
  el.dispatchEvent(new TransitionEvent('transitionend', {
    propertyName: 'max-height',
    bubbles: true,
  }))
  vi.advanceTimersByTime(300)
  expect(onDone).not.toHaveBeenCalled()
  el.remove()
})

test('null element still invokes onDone', () => {
  const onDone = vi.fn()
  animateLaneRowHeight(null, { direction: 'expand', onDone })
  expect(onDone).toHaveBeenCalledTimes(1)
})
