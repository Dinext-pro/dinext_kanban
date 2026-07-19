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

function set_swimlane_field_options(frm) {
    const fieldname = "custom_swimlane_field";
    if (!frm.doc.reference_doctype) {
        frm.set_df_property(fieldname, "options", "");
        const emptyField = frm.get_field(fieldname);
        emptyField?.set_data?.([]);
        emptyField?.refresh?.();
        return;
    }

    frappe.call({
        method: "quick_kanban.api.get_swimlane_field_options",
        args: { doctype: frm.doc.reference_doctype },
        callback(r) {
            const rows = r.message || [];
            const data = [
                {
                    value: "",
                    label: __("No Grouping", null, "QuickKanban.Board"),
                },
            ].concat(
                rows.map((row) => {
                    if (typeof row === "string") {
                        return { value: row, label: row };
                    }
                    return {
                        value: row.value,
                        label: row.label || row.value,
                    };
                }),
            );
            // Autocomplete: options via set_data so UI shows labels, DB keeps fieldnames.
            frm.set_df_property(fieldname, "options", "");
            const field = frm.get_field(fieldname);
            if (!field) {
                return;
            }
            field.set_data?.(data);
            field.refresh();
            const current = frm.doc.custom_swimlane_field || "";
            field.set_input?.(current);
        },
    });
}

frappe.ui.form.on("Kanban Board", {
    refresh(frm) {
        set_highlighted_field_options(frm);
        set_swimlane_field_options(frm);
    },
    reference_doctype(frm) {
        set_highlighted_field_options(frm);
        set_swimlane_field_options(frm);
    },
});
