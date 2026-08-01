import re

import frappe
from frappe import _

SKIP_FIELD_TYPES = frozenset(
	{
		"Section Break",
		"Column Break",
		"Tab Break",
		"HTML",
		"Heading",
		"Fold",
	}
)

TABLE_FIELD_TYPES = frozenset({"Table", "Table MultiSelect"})


def _normalize_client_eval_expression(code):
	code = code.strip()
	code = code.replace("&&", " and ").replace("||", " or ")
	code = re.sub(r"!\s*(doc\b|\()", r"not \1", code)
	return code


def _doc_eval_dict(doc):
	if hasattr(doc, "as_dict") and callable(getattr(doc, "as_dict", None)):
		return frappe._dict(doc.as_dict())
	return frappe._dict(doc)


def _eval_context(doc, parent):
	doc_dict = _doc_eval_dict(doc)
	if parent is None:
		parent_dict = doc_dict
	else:
		parent_dict = _doc_eval_dict(parent)

	return {"doc": doc_dict, "parent": parent_dict}


def _eval_mandatory_depends_on(expression, doc, parent):
	if expression is None:
		return False
	if isinstance(expression, bool):
		return expression
	if isinstance(expression, int):
		return bool(expression)
	if not isinstance(expression, str):
		return bool(expression)

	expression = expression.strip()
	if expression.startswith("eval:"):
		code = _normalize_client_eval_expression(expression[5:])
		try:
			return bool(
				frappe.safe_eval(
					code,
					None,
					_eval_context(doc, parent),
				)
			)
		except Exception:
			frappe.logger("dinext_kanban").debug(
				"Could not evaluate mandatory_depends_on: %s",
				expression,
				exc_info=True,
			)
			return False

	value = doc.get(expression) if hasattr(doc, "get") else doc[expression]
	if isinstance(value, (list, tuple)):
		return bool(value)
	return bool(value)


def is_field_mandatory(doc, field, parent=None):
	if field.mandatory_depends_on:
		return _eval_mandatory_depends_on(field.mandatory_depends_on, doc, parent or doc)
	return bool(field.reqd)


def _has_text_content(value, field):
	from frappe.utils import cstr, strip_html

	value = cstr(value)
	has_text_content = strip_html(value).strip()
	has_img_tag = "<img" in value
	has_text_or_img_tag = has_text_content or has_img_tag

	if field.fieldtype == "Text Editor" and has_text_or_img_tag:
		return True
	if field.fieldtype == "Code" and field.options == "HTML" and has_text_or_img_tag:
		return True
	return bool(has_text_content)


def has_field_value(doc, field):
	value = doc.get(field.fieldname)
	if field.fieldtype in TABLE_FIELD_TYPES:
		if not isinstance(value, list):
			return False
		return bool(value)
	if value in (None, []):
		return False
	return _has_text_content(value, field)


def get_missing_mandatory_field_details(doc, parent=None):
	if getattr(doc, "docstatus", 0) == 2:
		return []

	missing = []
	meta = doc.meta
	for field in meta.fields:
		if not field.fieldname or field.fieldtype in SKIP_FIELD_TYPES:
			continue
		if not is_field_mandatory(doc, field, parent):
			continue
		if has_field_value(doc, field):
			continue
		label = field.label or field.fieldname
		missing.append(
			{
				"fieldname": field.fieldname,
				"label": _(label, context=field.parent),
			}
		)

	for table_field in meta.get_table_fields():
		rows = doc.get(table_field.fieldname) or []
		for row in rows:
			if hasattr(row, "as_dict"):
				row_doc = row
			else:
				row_doc = frappe.get_doc(
					{
						"doctype": table_field.options,
						"parent": doc.name,
						"parenttype": doc.doctype,
						"parentfield": table_field.fieldname,
						**row,
					}
				)
			missing.extend(get_missing_mandatory_field_details(row_doc, parent=doc))

	return missing


def get_missing_mandatory_fields(doc, parent=None):
	return [row["label"] for row in get_missing_mandatory_field_details(doc, parent)]


def get_missing_mandatory_fieldnames(doc, parent=None):
	return [row["fieldname"] for row in get_missing_mandatory_field_details(doc, parent)]


def build_create_preview_doc(doctype, fieldname, value, workflow=None):
	doc = frappe.new_doc(doctype)
	if workflow and workflow.workflow_state_field == fieldname:
		doc.set(fieldname, value)
		next_state = _get_workflow_state_row(workflow, value)
		if next_state and next_state.update_field:
			doc.set(next_state.update_field, next_state.update_value)
	else:
		doc.set(fieldname, value)
	return doc


def build_preview_doc(doc, fieldname, value, workflow=None, workflow_action=None):
	preview = frappe.copy_doc(doc)
	if workflow and workflow.workflow_state_field == fieldname:
		transitions = _matching_workflow_transitions(doc, workflow, value, workflow_action)
		if not transitions:
			return preview
		transition = transitions[0]
		preview.set(workflow.workflow_state_field, transition.next_state)
		next_state = _get_workflow_state_row(workflow, transition.next_state)
		if next_state and next_state.update_field:
			preview.set(next_state.update_field, next_state.update_value)
	else:
		preview.set(fieldname, value)
	return preview


def validate_mandatory_for_move(doc, fieldname, value, workflow=None, workflow_action=None):
	preview = build_preview_doc(doc, fieldname, value, workflow, workflow_action)
	missing = get_missing_mandatory_fields(preview)
	if missing:
		frappe.throw(
			_("Mandatory fields required: {0}").format(", ".join(missing)),
			frappe.MandatoryError,
		)


def _matching_workflow_transitions(doc, workflow, next_state, workflow_action=None):
	from frappe.model.workflow import get_transitions, has_approval_access

	user = frappe.session.user
	matches = []
	for transition in get_transitions(doc, workflow):
		if transition.get("next_state") != next_state:
			continue
		if workflow_action and transition.get("action") != workflow_action:
			continue
		if not has_approval_access(user, doc, transition):
			continue
		matches.append(transition)
	return matches


def _get_workflow_state_row(workflow, state):
	for row in workflow.states:
		if row.state == state:
			return row
	return None
