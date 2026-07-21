from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

import frappe
from frappe.cache_manager import clear_controller_cache
from frappe.desk.doctype.todo.todo import ToDo
from frappe.tests.utils import FrappeTestCase, patch_hooks
from frappe.utils import get_datetime

from quick_kanban.api import (
    get_attachment_counts,
    get_board_document_names,
    get_child_counts,
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

    @patch("quick_kanban.api.get_board_document_names", return_value=["PARENT-1", "CHILD-1", "ORPHAN-1"])
    @patch("quick_kanban.api.frappe.get_list")
    @patch("quick_kanban.api.frappe.get_meta")
    @patch("quick_kanban.api.frappe.has_permission", return_value=True)
    def test_hide_board_children_excludes_on_board_children(
        self,
        _has_permission,
        get_meta,
        get_list,
        get_board_names,
    ):
        meta = Mock()
        meta.is_tree = 1
        meta.nsm_parent_field = "parent_task"
        meta.get_field.return_value = SimpleNamespace(fieldname="status", permlevel=0)
        get_meta.return_value = meta
        get_list.return_value = [
            {"name": "PARENT-1", "status": "Open", "parent_task": ""},
            {"name": "CHILD-1", "status": "Open", "parent_task": "PARENT-1"},
            {"name": "ORPHAN-1", "status": "Open", "parent_task": "OFF-BOARD"},
            {"name": "DONE-1", "status": "Done", "parent_task": ""},
        ]

        result = get_column_totals(
            "Task",
            "status",
            ["Open", "Done"],
            filters=[],
            hide_board_children=True,
        )

        get_board_names.assert_called_once()
        get_list.assert_called_once_with(
            "Task",
            fields=["status", "parent_task", "name"],
            filters=[],
            or_filters=[],
            limit_page_length=0,
        )
        self.assertEqual(result, {"Open": 2, "Done": 1})


class TestHiddenBoardChildNames(FrappeTestCase):
    @patch("quick_kanban.board_children.frappe.get_list")
    @patch("quick_kanban.api.get_board_document_names", return_value=["PARENT-1", "CHILD-1", "ORPHAN-1"])
    @patch("quick_kanban.board_children.tree_parent_field", return_value="parent_task")
    def test_returns_only_children_whose_parent_is_on_board(
        self,
        _tree_parent,
        _board_names,
        get_list,
    ):
        from quick_kanban.api import get_hidden_board_child_names

        get_list.return_value = [
            {"name": "PARENT-1", "parent_task": ""},
            {"name": "CHILD-1", "parent_task": "PARENT-1"},
            {"name": "ORPHAN-1", "parent_task": "OFF-BOARD"},
        ]
        names = get_hidden_board_child_names(
            "Task",
            filters=[],
            field_name="status",
            column_values=["Open"],
        )
        self.assertEqual(names, ["CHILD-1"])

    @patch("quick_kanban.board_children.tree_parent_field", return_value=None)
    def test_non_tree_returns_empty(self, _tree_parent):
        from quick_kanban.api import get_hidden_board_child_names

        self.assertEqual(
            get_hidden_board_child_names(
                "ToDo",
                filters=[],
                field_name="status",
                column_values=["Open"],
            ),
            [],
        )


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


class TestGetAttachmentCounts(FrappeTestCase):
    def test_empty_names_returns_empty_dict(self):
        self.assertEqual(get_attachment_counts("ToDo", []), {})
        self.assertEqual(get_attachment_counts("ToDo", "[]"), {})

    def test_counts_files_per_document(self):
        frappe.set_user("Administrator")
        todo_a = frappe.get_doc(
            {
                "doctype": "ToDo",
                "description": "Attachment count A",
                "status": "Open",
            }
        ).insert()
        todo_b = frappe.get_doc(
            {
                "doctype": "ToDo",
                "description": "Attachment count B",
                "status": "Open",
            }
        ).insert()
        for index in range(2):
            frappe.get_doc(
                {
                    "doctype": "File",
                    "file_name": f"count-a-{index}.txt",
                    "content": f"a{index}",
                    "attached_to_doctype": "ToDo",
                    "attached_to_name": todo_a.name,
                    "is_private": 1,
                }
            ).insert()
        frappe.get_doc(
            {
                "doctype": "File",
                "file_name": "count-b-0.txt",
                "content": "b0",
                "attached_to_doctype": "ToDo",
                "attached_to_name": todo_b.name,
                "is_private": 1,
            }
        ).insert()

        counts = get_attachment_counts("ToDo", [todo_a.name, todo_b.name, "MISSING"])
        self.assertEqual(counts[todo_a.name], 2)
        self.assertEqual(counts[todo_b.name], 1)
        self.assertEqual(counts["MISSING"], 0)

    def test_requires_read_permission_on_doctype(self):
        with patch("quick_kanban.api.frappe.has_permission", return_value=False):
            with self.assertRaises(frappe.PermissionError):
                get_attachment_counts("ToDo", ["TASK-1"])


class TestGetChildCounts(FrappeTestCase):
    def test_empty_names_returns_empty_dict(self):
        self.assertEqual(get_child_counts("ToDo", []), {})
        self.assertEqual(get_child_counts("ToDo", "[]"), {})

    def test_non_tree_doctype_returns_empty_dict(self):
        meta = SimpleNamespace(is_tree=0, nsm_parent_field=None)
        with patch("quick_kanban.api.frappe.get_meta", return_value=meta):
            self.assertEqual(get_child_counts("ToDo", ["DOC-1"]), {})

    def test_counts_direct_children_for_tree_doctype(self):
        meta = SimpleNamespace(is_tree=1, nsm_parent_field="parent_task")
        rows = [
            {"parent_task": "PARENT-A"},
            {"parent_task": "PARENT-A"},
            {"parent_task": "PARENT-B"},
        ]
        with (
            patch("quick_kanban.api.frappe.get_meta", return_value=meta),
            patch("quick_kanban.api.frappe.has_permission", return_value=True),
            patch("quick_kanban.api.frappe.get_list", return_value=rows) as get_list,
        ):
            counts = get_child_counts("Task", ["PARENT-A", "PARENT-B", "PARENT-C"])

        self.assertEqual(counts["PARENT-A"], 2)
        self.assertEqual(counts["PARENT-B"], 1)
        self.assertEqual(counts["PARENT-C"], 0)
        get_list.assert_called_once_with(
            "Task",
            filters={"parent_task": ("in", ["PARENT-A", "PARENT-B", "PARENT-C"])},
            fields=["parent_task"],
            limit_page_length=0,
            ignore_permissions=False,
        )

    def test_requires_read_permission_on_tree_doctype(self):
        meta = SimpleNamespace(is_tree=1, nsm_parent_field="parent_task")
        with (
            patch("quick_kanban.api.frappe.get_meta", return_value=meta),
            patch("quick_kanban.api.frappe.has_permission", return_value=False),
        ):
            with self.assertRaises(frappe.PermissionError):
                get_child_counts("Task", ["TASK-1"])


class TestGetBoardDocumentNames(FrappeTestCase):
    def test_empty_columns_returns_empty_list(self):
        with patch("quick_kanban.api.frappe.has_permission", return_value=True):
            self.assertEqual(
                get_board_document_names("Task", filters=[], field_name="status", column_values=[]),
                [],
            )

    def test_returns_names_for_active_columns(self):
        meta = SimpleNamespace(get_field=Mock(return_value=SimpleNamespace(fieldname="status")))
        rows = [{"name": "TASK-1"}, {"name": "TASK-2"}]
        with (
            patch("quick_kanban.api.frappe.get_meta", return_value=meta),
            patch("quick_kanban.api.frappe.has_permission", return_value=True),
            patch("quick_kanban.api.frappe.get_list", return_value=rows) as get_list,
        ):
            names = get_board_document_names(
                "Task",
                filters=[["project", "=", "PROJ"]],
                field_name="status",
                column_values=["Open", "Working"],
            )

        self.assertEqual(names, ["TASK-1", "TASK-2"])
        get_list.assert_called_once_with(
            "Task",
            filters=[["project", "=", "PROJ"], ["status", "in", ["Open", "Working"]]],
            or_filters=[],
            fields=["name"],
            limit_page_length=0,
            ignore_permissions=False,
        )

    def test_requires_read_permission(self):
        with patch("quick_kanban.api.frappe.has_permission", return_value=False):
            with self.assertRaises(frappe.PermissionError):
                get_board_document_names(
                    "Task",
                    filters=[],
                    field_name="status",
                    column_values=["Open"],
                )

    def test_passes_or_filters_to_get_list(self):
        meta = SimpleNamespace(get_field=Mock(return_value=SimpleNamespace(fieldname="status")))
        with (
            patch("quick_kanban.api.frappe.get_meta", return_value=meta),
            patch("quick_kanban.api.frappe.has_permission", return_value=True),
            patch("quick_kanban.api.frappe.get_list", return_value=[]) as get_list,
        ):
            get_board_document_names(
                "Task",
                filters=[["project", "=", "PROJ"]],
                field_name="status",
                column_values=["Open"],
                or_filters=[["subject", "like", "%x%"]],
            )

        get_list.assert_called_once_with(
            "Task",
            filters=[["project", "=", "PROJ"], ["status", "in", ["Open"]]],
            or_filters=[["subject", "like", "%x%"]],
            fields=["name"],
            limit_page_length=0,
            ignore_permissions=False,
        )


class TestGetColumnPage(FrappeTestCase):
    @patch("quick_kanban.api.frappe.has_permission", return_value=True)
    @patch("quick_kanban.swimlane.frappe.get_meta")
    @patch("quick_kanban.swimlane._matching_parent_names")
    @patch("quick_kanban.api.frappe.get_list")
    def test_slices_after_server_side_child_exclude(
        self,
        get_list,
        matching_names,
        get_meta,
        _has_permission,
    ):
        from quick_kanban.api import get_column_page

        meta = Mock()
        meta.is_tree = 1
        meta.nsm_parent_field = "parent_task"
        meta.title_field = "subject"
        get_meta.return_value = meta
        matching_names.return_value = ["PARENT-1", "CHILD-1", "ORPHAN-1"]
        get_list.side_effect = [
            [
                {"name": "PARENT-1", "parent_task": ""},
                {"name": "CHILD-1", "parent_task": "PARENT-1"},
                {"name": "ORPHAN-1", "parent_task": "OFF-BOARD"},
            ],
            [
                {
                    "name": "PARENT-1",
                    "subject": "Parent",
                    "status": "Open",
                    "parent_task": "",
                    "_assign": None,
                    "_user_tags": None,
                    "_comments": None,
                    "_liked_by": None,
                },
                {
                    "name": "ORPHAN-1",
                    "subject": "Orphan",
                    "status": "Open",
                    "parent_task": "OFF-BOARD",
                    "_assign": None,
                    "_user_tags": None,
                    "_comments": None,
                    "_liked_by": None,
                },
            ],
        ]

        with patch(
            "quick_kanban.board_children.board_name_set_for_hide",
            return_value=("parent_task", {"PARENT-1", "CHILD-1", "ORPHAN-1"}),
        ):
            page = get_column_page(
                "Task",
                "status",
                "Open",
                fields=["name", "subject", "status"],
                filters=[],
                start=0,
                page_length=10,
                hide_board_children=True,
                column_values=["Open", "Done"],
            )

        name_idx = page["keys"].index("name")
        names = [row[name_idx] for row in page["values"]]
        self.assertEqual(names, ["PARENT-1", "ORPHAN-1"])
        self.assertIn("parent_task", page["keys"])
        paged_call = get_list.call_args_list[-1]
        self.assertEqual(
            set(paged_call.kwargs["filters"]["name"][1]),
            {"PARENT-1", "ORPHAN-1"},
        )
        self.assertEqual(paged_call.kwargs["start"], 0)
        self.assertEqual(paged_call.kwargs["page_length"], 10)

    @patch("quick_kanban.api.frappe.has_permission", return_value=True)
    @patch("quick_kanban.swimlane.frappe.get_meta")
    def test_ensure_fields_include_tree_parent(self, get_meta, _has_permission):
        from quick_kanban.swimlane import _ensure_card_fetch_fields

        meta = Mock()
        meta.is_tree = 1
        meta.nsm_parent_field = "parent_task"
        meta.title_field = "subject"
        get_meta.return_value = meta

        fields = _ensure_card_fetch_fields(
            ["name", "subject"],
            doctype="Task",
            status_field="status",
        )
        self.assertIn("parent_task", fields)
        self.assertIn("status", fields)


class TestSwimlaneApi(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")

    def test_get_swimlane_field_options_includes_assign(self):
        from quick_kanban.api import get_swimlane_field_options

        options = get_swimlane_field_options("ToDo")
        values = {row["value"] for row in options}
        self.assertIn("__assign", values)

    def test_set_swimlane_field_sets_and_clears(self):
        from quick_kanban.api import set_swimlane_field

        board_name = ensure_todo_kanban_board()
        result = set_swimlane_field(board_name, "__assign")
        self.assertEqual(result["custom_swimlane_field"], "__assign")
        self.assertEqual(
            frappe.db.get_value("Kanban Board", board_name, "custom_swimlane_field"),
            "__assign",
        )

        cleared = set_swimlane_field(board_name, "")
        self.assertEqual(cleared["custom_swimlane_field"], "")
        self.assertIn(
            frappe.db.get_value("Kanban Board", board_name, "custom_swimlane_field"),
            ("", None),
        )

    def test_set_swimlane_field_rejects_invalid(self):
        from quick_kanban.api import set_swimlane_field

        board_name = ensure_todo_kanban_board()
        with self.assertRaises(frappe.ValidationError):
            set_swimlane_field(board_name, "not_a_real_field_xyz")

    def test_set_swimlane_field_requires_write(self):
        from quick_kanban.api import set_swimlane_field

        board_name = ensure_todo_kanban_board()
        board = frappe.get_doc("Kanban Board", board_name)
        with patch.object(board.__class__, "check_permission", side_effect=frappe.PermissionError):
            with patch("quick_kanban.api.frappe.get_doc", return_value=board):
                with self.assertRaises(frappe.PermissionError):
                    set_swimlane_field(board_name, "__assign")

    def test_assign_lanes_and_pages_duplicate_membership(self):
        from frappe.desk.form.assign_to import add as assign_add
        from quick_kanban.api import (
            get_cell_totals,
            get_swimlane_column_page,
            get_swimlane_lanes,
        )

        todo = frappe.get_doc(
            {
                "doctype": "ToDo",
                "description": "Swimlane multi assign",
                "status": "Open",
            }
        ).insert()
        assign_add(
            {
                "assign_to": ["Administrator"],
                "doctype": "ToDo",
                "name": todo.name,
            }
        )
        # Second user if exists
        users = frappe.get_all("User", filters={"enabled": 1}, pluck="name", limit=5)
        second = next((user for user in users if user not in ("Administrator", "Guest")), None)
        if second:
            assign_add(
                {
                    "assign_to": [second],
                    "doctype": "ToDo",
                    "name": todo.name,
                }
            )

        lanes = get_swimlane_lanes("ToDo", "__assign", filters=[])
        keys = {lane["key"] for lane in lanes}
        self.assertIn("Administrator", keys)
        self.assertIn("", keys)

        page = get_swimlane_column_page(
            "ToDo",
            "status",
            "Open",
            "__assign",
            "Administrator",
            fields=["status"],
            filters=[],
            start=0,
            page_length=50,
        )
        self.assertIn("name", page["keys"])
        self.assertIn("status", page["keys"])
        self.assertIn("_assign", page["keys"])
        self.assertIn("_user_tags", page["keys"])
        self.assertIn("_comments", page["keys"])
        self.assertIn("_liked_by", page["keys"])
        self.assertIn("user_info", page)
        self.assertIn("Administrator", page["user_info"])
        name_idx = page["keys"].index("name")
        names = [row[name_idx] for row in page["values"]]
        self.assertIn(todo.name, names)

        totals = get_cell_totals(
            "ToDo",
            "status",
            ["Open", "Closed"],
            "__assign",
            ["Administrator", ""],
            filters=[],
        )
        self.assertGreaterEqual(totals["Administrator"]["Open"], 1)

        from quick_kanban.api import get_swimlane_lane_page

        lane_page = get_swimlane_lane_page(
            "ToDo",
            "status",
            "__assign",
            "Administrator",
            fields=["status"],
            filters=[],
            start=0,
            page_length=50,
        )
        self.assertIn("name", lane_page["keys"])
        self.assertIn("status", lane_page["keys"])
        lane_name_idx = lane_page["keys"].index("name")
        lane_names = [row[lane_name_idx] for row in lane_page["values"]]
        self.assertIn(todo.name, lane_names)

        empty_page = get_swimlane_lane_page(
            "ToDo",
            "status",
            "__assign",
            "Administrator",
            fields=["status"],
            filters=[],
            start=10_000,
            page_length=10,
        )
        self.assertEqual(empty_page["values"], [])

    def test_closed_assign_todo_excluded_from_swimlane(self):
        """Closed ToDo (and leftover DocShare) must not create assign-lane membership."""
        from frappe.desk.form.assign_to import add as assign_add
        from frappe.desk.form.assign_to import set_status as assign_set_status
        from quick_kanban.api import get_swimlane_column_page, get_swimlane_lanes

        users = frappe.get_all(
            "User",
            filters={"enabled": 1, "user_type": "System User"},
            pluck="name",
            limit=10,
        )
        assignee = next(
            (user for user in users if user not in ("Administrator", "Guest")),
            None,
        )
        if not assignee:
            self.skipTest("Need a non-Administrator system user for assign swimlane test")

        todo = frappe.get_doc(
            {
                "doctype": "ToDo",
                "description": "Swimlane closed assign",
                "status": "Open",
            }
        ).insert()
        assign_add(
            {
                "assign_to": [assignee],
                "doctype": "ToDo",
                "name": todo.name,
            }
        )
        assign_set_status(
            "ToDo",
            todo.name,
            assign_to=assignee,
            status="Closed",
            ignore_permissions=True,
        )
        # Optional leftover share (Frappe may keep DocShare after close on some doctypes).
        if not frappe.db.exists(
            "DocShare",
            {"share_doctype": "ToDo", "share_name": todo.name, "user": assignee},
        ):
            frappe.share.add("ToDo", todo.name, assignee, read=1)

        self.assertNotIn(
            assignee,
            frappe.parse_json(frappe.db.get_value("ToDo", todo.name, "_assign") or "[]"),
        )
        self.assertTrue(
            frappe.db.exists(
                "DocShare",
                {"share_doctype": "ToDo", "share_name": todo.name, "user": assignee},
            ),
        )

        doc_filters = [["ToDo", "name", "=", todo.name]]
        lane_keys = {lane["key"] for lane in get_swimlane_lanes("ToDo", "__assign", filters=doc_filters)}
        self.assertNotIn(assignee, lane_keys)
        self.assertIn("", lane_keys)

        page = get_swimlane_column_page(
            "ToDo",
            "status",
            "Open",
            "__assign",
            assignee,
            fields=["status"],
            filters=doc_filters,
            start=0,
            page_length=50,
        )
        name_idx = page["keys"].index("name")
        names = [row[name_idx] for row in page["values"]]
        self.assertNotIn(todo.name, names)

        unassigned_page = get_swimlane_column_page(
            "ToDo",
            "status",
            "Open",
            "__assign",
            "",
            fields=["status"],
            filters=doc_filters,
            start=0,
            page_length=50,
        )
        unassigned_names = [
            row[unassigned_page["keys"].index("name")] for row in unassigned_page["values"]
        ]
        self.assertIn(todo.name, unassigned_names)

    def test_move_card_to_cell_changes_status(self):
        from quick_kanban.api import move_card_to_cell

        board_name = ensure_todo_kanban_board()
        board = frappe.get_doc("Kanban Board", board_name)
        board.custom_swimlane_field = "__assign"
        board.save()

        todo = frappe.get_doc(
            {
                "doctype": "ToDo",
                "description": "Swimlane move cell",
                "status": "Open",
            }
        ).insert()
        result = move_card_to_cell(
            board_name,
            todo.name,
            to_column="Closed",
            from_lane="",
            to_lane="",
            expected_modified=str(todo.modified),
        )
        self.assertEqual(result["status"], "Closed")
        self.assertEqual(frappe.db.get_value("ToDo", todo.name, "status"), "Closed")

    def test_link_swimlane_labels_use_title_field(self):
        from quick_kanban.swimlane import _link_title, _link_titles, get_swimlane_lanes

        if not frappe.db.exists("DocType", "Project"):
            self.skipTest("Project DocType is not installed")

        meta = frappe.get_meta("Project")
        if not meta.show_title_field_in_link or not meta.title_field:
            self.skipTest("Project does not show title_field in link")

        title_field = meta.title_field
        row = frappe.db.sql(
            f"""
            select name, `{title_field}` as title
            from `tabProject`
            where ifnull(`{title_field}`, '') != ''
              and name != `{title_field}`
            limit 1
            """,
            as_dict=True,
        )
        if not row:
            self.skipTest("No Project with a title distinct from name")

        project_id = row[0].name
        project_title = row[0].title

        titles = _link_titles("Project", [project_id])
        self.assertEqual(titles[project_id], project_title)
        self.assertEqual(_link_title("Project", project_id), project_title)

        task_meta = frappe.get_meta("Task") if frappe.db.exists("DocType", "Task") else None
        if not task_meta or not task_meta.get_field("project"):
            return

        task = frappe.get_doc(
            {
                "doctype": "Task",
                "subject": f"Swimlane label task {frappe.generate_hash(length=6)}",
                "project": project_id,
                "status": "Open",
            }
        ).insert(ignore_permissions=True)
        lanes = get_swimlane_lanes(
            "Task",
            "project",
            filters=[["name", "=", task.name]],
        )
        by_key = {lane["key"]: lane["label"] for lane in lanes}
        self.assertIn(project_id, by_key)
        self.assertEqual(by_key[project_id], project_title)

    def test_link_titles_uses_permission_aware_get_list(self):
        from types import SimpleNamespace

        from quick_kanban.swimlane import _link_titles

        meta = SimpleNamespace(show_title_field_in_link=1, title_field="project_name")

        with patch("quick_kanban.swimlane.frappe.get_meta", return_value=meta):
            with patch(
                "quick_kanban.swimlane.frappe.get_list",
                return_value=[
                    frappe._dict(name="PROJ-A", project_name="Title A"),
                    frappe._dict(name="PROJ-B", project_name="Title B"),
                ],
            ) as get_list:
                titles = _link_titles("Project", ["PROJ-A", "PROJ-B"])

        self.assertEqual(get_list.call_count, 1)
        kwargs = get_list.call_args.kwargs
        self.assertEqual(kwargs.get("limit_page_length"), 0)
        self.assertNotIn("ignore_permissions", kwargs)
        self.assertEqual(titles["PROJ-A"], "Title A")
        self.assertEqual(titles["PROJ-B"], "Title B")

    def test_link_titles_keep_name_when_get_list_omits_docs(self):
        from types import SimpleNamespace

        from quick_kanban.swimlane import _link_titles

        meta = SimpleNamespace(show_title_field_in_link=1, title_field="project_name")

        with patch("quick_kanban.swimlane.frappe.get_meta", return_value=meta):
            with patch(
                "quick_kanban.swimlane.frappe.get_list",
                return_value=[frappe._dict(name="PROJ-A", project_name="Title A")],
            ):
                titles = _link_titles("Project", ["PROJ-A", "PROJ-B"])

        self.assertEqual(titles["PROJ-A"], "Title A")
        self.assertEqual(titles["PROJ-B"], "PROJ-B")


class TestDeskAssets(FrappeTestCase):
    def test_bootstrap_is_the_only_global_desk_script(self):
        self.assertEqual(len(hooks.app_include_js), 1)
        self.assertTrue(
            hooks.app_include_js[0].startswith("/assets/quick_kanban/js/kanban_bootstrap.js")
        )
        self.assertFalse(getattr(hooks, "app_include_css", None))
