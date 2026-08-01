import { beforeEach, expect, test, vi } from 'vitest'
import {
  applyUserTagFilter,
  buildColumnListRouteOptions,
  LIST_HIDDEN_CHILD_NAME_LIMIT,
  openColumnListView,
} from './listNavigation'

const config = {
  ref_doctype: 'Task',
  field_name: 'status',
}

const column = {
  column_name: 'Open',
}

beforeEach(() => {
  frappe.route_options = {}
  frappe.set_route.mockClear()
  frappe.show_alert.mockClear()
})

test('buildColumnListRouteOptions returns only the column filter without cur_list', () => {
  expect(buildColumnListRouteOptions(config, column, null)).toEqual({
    routeOptions: { status: 'Open' },
    hiddenCapExceeded: false,
  })
})

test('buildColumnListRouteOptions merges cur_list search params with the column filter', () => {
  const list = {
    get_search_params: () => new URLSearchParams([['priority', 'High']]),
  }

  expect(buildColumnListRouteOptions(config, column, list)).toEqual({
    routeOptions: {
      priority: 'High',
      status: 'Open',
    },
    hiddenCapExceeded: false,
  })
})

test('openColumnListView sets route_options and navigates to List view', () => {
  openColumnListView(config, column)

  expect(frappe.route_options).toEqual({ status: 'Open' })
  expect(frappe.set_route).toHaveBeenCalledWith('List', 'Task', 'List')
})

test('buildColumnListRouteOptions adds name not-in for hidden board children', () => {
  expect(buildColumnListRouteOptions(config, column, null, {
    hiddenChildNames: ['CHILD-1', 'CHILD-2'],
  })).toEqual({
    routeOptions: {
      status: 'Open',
      name: ['not in', ['CHILD-1', 'CHILD-2']],
    },
    hiddenCapExceeded: false,
  })
})

test('buildColumnListRouteOptions omits name filter when hidden list is empty', () => {
  expect(buildColumnListRouteOptions(config, column, null, {
    hiddenChildNames: [],
  })).toEqual({
    routeOptions: { status: 'Open' },
    hiddenCapExceeded: false,
  })
})

test('buildColumnListRouteOptions skips giant name not-in and flags cap', () => {
  const hiddenChildNames = Array.from(
    { length: LIST_HIDDEN_CHILD_NAME_LIMIT + 1 },
    (_, index) => `CHILD-${index}`,
  )
  expect(buildColumnListRouteOptions(config, column, null, {
    hiddenChildNames,
  })).toEqual({
    routeOptions: { status: 'Open' },
    hiddenCapExceeded: true,
  })
})

test('openColumnListView alerts when hidden child names exceed the limit', () => {
  const hiddenChildNames = Array.from(
    { length: LIST_HIDDEN_CHILD_NAME_LIMIT + 1 },
    (_, index) => `CHILD-${index}`,
  )
  openColumnListView(config, column, null, { hiddenChildNames })

  expect(frappe.route_options).toEqual({ status: 'Open' })
  expect(frappe.show_alert).toHaveBeenCalledWith(expect.objectContaining({
    indicator: 'orange',
  }))
  expect(frappe.set_route).toHaveBeenCalledWith('List', 'Task', 'List')
})

test('applyUserTagFilter removes existing _user_tags filter then adds like', () => {
  const remove = vi.fn()
  const add = vi.fn()
  const list = {
    doctype: 'Task',
    filter_area: {
      add,
      filter_list: {
        get_filter: vi.fn(() => ({ remove })),
      },
    },
  }

  expect(applyUserTagFilter('  urgent  ', list)).toBe(true)
  expect(list.filter_area.filter_list.get_filter).toHaveBeenCalledWith('_user_tags')
  expect(remove).toHaveBeenCalledTimes(1)
  expect(add).toHaveBeenCalledWith('Task', '_user_tags', 'like', 'urgent')
})

test('applyUserTagFilter is a no-op without tag or filter_area', () => {
  expect(applyUserTagFilter('', { doctype: 'Task', filter_area: { add: vi.fn() } })).toBe(false)
  expect(applyUserTagFilter('urgent', null)).toBe(false)
  expect(applyUserTagFilter('urgent', { doctype: 'Task' })).toBe(false)
  expect(applyUserTagFilter('urgent', { filter_area: { add: vi.fn() } })).toBe(false)
})
