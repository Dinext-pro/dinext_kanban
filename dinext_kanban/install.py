"""Install / migrate hooks for Dinext Kanban."""

from __future__ import annotations

import frappe

from dinext_kanban.deadline import TASK_DEFAULT_DEADLINE_COLUMNS, ensure_column_value


def ensure_kanban_column_values_for_boards() -> list[str]:
	"""Ensure Kanban Column Value docs for defaults and board deadline Links.

	Unions TASK_DEFAULT_DEADLINE_COLUMNS with every non-empty
	custom_deadline_columns.column_value across Kanban Boards, then
	calls ensure_column_value for each. Idempotent; no explicit commit
	(Frappe owns install/migrate transactions).
	"""
	values: list[str] = []
	seen: set[str] = set()

	for value in TASK_DEFAULT_DEADLINE_COLUMNS:
		key = str(value or "").strip()
		if not key or key in seen:
			continue
		seen.add(key)
		values.append(key)

	rows = frappe.get_all(
		"Kanban Board Deadline Column",
		filters={"parenttype": "Kanban Board"},
		fields=["column_value"],
		limit_page_length=0,
	)
	for row in rows:
		key = str(row.get("column_value") or "").strip()
		if not key or key in seen:
			continue
		seen.add(key)
		values.append(key)

	ensured: list[str] = []
	for value in values:
		name = ensure_column_value(value)
		if name:
			ensured.append(name)
	return ensured


def after_install() -> None:
	ensure_kanban_column_values_for_boards()


def after_migrate() -> None:
	ensure_kanban_column_values_for_boards()
