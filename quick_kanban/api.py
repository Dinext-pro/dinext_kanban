import json

import frappe
from frappe import _
from frappe.utils import cint, get_datetime

from quick_kanban.move_policy import (
	BoardContext,
	assert_lane_change_allowed,
	assert_move_allowed,
	get_create_options as build_create_options,
	get_move_options as build_move_options,
	resolve_workflow_action,
)
from quick_kanban.validation import validate_mandatory_for_move

COLUMN_WIDTH_MIN = 1
COLUMN_WIDTH_MAX = 10000
COLUMN_CHILD_COPY_FIELDS = (
	"column_name",
	"status",
	"order",
	"indicator",
	"custom_column_width",
)


def _normalize_column_width(value):
	width = cint(value)
	if width < COLUMN_WIDTH_MIN or width > COLUMN_WIDTH_MAX:
		frappe.throw(
			_("Column width must be between {0} and {1} pixels.").format(
				COLUMN_WIDTH_MIN,
				COLUMN_WIDTH_MAX,
			)
		)
	return width


def _column_row_dict(column):
	row = {}
	for fieldname in COLUMN_CHILD_COPY_FIELDS:
		if fieldname == "custom_column_width":
			value = column.get(fieldname)
			if value in (None, ""):
				continue
			row[fieldname] = cint(value)
			continue
		row[fieldname] = column.get(fieldname)
	return row


@frappe.whitelist(methods=["POST"])
def set_column_widths(board_name, widths):
	"""Persist column widths on Kanban Board Column rows."""
	widths = frappe.parse_json(widths) if isinstance(widths, str) else widths
	if not isinstance(widths, dict) or not widths:
		frappe.throw(_("Column widths must be a non-empty object."))

	board = frappe.get_doc("Kanban Board", board_name)
	board.check_permission("write")

	normalized = {
		str(column_name): _normalize_column_width(width)
		for column_name, width in widths.items()
	}
	updated = False
	for column in board.columns:
		if column.column_name not in normalized:
			continue
		column.custom_column_width = normalized[column.column_name]
		updated = True

	if not updated:
		frappe.throw(_("No matching columns found to update."))

	board.save()
	return board


@frappe.whitelist()
def update_column_order(board_name, order):
	"""Set column order while preserving custom column fields (e.g. width)."""
	board = frappe.get_doc("Kanban Board", board_name)
	order = json.loads(order) if isinstance(order, str) else order
	old_columns = list(board.columns)
	new_columns = []

	for col in order:
		for column in list(old_columns):
			if col == column.column_name:
				new_columns.append(column)
				old_columns.remove(column)

	new_columns.extend(old_columns)

	board.columns = []
	for col in new_columns:
		board.append("columns", _column_row_dict(col))

	board.save()
	return board


@frappe.whitelist()
@frappe.read_only()
def get_column_totals(
	doctype,
	fieldname,
	columns,
	filters=None,
	or_filters=None,
):
	columns = frappe.parse_json(columns) if isinstance(columns, str) else columns
	filters = frappe.parse_json(filters) if isinstance(filters, str) else (filters or [])
	or_filters = (
		frappe.parse_json(or_filters)
		if isinstance(or_filters, str)
		else (or_filters or [])
	)
	if not isinstance(columns, list):
		frappe.throw(_("Kanban columns must be a list."))

	meta = frappe.get_meta(doctype)
	field = meta.get_field(fieldname)
	if not field:
		frappe.throw(_("Invalid Kanban status field."))
	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)
	if field.permlevel:
		permitted_fields = meta.get_permitted_fieldnames(
			user=frappe.session.user,
			permission_type="read",
		)
		if fieldname not in permitted_fields:
			frappe.throw(_("You cannot read the Kanban status field."), frappe.PermissionError)

	rows = frappe.get_list(
		doctype,
		fields=[fieldname, "count(name) as count"],
		filters=filters,
		or_filters=or_filters,
		group_by=fieldname,
		limit_page_length=0,
	)
	totals = {column: 0 for column in columns}
	for row in rows:
		value = row.get(fieldname)
		if value in totals:
			totals[value] = int(row.get("count") or 0)
	return totals


