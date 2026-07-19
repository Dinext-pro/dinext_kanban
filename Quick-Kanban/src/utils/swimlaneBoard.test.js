import { describe, expect, test } from 'vitest'
import {
  applyColumnStickRooms,
  computeColumnStickRooms,
  decodeCellListId,
  encodeCellListId,
  getExpandedLaneKeys,
  measureColumnContentHeight,
  resolveExpandedLaneKeys,
  sortLanesByOccupancy,
} from './swimlaneBoard'
import {
  laneKeysFromCard,
  resolveSwimlaneMode,
  SWIMLANE_ASSIGN,
  SWIMLANE_UNASSIGNED,
} from './kanban'

describe('swimlaneBoard ids', () => {
  test('encodes and decodes cell list ids', () => {
    expect(encodeCellListId(2, 3)).toBe(20003)
    expect(decodeCellListId(20003)).toEqual({ laneIndex: 2, columnIndex: 3 })
    expect(decodeCellListId(4)).toEqual({ laneIndex: null, columnIndex: 4 })
  })

  test('expanded keys merge persisted set with drag overlay', () => {
    expect(getExpandedLaneKeys(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(getExpandedLaneKeys(['a'], 'a')).toEqual(['a'])
    expect(getExpandedLaneKeys(['a'], null)).toEqual(['a'])
    expect(getExpandedLaneKeys([], 'x')).toEqual(['x'])
    expect(getExpandedLaneKeys(['', 'b'], null)).toEqual(['', 'b'])
  })

  test('resolves expanded keys against current lanes without forcing a default', () => {
    const lanes = [{ key: 'x' }, { key: 'y' }, { key: '' }]
    expect(resolveExpandedLaneKeys(lanes, ['y', 'missing', ''])).toEqual(['y', ''])
    expect(resolveExpandedLaneKeys(lanes, [])).toEqual([])
    expect(resolveExpandedLaneKeys([], ['y'])).toEqual([])
  })
})

describe('sortLanesByOccupancy', () => {
  test('moves empty lanes after occupied ones and keeps relative order', () => {
    const lanes = [
      { key: 'empty-a' },
      { key: 'alice' },
      { key: 'empty-b' },
      { key: 'bob' },
      { key: '' },
    ]
    const totals = {
      'empty-a': { Open: 0 },
      alice: { Open: 2 },
      'empty-b': { Open: 0 },
      bob: { Open: 1, Done: 0 },
      '': { Open: 3 },
    }
    expect(sortLanesByOccupancy(lanes, totals).map((lane) => lane.key)).toEqual([
      'alice',
      'bob',
      '',
      'empty-a',
      'empty-b',
    ])
  })

  test('treats missing totals as empty', () => {
    const lanes = [{ key: 'a' }, { key: 'b' }]
    expect(sortLanesByOccupancy(lanes, { b: { Open: 1 } }).map((lane) => lane.key))
      .toEqual(['b', 'a'])
  })
})

describe('laneKeysFromCard', () => {
  test('duplicates assign membership across users', () => {
    const keys = laneKeysFromCard(
      { _assign: JSON.stringify(['alice', 'bob']) },
      { swimlane_mode: 'assign', swimlane_field: SWIMLANE_ASSIGN },
    )
    expect(keys).toEqual(['alice', 'bob'])
  })

  test('unassigned when no assignees', () => {
    expect(laneKeysFromCard(
      { _assign: null },
      { swimlane_mode: 'assign' },
    )).toEqual([SWIMLANE_UNASSIGNED])
  })

  test('single field membership', () => {
    expect(laneKeysFromCard(
      { priority: 'High' },
      { swimlane_mode: 'field', swimlane_field: 'priority' },
    )).toEqual(['High'])
  })

  test('resolveSwimlaneMode', () => {
    expect(resolveSwimlaneMode('')).toBe('off')
    expect(resolveSwimlaneMode(SWIMLANE_ASSIGN)).toBe('assign')
    expect(resolveSwimlaneMode('owner', { fieldtype: 'Link' })).toBe('field')
    expect(resolveSwimlaneMode('users', { fieldtype: 'Table MultiSelect' })).toBe('multi')
  })
})

describe('column stick-room equalize', () => {
  test('computeColumnStickRooms fills shorter columns up to lane max', () => {
    expect(computeColumnStickRooms([120, 40, 120])).toEqual([0, 80, 0])
    expect(computeColumnStickRooms([0, 0])).toEqual([0, 0])
    expect(computeColumnStickRooms([])).toEqual([])
  })

  test('applyColumnStickRooms sets CSS var from list+footer heights', () => {
    const row = document.createElement('div')
    const tall = document.createElement('div')
    tall.className = 'kanban-column--cell kanban-column--external-scroller'
    const tallList = document.createElement('div')
    tallList.className = 'kanban-card-list'
    Object.defineProperty(tallList, 'offsetHeight', { value: 200 })
    const tallFooter = document.createElement('div')
    tallFooter.className = 'column-footer-actions'
    Object.defineProperty(tallFooter, 'offsetHeight', { value: 40 })
    tall.append(tallList, tallFooter)

    const short = document.createElement('div')
    short.className = 'kanban-column--cell kanban-column--external-scroller'
    const shortList = document.createElement('div')
    shortList.className = 'kanban-card-list'
    Object.defineProperty(shortList, 'offsetHeight', { value: 20 })
    const shortFooter = document.createElement('div')
    shortFooter.className = 'column-footer-actions'
    Object.defineProperty(shortFooter, 'offsetHeight', { value: 40 })
    short.append(shortList, shortFooter)

    row.append(tall, short)

    expect(measureColumnContentHeight(tall)).toBe(240)
    expect(measureColumnContentHeight(short)).toBe(60)
    expect(applyColumnStickRooms(row)).toEqual([0, 180])
    expect(tall.style.getPropertyValue('--column-stick-room')).toBe('0px')
    expect(short.style.getPropertyValue('--column-stick-room')).toBe('180px')
  })

  test('measureColumnContentHeight excludes stick-room dropzone after the footer', () => {
    const cell = document.createElement('div')
    cell.className = 'kanban-column--cell kanban-column--external-scroller'
    const list = document.createElement('div')
    list.className = 'kanban-card-list'
    Object.defineProperty(list, 'offsetHeight', { value: 200 })
    const footer = document.createElement('div')
    footer.className = 'column-footer-actions'
    Object.defineProperty(footer, 'offsetHeight', { value: 40 })
    const dropzone = document.createElement('div')
    dropzone.className = 'column-stick-room-dropzone'
    Object.defineProperty(dropzone, 'offsetHeight', { value: 180 })
    cell.append(list, footer, dropzone)

    expect(measureColumnContentHeight(cell)).toBe(240)
  })
})
