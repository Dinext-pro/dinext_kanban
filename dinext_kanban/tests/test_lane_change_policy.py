from types import SimpleNamespace
from unittest.mock import Mock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from dinext_kanban.move_policy import assert_lane_change_allowed


class TestLaneChangePolicy(FrappeTestCase):
	def test_assign_mode_requires_write(self):
		doc = Mock()
		doc.check_permission.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			assert_lane_change_allowed(doc, "__assign", "assign")

	def test_field_mode_rejects_read_only_field(self):
		doc = Mock()
		doc.doctype = "Task"
		doc.docstatus = 0
		doc.meta.get_field.return_value = SimpleNamespace(
			fieldtype="Link",
			options="Project",
			read_only=1,
			permlevel=0,
			allow_on_submit=0,
		)
		with self.assertRaises(frappe.ValidationError):
			assert_lane_change_allowed(doc, "project", "field")
		doc.check_permission.assert_called_once_with("write")

	@patch("frappe.model.workflow.get_workflow_name", return_value=None)
	def test_field_mode_allows_writable_field(self, _workflow):
		doc = Mock()
		doc.doctype = "Task"
		doc.docstatus = 0
		doc.meta.get_field.return_value = SimpleNamespace(
			fieldtype="Link",
			options="Project",
			read_only=0,
			permlevel=0,
			allow_on_submit=0,
		)
		doc.meta.get_permitted_fieldnames.return_value = ["project"]
		assert_lane_change_allowed(doc, "project", "field")
		doc.check_permission.assert_called_once_with("write")


class TestMoveCardToCellLanePolicy(FrappeTestCase):
	@patch("dinext_kanban.swimlane.apply_lane_membership")
	@patch("dinext_kanban.api.assert_lane_change_allowed")
	@patch("dinext_kanban.swimlane.resolve_swimlane_mode", return_value="field")
	@patch("dinext_kanban.api.BoardContext")
	@patch("dinext_kanban.api.frappe.get_doc")
	def test_move_card_to_cell_checks_lane_policy_before_membership(
		self,
		get_doc,
		board_context,
		_mode,
		assert_lane,
		apply_lane,
	):
		from dinext_kanban.api import move_card_to_cell

		board = Mock()
		board.get.return_value = "project"
		doc = Mock()
		doc.name = "TASK-1"
		doc.modified = "2026-07-10 10:00:00"
		doc.meta = Mock()
		doc.get.side_effect = lambda field: "Open" if field == "status" else None
		get_doc.side_effect = [board, doc]
		board_context.return_value = SimpleNamespace(
			ref_doctype="Task",
			field_name="status",
			workflow=None,
		)

		move_card_to_cell(
			"Task Board",
			"TASK-1",
			to_column=None,
			from_lane="A",
			to_lane="B",
			expected_modified="2026-07-10 10:00:00",
		)

		assert_lane.assert_called_once_with(doc, "project", "field")
		apply_lane.assert_called_once()
		doc.save.assert_called_once()
