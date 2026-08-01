export const LIST_HIDDEN_CHILD_NAME_LIMIT = 500

export function buildColumnListRouteOptions(
  config,
  column,
  list = globalThis.cur_list,
  { hiddenChildNames = [] } = {},
) {
  const routeOptions = {}
  const searchParams = list?.get_search_params?.()
  if (searchParams) {
    Object.assign(routeOptions, Object.fromEntries(searchParams))
  }
  routeOptions[config.field_name] = column.column_name
  const hidden = (hiddenChildNames || [])
    .map((name) => String(name || '').trim())
    .filter(Boolean)
  if (hidden.length && hidden.length <= LIST_HIDDEN_CHILD_NAME_LIMIT) {
    // Prefer name not-in over parent_field not-in: SQL NOT IN drops NULL parents
    // and would hide root tasks.
    routeOptions.name = ['not in', hidden]
  }
  return {
    routeOptions,
    hiddenCapExceeded: hidden.length > LIST_HIDDEN_CHILD_NAME_LIMIT,
  }
}

export function openColumnListView(
  config,
  column,
  list = globalThis.cur_list,
  options = {},
) {
  const { routeOptions, hiddenCapExceeded } = buildColumnListRouteOptions(
    config,
    column,
    list,
    options,
  )
  frappe.route_options = routeOptions
  if (hiddenCapExceeded) {
    frappe.show_alert({
      message: __(
        'The list may include child tasks that are hidden on the board',
        null,
        'DinextKanban.Board',
      ),
      indicator: 'orange',
    })
  }
  return frappe.set_route('List', config.ref_doctype, 'List')
}

/**
 * Apply a `_user_tags` like filter on the current list / kanban view
 * (same remove-then-add semantics as the List sidebar Tags stats).
 * @param {string|null|undefined} tag
 * @param {{ doctype?: string, filter_area?: { add: Function, filter_list?: { get_filter?: Function } } }|null} [list]
 * @returns {boolean}
 */
export function applyUserTagFilter(tag, list = globalThis.cur_list) {
  const label = String(tag || '').trim()
  if (!label || !list?.filter_area?.add) {
    return false
  }
  const doctype = list.doctype
  if (!doctype) {
    return false
  }
  const existing = list.filter_area.filter_list?.get_filter?.('_user_tags')
  if (existing?.remove) {
    existing.remove()
  }
  list.filter_area.add(doctype, '_user_tags', 'like', label)
  return true
}
