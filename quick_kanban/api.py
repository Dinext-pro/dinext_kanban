import frappe
from frappe import _
from frappe.utils import get_datetime


@frappe.whitelist()
@frappe.read_only()
def get_column_totals(
    doctype,
    fieldname,
    columns,
    filters=None,
    or_filters=None,
):
    columns = frappe.parse_json(columns) if isinstance(columns, str) else columns
    filters = frappe.parse_json(filters) if isinstance(filters, str) else (filters or [])
    or_filters = (
        frappe.parse_json(or_filters)
        if isinstance(or_filters, str)
        else (or_filters or [])
    )
    if not isinstance(columns, list):
        frappe.throw(_("Kanban columns must be a list."))

    meta = frappe.get_meta(doctype)
    field = meta.get_field(fieldname)
    if not field:
        frappe.throw(_("Invalid Kanban status field."))
    if not frappe.has_permission(doctype, "read"):
        frappe.throw(_("You cannot read this document type."), frappe.PermissionError)
    if field.permlevel:
        permitted_fields = meta.get_permitted_fieldnames(
            user=frappe.session.user,
            permission_type="read",
        )
        if fieldname not in permitted_fields:
            frappe.throw(_("You cannot read the Kanban status field."), frappe.PermissionError)

    rows = frappe.get_list(
        doctype,
        fields=[fieldname, "count(name) as count"],
        filters=filters,
        or_filters=or_filters,
        group_by=fieldname,
        limit_page_length=0,
    )
    totals = {column: 0 for column in columns}
    for row in rows:
        value = row.get(fieldname)
        if value in totals:
            totals[value] = int(row.get("count") or 0)
    return totals


@frappe.whitelist(methods=["POST"])
def move_card(doctype, name, fieldname, value, expected_modified=None):
    doc = frappe.get_doc(doctype, name)
    doc.check_permission("write")

    field = doc.meta.get_field(fieldname)
    if not field or field.fieldtype != "Select" or field.read_only:
        frappe.throw(_("The Kanban status field cannot be updated."))

    if field.permlevel:
        permitted_fields = doc.meta.get_permitted_fieldnames(
            user=frappe.session.user,
            permission_type="write",
        )
        if fieldname not in permitted_fields:
            frappe.throw(_("You cannot update the Kanban status field."), frappe.PermissionError)

    options = [option.strip() for option in (field.options or "").splitlines() if option.strip()]
    if value not in options:
        frappe.throw(_("Invalid Kanban column: {0}").format(value))

    if expected_modified and get_datetime(doc.modified) != get_datetime(expected_modified):
        frappe.throw(
            _("This card was changed by another user. Refresh the board and try again."),
            frappe.TimestampMismatchError,
        )

    doc.set(fieldname, value)
    doc.save()

    return {
        "name": doc.name,
        fieldname: doc.get(fieldname),
        "modified": doc.modified,
    }
