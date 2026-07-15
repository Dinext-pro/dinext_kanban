import { beforeEach, expect, test, vi } from 'vitest'
import {
  applyUserTagFilter,
  buildColumnListRouteOptions,
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
})

test('buildColumnListRouteOptions returns only the column filter without cur_list', () => {
  expect(buildColumnListRouteOptions(config, column, null)).toEqual({
    status: 'Open',
  })
})

test('buildColumnListRouteOptions merges cur_list search params with the column filter', () => {
  const list = {
    get_search_params: () => new URLSearchParams([['priority', 'High']]),
  }

  expect(buildColumnListRouteOptions(config, column, list)).toEqual({
    priority: 'High',
    status: 'Open',
  })
})

test('openColumnListView sets route_options and navigates to List view', () => {
  openColumnListView(config, column)

  expect(frappe.route_options).toEqual({ status: 'Open' })
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
