# Copyright (c) 2026, Dinext and contributors
# For license information, please see license.txt

"""Register this app's default Dinext Hub cards."""

from __future__ import annotations

import frappe

APP_NAME = 'dinext_kanban'

HUB_ITEMS = (
	{
		"section": 'My Work',
		"element_type": 'Workspace',
		"target": 'Моя доска',
		"label": 'My Board',
		"description": 'Personal Kanban workspace with the My Kanban board for tracking your work visually.',
		"icon": 'kanban',
	},
)


def register_dinext_hub_items() -> None:
	if "dinext_common" not in frappe.get_installed_apps():
		return

	try:
		from dinext_common.setup.hub_catalog import register_hub_items
	except ImportError:
		return

	register_hub_items(HUB_ITEMS, source_app=APP_NAME)
