"""Swimlane grouping helpers for Quick-Kanban."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint

SWIMLANE_ASSIGN = "__assign"
SWIMLANE_DEADLINES = "__deadlines"
SWIMLANE_FIELD_TYPES = ("Select", "Link", "User", "Table MultiSelect")
UNASSIGNED_KEY = ""
# Match Frappe `_assign` (todo.py): only Open ToDos count as active assignments.
ACTIVE_ASSIGN_TODO_STATUS = ("not in", ("Cancelled", "Closed"))


def resolve_swimlane_mode(swimlane_field, meta=None):
	"""Return off | assign | deadlines | field | multi."""
	fieldname = (swimlane_field or "").strip()
	if not fieldname:
		return "off"
	if fieldname == SWIMLANE_ASSIGN:
		return "assign"
	if fieldname == SWIMLANE_DEADLINES:
		return "deadlines"
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


def get_swimlane_field_options(doctype, board_name=None, include_deadlines=None):
	"""Options for Kanban Board.custom_swimlane_field.

	Deadlines (`__deadlines`) is included only when deadline tracking is enabled
	for the board: explicit ``include_deadlines``, or non-empty
	``custom_deadline_field`` when ``board_name`` is given. If neither is set,
	Deadlines is omitted.
	"""
	if not doctype:
		return []
	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	if include_deadlines is None and board_name:
		include_deadlines = bool(
			str(
				frappe.db.get_value("Kanban Board", board_name, "custom_deadline_field") or ""
			).strip()
		)
	elif include_deadlines is None:
		include_deadlines = False
	else:
		include_deadlines = bool(cint(include_deadlines) if not isinstance(include_deadlines, bool) else include_deadlines)

	meta = frappe.get_meta(doctype)
	options = [
		{"value": SWIMLANE_ASSIGN, "label": _("Assigned To")},
	]
	if include_deadlines:
		options.append({"value": SWIMLANE_DEADLINES, "label": _("Deadlines")})
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


def normalize_swimlane_field(doctype, swimlane_field, board_name=None, include_deadlines=None):
	"""Return '' or a validated swimlane fieldname for the doctype."""
	value = (swimlane_field or "").strip()
	if not value:
		return ""
	allowed = {
		row["value"]
		for row in get_swimlane_field_options(
			doctype,
			board_name=board_name,
			include_deadlines=include_deadlines,
		)
	}
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
					"status": ACTIVE_ASSIGN_TODO_STATUS,
				},
				fields=["allocated_to"],
				limit_page_length=0,
			)
			users = sorted({row.allocated_to for row in todos if row.allocated_to})
			for user in users:
				add_lane(user, _user_label(user))
		add_lane(UNASSIGNED_KEY, _("Unassigned"))
		return lanes

	if mode == "deadlines":
		from quick_kanban.deadline import (
			DEADLINE_ATTENTION,
			DEADLINE_NONE,
			DEADLINE_OVERDUE,
			DEADLINE_PLANNED,
		)

		add_lane(DEADLINE_OVERDUE, _("Overdue"))
		add_lane(DEADLINE_ATTENTION, _("Deadline Approaching"))
		add_lane(DEADLINE_PLANNED, _("On Track"))
		add_lane(DEADLINE_NONE, _("No Deadline"))
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
			"status": ACTIVE_ASSIGN_TODO_STATUS,
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
	hide_board_children=None,
):
	"""Return {laneKey: {columnName: count}} with multi-value membership."""
	from quick_kanban.board_children import (
		coerce_bool,
		filter_names_excluding_on_board_children,
		tree_parent_field,
	)
	from quick_kanban.api import get_board_document_names

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

	hide_children = coerce_bool(hide_board_children)
	parent_field = tree_parent_field(doctype) if hide_children else None
	board_name_set = None
	if hide_children and parent_field:
		board_names = get_board_document_names(
			doctype,
			filters=filters,
			field_name=status_field,
			column_values=columns,
			or_filters=or_filters,
		)
		board_name_set = {str(name) for name in board_names}

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
			if board_name_set is not None:
				names = filter_names_excluding_on_board_children(
					doctype,
					names,
					parent_field,
					board_name_set,
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
	if mode == "deadlines":
		return _names_for_deadline_lane(
			doctype,
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


def _names_for_deadline_lane(
	doctype,
	lane_key,
	status_field,
	status_value,
	filters,
	or_filters,
	deadline_field=None,
	attention_days=3,
	deadline_columns=None,
):
	from quick_kanban.deadline import get_board_deadline_settings, names_for_deadline_lane

	if deadline_columns is None or not deadline_field:
		board_name = frappe.flags.get("quick_kanban_board_name")
		if board_name:
			settings = get_board_deadline_settings(board_name)
			deadline_field = deadline_field or settings.get("deadline_field") or ""
			attention_days = settings.get("attention_days") or attention_days
			if deadline_columns is None:
				deadline_columns = settings.get("deadline_columns") or []
	if not deadline_field:
		meta = frappe.get_meta(doctype)
		if meta.get_field("exp_end_date"):
			deadline_field = "exp_end_date"
		elif meta.get_field("due_date"):
			deadline_field = "due_date"
		else:
			return []
	return names_for_deadline_lane(
		doctype,
		deadline_field=deadline_field,
		lane_key=lane_key,
		attention_days=attention_days,
		status_field=status_field,
		status_value=status_value,
		filters=filters,
		or_filters=or_filters,
		deadline_columns=deadline_columns or [],
	)


def _ensure_card_fetch_fields(fields, doctype=None, status_field=None, deadline_field=None):
	"""Always include name, title, status, tree parent, _assign, tags, comments, liked."""
	fields = list(fields or [])
	title_field = "name"
	parent_field = None
	meta = None
	if doctype:
		meta = frappe.get_meta(doctype)
		title_field = meta.title_field or "name"
		if meta.is_tree and meta.nsm_parent_field:
			parent_field = meta.nsm_parent_field
	required = ["name", title_field]
	if status_field:
		required.append(status_field)
	if parent_field:
		required.append(parent_field)
	required.append("_assign")
	required.append("_user_tags")
	required.append("_comments")
	required.append("_liked_by")
	if deadline_field:
		required.append(deadline_field)
	if meta and meta.get_field("project"):
		required.append("project")
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
			"status": ACTIVE_ASSIGN_TODO_STATUS,
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
	status_field=None,
):
	"""Document names in a swimlane across all columns (no status filter)."""
	if mode == "assign":
		return _names_for_assign_lane_all(doctype, lane_key, filters, or_filters)
	if mode == "multi":
		return _names_for_multi_lane_all(
			doctype, swimlane_field, lane_key, filters, or_filters
		)
	if mode == "deadlines":
		from quick_kanban.deadline import (
			classify_card_deadline,
			get_board_deadline_settings,
			resolve_projects_holiday_lists,
		)

		settings = {}
		board_name = frappe.flags.get("quick_kanban_board_name")
		if board_name:
			settings = get_board_deadline_settings(board_name)
		deadline_field = settings.get("deadline_field") or ""
		attention_days = settings.get("attention_days") or 3
		deadline_columns = settings.get("deadline_columns") or []
		if not deadline_field:
			if meta.get_field("exp_end_date"):
				deadline_field = "exp_end_date"
			elif meta.get_field("due_date"):
				deadline_field = "due_date"
			else:
				return []
		if not status_field:
			return []
		fields = ["name", deadline_field, status_field]
		has_project = bool(meta.get_field("project"))
		if has_project:
			fields.append("project")
		rows = frappe.get_list(
			doctype,
			fields=fields,
			filters=filters or [],
			or_filters=or_filters or [],
			limit_page_length=0,
		)
		projects = [str(r.project) for r in rows if has_project and r.get("project")]
		holiday_map = resolve_projects_holiday_lists(projects)
		return [
			row.name
			for row in rows
			if classify_card_deadline(
				row,
				deadline_field=deadline_field,
				attention_days=attention_days,
				holiday_list_by_project=holiday_map,
				status_field=status_field,
				deadline_columns=deadline_columns,
			)
			== lane_key
		]

	list_filters = list(filters or [])
	if lane_key == UNASSIGNED_KEY:
		list_filters.append([doctype, swimlane_field, "is", "not set"])
	else:
		list_filters.append([doctype, swimlane_field, "=", lane_key])
	return _matching_parent_names(doctype, list_filters, or_filters)


def _empty_page(fields):
	return {"keys": list(fields), "values": [], "user_info": {}}


def _apply_deadline_bucket_to_page(paged, fields, *, doctype, status_field):
	"""Attach `_deadline_bucket` using board settings; include it in page keys."""
	board_name = frappe.flags.get("quick_kanban_board_name")
	if not board_name or not paged:
		return paged, list(fields or [])
	from quick_kanban.deadline import enrich_rows_with_deadline_bucket, get_board_deadline_settings

	settings = get_board_deadline_settings(board_name)
	deadline_field = settings.get("deadline_field") or ""
	if not deadline_field:
		return paged, list(fields or [])
	meta = frappe.get_meta(doctype)
	enrich_rows_with_deadline_bucket(
		paged,
		deadline_field=deadline_field,
		attention_days=settings.get("attention_days") or 3,
		has_project_field=bool(meta.get_field("project")),
		status_field=status_field,
		deadline_columns=settings.get("deadline_columns") or [],
	)
	out_fields = list(fields or [])
	if "_deadline_bucket" not in out_fields:
		out_fields.append("_deadline_bucket")
	return paged, out_fields


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
	hide_board_children=None,
	column_values=None,
):
	"""Return reportview-like {keys, values} for one swimlane cell."""
	from quick_kanban.board_children import (
		coerce_bool,
		filter_names_excluding_on_board_children,
		board_name_set_for_hide,
	)

	filters = _parse_filters(filters)
	or_filters = _parse_or_filters(or_filters)
	fields = frappe.parse_json(fields) if isinstance(fields, str) else (fields or ["name"])
	deadline_field = None
	board_name = frappe.flags.get("quick_kanban_board_name")
	if board_name:
		from quick_kanban.deadline import get_board_deadline_settings

		deadline_field = get_board_deadline_settings(board_name).get("deadline_field") or None
	fields = _ensure_card_fetch_fields(
		fields,
		doctype=doctype,
		status_field=status_field,
		deadline_field=deadline_field,
	)
	column_values = (
		frappe.parse_json(column_values) if isinstance(column_values, str) else column_values
	)
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
	if coerce_bool(hide_board_children) and names:
		active_columns = column_values if isinstance(column_values, (list, tuple)) and column_values else [column]
		parent_field, board_set = board_name_set_for_hide(
			doctype,
			filters=filters,
			field_name=status_field,
			column_values=active_columns,
			or_filters=or_filters,
		)
		if parent_field and board_set is not None:
			names = filter_names_excluding_on_board_children(
				doctype,
				names,
				parent_field,
				board_set,
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
	paged, fields = _apply_deadline_bucket_to_page(
		paged, fields, doctype=doctype, status_field=status_field
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
	hide_board_children=None,
	column_values=None,
):
	"""Return reportview-like {keys, values} for one swimlane across all columns."""
	from quick_kanban.board_children import (
		coerce_bool,
		filter_names_excluding_on_board_children,
		board_name_set_for_hide,
	)

	filters = _parse_filters(filters)
	or_filters = _parse_or_filters(or_filters)
	fields = frappe.parse_json(fields) if isinstance(fields, str) else (fields or ["name"])
	deadline_field = None
	board_name = frappe.flags.get("quick_kanban_board_name")
	if board_name:
		from quick_kanban.deadline import get_board_deadline_settings

		deadline_field = get_board_deadline_settings(board_name).get("deadline_field") or None
	fields = _ensure_card_fetch_fields(
		fields,
		doctype=doctype,
		status_field=status_field,
		deadline_field=deadline_field,
	)
	column_values = (
		frappe.parse_json(column_values) if isinstance(column_values, str) else column_values
	)
	start = cint(start)
	page_length = cint(page_length) or 100
	lane_key = "" if lane_key in (None, "") else str(lane_key)
	hide_children = coerce_bool(hide_board_children)

	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	meta = frappe.get_meta(doctype)
	mode = resolve_swimlane_mode(swimlane_field, meta)
	if mode == "off":
		return _empty_page(fields)

	parent_field = None
	board_set = None
	if hide_children:
		active_columns = column_values if isinstance(column_values, (list, tuple)) else []
		parent_field, board_set = board_name_set_for_hide(
			doctype,
			filters=filters,
			field_name=status_field,
			column_values=active_columns,
			or_filters=or_filters,
		)

	# Field mode without hide: page directly with lane filters.
	# With hide: resolve names first so exclude happens before slice.
	if mode == "field" and not (hide_children and parent_field):
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
		paged, fields = _apply_deadline_bucket_to_page(
			paged, fields, doctype=doctype, status_field=status_field
		)
		return _page_rows_as_keys_values(paged, fields)

	if mode == "field":
		list_filters = list(filters or [])
		if lane_key == UNASSIGNED_KEY:
			list_filters.append([doctype, swimlane_field, "is", "not set"])
		else:
			list_filters.append([doctype, swimlane_field, "=", lane_key])
		names = _matching_parent_names(doctype, list_filters, or_filters)
	else:
		names = _lane_doc_names(
			doctype=doctype,
			meta=meta,
			mode=mode,
			swimlane_field=swimlane_field,
			lane_key=lane_key,
			filters=filters,
			or_filters=or_filters,
			status_field=status_field,
		)

	if hide_children and parent_field and board_set is not None and names:
		names = filter_names_excluding_on_board_children(
			doctype,
			names,
			parent_field,
			board_set,
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
	paged, fields = _apply_deadline_bucket_to_page(
		paged, fields, doctype=doctype, status_field=status_field
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
		# Remove all active (Open) assignees — Closed ToDos are already inactive.
		todos = frappe.get_all(
			"ToDo",
			filters={
				"reference_type": doc.doctype,
				"reference_name": doc.name,
				"status": ACTIVE_ASSIGN_TODO_STATUS,
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

	if mode == "deadlines":
		frappe.throw(_("Deadline swimlanes cannot be changed by dragging."))

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
