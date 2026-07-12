import { beforeEach, expect, test, vi } from 'vitest'
import {
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
