(function () {
	const TASK_DOCTYPE = "Task";
	const BUTTON_FLAG = "__dinext_kanban_board_button_el";
	const FILTER_FLAG = "__dinext_kanban_project_filter_bound";

	function get_nav() {
		return dinext_kanban.board_navigation;
	}

	function find_existing_button(page) {
		if (page?.[BUTTON_FLAG]?.length) {
			return page[BUTTON_FLAG];
		}
		const label = get_nav().board_label();
		const encoded = encodeURIComponent(label);
		return page?.inner_toolbar?.find?.(`button[data-label="${encoded}"]`) || $();
	}

	function sync_button_state(treeview) {
		const $btn = treeview?.page?.[BUTTON_FLAG];
		if (!$btn || !$btn.length) {
			return;
		}
		$btn.prop("disabled", !get_nav().resolve_tree_project(treeview));
	}

	function bind_project_filter(treeview) {
		if (treeview[FILTER_FLAG]) {
			sync_button_state(treeview);
			return;
		}

		const project_field = treeview?.page?.fields_dict?.project;
		if (!project_field) {
			sync_button_state(treeview);
			return;
		}

		treeview[FILTER_FLAG] = true;
		const previous_change = project_field.change;
		project_field.change = function () {
			if (previous_change) {
				previous_change.apply(this, arguments);
			}
			sync_button_state(treeview);
		};

		if (project_field.$input?.on) {
			project_field.$input.on("change.dinext_kanban_board", () => {
				sync_button_state(treeview);
			});
		}

		sync_button_state(treeview);
	}

	function setup_board_button(treeview) {
		const page = treeview?.page;
		if (!page?.add_inner_button) {
			return;
		}

		const nav = get_nav();
		const existing = find_existing_button(page);
		if (existing && existing.length) {
			page[BUTTON_FLAG] = existing;
			nav.decorate_board_button(existing);
			bind_project_filter(treeview);
			return;
		}

		const label = nav.board_label();
		const $btn = page.add_inner_button(label, function () {
			if ($btn.prop("disabled")) {
				return;
			}
			const project = nav.resolve_tree_project(treeview);
			if (!project) {
				return;
			}
			nav.open_project_board(project);
		});

		if (!$btn || !$btn.length) {
			return;
		}

		page[BUTTON_FLAG] = $btn;
		nav.decorate_board_button($btn);
		bind_project_filter(treeview);
	}

	function wrap_settings() {
		frappe.provide("frappe.treeview_settings");
		let settings = frappe.treeview_settings[TASK_DOCTYPE];
		if (!settings) {
			settings = frappe.treeview_settings[TASK_DOCTYPE] = {};
		}
		if (settings.__dinext_kanban_board_wrapped) {
			return;
		}
		settings.__dinext_kanban_board_wrapped = true;

		const previous_onload = settings.onload;
		settings.onload = function (treeview) {
			if (previous_onload) {
				previous_onload.call(this, treeview);
			}
			setup_board_button(treeview);
		};

		const previous_post_render = settings.post_render;
		settings.post_render = function (treeview) {
			if (previous_post_render) {
				previous_post_render.call(this, treeview);
			}
			setup_board_button(treeview);
		};
	}

	function current_tree_context() {
		const from_factory = frappe.views?.trees?.[TASK_DOCTYPE];
		if (from_factory?.page) {
			return from_factory;
		}

		const route_str =
			typeof frappe.get_route_str === "function" ? frappe.get_route_str() : "";
		const parent = frappe.container?.pages?.[route_str] || frappe.container?.page;
		const page = parent?.page || parent;
		if (page?.add_inner_button) {
			return { page, args: {} };
		}
		return null;
	}

	function on_tree_page_event() {
		const route = typeof frappe.get_route === "function" ? frappe.get_route() : [];
		if (route[0] !== "Tree" || route[1] !== "Task") {
			return;
		}
		const treeview = current_tree_context();
		if (treeview) {
			setup_board_button(treeview);
		}
	}

	function wrap_tree_factory() {
		const Factory = frappe.views?.TreeFactory;
		if (!Factory?.prototype || Factory.prototype.__dinext_kanban_board_on_show) {
			return;
		}
		Factory.prototype.__dinext_kanban_board_on_show = true;
		const previous_on_show = Factory.prototype.on_show;
		Factory.prototype.on_show = function () {
			if (previous_on_show) {
				previous_on_show.apply(this, arguments);
			}
			on_tree_page_event();
		};
	}

	wrap_settings();
	wrap_tree_factory();
	$(document).on("page-change.dinext_kanban_board", on_tree_page_event);
})();
