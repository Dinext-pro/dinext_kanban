frappe.ui.form.on("Project", {
	refresh(frm) {
		if (frm.is_new() || !frm.doc?.name) {
			return;
		}

		const nav = dinext_kanban.board_navigation;
		const label = nav.board_label();
		const $btn = frm.add_custom_button(label, () => {
			nav.open_project_board(frm.doc.name);
		});
		if (!$btn) {
			return;
		}

		nav.decorate_board_button($btn);
		const $toolbar = frm.page?.inner_toolbar || $btn.parent();
		nav.place_after_task_tree($btn, $toolbar);
	},
});
