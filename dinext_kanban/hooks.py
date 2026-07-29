from pathlib import Path

app_name = "dinext_kanban"
app_title = "Dinext Kanban"
app_publisher = "tridz"
app_description = "An enhanced version of Kanban Board"
app_email = "info@dinext.ru"
app_license = "mit"
# required_apps = []

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
_bootstrap_asset = Path(__file__).parent / "public" / "js" / "kanban_bootstrap.js"
_bootstrap_version = int(_bootstrap_asset.stat().st_mtime) if _bootstrap_asset.exists() else 1
app_include_js = [
    f"/assets/dinext_kanban/js/kanban_bootstrap.js?v={_bootstrap_version}",
]

# include js, css files in header of web template
# web_include_css = "/assets/dinext_kanban/css/dinext_kanban.css"
# web_include_js = "/assets/dinext_kanban/js/dinext_kanban.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "dinext_kanban/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {"Kanban Board" : "public/js/kanban_highlight.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "dinext_kanban/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "dinext_kanban.utils.jinja_methods",
# 	"filters": "dinext_kanban.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "dinext_kanban.install.before_install"
# after_install = "dinext_kanban.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "dinext_kanban.uninstall.before_uninstall"
# after_uninstall = "dinext_kanban.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "dinext_kanban.utils.before_app_install"
# after_app_install = "dinext_kanban.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "dinext_kanban.utils.before_app_uninstall"
# after_app_uninstall = "dinext_kanban.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "dinext_kanban.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"dinext_kanban.tasks.all"
# 	],
# 	"daily": [
# 		"dinext_kanban.tasks.daily"
# 	],
# 	"hourly": [
# 		"dinext_kanban.tasks.hourly"
# 	],
# 	"weekly": [
# 		"dinext_kanban.tasks.weekly"
# 	],
# 	"monthly": [
# 		"dinext_kanban.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "dinext_kanban.install.before_tests"

# Overriding Methods
# ------------------------------
override_whitelisted_methods = {
	"frappe.desk.doctype.kanban_board.kanban_board.update_column_order": (
		"dinext_kanban.api.update_column_order"
	),
}
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "dinext_kanban.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["dinext_kanban.utils.before_request"]
# after_request = ["dinext_kanban.utils.after_request"]

# Job Events
# ----------
# before_job = ["dinext_kanban.utils.before_job"]
# after_job = ["dinext_kanban.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"dinext_kanban.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

