from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

import frappe
from frappe.cache_manager import clear_controller_cache
from frappe.desk.doctype.todo.todo import ToDo
from frappe.tests.utils import FrappeTestCase, patch_hooks
from frappe.utils import get_datetime

from quick_kanban.api import (
    get_column_totals,
    move_card,
    set_column_widths,
    update_column_order,
)
from quick_kanban.tests.test_move_policy import BOARD_NAME, ensure_todo_kanban_board
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
        board_name = ensure_todo_kanban_board()
        todo = frappe.get_doc(
            {
                "doctype": "ToDo",
                "description": "Quick Kanban move test",
                "status": "Open",
            }
        ).insert()

        result = move_card(
            board_name,
            todo.name,
            "Closed",
            str(todo.modified),
        )

        self.assertEqual(result["status"], "Closed")
        self.assertEqual(frappe.db.get_value("ToDo", todo.name, "status"), "Closed")

    @patch("quick_kanban.api.assert_move_allowed", return_value="field_update")
    @patch("quick_kanban.api.validate_mandatory_for_move")
    @patch("quick_kanban.api.BoardContext")
    @patch("quick_kanban.api.frappe.get_doc")
    def test_move_card_checks_permission_and_saves(
        self, get_doc, board_context, validate_mandatory, assert_move_allowed
    ):
        doc = self.make_doc()
        get_doc.return_value = doc
        board_context.return_value = SimpleNamespace(
            ref_doctype="Task",
            field_name="status",
            workflow=None,
        )

        result = move_card(
            BOARD_NAME,
            "TASK-1",
            "Done",
            "2026-07-10 10:00:00",
        )

        doc.check_permission.assert_called_once_with("write")
        doc.save.assert_called_once()
        self.assertEqual(result["status"], "Done")

    @patch("quick_kanban.api.BoardContext")
    @patch("quick_kanban.api.frappe.get_doc")
    def test_move_card_rejects_stale_documents(self, get_doc, board_context):
        get_doc.return_value = self.make_doc()
        board_context.return_value = SimpleNamespace(
            ref_doctype="Task",
            field_name="status",
            workflow=None,
        )

        with self.assertRaises(frappe.TimestampMismatchError):
            move_card(
                BOARD_NAME,
                "TASK-1",
                "Done",
                "2026-07-10 11:00:00",
            )

    @patch("quick_kanban.api.assert_move_allowed")
    @patch("quick_kanban.api.BoardContext")
    @patch("quick_kanban.api.frappe.get_doc")
    def test_move_card_enforces_field_permission_level(
        self, get_doc, board_context, assert_move_allowed
    ):
        doc = self.make_doc()
        get_doc.return_value = doc
        board_context.return_value = SimpleNamespace(
            ref_doctype="Task",
            field_name="status",
            workflow=None,
        )
        assert_move_allowed.side_effect = frappe.PermissionError

        with self.assertRaises(frappe.PermissionError):
            move_card(BOARD_NAME, "TASK-1", "Done")


