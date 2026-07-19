import frappe
from frappe import _

from quick_kanban.validation import (
	build_create_preview_doc,
	build_preview_doc,
	get_missing_mandatory_fieldnames,
	get_missing_mandatory_fields,
)

MOVE_OPTIONS_BATCH_LIMIT = 50

REASON_WORKFLOW_DENIED = "workflow_denied"
REASON_FIELD_READONLY = "field_readonly"
REASON_NO_PERMISSION = "no_permission"
REASON_INVALID_COLUMN = "invalid_column"
REASON_MISSING_MANDATORY = "missing_mandatory"
REASON_SAME_COLUMN = "same_column"


class BoardContext:
	__slots__ = (
		"board_name",
		"ref_doctype",
		"field_name",
		"columns",
		"status_field",
		"workflow",
		"workflow_state_field",
		"uses_workflow_field",
		"workflow_update_fields",
	)

	def __init__(self, board_name):
		board = frappe.get_doc("Kanban Board", board_name)
		if not board.reference_doctype or not board.field_name:
			frappe.throw(_("Kanban Board is not configured correctly."))

		meta = frappe.get_meta(board.reference_doctype)
		status_field = meta.get_field(board.field_name)
		if not status_field:
			frappe.throw(_("Invalid Kanban status field."))

		columns = {
			column.column_name
			for column in board.columns
			if column.column_name
		}
		if not columns:
			frappe.throw(_("Kanban Board has no columns."))

		workflow = None
		workflow_state_field = None
		uses_workflow_field = False
		workflow_update_fields = set()

		from frappe.model.workflow import get_workflow_name

		workflow_name = get_workflow_name(board.reference_doctype)
		if workflow_name:
			workflow = frappe.get_cached_doc("Workflow", workflow_name)
			workflow_state_field = workflow.workflow_state_field
			uses_workflow_field = board.field_name == workflow_state_field
			workflow_update_fields = {
				state.update_field
				for state in workflow.states
				if state.update_field
			}

		self.board_name = board_name
		self.ref_doctype = board.reference_doctype
		self.field_name = board.field_name
		self.columns = columns
		self.status_field = status_field
		self.workflow = workflow
		self.workflow_state_field = workflow_state_field
		self.uses_workflow_field = uses_workflow_field
		self.workflow_update_fields = workflow_update_fields

		self._validate_status_field_type()

	def _validate_status_field_type(self):
		fieldtype = self.status_field.fieldtype
		if fieldtype == "Select":
			return
		if fieldtype == "Link" and self.status_field.options == "Workflow State":
			return
		frappe.throw(_("The Kanban status field cannot be updated."))


def _user_roles(user=None):
	return set(frappe.get_roles(user or frappe.session.user))


def _can_edit_in_workflow_state(workflow, state_name, user=None):
	if (user or frappe.session.user) == "Administrator":
		return True
	for state in workflow.states:
		if state.state == state_name:
			allow_edit = state.allow_edit or ""
			return bool(_user_roles(user) & set(role.strip() for role in allow_edit.split("\n") if role.strip()))
	return False


def _current_workflow_state(doc, workflow):
	state = doc.get(workflow.workflow_state_field)
	if state:
		return state
	if workflow.states:
		return workflow.states[0].state
	return None


def _field_write_allowed(doc, fieldname, field):
	if field.read_only:
		return False, REASON_FIELD_READONLY

	if field.permlevel:
		permitted = doc.meta.get_permitted_fieldnames(
			user=frappe.session.user,
			permission_type="write",
		)
		if fieldname not in permitted:
			return False, REASON_NO_PERMISSION

	if doc.docstatus == 1 and not field.allow_on_submit:
		return False, REASON_FIELD_READONLY

	if doc.docstatus == 2:
		return False, REASON_FIELD_READONLY

	return True, None


