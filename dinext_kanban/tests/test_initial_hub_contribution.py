from unittest.mock import patch

import frappe

from dinext_common.tests.hub_test_utils import HubRegistrationTestCase
from dinext_kanban.setup.dinext_hub import register_dinext_hub_items


class TestInitialHubContribution(HubRegistrationTestCase):
	def test_projects_owns_task_when_present(self):
		apps = list(dict.fromkeys([*frappe.get_installed_apps(), "dinext_projects"]))
		with patch("frappe.get_installed_apps", return_value=apps):
			register_dinext_hub_items()
			register_dinext_hub_items()
		self.settings.reload()
		self.assertEqual(len(self.settings.items), 1)
		self.assertEqual(self.settings.doctype_items, [])
		self.assertEqual(self.settings.sections[0].card_columns, 3)

	def test_kanban_without_projects_keeps_task_fallback(self):
		apps = [a for a in frappe.get_installed_apps() if a != "dinext_projects"]
		with patch("frappe.get_installed_apps", return_value=apps):
			register_dinext_hub_items()
			register_dinext_hub_items()
		self.settings.reload()
		self.assertEqual(len(self.settings.doctype_items), 1)
		self.assertEqual(self.settings.doctype_items[0].document_type, "Task")
		self.assertEqual(self.settings.doctype_items[0].source_app, "dinext_kanban")