class TestMoveCardLifecycle(FrappeTestCase):
    def setUp(self):
        reset_move_card_trackers()
        frappe.set_user("Administrator")
        frappe.cache.delete_value("app_hooks")
        clear_controller_cache("ToDo")

    def tearDown(self):
        frappe.cache.delete_value("app_hooks")
        clear_controller_cache("ToDo")

    def insert_open_todo(self, description="Quick Kanban lifecycle test"):
        return frappe.get_doc(
            {
                "doctype": "ToDo",
                "description": description,
                "status": "Open",
            }
        ).insert()

    def test_move_card_runs_full_document_lifecycle(self):
        board_name = ensure_todo_kanban_board()
        with patch_hooks(
            {
                "override_doctype_class": {
                    "ToDo": ["quick_kanban.tests.test_api.LifecycleTrackingToDo"],
                },
            }
        ):
            frappe.cache.delete_value("app_hooks")
            clear_controller_cache("ToDo")

            todo = self.insert_open_todo()
            original_modified = todo.modified

            result = move_card(
                board_name,
                todo.name,
                "Closed",
                str(todo.modified),
            )

        self.assertEqual(result["status"], "Closed")
        self.assertEqual(frappe.db.get_value("ToDo", todo.name, "status"), "Closed")
        self.assertIn("validate", _lifecycle_events)
        self.assertIn("before_save", _lifecycle_events)
        self.assertIn("on_update", _lifecycle_events)
        self.assertLess(
            _lifecycle_events.index("validate"),
            _lifecycle_events.index("on_update"),
        )
        self.assertGreater(get_datetime(result["modified"]), get_datetime(original_modified))

    def clear_doc_event_cache(self):
        if hasattr(frappe.local, "doc_events_hooks"):
            del frappe.local.doc_events_hooks

    def test_move_card_triggers_doc_events_on_update(self):
        board_name = ensure_todo_kanban_board()
        with patch_hooks(
            {
                "doc_events": {
                    "ToDo": {
                        "on_update": [
                            "quick_kanban.tests.test_api.track_move_card_doc_event",
                        ],
                    },
                },
            }
        ):
            self.clear_doc_event_cache()
            todo = self.insert_open_todo()
            reset_move_card_trackers()

            move_card(
                board_name,
                todo.name,
                "Closed",
                str(todo.modified),
            )

        self.assertEqual(len(_doc_event_calls), 1)
        self.assertEqual(_doc_event_calls[0]["doctype"], "ToDo")
        self.assertEqual(_doc_event_calls[0]["name"], todo.name)
        self.assertEqual(_doc_event_calls[0]["status"], "Closed")

    def test_move_card_rolls_back_when_validate_rejects(self):
        board_name = ensure_todo_kanban_board()
        with patch_hooks(
            {
                "override_doctype_class": {
                    "ToDo": ["quick_kanban.tests.test_api.BlockingMoveToDo"],
                },
                "doc_events": {
                    "ToDo": {
                        "on_update": [
                            "quick_kanban.tests.test_api.track_move_card_doc_event",
                        ],
                    },
                },
            }
        ):
            frappe.cache.delete_value("app_hooks")
            clear_controller_cache("ToDo")
            self.clear_doc_event_cache()

            todo = self.insert_open_todo("BLOCK_MOVE should fail")
            reset_move_card_trackers()

            with self.assertRaises(frappe.ValidationError):
                move_card(
                    board_name,
                    todo.name,
                    "Closed",
                    str(todo.modified),
                )

        self.assertEqual(frappe.db.get_value("ToDo", todo.name, "status"), "Open")
        self.assertFalse(
            any(call["status"] == "Closed" for call in _doc_event_calls),
            _doc_event_calls,
        )

    def test_move_card_rejects_invalid_column_value(self):
        board_name = ensure_todo_kanban_board()
        todo = self.insert_open_todo()

        with self.assertRaises(frappe.ValidationError):
            move_card(
                board_name,
                todo.name,
                "NotAStatus",
                str(todo.modified),
            )

        self.assertEqual(frappe.db.get_value("ToDo", todo.name, "status"), "Open")

    @patch("quick_kanban.api.assert_move_allowed")
    @patch("quick_kanban.api.BoardContext")
    @patch("quick_kanban.api.frappe.get_doc")
    def test_move_card_rejects_read_only_status_field(self, get_doc, board_context, assert_move_allowed):
        assert_move_allowed.side_effect = frappe.ValidationError("read only")
        doc = self.make_doc()
        get_doc.return_value = doc
        board_context.return_value = SimpleNamespace(
            ref_doctype="Task",
            field_name="status",
            workflow=None,
        )

        with self.assertRaises(frappe.ValidationError):
            move_card(BOARD_NAME, "TASK-1", "Done")

        doc.save.assert_not_called()

    def test_move_card_persists_through_document_save(self):
        import inspect

        source = inspect.getsource(move_card)
        self.assertIn("frappe.get_doc", source)
        self.assertIn("doc.save()", source)
        self.assertNotIn("set_value", source)
        self.assertNotIn("db_set", source)
        self.assertNotIn("db.sql", source)

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


