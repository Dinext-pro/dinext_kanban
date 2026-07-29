"""Deadline tracking helpers for Quick-Kanban (working days + buckets)."""

from __future__ import annotations

from datetime import timedelta

import frappe
from frappe.utils import cint, getdate, today

DEADLINE_OVERDUE = "overdue"
DEADLINE_ATTENTION = "attention"
DEADLINE_PLANNED = "planned"
DEADLINE_NONE = "none"

DEADLINE_LANE_ORDER = (
	DEADLINE_OVERDUE,
	DEADLINE_ATTENTION,
	DEADLINE_PLANNED,
	DEADLINE_NONE,
)

TASK_DEFAULT_DEADLINE_FIELD = "exp_end_date"
TASK_DEFAULT_ATTENTION_DAYS = 3
TASK_DEFAULT_DEADLINE_COLUMNS = ("Open", "Working", "Overdue")


def ensure_column_value(value: str) -> str:
	"""Ensure Kanban Column Value exists; return its name (same as value)."""
	value = str(value or "").strip()
	if not value:
		return ""
	if frappe.db.exists("Kanban Column Value", value):
		return value
	doc = frappe.get_doc(
		{
			"doctype": "Kanban Column Value",
			"column_value": value,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def parse_deadline_columns(board) -> list[str]:
	"""Raw kanban column values from Table MultiSelect child rows."""
	rows = board.get("custom_deadline_columns") or []
	out = []
	seen = set()
	for row in rows:
		value = ""
		if isinstance(row, dict):
			value = str(row.get("column_value") or "").strip()
		else:
			value = str(getattr(row, "column_value", "") or "").strip()
		if not value or value in seen:
			continue
		seen.add(value)
		out.append(value)
	return out


def board_deadline_settings(board) -> dict:
	"""Normalize deadline settings from a Kanban Board document/dict."""
	field = str(board.get("custom_deadline_field") or "").strip()
	attention = cint(board.get("custom_deadline_attention_days"))
	if attention <= 0:
		attention = TASK_DEFAULT_ATTENTION_DAYS
	return {
		"deadline_field": field,
		"attention_days": attention,
		"deadline_columns": parse_deadline_columns(board),
		"enabled": bool(field),
	}


def get_board_deadline_settings(board_name: str) -> dict:
	if not board_name:
		return board_deadline_settings({})
	board = frappe.db.get_value(
		"Kanban Board",
		board_name,
		["custom_deadline_field", "custom_deadline_attention_days"],
		as_dict=True,
	) or {}
	board["custom_deadline_columns"] = frappe.get_all(
		"Kanban Board Deadline Column",
		filters={"parent": board_name, "parenttype": "Kanban Board"},
		fields=["column_value"],
		order_by="idx asc",
		limit_page_length=0,
	)
	return board_deadline_settings(board)


def _fallback_company_holiday_list(company: str | None = None) -> str | None:
	if not company:
		try:
			from erpnext import get_default_company

			company = get_default_company()
		except Exception:
			company = None
		if not company:
			companies = frappe.get_all("Company", pluck="name", limit=1)
			company = companies[0] if companies else None
	if not company:
		return None
	return frappe.get_cached_value("Company", company, "default_holiday_list")


def resolve_holiday_list(project: str | None = None, company: str | None = None) -> str | None:
	"""Project.holiday_list → Company.default_holiday_list → default company list."""
	if project:
		row = frappe.db.get_value(
			"Project",
			project,
			["holiday_list", "company"],
			as_dict=True,
		) or {}
		if row.get("holiday_list"):
			return row.holiday_list
		return _fallback_company_holiday_list(row.get("company") or company)
	return _fallback_company_holiday_list(company)


def holiday_dates_in_range(holiday_list: str | None, from_date, to_date) -> set:
	if not holiday_list:
		return set()
	from_date = getdate(from_date)
	to_date = getdate(to_date)
	if from_date > to_date:
		from_date, to_date = to_date, from_date
	rows = frappe.get_all(
		"Holiday",
		filters={
			"parent": holiday_list,
			"holiday_date": ["between", [from_date, to_date]],
		},
		fields=["holiday_date"],
		limit_page_length=0,
	)
	return {getdate(row.holiday_date) for row in rows if row.get("holiday_date")}


def working_days_until(target_date, holiday_list: str | None = None, as_of=None) -> int | None:
	"""Count working days in [as_of, target] inclusive. None if target missing."""
	if target_date in (None, ""):
		return None
	target = getdate(target_date)
	start = getdate(as_of or today())
	if target < start:
		return -1
	holidays = holiday_dates_in_range(holiday_list, start, target)
	count = 0
	cursor = start
	while cursor <= target:
		if cursor not in holidays:
			count += 1
		cursor += timedelta(days=1)
	return count


def classify_deadline_bucket(
	date_value,
	attention_days: int = TASK_DEFAULT_ATTENTION_DAYS,
	holiday_list: str | None = None,
	as_of=None,
) -> str:
	"""Return overdue | attention | planned | none."""
	if date_value in (None, ""):
		return DEADLINE_NONE
	try:
		target = getdate(date_value)
	except Exception:
		return DEADLINE_NONE
	start = getdate(as_of or today())
	if target < start:
		return DEADLINE_OVERDUE
	days = working_days_until(target, holiday_list=holiday_list, as_of=start)
	if days is None:
		return DEADLINE_NONE
	attention = cint(attention_days) or TASK_DEFAULT_ATTENTION_DAYS
	if days <= attention:
		return DEADLINE_ATTENTION
	return DEADLINE_PLANNED


def is_deadline_column_tracked(status_value, deadline_columns) -> bool:
	"""True when status is in the configured tracked kanban columns."""
	columns = [str(c).strip() for c in (deadline_columns or []) if str(c).strip()]
	if not columns:
		return False
	return str(status_value or "").strip() in columns


def effective_deadline_bucket(
	raw_bucket: str,
	*,
	status_value,
	deadline_columns,
) -> str:
	"""Swimlane bucket from date bucket + column tracking.

	- empty date (raw none) → none
	- date set, status not in deadline_columns → planned
	- date set, status tracked → raw overdue/attention/planned
	"""
	raw = raw_bucket or DEADLINE_NONE
	if raw == DEADLINE_NONE:
		return DEADLINE_NONE
	if not is_deadline_column_tracked(status_value, deadline_columns):
		return DEADLINE_PLANNED
	return raw


def resolve_projects_holiday_lists(projects: list[str] | None = None) -> dict[str, str | None]:
	"""Map project name → holiday list (may be None). Includes '' for default."""
	out: dict[str, str | None] = {"": resolve_holiday_list(None)}
	for project in projects or []:
		project = str(project or "").strip()
		if not project or project in out:
			continue
		out[project] = resolve_holiday_list(project)
	return out


def classify_card_deadline(
	card: dict,
	*,
	deadline_field: str,
	attention_days: int,
	holiday_list_by_project: dict | None = None,
	as_of=None,
	status_field: str | None = None,
	deadline_columns=None,
) -> str:
	if not deadline_field:
		return DEADLINE_NONE
	project = ""
	status_value = None
	if isinstance(card, dict):
		date_value = card.get(deadline_field)
		project = str(card.get("project") or "").strip()
		if status_field:
			status_value = card.get(status_field)
	else:
		date_value = getattr(card, deadline_field, None)
		project = str(getattr(card, "project", "") or "").strip()
		if status_field:
			status_value = getattr(card, status_field, None)
	maps = holiday_list_by_project or {}
	holiday_list = maps.get(project, maps.get("", None))
	if project and project not in maps:
		holiday_list = resolve_holiday_list(project)
	raw = classify_deadline_bucket(
		date_value,
		attention_days=attention_days,
		holiday_list=holiday_list,
		as_of=as_of,
	)
	if deadline_columns is not None and status_field is not None:
		return effective_deadline_bucket(
			raw,
			status_value=status_value,
			deadline_columns=deadline_columns,
		)
	return raw


def enrich_rows_with_deadline_bucket(
	rows: list,
	*,
	deadline_field: str,
	attention_days: int,
	has_project_field: bool = False,
	status_field: str | None = None,
	deadline_columns=None,
) -> list:
	"""Attach `_deadline_bucket` on each row dict."""
	if not deadline_field or not rows:
		return rows
	projects = []
	if has_project_field:
		for row in rows:
			project = row.get("project") if isinstance(row, dict) else getattr(row, "project", None)
			if project:
				projects.append(str(project))
	holiday_map = resolve_projects_holiday_lists(projects)
	for row in rows:
		as_dict = row if isinstance(row, dict) else row
		bucket = classify_card_deadline(
			as_dict if isinstance(as_dict, dict) else dict(as_dict),
			deadline_field=deadline_field,
			attention_days=attention_days,
			holiday_list_by_project=holiday_map,
			status_field=status_field,
			deadline_columns=deadline_columns,
		)
		if isinstance(row, dict):
			row["_deadline_bucket"] = bucket
		else:
			row["_deadline_bucket"] = bucket
	return rows


def names_for_deadline_lane(
	doctype: str,
	*,
	deadline_field: str,
	lane_key: str,
	attention_days: int,
	status_field: str,
	status_value: str,
	filters=None,
	or_filters=None,
	deadline_columns=None,
) -> list[str]:
	"""Doc names in a status column that belong to a deadline swimlane bucket."""
	meta = frappe.get_meta(doctype)
	if not meta.get_field(deadline_field):
		return []

	list_filters = list(filters or [])
	list_filters.append([doctype, status_field, "=", status_value])

	fields = ["name", deadline_field]
	has_project = bool(meta.get_field("project"))
	if has_project:
		fields.append("project")

	rows = frappe.get_list(
		doctype,
		fields=fields,
		filters=list_filters,
		or_filters=or_filters or [],
		limit_page_length=0,
	)
	if not rows:
		return []

	projects = [str(r.project) for r in rows if has_project and r.get("project")]
	holiday_map = resolve_projects_holiday_lists(projects)
	matched = []
	for row in rows:
		# Date-only classify: rows omit status; apply column rule via status_value.
		raw = classify_card_deadline(
			row,
			deadline_field=deadline_field,
			attention_days=attention_days,
			holiday_list_by_project=holiday_map,
		)
		bucket = effective_deadline_bucket(
			raw,
			status_value=status_value,
			deadline_columns=deadline_columns,
		)
		if bucket == lane_key:
			matched.append(row.name)
	return matched