def _ordinary_field_destination_allowed(doc, context, column_name):
	if column_name == doc.get(context.field_name):
		return False, REASON_SAME_COLUMN, None

	if column_name not in context.columns:
		return False, REASON_INVALID_COLUMN, None

	field = context.status_field
	allowed, reason = _field_write_allowed(doc, context.field_name, field)
	if not allowed:
		return False, reason, None

	if context.workflow:
		current_state = _current_workflow_state(doc, context.workflow)
		if not _can_edit_in_workflow_state(context.workflow, current_state):
			return False, REASON_WORKFLOW_DENIED, None

		if context.field_name == context.workflow_state_field:
			return False, REASON_WORKFLOW_DENIED, None

		if context.field_name in context.workflow_update_fields:
			return False, REASON_FIELD_READONLY, None

	options = [option.strip() for option in (field.options or "").splitlines() if option.strip()]
	if field.fieldtype == "Select" and options and column_name not in options:
		return False, REASON_INVALID_COLUMN, None

	return True, None, {
		"allowed": True,
		"mode": "field_update",
		"actions": [],
	}


def _workflow_transitions_for_destination(doc, context, column_name):
	from frappe.model.workflow import get_transitions, has_approval_access

	user = frappe.session.user
	transitions = []
	for transition in get_transitions(doc, context.workflow):
		if transition.get("next_state") != column_name:
			continue
		if not has_approval_access(user, doc, transition):
			continue
		transitions.append(
			{
				"action": transition.get("action"),
				"next_state": transition.get("next_state"),
			}
		)
	return transitions


def _workflow_destination_allowed(doc, context, column_name):
	if column_name == doc.get(context.field_name):
		return False, REASON_SAME_COLUMN, None

	if column_name not in context.columns:
		return False, REASON_INVALID_COLUMN, None

	actions = _workflow_transitions_for_destination(doc, context, column_name)
	if not actions:
		return False, REASON_WORKFLOW_DENIED, None

	return True, None, {
		"allowed": True,
		"mode": "workflow",
		"actions": actions,
	}


def _destination_policy(doc, context, column_name):
	if context.uses_workflow_field:
		return _workflow_destination_allowed(doc, context, column_name)
	return _ordinary_field_destination_allowed(doc, context, column_name)


def _attach_missing_mandatory(doc, context, column_name, destination):
	if not destination.get("allowed"):
		return destination

	workflow_action = None
	if destination.get("mode") == "workflow" and len(destination.get("actions") or []) == 1:
		workflow_action = destination["actions"][0]["action"]

	preview = build_preview_doc(
		doc,
		context.field_name,
		column_name,
		context.workflow,
		workflow_action,
	)
	missing = get_missing_mandatory_fields(preview)
	destination = dict(destination)
	destination["missing_mandatory"] = missing
	if missing:
		destination["allowed"] = False
		destination["reason"] = REASON_MISSING_MANDATORY
	return destination


def get_card_move_policy(doc, context):
	doc.check_permission("read")
	can_drag = False
	destinations = {}

	try:
		doc.check_permission("write")
	except frappe.PermissionError:
		return {
			"can_drag": False,
			"destinations": {
				column: {
					"allowed": False,
					"reason": REASON_NO_PERMISSION,
					"mode": "workflow" if context.uses_workflow_field else "field_update",
					"actions": [],
					"missing_mandatory": [],
				}
				for column in sorted(context.columns)
			},
		}

	for column_name in sorted(context.columns):
		allowed, reason, payload = _destination_policy(doc, context, column_name)
		if not allowed:
			destinations[column_name] = {
				"allowed": False,
				"reason": reason,
				"mode": "workflow" if context.uses_workflow_field else "field_update",
				"actions": [],
				"missing_mandatory": [],
			}
			continue

		destinations[column_name] = _attach_missing_mandatory(doc, context, column_name, payload)
		if destinations[column_name]["allowed"]:
			can_drag = True

	return {"can_drag": can_drag, "destinations": destinations}


def _quick_entry_fieldnames(meta):
	fieldnames = set()
	for field in meta.fields:
		if field.fieldtype == "Tab Break":
			continue
		if field.read_only or field.is_virtual:
			continue
		if field.reqd or field.allow_in_quick_entry:
			fieldnames.add(field.fieldname)
	if (meta.autoname or "").lower() == "prompt":
		fieldnames.add("__newname")
	return fieldnames


