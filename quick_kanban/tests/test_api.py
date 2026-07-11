from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from quick_kanban.api import get_column_totals, move_card
from quick_kanban import hooks


class TestMoveCard(FrappeTestCase):
    def test_move_card_allows_only_post_requests(self):
        self.assertEqual(
            frappe.allowed_http_methods_for_whitelisted_func[move_card],
            ["POST"],
        )

    def make_doc(self):
        doc = Mock()
        doc.name = "TASK-1"
        doc.modified = datetime(2026, 7, 10, 10, 0, 0)
        doc.meta.get_field.return_value = SimpleNamespace(
            fieldtype="Select",
            options="Open\nDone",
            read_only=False,
            permlevel=0,
        )
        doc.meta.get_permitted_fieldnames.return_value = ["status"]
        doc.get.side_effect = lambda fieldname: getattr(doc, fieldname)
        doc.set.side_effect = lambda fieldname, value: setattr(doc, fieldname, value)
        return doc

    def test_move_real_document(self):
        frappe.set_user("Administrator")
        todo = frappe.get_doc(
            {
                "doctype": "ToDo",
                "description": "Quick Kanban move test",
                "status": "Open",
            }
        ).insert()

        result = move_card(
            "ToDo",
            todo.name,
            "status",
            "Closed",
            str(todo.modified),
        )

        self.assertEqual(result["status"], "Closed")
        self.assertEqual(frappe.db.get_value("ToDo", todo.name, "status"), "Closed")

    @patch("quick_kanban.api.frappe.get_doc")
    def test_move_card_checks_permission_and_saves(self, get_doc):
        doc = self.make_doc()
        get_doc.return_value = doc

        result = move_card(
            "Task",
            "TASK-1",
            "status",
            "Done",
            "2026-07-10 10:00:00",
        )

        doc.check_permission.assert_called_once_with("write")
        doc.save.assert_called_once()
        self.assertEqual(result["status"], "Done")

    @patch("quick_kanban.api.frappe.get_doc")
    def test_move_card_rejects_stale_documents(self, get_doc):
        get_doc.return_value = self.make_doc()

        with self.assertRaises(frappe.TimestampMismatchError):
            move_card(
                "Task",
                "TASK-1",
                "status",
                "Done",
                "2026-07-10 11:00:00",
            )

    @patch("quick_kanban.api.frappe.get_doc")
    def test_move_card_enforces_field_permission_level(self, get_doc):
        doc = self.make_doc()
        doc.meta.get_field.return_value.permlevel = 1
        doc.meta.get_permitted_fieldnames.return_value = []
        get_doc.return_value = doc

        with self.assertRaises(frappe.PermissionError):
            move_card("Task", "TASK-1", "status", "Done")


class TestColumnTotals(FrappeTestCase):
    @patch("quick_kanban.api.frappe.get_list")
    @patch("quick_kanban.api.frappe.get_meta")
    def test_returns_zero_filled_permission_aware_grouped_counts(self, get_meta, get_list):
        meta = Mock()
        meta.get_field.return_value = SimpleNamespace(
            fieldname="status",
            permlevel=0,
        )
        get_meta.return_value = meta
        get_list.return_value = [{"status": "Open", "count": 5}]

        result = get_column_totals(
            "Task",
            "status",
            ["Open", "Done"],
            filters=[["priority", "=", "High"]],
            or_filters=[["owner", "=", "user@example.com"]],
        )

        get_list.assert_called_once_with(
            "Task",
            fields=["status", "count(name) as count"],
            filters=[["priority", "=", "High"]],
            or_filters=[["owner", "=", "user@example.com"]],
            group_by="status",
            limit_page_length=0,
        )
        self.assertEqual(result, {"Open": 5, "Done": 0})


class TestDeskAssets(FrappeTestCase):
    def test_bootstrap_is_the_only_global_desk_script(self):
        self.assertEqual(
            hooks.app_include_js,
            ["/assets/quick_kanban/js/kanban_bootstrap.js"],
        )
        self.assertFalse(getattr(hooks, "app_include_css", None))
