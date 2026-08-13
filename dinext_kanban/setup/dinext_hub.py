# Copyright (c) 2026, Dinext and contributors
# For license information, please see license.txt

"""Register this app's default Dinext Hub cards and DocType lists."""

from __future__ import annotations

import frappe

APP_NAME = "dinext_kanban"

HUB_ITEMS = (
	{
		"section": "My Work",
		"element_type": "Workspace",
		"target": "Моя доска",
		"label": "My Board",
		"description": "Personal Kanban workspace with the My Kanban board for tracking your work visually.",
		"icon": "kanban",
	},
)

HUB_SECTIONS = ({"section": "My Work", "list_limit": 5},)

HUB_DOCTYPE_ITEMS = (
	{
		"section": "My Work",
		"document_type": "Task",
		"show_quick_create": 1,
		"show_recently_opened": 1,
		"show_assigned": 1,
		"show_liked": 0,
		"show_attention": 1,
		"attention_filter": [
			["Task", "status", "=", "Overdue", False],
			["Task", "type", "!=", "Issue", False],
		],
	},
)


def register_dinext_hub_items() -> None:
	if "dinext_common" not in frappe.get_installed_apps():
		return

	try:
		from dinext_common.setup.hub_catalog import (
			register_hub_doctype_items,
			register_hub_items,
			register_hub_sections,
		)
	except ImportError:
		return

	register_hub_items(HUB_ITEMS, source_app=APP_NAME)
	register_hub_sections(HUB_SECTIONS, source_app=APP_NAME)
	register_hub_doctype_items(HUB_DOCTYPE_ITEMS, source_app=APP_NAME)
