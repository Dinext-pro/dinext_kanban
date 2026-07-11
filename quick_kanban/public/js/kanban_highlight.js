function set_highlighted_field_options(frm) {
    if (!frm.doc.reference_doctype) return;

    frappe.model.with_doctype(frm.doc.reference_doctype, function () {
        const supported_types = ["Select", "Link", "Data"];
        const options = $.map(frappe.get_meta(frm.doc.reference_doctype).fields, function (field) {
            if (
                field.fieldname &&
                supported_types.includes(field.fieldtype) &&
                !frappe.model.no_value_type.includes(field.fieldtype)
            ) {
                return field.fieldname;
            }
            return null;
        });
        frm.set_df_property("custom_highlighted_field", "options", options);
        frm.get_field("custom_highlighted_field").refresh();
    });
}

frappe.ui.form.on("Kanban Board", {
    refresh: set_highlighted_field_options,
    reference_doctype: set_highlighted_field_options,
});