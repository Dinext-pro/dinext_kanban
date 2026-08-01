import frappe
from frappe.tests.utils import FrappeTestCase

from dinext_kanban.validation import (
	_eval_mandatory_depends_on,
	_normalize_client_eval_expression,
	get_missing_mandatory_fields,
	is_field_mandatory,
	validate_mandatory_for_move,
)


class TestMoveValidation(FrappeTestCase):
	def test_is_field_mandatory_static_reqd(self):
		field = frappe._dict(reqd=1, mandatory_depends_on=None)
		doc = frappe._dict()
		self.assertTrue(is_field_mandatory(doc, field))

	def test_is_field_mandatory_depends_on_fieldname(self):
		field = frappe._dict(reqd=0, mandatory_depends_on="needs_review")
		self.assertTrue(is_field_mandatory(frappe._dict(needs_review=1), field))
		self.assertFalse(is_field_mandatory(frappe._dict(needs_review=0), field))

	def test_validate_mandatory_for_move_raises_for_empty_description(self):
		doc = frappe.get_doc(
			{
				"doctype": "ToDo",
				"description": "Has text",
				"status": "Open",
			}
		)
		doc.description = ""
		with self.assertRaises(frappe.MandatoryError):
			validate_mandatory_for_move(doc, "status", "Closed")

	def test_get_missing_mandatory_fields_includes_description(self):
		doc = frappe.get_doc(
			{
				"doctype": "ToDo",
				"description": "",
				"status": "Open",
			}
		)
		missing = get_missing_mandatory_fields(doc)
		self.assertTrue(missing)

	def test_normalize_client_eval_expression(self):
		code = "((doc.type == 'Phase'||doc.type == 'Stage') && !doc.is_template)"
		normalized = _normalize_client_eval_expression(code)
		self.assertIn(" and ", normalized)
		self.assertIn(" or ", normalized)
		self.assertIn("not doc.is_template", normalized)

	def test_eval_mandatory_depends_on_client_syntax(self):
		doc = frappe.get_doc(
			{
				"doctype": "ToDo",
				"description": "Sample",
				"status": "Open",
			}
		)
		field = frappe._dict(reqd=0, mandatory_depends_on="eval:doc.status=='Closed'")
		self.assertFalse(_eval_mandatory_depends_on(field.mandatory_depends_on, doc, doc))
		doc.status = "Closed"
		self.assertTrue(_eval_mandatory_depends_on(field.mandatory_depends_on, doc, doc))

	def test_eval_mandatory_depends_on_js_operators(self):
		doc = frappe._dict(type="Phase", is_template=0)
		expression = (
			"eval:((doc.type == 'Phase'||doc.type == 'Stage'||doc.type == 'Sprint') && !doc.is_template)"
		)
		self.assertTrue(_eval_mandatory_depends_on(expression, doc, doc))
		doc.is_template = 1
		self.assertFalse(_eval_mandatory_depends_on(expression, doc, doc))