@frappe.whitelist()
@frappe.read_only()
def get_attachment_counts(doctype, names):
	"""Return File attachment counts keyed by document name."""
	names = frappe.parse_json(names) if isinstance(names, str) else names
	if not names:
		return {}
	if not isinstance(names, (list, tuple)):
		frappe.throw(_("Document names must be a list."))

	unique_names = []
	seen = set()
	for name in names:
		key = str(name or "").strip()
		if not key or key in seen:
			continue
		seen.add(key)
		unique_names.append(key)

	if not unique_names:
		return {}

	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	counts = {name: 0 for name in unique_names}
	files = frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": doctype,
			"attached_to_name": ("in", unique_names),
		},
		fields=["attached_to_name"],
		limit_page_length=0,
	)
	for row in files:
		attached_name = row.get("attached_to_name")
		if attached_name in counts:
			counts[attached_name] += 1
	return counts


@frappe.whitelist()
@frappe.read_only()
def get_child_counts(doctype, names):
	"""Return direct child counts for tree DocTypes, keyed by parent name."""
	names = frappe.parse_json(names) if isinstance(names, str) else names
	if not names:
		return {}
	if not isinstance(names, (list, tuple)):
		frappe.throw(_("Document names must be a list."))

	unique_names = []
	seen = set()
	for name in names:
		key = str(name or "").strip()
		if not key or key in seen:
			continue
		seen.add(key)
		unique_names.append(key)

	if not unique_names:
		return {}

	meta = frappe.get_meta(doctype)
	parent_field = meta.nsm_parent_field if meta.is_tree else None
	if not parent_field:
		return {}

	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	counts = {name: 0 for name in unique_names}
	# Permission-aware; limit_page_length=0 avoids get_list default of 20.
	rows = frappe.get_list(
		doctype,
		filters={parent_field: ("in", unique_names)},
		fields=[parent_field],
		limit_page_length=0,
		ignore_permissions=False,
	)
	for row in rows:
		parent_name = row.get(parent_field)
		if parent_name in counts:
			counts[parent_name] += 1
	return counts


@frappe.whitelist(methods=["POST"])
def get_move_options(board_name, names):
	return build_move_options(board_name, names)


@frappe.whitelist(methods=["POST"])
def get_create_options(board_name):
	return build_create_options(board_name)


@frappe.whitelist(methods=["POST"])
def move_card(board_name, name, value, expected_modified=None, workflow_action=None):
	context = BoardContext(board_name)
	doc = frappe.get_doc(context.ref_doctype, name)
	doc.check_permission("write")

	if expected_modified and get_datetime(doc.modified) != get_datetime(expected_modified):
		frappe.throw(
			_("This card was changed by another user. Refresh the board and try again."),
			frappe.TimestampMismatchError,
		)

	move_mode = assert_move_allowed(doc, context, value, workflow_action)

	if move_mode == "workflow":
		from quick_kanban.move_policy import apply_workflow_transition

		selected_action = resolve_workflow_action(doc, context, value, workflow_action)
		validate_mandatory_for_move(
			doc,
			context.field_name,
			value,
			context.workflow,
			selected_action,
		)
		doc = apply_workflow_transition(doc, selected_action, context.workflow)
	else:
		validate_mandatory_for_move(doc, context.field_name, value, context.workflow)
		doc.set(context.field_name, value)
		doc.save()

	return {
		"name": doc.name,
		context.field_name: doc.get(context.field_name),
		"modified": doc.modified,
	}


@frappe.whitelist()
@frappe.read_only()
def get_swimlane_field_options(doctype):
	from quick_kanban.swimlane import get_swimlane_field_options as _get_options

	return _get_options(doctype)


@frappe.whitelist(methods=["POST"])
def set_swimlane_field(board_name, swimlane_field=None):
	"""Persist Kanban Board.custom_swimlane_field after validating options."""
	from quick_kanban.swimlane import normalize_swimlane_field

	board = frappe.get_doc("Kanban Board", board_name)
	board.check_permission("write")
	value = normalize_swimlane_field(board.reference_doctype, swimlane_field)
	board.custom_swimlane_field = value
	board.save()
	return {"custom_swimlane_field": board.custom_swimlane_field or ""}


