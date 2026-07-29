import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  animateScrollTop,
  resolveCardPinScrollTop,
} from './childPanelAnimation'

function mockScroller({
  scrollTop = 0,
  clientHeight = 400,
  scrollHeight = 1200,
  top = 0,
  height = 400,
} = {}) {
  return {
    scrollTop,
    clientHeight,
    scrollHeight,
    getBoundingClientRect: () => ({
      top,
      bottom: top + height,
      left: 0,
      right: 300,
      width: 300,
      height,
    }),
  }
}

function mockCard({ top = 200, height = 80 } = {}) {
  return {
    getBoundingClientRect: () => ({
      top,
      bottom: top + height,
      left: 0,
      right: 280,
      width: 280,
      height,
    }),
  }
}

describe('childPanelAnimation', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  })

  test('resolveCardPinScrollTop returns null when already aligned', () => {
    const scroller = mockScroller({ scrollTop: 100, top: 50 })
    const card = mockCard({ top: 50 })
    expect(resolveCardPinScrollTop(card, scroller, { topInset: 0 })).toBe(null)
  })

  test('resolveCardPinScrollTop computes target scrollTop with inset', () => {
    const scroller = mockScroller({ scrollTop: 0, top: 40 })
    const card = mockCard({ top: 240 })
    // delta = 240 - (40 + 20) = 180 → scrollTop 180
    expect(resolveCardPinScrollTop(card, scroller, { topInset: 20 })).toBe(180)
  })

  test('animateScrollTop snaps immediately when reduced motion is on', async () => {
    const scroller = mockScroller({ scrollTop: 0 })
    const { done } = animateScrollTop(scroller, 200, {
      reducedMotion: true,
      duration: 300,
    })
    expect(scroller.scrollTop).toBe(200)
    await expect(done).resolves.toBe(true)
  })

  test('animateScrollTop emits mid-frame values then settles', async () => {
    const scroller = mockScroller({ scrollTop: 0 })
    const frames = []
    let now = 0
    const { done } = animateScrollTop(scroller, 100, {
      duration: 100,
      reducedMotion: false,
      now: () => now,
      requestFrame: (cb) => {
        frames.push(cb)
        return frames.length
      },
      cancelFrame: () => {},
    })
    expect(frames.length).toBe(1)
    now = 50
    frames[0](50)
    expect(scroller.scrollTop).toBeGreaterThan(0)
    expect(scroller.scrollTop).toBeLessThan(100)
    now = 100
    frames[1](100)
    expect(scroller.scrollTop).toBe(100)
    await expect(done).resolves.toBe(true)
  })

  test('animateScrollTop cancel stops further frames', async () => {
    const scroller = mockScroller({ scrollTop: 0 })
    const frames = []
    let now = 0
    const { cancel, done } = animateScrollTop(scroller, 100, {
      duration: 100,
      reducedMotion: false,
      now: () => now,
      requestFrame: (cb) => {
        frames.push(cb)
        return frames.length
      },
      cancelFrame: () => {},
    })
    cancel()
    now = 100
    frames[0](100)
    expect(scroller.scrollTop).toBe(0)
    await expect(done).resolves.toBe(false)
  })
})
