from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from dinext_kanban.api import get_move_options, move_card
from dinext_kanban.move_policy import BoardContext


BOARD_NAME = "Dinext Kanban ToDo Test Board"


def ensure_todo_kanban_board():
	if frappe.db.exists("Kanban Board", BOARD_NAME):
		return BOARD_NAME

	board = frappe.get_doc(
		{
			"doctype": "Kanban Board",
			"kanban_board_name": BOARD_NAME,
			"reference_doctype": "ToDo",
			"field_name": "status",
			"columns": [
				{"column_name": "Open"},
				{"column_name": "Closed"},
			],
		}
	).insert(ignore_permissions=True)
	return board.name


class TestMovePolicyAPI(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.board_name = ensure_todo_kanban_board()

	def insert_open_todo(self, description="Dinext Kanban policy test"):
		return frappe.get_doc(
			{
				"doctype": "ToDo",
				"description": description,
				"status": "Open",
			}
		).insert()

	def test_get_move_options_returns_destinations(self):
		todo = self.insert_open_todo()
		result = get_move_options(self.board_name, [todo.name])
		self.assertIn(todo.name, result)
		self.assertTrue(result[todo.name]["can_drag"])
		self.assertTrue(result[todo.name]["destinations"]["Closed"]["allowed"])

	def test_move_card_uses_board_context(self):
		todo = self.insert_open_todo()
		original_modified = todo.modified
		result = move_card(self.board_name, todo.name, "Closed", str(todo.modified))
		self.assertEqual(result["status"], "Closed")
		self.assertEqual(frappe.db.get_value("ToDo", todo.name, "status"), "Closed")
		self.assertGreater(frappe.utils.get_datetime(result["modified"]), frappe.utils.get_datetime(original_modified))

	def test_move_card_rejects_invalid_column(self):
		todo = self.insert_open_todo()
		with self.assertRaises(frappe.ValidationError):
			move_card(self.board_name, todo.name, "NotAStatus", str(todo.modified))
		self.assertEqual(frappe.db.get_value("ToDo", todo.name, "status"), "Open")

	def test_get_move_options_requires_doctype_read_permission(self):
		todo = self.insert_open_todo()
		# ToDo grants read to role All; patch denies only ToDo read so BoardContext
		# can still load the Kanban Board while the API deny-path is exercised.
		real_has_permission = frappe.has_permission

		def deny_todo_read(doctype, ptype="read", *args, **kwargs):
			if doctype == "ToDo" and ptype == "read":
				return False
			return real_has_permission(doctype, ptype, *args, **kwargs)

		with patch("frappe.has_permission", side_effect=deny_todo_read):
			with self.assertRaises(frappe.PermissionError):
				get_move_options(self.board_name, [todo.name])

	def test_board_context_detects_select_field(self):
		context = BoardContext(self.board_name)
		self.assertEqual(context.ref_doctype, "ToDo")
		self.assertEqual(context.field_name, "status")
		self.assertIn("Open", context.columns)

	def test_batch_limit_rejects_oversized_requests(self):
		names = [f"TODO-{index}" for index in range(60)]
		with self.assertRaises(frappe.ValidationError):
			get_move_options(self.board_name, names)