def _frappe_allows_quick_entry(meta):
	if meta.quick_entry != 1:
		return False

	mandatory = [
		field
		for field in meta.fields
		if (field.reqd or field.allow_in_quick_entry)
		and not field.read_only
		and not field.is_virtual
		and field.fieldtype != "Tab Break"
	]
	if any(field.fieldtype in ("Table", "Table MultiSelect") for field in mandatory):
		return False
	if not mandatory:
		return False
	if len(mandatory) > 7:
		return False
	return True


def _resolve_create_form_mode(meta, missing_fieldnames):
	if not _frappe_allows_quick_entry(meta):
		return "full_form"

	quick_entry_fields = _quick_entry_fieldnames(meta)
	if any(fieldname not in quick_entry_fields for fieldname in missing_fieldnames):
		return "full_form"
	return "quick_entry"


def _column_create_allowed(context, column_name):
	if not frappe.has_permission(context.ref_doctype, "create"):
		return False, REASON_NO_PERMISSION

	if column_name not in context.columns:
		return False, REASON_INVALID_COLUMN

	field = context.status_field
	options = [option.strip() for option in (field.options or "").splitlines() if option.strip()]
	if field.fieldtype == "Select" and options and column_name not in options:
		return False, REASON_INVALID_COLUMN

	if context.workflow and not _can_edit_in_workflow_state(context.workflow, column_name):
		return False, REASON_WORKFLOW_DENIED

	return True, None


def get_column_create_policy(context, column_name):
	allowed, reason = _column_create_allowed(context, column_name)
	if not allowed:
		return {
			"allowed": False,
			"reason": reason,
			"missing_mandatory": [],
			"missing_fieldnames": [],
			"form_mode": "blocked",
		}

	meta = frappe.get_meta(context.ref_doctype)
	preview = build_create_preview_doc(
		context.ref_doctype,
		context.field_name,
		column_name,
		context.workflow,
	)
	missing_fieldnames = get_missing_mandatory_fieldnames(preview)
	missing_mandatory = get_missing_mandatory_fields(preview)
	form_mode = _resolve_create_form_mode(meta, missing_fieldnames)

	return {
		"allowed": True,
		"reason": None,
		"missing_mandatory": missing_mandatory,
		"missing_fieldnames": missing_fieldnames,
		"form_mode": form_mode,
	}


