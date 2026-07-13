import frappe


@frappe.whitelist()
@frappe.read_only()
def get_kanban_config():
    config = frappe.local.conf
    beta_users = config.get("kanban_beta_users") or []
    return {
        "kanban_beta": config.get("kanban_beta", 0),
        "kanban_beta_users": beta_users if isinstance(beta_users, list) else [],
    }
