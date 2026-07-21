import { describe, expect, test } from 'vitest'
import {
  applyColumnStickRooms,
  computeColumnStickRooms,
  decodeCellListId,
  encodeCellListId,
  getExpandedLaneKeys,
  measureColumnContentHeight,
  reconcileCardInstancesAcrossLanes,
  removeAllCardInstances,
  resolveExpandedLaneKeys,
  restoreCardInstances,
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

  test('reads assignees from mapped _assign object', () => {
    expect(laneKeysFromCard(
      { _assign: { alice: 'Alice', bob: 'Bob' } },
      { swimlane_mode: 'assign' },
    )).toEqual(['alice', 'bob'])
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

describe('reconcileCardInstancesAcrossLanes', () => {
  const assignConfig = {
    field_name: 'status',
    swimlane_mode: 'assign',
    swimlane_field: SWIMLANE_ASSIGN,
    swimlane_is_multi: true,
  }

  function dualLaneBoard(cardFields = {}) {
    const base = {
      name: 'TASK-1',
      status: 'Open',
      _assign: { alice: 'Alice', bob: 'Bob' },
      ...cardFields,
    }
    return [
      {
        key: 'alice',
        columns: [
          { column_name: 'Open', cards: [{ ...base }] },
          { column_name: 'Done', cards: [] },
        ],
      },
      {
        key: 'bob',
        columns: [
          { column_name: 'Open', cards: [{ ...base }] },
          { column_name: 'Done', cards: [] },
        ],
      },
    ]
  }

  test('moves sibling copies into the status column', () => {
    const lanes = dualLaneBoard({ status: 'Done' })
    expect(reconcileCardInstancesAcrossLanes(lanes, assignConfig, 'TASK-1')).toBe(true)
    expect(lanes[0].columns[0].cards).toEqual([])
    expect(lanes[0].columns[1].cards[0]).toMatchObject({ name: 'TASK-1', status: 'Done' })
    expect(lanes[1].columns[0].cards).toEqual([])
    expect(lanes[1].columns[1].cards[0]).toMatchObject({ name: 'TASK-1', status: 'Done' })
  })

  test('prunes copies from lanes that no longer match membership', () => {
    const lanes = dualLaneBoard({
      _assign: { bob: 'Bob' },
    })
    expect(reconcileCardInstancesAcrossLanes(lanes, assignConfig, 'TASK-1')).toBe(true)
    expect(lanes[0].columns[0].cards).toEqual([])
    expect(lanes[1].columns[0].cards).toHaveLength(1)
    expect(lanes[1].columns[0].cards[0]._assign).toEqual({ bob: 'Bob' })
  })

  test('prepends into a loaded membership lane that is missing the card', () => {
    const lanes = [
      {
        key: 'alice',
        columns: [
          {
            column_name: 'Open',
            cards: [{
              name: 'TASK-1',
              status: 'Open',
              _assign: { alice: 'Alice', bob: 'Bob' },
            }],
          },
          { column_name: 'Done', cards: [] },
        ],
      },
      {
        key: 'bob',
        columns: [
          { column_name: 'Open', cards: [] },
          { column_name: 'Done', cards: [] },
        ],
      },
    ]
    const prepended = []
    const touched = reconcileCardInstancesAcrossLanes(
      lanes,
      assignConfig,
      'TASK-1',
      {
        canPrependToCell: (laneKey, columnName) => {
          prepended.push([laneKey, columnName])
          return laneKey === 'bob' && columnName === 'Open'
        },
      },
    )
    expect(touched).toBe(true)
    expect(prepended).toEqual([['bob', 'Open']])
    expect(lanes[1].columns[0].cards[0]).toMatchObject({
      name: 'TASK-1',
      status: 'Open',
    })
  })

  test('does not prepend when canPrependToCell denies the cell', () => {
    const lanes = [
      {
        key: 'alice',
        columns: [
          {
            column_name: 'Open',
            cards: [{
              name: 'TASK-1',
              status: 'Open',
              _assign: { alice: 'Alice', bob: 'Bob' },
            }],
          },
        ],
      },
      {
        key: 'bob',
        columns: [{ column_name: 'Open', cards: [] }],
      },
    ]
    expect(reconcileCardInstancesAcrossLanes(
      lanes,
      assignConfig,
      'TASK-1',
      { canPrependToCell: () => false },
    )).toBe(false)
    expect(lanes[1].columns[0].cards).toEqual([])
  })

  test('field-mode single membership only repositions within its lane', () => {
    const lanes = [
      {
        key: 'proj-a',
        columns: [
          {
            column_name: 'Open',
            cards: [{ name: 'TASK-1', status: 'Done', project: 'proj-a' }],
          },
          { column_name: 'Done', cards: [] },
        ],
      },
      {
        key: 'proj-b',
        columns: [
          { column_name: 'Open', cards: [] },
          { column_name: 'Done', cards: [] },
        ],
      },
    ]
    const config = {
      field_name: 'status',
      swimlane_mode: 'field',
      swimlane_field: 'project',
      swimlane_is_multi: false,
    }
    expect(reconcileCardInstancesAcrossLanes(lanes, config, 'TASK-1')).toBe(true)
    expect(lanes[0].columns[0].cards).toEqual([])
    expect(lanes[0].columns[1].cards[0].name).toBe('TASK-1')
    expect(lanes[1].columns[0].cards).toEqual([])
    expect(lanes[1].columns[1].cards).toEqual([])
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

describe('removeAllCardInstances', () => {
  test('removes flat-board cards and restores them', () => {
    const columns = [
      {
        column_name: 'Open',
        cards: [{ name: 'TASK-1', subject: 'One' }, { name: 'TASK-2', subject: 'Two' }],
      },
    ]
    const snapshot = removeAllCardInstances([], columns, 'TASK-1')
    expect(snapshot.card.name).toBe('TASK-1')
    expect(columns[0].cards.map(({ name }) => name)).toEqual(['TASK-2'])
    expect(restoreCardInstances([], columns, snapshot)).toBe(true)
    expect(columns[0].cards.map(({ name }) => name)).toEqual(['TASK-1', 'TASK-2'])
  })

  test('removes card copies from every swimlane', () => {
    const lanes = [
      {
        key: 'a',
        columns: [{ column_name: 'Open', cards: [{ name: 'TASK-1', subject: 'One' }] }],
      },
      {
        key: 'b',
        columns: [{ column_name: 'Open', cards: [{ name: 'TASK-1', subject: 'One' }] }],
      },
    ]
    const snapshot = removeAllCardInstances(lanes, [], 'TASK-1')
    expect(snapshot.placements).toHaveLength(2)
    expect(lanes[0].columns[0].cards).toEqual([])
    expect(lanes[1].columns[0].cards).toEqual([])
    restoreCardInstances(lanes, [], snapshot)
    expect(lanes[0].columns[0].cards[0].name).toBe('TASK-1')
    expect(lanes[1].columns[0].cards[0].name).toBe('TASK-1')
  })
})