def get_create_options(board_name):
	context = BoardContext(board_name)
	if not frappe.has_permission(context.ref_doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	return {
		column_name: get_column_create_policy(context, column_name)
		for column_name in sorted(context.columns)
	}


def get_move_options(board_name, names):
	names = frappe.parse_json(names) if isinstance(names, str) else names
	if not isinstance(names, list):
		frappe.throw(_("Card names must be a list."))

	unique_names = []
	seen = set()
	for name in names:
		if not name or name in seen:
			continue
		seen.add(name)
		unique_names.append(name)
		if len(unique_names) > MOVE_OPTIONS_BATCH_LIMIT:
			frappe.throw(
				_("You can request move options for at most {0} cards at once.").format(
					MOVE_OPTIONS_BATCH_LIMIT
				)
			)

	context = BoardContext(board_name)
	if not frappe.has_permission(context.ref_doctype, "read"):
		frappe.throw(_("You cannot read this document type."), frappe.PermissionError)

	results = {}
	for name in unique_names:
		if not frappe.has_permission(context.ref_doctype, "read", doc=name):
			continue
		doc = frappe.get_doc(context.ref_doctype, name)
		try:
			results[name] = get_card_move_policy(doc, context)
		except Exception:
			frappe.logger("quick_kanban").error(
				"Failed to build move policy for %s %s",
				context.ref_doctype,
				name,
				exc_info=True,
			)
			results[name] = {
				"can_drag": False,
				"destinations": {
					column: {
						"allowed": False,
						"reason": "no_permission",
						"mode": "workflow" if context.uses_workflow_field else "field_update",
						"actions": [],
						"missing_mandatory": [],
					}
					for column in sorted(context.columns)
				},
			}

	return results


def apply_workflow_transition(doc, action, workflow):
	from frappe.core.doctype.submission_queue.submission_queue import queue_submission
	from frappe.model.docstatus import DocStatus
	from frappe.model.workflow import get_transitions, has_approval_access
	from frappe.utils.scheduler import is_scheduler_inactive

	transitions = get_transitions(doc, workflow)
	user = frappe.session.user
	transition = None
	for row in transitions:
		if row.get("action") == action:
			transition = row

	if not transition:
		frappe.throw(_("Not a valid Workflow Action"), frappe.ValidationError)

	if not has_approval_access(user, doc, transition):
		frappe.throw(_("Self approval is not allowed"))

	doc.set(workflow.workflow_state_field, transition.get("next_state"))
	next_state = next(state for state in workflow.states if state.state == transition.get("next_state"))

	if next_state.update_field:
		doc.set(next_state.update_field, next_state.update_value)

	new_docstatus = DocStatus(next_state.doc_status or 0)
	if doc.docstatus.is_draft() and new_docstatus.is_draft():
		doc.save()
	elif doc.docstatus.is_draft() and new_docstatus.is_submitted():
		if doc.meta.queue_in_background and not is_scheduler_inactive():
			queue_submission(doc, "Submit")
			return doc
		doc.submit()
	elif doc.docstatus.is_submitted() and new_docstatus.is_submitted():
		doc.save()
	elif doc.docstatus.is_submitted() and new_docstatus.is_cancelled():
		doc.cancel()
	else:
		frappe.throw(_("Illegal Document Status for {0}").format(next_state.state))

	doc.add_comment("Workflow", _(next_state.state))
	return doc


def resolve_workflow_action(doc, context, value, workflow_action=None):
	actions = _workflow_transitions_for_destination(doc, context, value)
	if not actions:
		frappe.throw(_("Workflow State transition not allowed."), frappe.PermissionError)

	if len(actions) == 1:
		selected = actions[0]["action"]
	elif workflow_action:
		matching = [action for action in actions if action["action"] == workflow_action]
		if not matching:
			frappe.throw(_("Not a valid Workflow Action"), frappe.ValidationError)
		selected = workflow_action
	else:
		frappe.throw(_("Select a Workflow Action"), frappe.ValidationError)

	return selected


def assert_move_allowed(doc, context, value, workflow_action=None):
	if value not in context.columns:
		frappe.throw(_("Invalid Kanban column: {0}").format(value))

	if context.uses_workflow_field:
		resolve_workflow_action(doc, context, value, workflow_action)
		return "workflow"

	allowed, reason, _payload = _ordinary_field_destination_allowed(doc, context, value)
	if not allowed:
		if reason == REASON_WORKFLOW_DENIED:
			frappe.throw(_("You are not allowed to edit this document in the current Workflow State."))
		if reason == REASON_NO_PERMISSION:
			frappe.throw(_("You cannot update the Kanban status field."), frappe.PermissionError)
		if reason == REASON_FIELD_READONLY:
			frappe.throw(_("The Kanban status field cannot be updated."))
		frappe.throw(_("This move is not allowed."))

	return "field_update"


def assert_lane_change_allowed(doc, swimlane_field, mode):
	"""Enforce field/workflow/assign rules before swimlane membership changes."""
	from quick_kanban.swimlane import SWIMLANE_ASSIGN

	doc.check_permission("write")

	if mode == "assign" or swimlane_field == SWIMLANE_ASSIGN:
		# Assign To uses Desk assign APIs; require document write (already checked).
		return

	field = doc.meta.get_field(swimlane_field)
	if not field:
		frappe.throw(_("Invalid swimlane field: {0}").format(swimlane_field))

	allowed, reason = _field_write_allowed(doc, swimlane_field, field)
	if not allowed:
		if reason == REASON_NO_PERMISSION:
			frappe.throw(
				_("You cannot update the swimlane field."),
				frappe.PermissionError,
			)
		frappe.throw(_("The swimlane field cannot be updated."))

	from frappe.model.workflow import get_workflow_name

	workflow_name = get_workflow_name(doc.doctype)
	if not workflow_name:
		return

	workflow = frappe.get_cached_doc("Workflow", workflow_name)
	current_state = _current_workflow_state(doc, workflow)
	if not _can_edit_in_workflow_state(workflow, current_state):
		frappe.throw(
			_("You are not allowed to edit this document in the current Workflow State.")
		)
