# Copyright (c) 2026, Dinext Kanban contributors
# License: MIT. See LICENSE

from datetime import date
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from dinext_kanban.deadline import (
	DEADLINE_ATTENTION,
	DEADLINE_NONE,
	DEADLINE_OVERDUE,
	DEADLINE_PLANNED,
	classify_deadline_bucket,
	effective_deadline_bucket,
	enrich_rows_with_deadline_bucket,
	is_deadline_column_tracked,
	names_for_deadline_lane,
	working_days_until,
)


class TestDeadlineClassification(FrappeTestCase):
	def test_empty_date_is_none(self):
		self.assertEqual(classify_deadline_bucket(None), DEADLINE_NONE)
		self.assertEqual(classify_deadline_bucket(""), DEADLINE_NONE)

	def test_past_date_is_overdue(self):
		as_of = date(2026, 7, 25)
		self.assertEqual(
			classify_deadline_bucket(date(2026, 7, 20), attention_days=3, as_of=as_of),
			DEADLINE_OVERDUE,
		)

	def test_within_attention_window(self):
		as_of = date(2026, 7, 25)
		self.assertEqual(
			classify_deadline_bucket(date(2026, 7, 27), attention_days=3, as_of=as_of),
			DEADLINE_ATTENTION,
		)

	def test_beyond_attention_is_planned(self):
		as_of = date(2026, 7, 25)
		self.assertEqual(
			classify_deadline_bucket(date(2026, 8, 10), attention_days=3, as_of=as_of),
			DEADLINE_PLANNED,
		)

	def test_working_days_skip_holidays(self):
		as_of = date(2026, 7, 25)
		target = date(2026, 7, 28)
		with patch(
			"dinext_kanban.deadline.holiday_dates_in_range",
			return_value={date(2026, 7, 26), date(2026, 7, 27)},
		):
			# 25, 28 working → 2 days
			self.assertEqual(working_days_until(target, holiday_list="HL", as_of=as_of), 2)
			self.assertEqual(
				classify_deadline_bucket(target, attention_days=2, holiday_list="HL", as_of=as_of),
				DEADLINE_ATTENTION,
			)
			self.assertEqual(
				classify_deadline_bucket(target, attention_days=1, holiday_list="HL", as_of=as_of),
				DEADLINE_PLANNED,
			)

	def test_today_counts_as_attention(self):
		as_of = date(2026, 7, 25)
		self.assertEqual(
			classify_deadline_bucket(as_of, attention_days=3, as_of=as_of),
			DEADLINE_ATTENTION,
		)

	def test_non_tracked_column_with_date_maps_to_planned(self):
		self.assertFalse(is_deadline_column_tracked("Completed", ["Open", "Working"]))
		self.assertEqual(
			effective_deadline_bucket(
				DEADLINE_OVERDUE,
				status_value="Completed",
				deadline_columns=["Open", "Working"],
			),
			DEADLINE_PLANNED,
		)

	def test_tracked_column_keeps_overdue(self):
		self.assertTrue(is_deadline_column_tracked("Open", ["Open", "Working"]))
		self.assertEqual(
			effective_deadline_bucket(
				DEADLINE_OVERDUE,
				status_value="Open",
				deadline_columns=["Open", "Working"],
			),
			DEADLINE_OVERDUE,
		)

	def test_empty_date_stays_none_even_if_untracked(self):
		self.assertEqual(
			effective_deadline_bucket(
				DEADLINE_NONE,
				status_value="Completed",
				deadline_columns=["Open", "Working"],
			),
			DEADLINE_NONE,
		)

	def test_empty_deadline_columns_with_date_maps_to_planned(self):
		self.assertFalse(is_deadline_column_tracked("Open", []))
		self.assertEqual(
			effective_deadline_bucket(
				DEADLINE_ATTENTION,
				status_value="Open",
				deadline_columns=[],
			),
			DEADLINE_PLANNED,
		)

	def test_names_for_deadline_lane_without_status_on_row(self):
		"""Rows from get_list omit status; must still classify by date after tracked gate."""
		as_of = date(2026, 7, 25)
		overdue_row = frappe._dict(name="TASK-OVERDUE", exp_end_date=date(2026, 7, 20))
		none_row = frappe._dict(name="TASK-NONE", exp_end_date=None)
		meta = frappe._dict(get_field=lambda fieldname: True if fieldname == "exp_end_date" else None)

		with (
			patch("dinext_kanban.deadline.frappe.get_meta", return_value=meta),
			patch(
				"dinext_kanban.deadline.frappe.get_list",
				return_value=[overdue_row, none_row],
			),
			patch(
				"dinext_kanban.deadline.resolve_projects_holiday_lists",
				return_value={"": None},
			),
			patch("dinext_kanban.deadline.today", return_value=as_of),
		):
			overdue_names = names_for_deadline_lane(
				"Task",
				deadline_field="exp_end_date",
				lane_key=DEADLINE_OVERDUE,
				attention_days=3,
				status_field="status",
				status_value="Open",
				deadline_columns=["Open", "Working"],
			)
			none_names = names_for_deadline_lane(
				"Task",
				deadline_field="exp_end_date",
				lane_key=DEADLINE_NONE,
				attention_days=3,
				status_field="status",
				status_value="Open",
				deadline_columns=["Open", "Working"],
			)

		self.assertEqual(overdue_names, ["TASK-OVERDUE"])
		self.assertEqual(none_names, ["TASK-NONE"])
		self.assertNotIn("TASK-OVERDUE", none_names)

	def test_names_for_deadline_lane_untracked_with_date_is_planned(self):
		as_of = date(2026, 7, 25)
		past_row = frappe._dict(name="TASK-DONE", exp_end_date=date(2026, 4, 30))
		empty_row = frappe._dict(name="TASK-EMPTY", exp_end_date=None)
		meta = frappe._dict(get_field=lambda fieldname: True if fieldname == "exp_end_date" else None)

		with (
			patch("dinext_kanban.deadline.frappe.get_meta", return_value=meta),
			patch(
				"dinext_kanban.deadline.frappe.get_list",
				return_value=[past_row, empty_row],
			),
			patch(
				"dinext_kanban.deadline.resolve_projects_holiday_lists",
				return_value={"": None},
			),
			patch("dinext_kanban.deadline.today", return_value=as_of),
		):
			planned_names = names_for_deadline_lane(
				"Task",
				deadline_field="exp_end_date",
				lane_key=DEADLINE_PLANNED,
				attention_days=3,
				status_field="status",
				status_value="Completed",
				deadline_columns=["Open", "Working"],
			)
			none_names = names_for_deadline_lane(
				"Task",
				deadline_field="exp_end_date",
				lane_key=DEADLINE_NONE,
				attention_days=3,
				status_field="status",
				status_value="Completed",
				deadline_columns=["Open", "Working"],
			)
			overdue_names = names_for_deadline_lane(
				"Task",
				deadline_field="exp_end_date",
				lane_key=DEADLINE_OVERDUE,
				attention_days=3,
				status_field="status",
				status_value="Completed",
				deadline_columns=["Open", "Working"],
			)

		self.assertEqual(planned_names, ["TASK-DONE"])
		self.assertEqual(none_names, ["TASK-EMPTY"])
		self.assertEqual(overdue_names, [])

	def test_enrich_rows_attaches_deadline_bucket(self):
		as_of = date(2026, 7, 25)
		rows = [
			frappe._dict(
				name="TASK-A",
				status="Open",
				exp_end_date=date(2026, 7, 29),
				project="",
			),
		]
		with (
			patch(
				"dinext_kanban.deadline.resolve_projects_holiday_lists",
				return_value={"": "HL"},
			),
			patch(
				"dinext_kanban.deadline.holiday_dates_in_range",
				return_value={date(2026, 7, 26), date(2026, 7, 27)},
			),
			patch("dinext_kanban.deadline.today", return_value=as_of),
		):
			enrich_rows_with_deadline_bucket(
				rows,
				deadline_field="exp_end_date",
				attention_days=3,
				has_project_field=False,
				status_field="status",
				deadline_columns=["Open", "Working"],
			)
		self.assertEqual(rows[0]["_deadline_bucket"], DEADLINE_ATTENTION)

	def test_apply_deadline_bucket_to_page_adds_key(self):
		from dinext_kanban.swimlane import _apply_deadline_bucket_to_page

		as_of = date(2026, 7, 25)
		paged = [
			frappe._dict(
				name="TASK-A",
				status="Open",
				exp_end_date=date(2026, 7, 29),
			),
		]
		fields = ["name", "status", "exp_end_date"]
		with (
			patch("dinext_kanban.swimlane.frappe.flags") as flags,
			patch(
				"dinext_kanban.deadline.get_board_deadline_settings",
				return_value={
					"deadline_field": "exp_end_date",
					"attention_days": 3,
					"deadline_columns": ["Open"],
				},
			),
			patch(
				"dinext_kanban.deadline.resolve_projects_holiday_lists",
				return_value={"": "HL"},
			),
			patch(
				"dinext_kanban.deadline.holiday_dates_in_range",
				return_value={date(2026, 7, 26), date(2026, 7, 27)},
			),
			patch("dinext_kanban.deadline.today", return_value=as_of),
			patch(
				"dinext_kanban.swimlane.frappe.get_meta",
				return_value=frappe._dict(get_field=lambda _n: None),
			),
		):
			flags.get = lambda key, default=None: "Board" if key == "dinext_kanban_board_name" else default
			out_rows, out_fields = _apply_deadline_bucket_to_page(
				paged, fields, doctype="Task", status_field="status"
			)
		self.assertIn("_deadline_bucket", out_fields)
		self.assertEqual(out_rows[0]["_deadline_bucket"], DEADLINE_ATTENTION)
