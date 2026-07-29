import { afterEach, expect, test, vi } from 'vitest'
import {
  animateColumnTracks,
  easeOutCubic,
  formatTrackTemplate,
  interpolateTrackWidths,
} from './columnCollapseAnimation'

afterEach(() => {
  vi.restoreAllMocks()
})

test('easeOutCubic stays in 0..1 and settles at the end', () => {
  expect(easeOutCubic(0)).toBe(0)
  expect(easeOutCubic(1)).toBe(1)
  expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  expect(easeOutCubic(0.5)).toBeLessThan(1)
})

test('interpolateTrackWidths lerps each track with easing', () => {
  const mid = interpolateTrackWidths([100, 200], [0, 400], 0.5)
  expect(mid).toHaveLength(2)
  expect(mid[0]).toBeLessThan(100)
  expect(mid[0]).toBeGreaterThan(0)
  expect(mid[1]).toBeGreaterThan(200)
  expect(mid[1]).toBeLessThan(400)
  expect(interpolateTrackWidths([100], [52], 1)).toEqual([52])
})

test('formatTrackTemplate joins px tracks', () => {
  expect(formatTrackTemplate([280, 52, 320])).toBe('280px 52px 320px')
  expect(formatTrackTemplate([])).toBe('')
})

test('animateColumnTracks snaps immediately when reduced motion is on', () => {
  const frames = []
  const { cancel } = animateColumnTracks({
    from: [280, 320],
    to: [52, 320],
    reducedMotion: true,
    onFrame: (widths) => frames.push(widths),
  })
  expect(frames).toEqual([[52, 320]])
  cancel()
})

test('animateColumnTracks emits mid-frame values then settles', () => {
  const frames = []
  let now = 0
  const callbacks = []
  const requestFrame = (cb) => {
    callbacks.push(cb)
    return callbacks.length
  }
  const cancelFrame = vi.fn()

  const { cancel } = animateColumnTracks({
    from: [280, 320],
    to: [52, 320],
    duration: 220,
    reducedMotion: false,
    now: () => now,
    requestFrame,
    cancelFrame,
    onFrame: (widths) => frames.push([...widths]),
  })

  expect(callbacks).toHaveLength(1)
  now = 110
  callbacks.shift()(now)
  expect(frames.length).toBeGreaterThanOrEqual(1)
  expect(frames[0][0]).toBeLessThan(280)
  expect(frames[0][0]).toBeGreaterThan(52)
  expect(frames[0][1]).toBe(320)

  now = 220
  callbacks.shift()(now)
  expect(frames.at(-1)).toEqual([52, 320])
  cancel()
})

test('animateColumnTracks cancel stops further frames', () => {
  const frames = []
  let now = 0
  const callbacks = []
  const requestFrame = (cb) => {
    callbacks.push(cb)
    return callbacks.length
  }
  const cancelFrame = vi.fn()

  const { cancel } = animateColumnTracks({
    from: [280],
    to: [52],
    duration: 220,
    reducedMotion: false,
    now: () => now,
    requestFrame,
    cancelFrame,
    onFrame: (widths) => frames.push([...widths]),
  })

  now = 50
  callbacks.shift()(now)
  const countAfterFirst = frames.length
  cancel()
  expect(cancelFrame).toHaveBeenCalled()

  now = 220
  // Stale callback must not append after cancel.
  const stale = callbacks.shift()
  stale?.(now)
  expect(frames).toHaveLength(countAfterFirst)
})