@frappe.whitelist()
@frappe.read_only()
def get_swimlane_lanes(doctype, swimlane_field, filters=None, or_filters=None):
	from quick_kanban.swimlane import get_swimlane_lanes as _get_lanes

	return _get_lanes(doctype, swimlane_field, filters=filters, or_filters=or_filters)


@frappe.whitelist()
@frappe.read_only()
def get_cell_totals(
	doctype,
	status_field,
	columns,
	swimlane_field,
	lane_keys,
	filters=None,
	or_filters=None,
):
	from quick_kanban.swimlane import get_cell_totals as _get_cell_totals

	return _get_cell_totals(
		doctype,
		status_field,
		columns,
		swimlane_field,
		lane_keys,
		filters=filters,
		or_filters=or_filters,
	)


@frappe.whitelist()
@frappe.read_only()
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
	from quick_kanban.swimlane import get_swimlane_column_page as _get_page

	return _get_page(
		doctype,
		status_field,
		column,
		swimlane_field,
		lane_key,
		fields=fields,
		filters=filters,
		or_filters=or_filters,
		start=start,
		page_length=page_length,
	)


@frappe.whitelist()
@frappe.read_only()
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
	from quick_kanban.swimlane import get_swimlane_lane_page as _get_page

	return _get_page(
		doctype,
		status_field,
		swimlane_field,
		lane_key,
		fields=fields,
		filters=filters,
		or_filters=or_filters,
		start=start,
		page_length=page_length,
	)


@frappe.whitelist(methods=["POST"])
def move_card_to_cell(
	board_name,
	name,
	to_column=None,
	from_lane=None,
	to_lane=None,
	expected_modified=None,
	workflow_action=None,
):
	"""Move card across status column and/or swimlane membership."""
	from quick_kanban.swimlane import apply_lane_membership, resolve_swimlane_mode

	context = BoardContext(board_name)
	board = frappe.get_doc("Kanban Board", board_name)
	swimlane_field = (board.get("custom_swimlane_field") or "").strip()
	doc = frappe.get_doc(context.ref_doctype, name)
	doc.check_permission("write")

	if expected_modified and get_datetime(doc.modified) != get_datetime(expected_modified):
		frappe.throw(
			_("This card was changed by another user. Refresh the board and try again."),
			frappe.TimestampMismatchError,
		)

	column_changed = to_column is not None and doc.get(context.field_name) != to_column
	lane_changed = (
		swimlane_field
		and from_lane is not None
		and to_lane is not None
		and str(from_lane or "") != str(to_lane or "")
	)

	if column_changed:
		move_mode = assert_move_allowed(doc, context, to_column, workflow_action)
		if move_mode == "workflow":
			from quick_kanban.move_policy import apply_workflow_transition

			selected_action = resolve_workflow_action(doc, context, to_column, workflow_action)
			validate_mandatory_for_move(
				doc,
				context.field_name,
				to_column,
				context.workflow,
				selected_action,
			)
			doc = apply_workflow_transition(doc, selected_action, context.workflow)
		else:
			validate_mandatory_for_move(doc, context.field_name, to_column, context.workflow)
			doc.set(context.field_name, to_column)
			doc.save()
			doc = frappe.get_doc(context.ref_doctype, name)

	mode = resolve_swimlane_mode(swimlane_field, doc.meta) if swimlane_field else "off"
	if lane_changed and mode != "off":
		assert_lane_change_allowed(doc, swimlane_field, mode)
		apply_lane_membership(doc, swimlane_field, from_lane, to_lane)
		if mode != "assign":
			doc.save()
		else:
			doc.reload()

	result = {
		"name": doc.name,
		context.field_name: doc.get(context.field_name),
		"modified": doc.modified,
	}
	if swimlane_field and mode == "field":
		result[swimlane_field] = doc.get(swimlane_field)
	if mode == "assign":
		result["_assign"] = doc.get("_assign")
	return result
