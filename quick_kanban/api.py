import frappe
from frappe import _
from frappe.utils import get_datetime

from quick_kanban.move_policy import (
	BoardContext,
	assert_move_allowed,
	get_create_options as build_create_options,
	get_move_options as build_move_options,
	resolve_workflow_action,
)
from quick_kanban.validation import validate_mandatory_for_move


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
