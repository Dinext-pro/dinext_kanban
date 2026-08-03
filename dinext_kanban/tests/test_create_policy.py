from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from dinext_kanban.api import get_create_options
from dinext_kanban.move_policy import BoardContext, get_column_create_policy

from dinext_kanban.tests.test_move_policy import ensure_todo_kanban_board


class TestCreatePolicy(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.board_name = ensure_todo_kanban_board()
		self.context = BoardContext(self.board_name)

	def test_get_create_options_returns_form_mode_per_column(self):
		result = get_create_options(self.board_name)
		self.assertIn("Open", result)
		self.assertIn("Closed", result)
		self.assertTrue(result["Open"]["allowed"])
		self.assertIn(result["Open"]["form_mode"], ("quick_entry", "full_form", "blocked"))
		self.assertIsInstance(result["Open"]["missing_fieldnames"], list)
		self.assertIsInstance(result["Open"]["missing_mandatory"], list)

	def test_get_column_create_policy_allows_open_column(self):
		policy = get_column_create_policy(self.context, "Open")
		self.assertTrue(policy["allowed"])
		self.assertIsNone(policy["reason"])
		self.assertIn(policy["form_mode"], ("quick_entry", "full_form"))

	def test_get_column_create_policy_rejects_invalid_column(self):
		policy = get_column_create_policy(self.context, "NotAStatus")
		self.assertFalse(policy["allowed"])
		self.assertEqual(policy["reason"], "invalid_column")
		self.assertEqual(policy["form_mode"], "blocked")

	def test_get_create_options_requires_doctype_read_permission(self):
		# ToDo grants read to role All; patch denies only ToDo read so BoardContext
		# can still load the Kanban Board while the API deny-path is exercised.
		real_has_permission = frappe.has_permission

		def deny_todo_read(doctype, ptype="read", *args, **kwargs):
			if doctype == "ToDo" and ptype == "read":
				return False
			return real_has_permission(doctype, ptype, *args, **kwargs)

		with patch("frappe.has_permission", side_effect=deny_todo_read):
			with self.assertRaises(frappe.PermissionError):
				get_create_options(self.board_name)
