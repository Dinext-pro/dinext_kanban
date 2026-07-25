"""Helpers for hiding on-board child docs (same semantics as Quick Kanban cards)."""

from __future__ import annotations

import frappe


def coerce_bool(value) -> bool:
	if isinstance(value, bool):
		return value
	if value in (None, ""):
		return False
	if isinstance(value, (int, float)):
		return bool(value)
	return str(value).strip().lower() in {"1", "true", "yes"}


def tree_parent_field(doctype) -> str | None:
	meta = frappe.get_meta(doctype)
	if not meta.is_tree:
		return None
	return meta.nsm_parent_field or None


def exclude_on_board_children(rows, parent_field, board_name_set):
	"""Drop rows whose direct parent is also on the board."""
	if not parent_field or not board_name_set:
		return list(rows or [])
	visible = []
	for row in rows or []:
		parent = row.get(parent_field)
		if parent is None or parent == "":
			visible.append(row)
			continue
		if str(parent) in board_name_set:
			continue
		visible.append(row)
	return visible


def filter_names_excluding_on_board_children(doctype, names, parent_field, board_name_set):
	"""Return subset of names that should remain visible when children are hidden."""
	unique = []
	seen = set()
	for name in names or []:
		key = str(name or "").strip()
		if not key or key in seen:
			continue
		seen.add(key)
		unique.append(key)
	if not unique or not parent_field or not board_name_set:
		return unique

	rows = frappe.get_list(
		doctype,
		filters={"name": ("in", unique)},
		fields=["name", parent_field],
		limit_page_length=0,
		ignore_permissions=False,
	)
	by_name = {str(row.get("name")): row for row in rows if row.get("name")}
	visible = []
	for name in unique:
		row = by_name.get(name)
		if not row:
			visible.append(name)
			continue
		parent = row.get(parent_field)
		if parent is None or parent == "":
			visible.append(name)
			continue
		if str(parent) in board_name_set:
			continue
		visible.append(name)
	return visible


def get_hidden_board_child_names(
	doctype,
	filters=None,
	field_name=None,
	column_values=None,
	or_filters=None,
):
	"""Names on the board that are hidden when Show child tasks is off."""
	from quick_kanban.api import get_board_document_names

	parent_field = tree_parent_field(doctype)
	if not parent_field:
		return []

	board_names = get_board_document_names(
		doctype,
		filters=filters,
		field_name=field_name,
		column_values=column_values,
		or_filters=or_filters,
	)
	if not board_names:
		return []

	board_set = {str(name) for name in board_names}
	rows = frappe.get_list(
		doctype,
		filters={"name": ("in", board_names)},
		fields=["name", parent_field],
		limit_page_length=0,
		ignore_permissions=False,
	)
	hidden = []
	for row in rows:
		name = row.get("name")
		parent = row.get(parent_field)
		if not name or parent is None or parent == "":
			continue
		if str(parent) in board_set:
			hidden.append(str(name))
	return hidden


def board_name_set_for_hide(
	doctype,
	filters=None,
	field_name=None,
	column_values=None,
	or_filters=None,
):
	"""Return (parent_field, board_name_set) for hide mode, or (None, None)."""
	parent_field = tree_parent_field(doctype)
	if not parent_field:
		return None, None
	from quick_kanban.api import get_board_document_names

	board_names = get_board_document_names(
		doctype,
		filters=filters,
		field_name=field_name,
		column_values=column_values,
		or_filters=or_filters,
	)
	return parent_field, {str(name) for name in board_names}


def append_parent_filter(doctype, filters, parent_field, parent_name):
	"""Return a copy of filters with a direct-parent equality constraint."""
	from frappe import _

	parent = str(parent_name or "").strip()
	field = str(parent_field or "").strip()
	if not parent or not field:
		frappe.throw(_("Parent name and parent field are required."))
	merged = list(filters or [])
	merged.append([doctype, field, "=", parent])
	return merged


def resolve_tree_parent_field(doctype, parent_field=None):
	"""Return validated nsm parent field for a tree DocType."""
	from frappe import _

	resolved = tree_parent_field(doctype)
	if not resolved:
		frappe.throw(_("DocType {0} is not hierarchical.").format(doctype))
	requested = str(parent_field or "").strip()
	if requested and requested != resolved:
		frappe.throw(_("Invalid parent field for hierarchical DocType."))
	return resolved