_lifecycle_events = []
_doc_event_calls = []


def reset_move_card_trackers():
    global _lifecycle_events, _doc_event_calls
    _lifecycle_events = []
    _doc_event_calls = []


def track_move_card_doc_event(doc, method=None):
    _doc_event_calls.append(
        {
            "doctype": doc.doctype,
            "name": doc.name,
            "status": doc.status,
            "method": method,
        }
    )


class LifecycleTrackingToDo(ToDo):
    def validate(self):
        _lifecycle_events.append("validate")
        super().validate()

    def before_save(self):
        _lifecycle_events.append("before_save")

    def on_update(self):
        _lifecycle_events.append("on_update")
        super().on_update()


class BlockingMoveToDo(ToDo):
    def validate(self):
        if self.status == "Closed" and (self.description or "").startswith("BLOCK_MOVE"):
            frappe.throw("Move blocked by validation", frappe.ValidationError)
        super().validate()


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


class TestColumnWidths(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self.board_name = ensure_todo_kanban_board()

    def test_set_column_widths_persists_on_board_columns(self):
        board = set_column_widths(self.board_name, {"Open": 320, "Closed": 280})
        widths = {
            column.column_name: column.custom_column_width for column in board.columns
        }
        self.assertEqual(widths["Open"], 320)
        self.assertEqual(widths["Closed"], 280)

        reloaded = frappe.get_doc("Kanban Board", self.board_name)
        reloaded_widths = {
            column.column_name: column.custom_column_width for column in reloaded.columns
        }
        self.assertEqual(reloaded_widths["Open"], 320)
        self.assertEqual(reloaded_widths["Closed"], 280)

    def test_set_column_widths_rejects_out_of_range_values(self):
        with self.assertRaises(frappe.ValidationError):
            set_column_widths(self.board_name, {"Open": 0})
        with self.assertRaises(frappe.ValidationError):
            set_column_widths(self.board_name, {"Open": 10001})

    def test_set_column_widths_requires_board_write(self):
        board = Mock()
        board.columns = [SimpleNamespace(column_name="Open", custom_column_width=250)]
        board.check_permission.side_effect = frappe.PermissionError

        with patch("quick_kanban.api.frappe.get_doc", return_value=board):
            with self.assertRaises(frappe.PermissionError):
                set_column_widths(self.board_name, {"Open": 300})

        board.check_permission.assert_called_once_with("write")
        board.save.assert_not_called()

    def test_update_column_order_preserves_custom_column_width(self):
        set_column_widths(self.board_name, {"Open": 333, "Closed": 222})
        board = update_column_order(
            self.board_name,
            frappe.as_json(["Closed", "Open"]),
        )
        widths = {
            column.column_name: column.custom_column_width for column in board.columns
        }
        self.assertEqual(
            [column.column_name for column in board.columns][:2],
            ["Closed", "Open"],
        )
        self.assertEqual(widths["Open"], 333)
        self.assertEqual(widths["Closed"], 222)

    def test_override_whitelisted_update_column_order_is_registered(self):
        self.assertEqual(
            hooks.override_whitelisted_methods[
                "frappe.desk.doctype.kanban_board.kanban_board.update_column_order"
            ],
            "quick_kanban.api.update_column_order",
        )


class TestDeskAssets(FrappeTestCase):
    def test_bootstrap_is_the_only_global_desk_script(self):
        self.assertEqual(len(hooks.app_include_js), 1)
        self.assertTrue(
            hooks.app_include_js[0].startswith("/assets/quick_kanban/js/kanban_bootstrap.js")
        )
        self.assertFalse(getattr(hooks, "app_include_css", None))
