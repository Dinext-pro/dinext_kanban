import frappe
from frappe.tests.utils import FrappeTestCase

from quick_kanban.api import get_create_options
from quick_kanban.move_policy import BoardContext, get_column_create_policy

from quick_kanban.tests.test_move_policy import BOARD_NAME, ensure_todo_kanban_board


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
		guest_user = "guest@example.com"
		if not frappe.db.exists("User", guest_user):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": guest_user,
					"first_name": "Guest",
					"send_welcome_email": 0,
				}
			).insert(ignore_permissions=True)

		frappe.set_user(guest_user)
		with self.assertRaises(frappe.PermissionError):
			get_create_options(self.board_name)
