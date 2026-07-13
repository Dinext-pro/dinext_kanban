export function buildColumnListRouteOptions(config, column, list = globalThis.cur_list) {
  const routeOptions = {}
  const searchParams = list?.get_search_params?.()
  if (searchParams) {
    Object.assign(routeOptions, Object.fromEntries(searchParams))
  }
  routeOptions[config.field_name] = column.column_name
  return routeOptions
}

export function openColumnListView(config, column) {
  frappe.route_options = buildColumnListRouteOptions(config, column)
  return frappe.set_route('List', config.ref_doctype, 'List')
}
