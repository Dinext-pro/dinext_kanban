const QUICK_KANBAN_CTX = "DinextKanban.Board";
const TASK_DEFAULT_DEADLINE_FIELD = "exp_end_date";
const TASK_DEFAULT_ATTENTION_DAYS = 3;
const TASK_DEFAULT_DEADLINE_COLUMNS = ["Open", "Working", "Overdue"];

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
        method: "dinext_kanban.api.get_swimlane_field_options",
        args: {
            doctype: frm.doc.reference_doctype,
            board_name: frm.doc.name || "",
            column_field: frm.doc.field_name || "",
            include_deadlines: Boolean(frm.doc.custom_deadline_field),
        },
        callback(r) {
            const rows = r.message || [];
            const data = [
                {
                    value: "",
                    label: __("No Grouping", null, QUICK_KANBAN_CTX),
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

function set_deadline_field_options(frm) {
    const fieldname = "custom_deadline_field";
    if (!frm.get_field(fieldname)) {
        return;
    }
    if (!frm.doc.reference_doctype) {
        frm.set_df_property(fieldname, "options", "");
        const emptyField = frm.get_field(fieldname);
        emptyField?.set_data?.([]);
        emptyField?.refresh?.();
        return;
    }
    frappe.model.with_doctype(frm.doc.reference_doctype, function () {
        const doctype = frm.doc.reference_doctype;
        const data = [
            {
                value: "",
                label: __("No Deadline Field", null, QUICK_KANBAN_CTX),
            },
        ].concat(
            $.map(frappe.get_meta(doctype).fields, function (field) {
                if (
                    !field.fieldname ||
                    !["Date", "Datetime"].includes(field.fieldtype)
                ) {
                    return null;
                }
                return {
                    value: field.fieldname,
                    label: __(field.label || field.fieldname, null, doctype),
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
        field.set_input?.(frm.doc.custom_deadline_field || "");
    });
}

function get_kanban_column_options(frm) {
    if (!frm.doc.reference_doctype || !frm.doc.field_name) {
        return [];
    }
    const meta = frappe.get_meta(frm.doc.reference_doctype);
    const df = meta?.fields?.find((field) => field.fieldname === frm.doc.field_name);
    if (!df?.options) {
        return [];
    }
    return String(df.options)
        .split("\n")
        .map((opt) => opt.trim())
        .filter(Boolean);
}

function selected_deadline_columns(frm) {
    return (frm.doc.custom_deadline_columns || [])
        .map((row) => row.column_value)
        .filter(Boolean);
}

function render_deadline_columns_multicheck(frm) {
    const wrap = frm.fields_dict.custom_deadline_columns_html?.$wrapper;
    if (!wrap) {
        return;
    }
    wrap.empty();

    const options = get_kanban_column_options(frm);
    if (!options.length) {
        wrap.html(
            `<p class="text-muted">${__(
                "Select a reference DocType and Kanban field to choose columns.",
                null,
                QUICK_KANBAN_CTX,
            )}</p>`,
        );
        return;
    }

    const selected = new Set(selected_deadline_columns(frm));
    const $control = $(`<div class="dinext-kanban-deadline-columns"></div>`);
    wrap.append($control);

    const multicheck = frappe.ui.form.make_control({
        parent: $control,
        df: {
            fieldname: "_deadline_columns_check",
            fieldtype: "MultiCheck",
            label: __("Track Deadlines In Columns", null, QUICK_KANBAN_CTX),
            options: options.map((value) => ({
                label: __(value, null, frm.doc.reference_doctype),
                value,
                checked: selected.has(value),
            })),
            columns: 2,
            select_all: true,
            on_change() {
                sync_deadline_columns_from_multicheck(frm, multicheck);
            },
        },
        render_input: true,
    });
    frm._deadline_columns_multicheck = multicheck;
}

function sync_deadline_columns_from_multicheck(frm, multicheck) {
    const values = (multicheck?.get_value?.() || multicheck?.selected_options || []).filter(Boolean);
    frappe.call({
        method: "dinext_kanban.api.ensure_deadline_column_values",
        args: { values },
        freeze: false,
        callback(r) {
            const ensured = r.message || values;
            frm.clear_table("custom_deadline_columns");
            ensured.forEach((value) => {
                const row = frm.add_child("custom_deadline_columns");
                row.column_value = value;
            });
            frm.refresh_field("custom_deadline_columns");
            frm.dirty();
        },
    });
}

function apply_task_deadline_defaults(frm) {
    if (frm.doc.reference_doctype !== "Task") {
        return;
    }
    if (!frm.doc.custom_deadline_field) {
        const meta = frappe.get_meta("Task");
        if (meta?.fields?.some((f) => f.fieldname === TASK_DEFAULT_DEADLINE_FIELD)) {
            frm.set_value("custom_deadline_field", TASK_DEFAULT_DEADLINE_FIELD);
        }
    }
    if (
        frm.doc.custom_deadline_attention_days == null ||
        frm.doc.custom_deadline_attention_days === ""
    ) {
        frm.set_value("custom_deadline_attention_days", TASK_DEFAULT_ATTENTION_DAYS);
    }
    if (!(frm.doc.custom_deadline_columns || []).length) {
        frappe.call({
            method: "dinext_kanban.api.ensure_deadline_column_values",
            args: { values: TASK_DEFAULT_DEADLINE_COLUMNS },
            callback(r) {
                const ensured = r.message || TASK_DEFAULT_DEADLINE_COLUMNS;
                frm.clear_table("custom_deadline_columns");
                ensured.forEach((value) => {
                    const row = frm.add_child("custom_deadline_columns");
                    row.column_value = value;
                });
                frm.refresh_field("custom_deadline_columns");
                render_deadline_columns_multicheck(frm);
            },
        });
    }
}

frappe.ui.form.on("Kanban Board", {
    refresh(frm) {
        set_highlighted_field_options(frm);
        set_swimlane_field_options(frm);
        set_deadline_field_options(frm);
        if (frm.is_new()) {
            apply_task_deadline_defaults(frm);
        }
        render_deadline_columns_multicheck(frm);
    },
    reference_doctype(frm) {
        set_highlighted_field_options(frm);
        set_swimlane_field_options(frm);
        set_deadline_field_options(frm);
        apply_task_deadline_defaults(frm);
        render_deadline_columns_multicheck(frm);
    },
    field_name(frm) {
        set_swimlane_field_options(frm);
        render_deadline_columns_multicheck(frm);
        if (
            frm.doc.field_name
            && frm.doc.custom_swimlane_field === frm.doc.field_name
        ) {
            frm.set_value("custom_swimlane_field", "");
        }
    },
    custom_deadline_field(frm) {
        set_swimlane_field_options(frm);
        if (
            !frm.doc.custom_deadline_field
            && frm.doc.custom_swimlane_field === "__deadlines"
        ) {
            frm.set_value("custom_swimlane_field", "");
        }
    },
});
