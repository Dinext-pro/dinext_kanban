"""Swimlane grouping helpers for Quick-Kanban."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint

SWIMLANE_ASSIGN = "__assign"
SWIMLANE_FIELD_TYPES = ("Select", "Link", "User", "Table MultiSelect")
UNASSIGNED_KEY = ""


def resolve_swimlane_mode(swimlane_field, meta=None):
	"""Return off | assign | field | multi."""
	fieldname = (swimlane_field or "").strip()
	if not fieldname:
		return "off"
	if fieldname == SWIMLANE_ASSIGN:
		return "assign"
	if meta is None:
		return "field"
	df = meta.get_field(fieldname)
	if not df:
		frappe.throw(_("Invalid swimlane field: {0}").format(fieldname))
	fieldtype = (df.fieldtype or "").replace(" ", "")
	if fieldtype == "TableMultiSelect":
		return "multi"
	if df.fieldtype in ("Select", "Link", "User"):
		return "field"
	frappe.throw(
		_("Swimlane field must be Select, Link, User, or Table MultiSelect."),
	)


def get_swimlane_field_options(doctype):
	"""Options for Kanban Board.custom_swimlane_field."""
	if not doctype:
		return []
	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	meta = frappe.get_meta(doctype)
	options = [{"value": SWIMLANE_ASSIGN, "label": _("Assigned To")}]
	for df in meta.fields:
		if not df.fieldname:
			continue
		if df.fieldtype not in SWIMLANE_FIELD_TYPES:
			continue
		options.append(
			{
				"value": df.fieldname,
				"label": _(df.label) if df.label else df.fieldname,
			}
		)
	return options


def normalize_swimlane_field(doctype, swimlane_field):
	"""Return '' or a validated swimlane fieldname for the doctype."""
	value = (swimlane_field or "").strip()
	if not value:
		return ""
	allowed = {row["value"] for row in get_swimlane_field_options(doctype)}
	if value not in allowed:
		frappe.throw(_("Invalid swimlane field: {0}").format(value))
	return value


def _parse_filters(filters):
	if filters is None:
		return []
	if isinstance(filters, str):
		filters = frappe.parse_json(filters)
	return filters or []


def _parse_or_filters(or_filters):
	if or_filters is None:
		return []
	if isinstance(or_filters, str):
		or_filters = frappe.parse_json(or_filters)
	return or_filters or []


def _link_titles(doctype, names):
	"""Batch-resolve link titles keyed by document name (desk.search.get_link_title rules)."""
	names = [str(name) for name in (names or []) if name not in (None, "")]
	if not doctype or not names:
		return {}
	meta = frappe.get_meta(doctype)
	title_field = meta.title_field
	if meta.show_title_field_in_link and title_field and title_field != "name":
		# Permission-aware; limit_page_length=0 avoids get_list default of 20.
		rows = frappe.get_list(
			doctype,
			filters={"name": ("in", names)},
			fields=["name", title_field],
			limit_page_length=0,
		)
		out = {}
		for row in rows:
			title = row.get(title_field)
			out[row.name] = title or row.name
		for name in names:
			out.setdefault(name, name)
		return out
	return {name: name for name in names}


def _link_title(doctype, name):
	if not name:
		return _("Unassigned")
	return _link_titles(doctype, [name]).get(str(name), name)


def _user_label(user):
	if not user:
		return _("Unassigned")
	return frappe.utils.get_fullname(user) or user


def _select_options(df):
	raw = (df.options or "").split("\n")
	return [opt.strip() for opt in raw if opt and opt.strip()]


def _child_link_field(child_doctype):
	meta = frappe.get_meta(child_doctype)
	link_fields = [df for df in meta.fields if df.fieldtype == "Link"]
	if not link_fields:
		frappe.throw(_("Table MultiSelect child {0} has no Link field.").format(child_doctype))
	return link_fields[0].fieldname, link_fields[0].options


def get_swimlane_lanes(doctype, swimlane_field, filters=None, or_filters=None):
	"""Return ordered list of {key, label} for swimlane rows."""
	filters = _parse_filters(filters)
	or_filters = _parse_or_filters(or_filters)
	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	meta = frappe.get_meta(doctype)
	mode = resolve_swimlane_mode(swimlane_field, meta)
	if mode == "off":
		return []

	lanes = []
	seen = set()

	def add_lane(key, label):
		key = "" if key in (None, "") else str(key)
		if key in seen:
			return
		seen.add(key)
		lanes.append({"key": key, "label": label})

	if mode == "assign":
		parent_names = _matching_parent_names(doctype, filters, or_filters)
		if parent_names:
			todos = frappe.get_all(
				"ToDo",
				filters={
					"reference_type": doctype,
					"reference_name": ("in", parent_names),
					"status": ("!=", "Cancelled"),
				},
				fields=["allocated_to"],
				limit_page_length=0,
			)
			users = sorted({row.allocated_to for row in todos if row.allocated_to})
			for user in users:
				add_lane(user, _user_label(user))
		add_lane(UNASSIGNED_KEY, _("Unassigned"))
		return lanes

	df = meta.get_field(swimlane_field)
	if mode == "multi":
		child_doctype = df.options
		link_field, link_doctype = _child_link_field(child_doctype)
		parent_names = _matching_parent_names(doctype, filters, or_filters)
		values = []
		if parent_names:
			rows = frappe.get_all(
				child_doctype,
				filters={"parent": ("in", parent_names), "parenttype": doctype},
				fields=[link_field],
				limit_page_length=0,
			)
			values = sorted({row.get(link_field) for row in rows if row.get(link_field)})
		titles = _link_titles(link_doctype, values)
		for value in values:
			add_lane(value, titles.get(str(value), value))
		add_lane(UNASSIGNED_KEY, _("Unassigned"))
		return lanes

	# Single-value Select / Link / User
	if df.fieldtype == "Select":
		for opt in _select_options(df):
			add_lane(opt, _(opt, context=doctype))
	else:
		rows = frappe.get_list(
			doctype,
			fields=[swimlane_field],
			filters=filters,
			or_filters=or_filters,
			limit_page_length=0,
		)
		values = sorted({row.get(swimlane_field) for row in rows if row.get(swimlane_field)})
		if df.fieldtype == "User":
			for value in values:
				add_lane(value, _user_label(value))
		elif df.fieldtype == "Link" and df.options:
			titles = _link_titles(df.options, values)
			for value in values:
				add_lane(value, titles.get(str(value), value))
		else:
			for value in values:
				add_lane(value, value)

	add_lane(UNASSIGNED_KEY, _("Unassigned"))
	return lanes


def _matching_parent_names(doctype, filters, or_filters, extra_filters=None):
	list_filters = list(filters or [])
	if extra_filters:
		list_filters.extend(extra_filters)
	rows = frappe.get_list(
		doctype,
		fields=["name"],
		filters=list_filters,
		or_filters=or_filters or [],
		limit_page_length=0,
	)
	return [row.name for row in rows]


def _names_for_assign_lane(doctype, lane_key, status_field, status_value, filters, or_filters):
	base_filters = list(filters or [])
	base_filters.append([doctype, status_field, "=", status_value])
	parent_names = _matching_parent_names(doctype, base_filters, or_filters)
	if not parent_names:
		return []

	todos = frappe.get_all(
		"ToDo",
		filters={
			"reference_type": doctype,
			"reference_name": ("in", parent_names),
			"status": ("!=", "Cancelled"),
		},
		fields=["reference_name", "allocated_to"],
		limit_page_length=0,
	)
	by_parent = {}
	for row in todos:
		if not row.allocated_to:
			continue
		by_parent.setdefault(row.reference_name, set()).add(row.allocated_to)

	if lane_key == UNASSIGNED_KEY:
		return [name for name in parent_names if name not in by_parent]

	return [name for name in parent_names if lane_key in by_parent.get(name, ())]


def _names_for_multi_lane(
	doctype,
	swimlane_field,
	lane_key,
	status_field,
	status_value,
	filters,
	or_filters,
):
	meta = frappe.get_meta(doctype)
	df = meta.get_field(swimlane_field)
	child_doctype = df.options
	link_field, _link_doctype = _child_link_field(child_doctype)

	base_filters = list(filters or [])
	base_filters.append([doctype, status_field, "=", status_value])
	parent_names = _matching_parent_names(doctype, base_filters, or_filters)
	if not parent_names:
		return []

	rows = frappe.get_all(
		child_doctype,
		filters={"parent": ("in", parent_names), "parenttype": doctype},
		fields=["parent", link_field],
		limit_page_length=0,
	)
	by_parent = {}
	for row in rows:
		value = row.get(link_field)
		if not value:
			continue
		by_parent.setdefault(row.parent, set()).add(value)

	if lane_key == UNASSIGNED_KEY:
		return [name for name in parent_names if name not in by_parent]

	return [name for name in parent_names if lane_key in by_parent.get(name, ())]


def get_cell_totals(
	doctype,
	status_field,
	columns,
	swimlane_field,
	lane_keys,
	filters=None,
	or_filters=None,
):
	"""Return {laneKey: {columnName: count}} with multi-value membership."""
	filters = _parse_filters(filters)
	or_filters = _parse_or_filters(or_filters)
	columns = frappe.parse_json(columns) if isinstance(columns, str) else columns
	lane_keys = frappe.parse_json(lane_keys) if isinstance(lane_keys, str) else lane_keys
	if not isinstance(columns, list) or not isinstance(lane_keys, list):
		frappe.throw(_("columns and lane_keys must be lists."))

	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	meta = frappe.get_meta(doctype)
	mode = resolve_swimlane_mode(swimlane_field, meta)
	result = {str(lane): {col: 0 for col in columns} for lane in lane_keys}

	if mode == "off":
		return result

	for lane_key in lane_keys:
		lane_key = "" if lane_key in (None, "") else str(lane_key)
		for column in columns:
			names = _cell_doc_names(
				doctype=doctype,
				meta=meta,
				mode=mode,
				swimlane_field=swimlane_field,
				lane_key=lane_key,
				status_field=status_field,
				status_value=column,
				filters=filters,
				or_filters=or_filters,
			)
			result[lane_key][column] = len(names)

	return result


def _cell_doc_names(
	*,
	doctype,
	meta,
	mode,
	swimlane_field,
	lane_key,
	status_field,
	status_value,
	filters,
	or_filters,
):
	if mode == "assign":
		return _names_for_assign_lane(
			doctype, lane_key, status_field, status_value, filters, or_filters
		)
	if mode == "multi":
		return _names_for_multi_lane(
			doctype,
			swimlane_field,
			lane_key,
			status_field,
			status_value,
			filters,
			or_filters,
		)

	list_filters = list(filters or [])
	list_filters.append([doctype, status_field, "=", status_value])
	if lane_key == UNASSIGNED_KEY:
		list_filters.append([doctype, swimlane_field, "is", "not set"])
	else:
		list_filters.append([doctype, swimlane_field, "=", lane_key])
	return _matching_parent_names(doctype, list_filters, or_filters)


def _ensure_card_fetch_fields(fields, doctype=None, status_field=None):
	"""Always include name, title, status, _assign, _user_tags, _comments, _liked_by."""
	fields = list(fields or [])
	title_field = "name"
	if doctype:
		title_field = frappe.get_meta(doctype).title_field or "name"
	required = ["name", title_field]
	if status_field:
		required.append(status_field)
	required.append("_assign")
	required.append("_user_tags")
	required.append("_comments")
	required.append("_liked_by")
	out = []
	seen = set()
	for field in required + fields:
		if not field or field in seen:
			continue
		seen.add(field)
		out.append(field)
	return out


def _names_for_assign_lane_all(doctype, lane_key, filters, or_filters):
	"""Assign-lane membership across all status columns."""
	parent_names = _matching_parent_names(doctype, filters, or_filters)
	if not parent_names:
		return []

	todos = frappe.get_all(
		"ToDo",
		filters={
			"reference_type": doctype,
			"reference_name": ("in", parent_names),
			"status": ("!=", "Cancelled"),
		},
		fields=["reference_name", "allocated_to"],
		limit_page_length=0,
	)
	by_parent = {}
	for row in todos:
		if not row.allocated_to:
			continue
		by_parent.setdefault(row.reference_name, set()).add(row.allocated_to)

	if lane_key == UNASSIGNED_KEY:
		return [name for name in parent_names if name not in by_parent]

	return [name for name in parent_names if lane_key in by_parent.get(name, ())]


def _names_for_multi_lane_all(doctype, swimlane_field, lane_key, filters, or_filters):
	"""Table MultiSelect lane membership across all status columns."""
	meta = frappe.get_meta(doctype)
	df = meta.get_field(swimlane_field)
	child_doctype = df.options
	link_field, _link_doctype = _child_link_field(child_doctype)

	parent_names = _matching_parent_names(doctype, filters, or_filters)
	if not parent_names:
		return []

	rows = frappe.get_all(
		child_doctype,
		filters={"parent": ("in", parent_names), "parenttype": doctype},
		fields=["parent", link_field],
		limit_page_length=0,
	)
	by_parent = {}
	for row in rows:
		value = row.get(link_field)
		if not value:
			continue
		by_parent.setdefault(row.parent, set()).add(value)

	if lane_key == UNASSIGNED_KEY:
		return [name for name in parent_names if name not in by_parent]

	return [name for name in parent_names if lane_key in by_parent.get(name, ())]


def _lane_doc_names(
	*,
	doctype,
	meta,
	mode,
	swimlane_field,
	lane_key,
	filters,
	or_filters,
):
	"""Document names in a swimlane across all columns (no status filter)."""
	if mode == "assign":
		return _names_for_assign_lane_all(doctype, lane_key, filters, or_filters)
	if mode == "multi":
		return _names_for_multi_lane_all(
			doctype, swimlane_field, lane_key, filters, or_filters
		)

	list_filters = list(filters or [])
	if lane_key == UNASSIGNED_KEY:
		list_filters.append([doctype, swimlane_field, "is", "not set"])
	else:
		list_filters.append([doctype, swimlane_field, "=", lane_key])
	return _matching_parent_names(doctype, list_filters, or_filters)


def _empty_page(fields):
	return {"keys": list(fields), "values": [], "user_info": {}}


def _page_rows_as_keys_values(paged, fields):
	"""Return reportview-like {keys, values, user_info} for avatar/assignee UI."""
	from frappe.utils import add_user_info

	keys = list(fields)
	values = []
	user_info = {}
	for row in paged:
		values.append([row.get(field) for field in keys])
		assign_raw = row.get("_assign") or ""
		if not assign_raw:
			continue
		try:
			users = json.loads(assign_raw) if isinstance(assign_raw, str) else assign_raw
		except (TypeError, ValueError):
			continue
		if not isinstance(users, (list, tuple)):
			continue
		for user in users:
			if user:
				add_user_info(user, user_info)
	return {"keys": keys, "values": values, "user_info": user_info}


def get_swimlane_column_page(
	doctype,
	status_field,
	column,
	swimlane_field,
	lane_key,
	fields=None,
	filters=None,
	or_filters=None,
	start=0,
	page_length=20,
):
	"""Return reportview-like {keys, values} for one swimlane cell."""
	filters = _parse_filters(filters)
	or_filters = _parse_or_filters(or_filters)
	fields = frappe.parse_json(fields) if isinstance(fields, str) else (fields or ["name"])
	fields = _ensure_card_fetch_fields(fields, doctype=doctype, status_field=status_field)
	start = cint(start)
	page_length = cint(page_length) or 20
	lane_key = "" if lane_key in (None, "") else str(lane_key)

	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	meta = frappe.get_meta(doctype)
	mode = resolve_swimlane_mode(swimlane_field, meta)
	names = _cell_doc_names(
		doctype=doctype,
		meta=meta,
		mode=mode,
		swimlane_field=swimlane_field,
		lane_key=lane_key,
		status_field=status_field,
		status_value=column,
		filters=filters,
		or_filters=or_filters,
	)
	# Stable order by modified desc to match typical kanban
	if not names:
		return _empty_page(fields)

	# Page slice after sorting via get_list
	paged = frappe.get_list(
		doctype,
		fields=fields,
		filters={"name": ("in", names)},
		order_by="modified desc",
		start=start,
		page_length=page_length,
	)
	return _page_rows_as_keys_values(paged, fields)


def get_swimlane_lane_page(
	doctype,
	status_field,
	swimlane_field,
	lane_key,
	fields=None,
	filters=None,
	or_filters=None,
	start=0,
	page_length=100,
):
	"""Return reportview-like {keys, values} for one swimlane across all columns."""
	filters = _parse_filters(filters)
	or_filters = _parse_or_filters(or_filters)
	fields = frappe.parse_json(fields) if isinstance(fields, str) else (fields or ["name"])
	fields = _ensure_card_fetch_fields(fields, doctype=doctype, status_field=status_field)
	start = cint(start)
	page_length = cint(page_length) or 100
	lane_key = "" if lane_key in (None, "") else str(lane_key)

	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	meta = frappe.get_meta(doctype)
	mode = resolve_swimlane_mode(swimlane_field, meta)
	if mode == "off":
		return _empty_page(fields)

	# Field mode: page directly with lane filters (avoids loading all names).
	if mode == "field":
		list_filters = list(filters or [])
		if lane_key == UNASSIGNED_KEY:
			list_filters.append([doctype, swimlane_field, "is", "not set"])
		else:
			list_filters.append([doctype, swimlane_field, "=", lane_key])
		paged = frappe.get_list(
			doctype,
			fields=fields,
			filters=list_filters,
			or_filters=or_filters or [],
			order_by="modified desc",
			start=start,
			page_length=page_length,
		)
		return _page_rows_as_keys_values(paged, fields)

	names = _lane_doc_names(
		doctype=doctype,
		meta=meta,
		mode=mode,
		swimlane_field=swimlane_field,
		lane_key=lane_key,
		filters=filters,
		or_filters=or_filters,
	)
	if not names:
		return _empty_page(fields)

	paged = frappe.get_list(
		doctype,
		fields=fields,
		filters={"name": ("in", names)},
		order_by="modified desc",
		start=start,
		page_length=page_length,
	)
	return _page_rows_as_keys_values(paged, fields)


def _clear_table_multiselect(doc, fieldname):
	doc.set(fieldname, [])


def _set_table_multiselect_membership(doc, fieldname, from_lane, to_lane):
	meta = doc.meta
	df = meta.get_field(fieldname)
	child_doctype = df.options
	link_field, _ = _child_link_field(child_doctype)
	rows = list(doc.get(fieldname) or [])
	current = {row.get(link_field) for row in rows if row.get(link_field)}

	if to_lane == UNASSIGNED_KEY:
		_clear_table_multiselect(doc, fieldname)
		return

	from_lane = "" if from_lane in (None, "") else str(from_lane)
	to_lane = str(to_lane)

	if from_lane and from_lane in current and from_lane != to_lane:
		doc.set(
			fieldname,
			[row for row in rows if row.get(link_field) != from_lane],
		)
		rows = list(doc.get(fieldname) or [])
		current = {row.get(link_field) for row in rows if row.get(link_field)}

	if to_lane not in current:
		doc.append(fieldname, {link_field: to_lane})


def _reassign_membership(doc, from_lane, to_lane):
	from frappe.desk.form.assign_to import add as assign_add
	from frappe.desk.form.assign_to import remove as assign_remove

	from_lane = "" if from_lane in (None, "") else str(from_lane)
	to_lane = "" if to_lane in (None, "") else str(to_lane)

	if to_lane == UNASSIGNED_KEY:
		# Remove all assignees
		todos = frappe.get_all(
			"ToDo",
			filters={
				"reference_type": doc.doctype,
				"reference_name": doc.name,
				"status": ("!=", "Cancelled"),
			},
			fields=["allocated_to"],
			limit_page_length=0,
		)
		for row in todos:
			if row.allocated_to:
				assign_remove(doc.doctype, doc.name, row.allocated_to)
		return

	if from_lane and from_lane != to_lane:
		try:
			assign_remove(doc.doctype, doc.name, from_lane)
		except Exception:
			pass

	if to_lane:
		assign_add(
			{
				"assign_to": [to_lane],
				"doctype": doc.doctype,
				"name": doc.name,
				"description": doc.get("description") or doc.name,
			}
		)


def apply_lane_membership(doc, swimlane_field, from_lane, to_lane):
	"""Mutate doc (or assignments) for lane membership change. Caller saves when needed."""
	meta = doc.meta
	mode = resolve_swimlane_mode(swimlane_field, meta)
	from_lane = "" if from_lane in (None, "") else str(from_lane)
	to_lane = "" if to_lane in (None, "") else str(to_lane)

	if from_lane == to_lane:
		return mode

	if mode == "assign":
		_reassign_membership(doc, from_lane, to_lane)
		return mode

	if mode == "multi":
		_set_table_multiselect_membership(doc, swimlane_field, from_lane, to_lane)
		return mode

	if mode == "field":
		doc.set(swimlane_field, to_lane if to_lane != UNASSIGNED_KEY else None)
		return mode

	return mode
