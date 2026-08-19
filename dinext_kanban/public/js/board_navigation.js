frappe.provide("dinext_kanban.board_navigation");

dinext_kanban.board_navigation = {
	CONTEXT: "DinextKanban.Board",
	BOARD_NAME: "Все задачи",

	board_label() {
		return __("Board", null, this.CONTEXT);
	},

	kanban_icon_html() {
		return '<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-kanban"></use></svg>';
	},

	decorate_board_button($btn) {
		if (!$btn || !$btn.length) {
			return $btn;
		}
		if ($btn.data("dinext-kanban-icon")) {
			return $btn;
		}
		$btn.prepend(this.kanban_icon_html() + " ");
		$btn.data("dinext-kanban-icon", 1);
		return $btn;
	},

	normalize_path(path) {
		const raw = String(path || "").split("?")[0].replace(/\/+$/, "");
		try {
			return decodeURIComponent(raw);
		} catch (e) {
			return raw;
		}
	},

	board_url(project) {
		const path = "/app/task/view/kanban/" + encodeURIComponent(this.BOARD_NAME);
		if (!project) {
			return path;
		}
		return path + "?project=" + encodeURIComponent(project);
	},

	open_project_board(project) {
		if (!project) {
			return;
		}
		// KanbanView.show() assigns frappe.route_options = {} before before_refresh.
		// ListView.parse_filters_from_route_options() reads location.search first,
		// so the project must be on the URL before router.route().
		frappe.route_options = { project };
		const url = this.board_url(project);
		const path = url.split("?")[0];
		if (
			typeof window !== "undefined" &&
			window.history &&
			frappe.router &&
			typeof frappe.router.route === "function"
		) {
			const current = this.normalize_path(window.location && window.location.pathname);
			const target = this.normalize_path(path);
			if (current === target) {
				window.history.replaceState({ click: true }, "", url);
			} else {
				window.history.pushState({ click: true }, "", url);
			}
			frappe.router.route();
			return;
		}
		frappe.set_route("List", "Task", "Kanban", this.BOARD_NAME);
	},

	get_stored_tree_project() {
		try {
			const user = frappe.user?.name || frappe.session?.user;
			if (!user) {
				return null;
			}
			const stored = localStorage.getItem(`${user}:tree:project`);
			return stored ? String(stored).trim() : null;
		} catch (error) {
			return null;
		}
	},

	resolve_tree_project(treeview) {
		const project_field = treeview?.page?.fields_dict?.project;
		const candidates = [
			project_field?.get_value?.(),
			treeview?.args?.project,
			project_field?.df?.default,
			this.get_stored_tree_project(),
		];
		for (const candidate of candidates) {
			if (candidate == null || candidate === "") {
				continue;
			}
			const project = String(candidate).trim();
			if (project) {
				return project;
			}
		}
		return null;
	},

	find_task_tree_button($toolbar) {
		if (!$toolbar || !$toolbar.find) {
			return $();
		}
		const label = __("Task tree");
		return $toolbar
			.find("button")
			.filter(function () {
				return (this.textContent || "").indexOf(label) !== -1;
			})
			.first();
	},

	place_after_task_tree($btn, $toolbar) {
		const $tree = this.find_task_tree_button($toolbar || $btn?.parent?.());
		if ($tree && $tree.length && $btn && $btn.length) {
			$btn.insertAfter($tree);
		}
		return $btn;
	},
};
