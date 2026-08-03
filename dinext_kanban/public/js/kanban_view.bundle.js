frappe.provide("frappe.views");

const NativeKanbanView = frappe.views.KanbanView;
const bootstrap = window.dinextKanbanBootstrap;

function removeStaleDinextKanbanStylesheets(href) {
    document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
        const linkHref = link.getAttribute("href") || "";
        if (linkHref.includes("dinext_kanban.bundle") && linkHref !== href) {
            link.remove();
        }
    });
}

function loadStylesheet(href) {
    if (bootstrap?.loadStylesheet) {
        return bootstrap.loadStylesheet(href);
    }

    return new Promise((resolve, reject) => {
        removeStaleDinextKanbanStylesheets(href);

        const existing = document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
        if (existing) {
            resolve(existing);
            return;
        }

        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.addEventListener("load", () => resolve(link), { once: true });
        link.addEventListener(
            "error",
            () => reject(new Error(`Failed to load ${href}`)),
            { once: true },
        );
        document.head.appendChild(link);
    });
}

function removeStaleDinextKanbanScripts(href) {
    document.querySelectorAll("script[src*='dinext_kanban.bundle']").forEach((script) => {
        const src = script.getAttribute("src") || "";
        if (src.includes("dinext_kanban.bundle") && src !== href) {
            bootstrap?.forgetScript?.(src);
            script.remove();
        }
    });
}

/**
 * nginx caches /assets/* for 1y, including assets.json. Desk boot can also
 * keep a stale assets map for the whole SPA session. Refresh the map with a
 * cache-busted fetch so rebuilds load the new hashed dinext_kanban bundle.
 */
async function refreshDinextKanbanAssetMap() {
    try {
        const response = await fetch(`/assets/assets.json?v=${Date.now()}`, {
            credentials: "same-origin",
            cache: "no-store",
        });
        if (!response.ok) {
            return;
        }
        const assets = await response.json();
        if (!assets || typeof assets !== "object") {
            return;
        }
        frappe.boot = frappe.boot || {};
        frappe.boot.assets_json = {
            ...(frappe.boot.assets_json || {}),
            ...assets,
        };
    } catch {
        // Fall back to whatever boot already has.
    }
}

async function ensureDinextKanbanBundle() {
    await refreshDinextKanbanAssetMap();
    const cssUrl = frappe.assets.bundled_asset("dinext_kanban.bundle.css");
    const bundleUrl = frappe.assets.bundled_asset("dinext_kanban.bundle.js");
    const existing = document.querySelector("script[src*='dinext_kanban.bundle']");
    const existingSrc = existing?.getAttribute("src") || "";
    if (existingSrc && existingSrc !== bundleUrl) {
        window.unmountDinextKanban?.();
        delete window.mountDinextKanban;
        delete window.hydrateDinextKanban;
        delete window.isDinextKanbanMountedOn;
        removeStaleDinextKanbanScripts(bundleUrl);
    }
    await loadStylesheet(cssUrl);
    const hasCurrentScript = Boolean(document.querySelector(`script[src="${bundleUrl}"]`));
    if (!hasCurrentScript || !window.mountDinextKanban) {
        await loadScript(bundleUrl);
    }
}

function loadScript(src) {
    if (bootstrap?.loadScript) {
        return bootstrap.loadScript(src);
    }

    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing?.dataset?.loaded === "true") {
            resolve(existing);
            return;
        }

        const script = existing || document.createElement("script");
        script.addEventListener(
            "load",
            () => {
                script.dataset.loaded = "true";
                resolve(script);
            },
            { once: true },
        );
        script.addEventListener(
            "error",
            () => reject(new Error(`Failed to load ${src}`)),
            { once: true },
        );

        if (!existing) {
            script.src = src;
            document.head.appendChild(script);
        }
    });
}

function parseJsonArray(value, fallback = []) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== "string") {
        return fallback;
    }
    try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Normalize fields/filters on a working board object for Kanban runtime.
 * Must only be called on a detached copy — never on the synced locals doc —
 * so Code fields stay JSON strings for Form save.
 */
function normalizeBoardDoc(board) {
    if (!board) {
        return;
    }

    board.fields = parseJsonArray(board.fields, []);
    board.filters_array = parseJsonArray(
        board.filters_array ?? board.filters,
        [],
    );
}

const DinextKanbanView = class KanbanView extends NativeKanbanView {
    set_board_perms_and_push_menu_items() {
        // Perms arrive async after first paint; remount Group By when write is known.
        return Promise.resolve(super.set_board_perms_and_push_menu_items()).then(() => {
            this.setup_groupby_control();
        });
    }

    async setup_defaults() {
        await super.setup_defaults();
        this.page_length = 100;
    }

    get_board() {
        return frappe.db.get_doc("Kanban Board", this.board_name).then((board) => {
            // Shallow-copy so JSON.parse of fields does not pollute locals
            // (Kanban Board.fields is Code/JSON and Form save rejects lists).
            this.board = { ...board };
            normalizeBoardDoc(this.board);
            this.filters = this.board.filters_array;
        });
    }

    async set_fields() {
        normalizeBoardDoc(this.board);
        await frappe.views.ListView.prototype.set_fields.call(this);
        this._add_field(this.card_meta.title_field);
        (this.board.fields || []).forEach((field) => this._add_field(field));
        this._add_field(this.board.custom_highlighted_field);
        this._addCardColorField();
        this._addTreeParentField();
    }

    _addCardColorField() {
        const meta = frappe.get_meta(this.board.reference_doctype);
        const colorField = meta?.fields?.find(
            (field) => field.fieldname === "color" && field.fieldtype === "Color",
        );
        if (colorField) {
            this._add_field("color");
        }
    }

    _addTreeParentField() {
        const meta = frappe.get_meta(this.board.reference_doctype);
        if (meta?.is_tree && meta?.nsm_parent_field) {
            this._add_field(meta.nsm_parent_field);
        }
    }

    toggle_result_area() {
        // Columns come from the board config; keep $result visible with empty cards.
        this.$result.show();
        this.$no_result?.hide?.();
        this.$paging_area?.toggle?.(false);
    }

    getMinimizeCardsPreference() {
        const boardName = this.board_name || this.board?.name || "";
        try {
            return localStorage.getItem(`dinext_kanban:minimize_cards:${boardName}`) === "1";
        } catch {
            return false;
        }
    }

    getShowChildTasksPreference() {
        const boardName = this.board_name || this.board?.name || "";
        try {
            return localStorage.getItem(`dinext_kanban:show_child_tasks:${boardName}`) === "1";
        } catch {
            return false;
        }
    }

    isTreeBoardDoctype() {
        const doctype = this.board?.reference_doctype || this.doctype;
        const meta = doctype && frappe.get_meta?.(doctype);
        return Boolean(meta?.is_tree && meta?.nsm_parent_field);
    }

    resolveFilterSelector() {
        const $section = this.$filter_section;
        if ($section?.find) {
            const found = $section.find(".filter-selector");
            if (found?.[0]) {
                return found[0];
            }
        }
        if ($section?.[0]?.querySelector) {
            const found = $section[0].querySelector(".filter-selector");
            if (found) {
                return found;
            }
        }
        const customActions = this.page?.custom_actions?.[0]
            || this.page?.wrapper?.[0]?.querySelector?.(".custom-actions");
        return customActions?.querySelector?.(".filter-selector")
            || document.querySelector(".page-head .filter-selector")
            || document.querySelector(".filter-selector");
    }

    resolveCustomActionsHost() {
        const filterSelector = this.resolveFilterSelector();
        if (!filterSelector?.parentNode) {
            return null;
        }

        // Prefer sibling of .filter-section under .custom-actions so we don't
        // inflate the filter row or fight Bootstrap label styles inside it.
        const filterSection = filterSelector.closest?.(".filter-section")
            || (filterSelector.parentNode?.classList?.contains?.("filter-section")
                ? filterSelector.parentNode
                : null);
        return {
            host: filterSection?.parentNode || filterSelector.parentNode,
            insertBeforeNode: filterSection || filterSelector,
        };
    }

    canEditBoardSettings() {
        if (this.board_perms?.write) {
            return true;
        }
        return Boolean(window.__dinextKanbanStore?.getters?.canEditBoard);
    }

    setup_minimize_cards_control() {
        const placement = this.resolveCustomActionsHost();
        if (!placement) {
            return;
        }
        const { host, insertBeforeNode } = placement;

        let control = host.querySelector(".dinext-kanban-minimize-control");

        if (!control) {
            const labelText = __("Minimize", null, "DinextKanban.Board");
            control = document.createElement("label");
            control.className = "dinext-kanban-minimize-control";
            control.setAttribute("title", labelText);
            control.setAttribute("aria-label", labelText);

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            const labelSpan = document.createElement("span");
            labelSpan.className = "dinext-kanban-minimize-label";
            labelSpan.setAttribute("aria-hidden", "true");
            // collapse = corner arrows inward — compact/minimized cards, not column width.
            const iconHtml = frappe.utils?.icon?.("collapse", "sm");
            if (iconHtml) {
                labelSpan.innerHTML = iconHtml;
            } else {
                // Fallback when Desk icon sprites are unavailable (tests / early boot).
                labelSpan.innerHTML =
                    '<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-collapse"></use></svg>';
            }
            control.append(checkbox, labelSpan);

            checkbox.addEventListener("change", () => {
                window.setDinextKanbanMinimizeCards?.(checkbox.checked);
            });

            host.insertBefore(control, insertBeforeNode);
        }

        const checkbox = control.querySelector('input[type="checkbox"]');
        if (checkbox) {
            const preferred = window.__dinextKanbanStore
                ? Boolean(window.__dinextKanbanStore.state.minimize_cards)
                : this.getMinimizeCardsPreference();
            checkbox.checked = preferred;
            if (!window.__dinextKanbanStore) {
                window.setDinextKanbanMinimizeCards?.(preferred, { persist: false });
            }
        }

        this.$minimize_cards_control = control;
    }

    remove_minimize_cards_control() {
        const control = this.$minimize_cards_control
            || document.querySelector(".dinext-kanban-minimize-control");
        control?.remove?.();
        this.$minimize_cards_control = null;
    }

    setup_show_child_tasks_control() {
        if (!this.isTreeBoardDoctype()) {
            this.remove_show_child_tasks_control();
            return;
        }

        const placement = this.resolveCustomActionsHost();
        if (!placement) {
            return;
        }
        const { host, insertBeforeNode } = placement;

        let control = host.querySelector(".dinext-kanban-show-child-tasks-control");

        if (!control) {
            const labelText = __("Show child tasks", null, "DinextKanban.Board");
            control = document.createElement("label");
            control.className = "dinext-kanban-show-child-tasks-control";
            control.setAttribute("title", labelText);
            control.setAttribute("aria-label", labelText);

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            const labelSpan = document.createElement("span");
            labelSpan.className = "dinext-kanban-show-child-tasks-label";
            labelSpan.setAttribute("aria-hidden", "true");
            // Same glyph as card child-count badge (frontend/src/icons/childTreeIcon.js).
            labelSpan.innerHTML =
                '<svg class="icon icon-sm" viewBox="0 0 16 16" fill="none" data-icon="child-tree" aria-hidden="true">' +
                '<path stroke="var(--icon-stroke)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M3.25 2.5h4M5.25 2.5v9.75c0 .69.56 1.25 1.25 1.25H8.5"/>' +
                '<path stroke="var(--icon-stroke)" stroke-width="1.5" stroke-linecap="round" d="M5.25 6.5H8.5"/>' +
                '<rect x="8.5" y="4.5" width="5" height="4" rx="1" stroke="var(--icon-stroke)" stroke-width="1.5"/>' +
                '<rect x="8.5" y="11" width="5" height="4" rx="1" stroke="var(--icon-stroke)" stroke-width="1.5"/>' +
                "</svg>";
            control.append(checkbox, labelSpan);

            checkbox.addEventListener("change", () => {
                window.setDinextKanbanShowChildTasks?.(checkbox.checked);
            });

            host.insertBefore(control, insertBeforeNode);
        }

        const checkbox = control.querySelector('input[type="checkbox"]');
        if (checkbox) {
            const preferred = window.__dinextKanbanStore
                ? Boolean(window.__dinextKanbanStore.state.show_child_tasks)
                : this.getShowChildTasksPreference();
            checkbox.checked = preferred;
            if (!window.__dinextKanbanStore) {
                window.setDinextKanbanShowChildTasks?.(preferred, { persist: false });
            }
        }

        this.$show_child_tasks_control = control;
    }

    remove_show_child_tasks_control() {
        const control = this.$show_child_tasks_control
            || document.querySelector(".dinext-kanban-show-child-tasks-control");
        control?.remove?.();
        this.$show_child_tasks_control = null;
    }

    getSwimlaneFieldValue() {
        return String(this.board?.custom_swimlane_field || "").trim();
    }

    getGroupByNoneLabel() {
        return __("No Grouping", null, "DinextKanban.Board");
    }

    updateGroupByButtonLabel() {
        const control = this.$groupby_control
            || document.querySelector(".dinext-kanban-groupby-control");
        const textEl = control?.querySelector?.(".dropdown-text");
        if (!textEl) {
            return;
        }
        const value = this.getSwimlaneFieldValue();
        const labels = this._groupby_labels || {};
        textEl.textContent = value
            ? (labels[value] || value)
            : this.getGroupByNoneLabel();
    }

    setup_groupby_control() {
        if (!this.canEditBoardSettings()) {
            this.remove_groupby_control();
            return;
        }

        const placement = this.resolveCustomActionsHost();
        if (!placement) {
            return;
        }
        const { host, insertBeforeNode } = placement;

        let control = host.querySelector(".dinext-kanban-groupby-control");
        if (!control) {
            control = document.createElement("div");
            control.className = "dinext-kanban-groupby-control";

            const btnGroup = document.createElement("div");
            btnGroup.className = "btn-group";

            const groupByLabel = __("Group By", null, "DinextKanban.Board");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn btn-default btn-sm dropdown-toggle";
            button.setAttribute("data-toggle", "dropdown");
            button.setAttribute("aria-haspopup", "true");
            button.setAttribute("aria-expanded", "false");
            button.setAttribute("title", groupByLabel);
            button.setAttribute("aria-label", groupByLabel);

            const dropdownText = document.createElement("span");
            dropdownText.className = "dropdown-text";
            dropdownText.textContent = this.getGroupByNoneLabel();
            button.append(dropdownText);

            const menu = document.createElement("ul");
            menu.className = "dropdown-menu dropdown-menu-right";

            btnGroup.append(button, menu);
            control.append(btnGroup);
            host.insertBefore(control, insertBeforeNode);
        }

        this.$groupby_control = control;
        this._groupby_labels = this._groupby_labels || {};
        this.updateGroupByButtonLabel();
        this.load_groupby_options();
    }

    load_groupby_options() {
        const doctype = this.board?.reference_doctype || this.doctype;
        const control = this.$groupby_control;
        if (!doctype || !control) {
            return;
        }

        const requestToken = Symbol("groupby-options");
        this._groupby_options_token = requestToken;

        frappe.call({
            method: "dinext_kanban.api.get_swimlane_field_options",
            args: {
                doctype,
                board_name: this.board_name || this.board?.name || "",
            },
            callback: (r) => {
                if (this._groupby_options_token !== requestToken) {
                    return;
                }
                const rows = r.message || [];
                this._groupby_labels = {};
                for (const row of rows) {
                    const value = typeof row === "string" ? row : row.value;
                    const label = typeof row === "string"
                        ? row
                        : (row.label || row.value);
                    if (value) {
                        this._groupby_labels[value] = label;
                    }
                }
                this.render_groupby_menu(rows);
                this.updateGroupByButtonLabel();
            },
        });
    }

    render_groupby_menu(rows) {
        const control = this.$groupby_control;
        const menu = control?.querySelector?.(".dropdown-menu");
        if (!menu) {
            return;
        }

        menu.replaceChildren();
        const current = this.getSwimlaneFieldValue();
        const options = [
            { value: "", label: this.getGroupByNoneLabel() },
            ...rows.map((row) => (
                typeof row === "string"
                    ? { value: row, label: row }
                    : { value: row.value, label: row.label || row.value }
            )),
        ];

        for (const option of options) {
            const li = document.createElement("li");
            const link = document.createElement("a");
            link.className = "dropdown-item option";
            if (option.value === current) {
                link.classList.add("active");
            }
            link.href = "#";
            link.setAttribute("data-value", option.value);
            link.textContent = option.label;
            link.addEventListener("click", (event) => {
                event.preventDefault();
                this.apply_groupby_field(option.value);
            });
            li.append(link);
            menu.append(li);
        }
    }

    apply_groupby_field(swimlane_field) {
        const boardName = this.board_name || this.board?.name;
        if (!boardName || this._groupby_saving) {
            return;
        }

        const nextValue = String(swimlane_field || "").trim();
        if (nextValue === this.getSwimlaneFieldValue()) {
            return;
        }

        this._groupby_saving = true;
        const control = this.$groupby_control;
        control?.classList?.add("is-saving");

        frappe.call({
            method: "dinext_kanban.api.set_swimlane_field",
            args: {
                board_name: boardName,
                swimlane_field: nextValue,
            },
            callback: (r) => {
                const saved = r.message?.custom_swimlane_field ?? nextValue;
                if (this.board) {
                    this.board.custom_swimlane_field = saved;
                }
                this.updateGroupByButtonLabel();
                this.render_groupby_menu(
                    Object.entries(this._groupby_labels || {}).map(([value, label]) => ({
                        value,
                        label,
                    })),
                );
                const store = window.__dinextKanbanStore;
                if (store?.dispatch) {
                    store.dispatch("refreshBoard", {
                        board_name: boardName,
                        forceConfig: true,
                    });
                }
            },
            error: () => {
                this.updateGroupByButtonLabel();
            },
            always: () => {
                this._groupby_saving = false;
                control?.classList?.remove("is-saving");
            },
        });
    }

    remove_groupby_control() {
        const control = this.$groupby_control
            || document.querySelector(".dinext-kanban-groupby-control");
        control?.remove?.();
        this.$groupby_control = null;
        this._groupby_labels = null;
        this._groupby_options_token = null;
    }

    render() {
        const renderToken = Symbol("dinext-kanban-render");
        this.dinext_kanban_render_token = renderToken;

        Promise.resolve()
            .then(() => {
                if (this.dinext_kanban_render_token !== renderToken) return;
                if (!bootstrap) {
                    throw new Error("Dinext Kanban bootstrap is unavailable");
                }
                return this.renderBeta();
            })
            .catch(() => {
                if (this.dinext_kanban_render_token !== renderToken) return;
                frappe.show_alert({
                    message: __("Dinext Kanban could not start. Using the standard Kanban view."),
                    indicator: "orange",
                });
                this.remove_minimize_cards_control();
                this.remove_show_child_tasks_control();
                this.remove_groupby_control();
                this.renderOld();
            });
    }

    setup_page_head_controls() {
        this.setup_minimize_cards_control();
        this.setup_show_child_tasks_control();
        this.setup_groupby_control();
    }

    async renderBeta() {
        const initialData = {
            board: this.board,
            cards: this.data,
            args: this.get_args(),
            board_perms: this.board_perms || {},
        };
        const mountNode = this.$result.find("#kanbanapp")[0] || null;

        this.setup_page_head_controls();

        if (mountNode && window.isDinextKanbanMountedOn?.(mountNode) && window.hydrateDinextKanban) {
            window.hydrateDinextKanban(initialData);
            return;
        }

        if (mountNode) {
            window.unmountDinextKanban?.();
            window.dinextKanbanInitialData = initialData;
            try {
                await ensureDinextKanbanBundle();
                window.mountDinextKanban?.(mountNode);
                this.setup_page_head_controls();
            } catch {
                delete window.dinextKanbanInitialData;
                this.remove_minimize_cards_control();
                this.remove_show_child_tasks_control();
                this.remove_groupby_control();
                frappe.show_alert({
                    message: __("Dinext Kanban failed to load. Using the standard Kanban view."),
                    indicator: "orange",
                });
                this.renderOld();
            }
            return;
        }

        window.unmountDinextKanban?.();
        window.dinextKanbanInitialData = initialData;
        this.$result.html(`<div id="kanbanapp"></div>`);
        try {
            await ensureDinextKanbanBundle();
            window.mountDinextKanban?.(this.$result.find("#kanbanapp")[0]);
            this.setup_page_head_controls();
        } catch {
            delete window.dinextKanbanInitialData;
            this.remove_minimize_cards_control();
            this.remove_show_child_tasks_control();
            this.remove_groupby_control();
            frappe.show_alert({
                message: __("Dinext Kanban failed to load. Using the standard Kanban view."),
                indicator: "orange",
            });
            this.renderOld();
        }
    }

    renderOld() {
        this.remove_minimize_cards_control();
        this.remove_show_child_tasks_control();
        this.remove_groupby_control();
        const hadBetaMount = this.$result.find("#kanbanapp").length;
        window.unmountDinextKanban?.();
        if (hadBetaMount) this.$result.empty?.();
        const board_name = this.board_name;
        if (!this.kanban) {
            this.kanban = new frappe.views.KanbanBoard({
                doctype: this.doctype,
                board: this.board,
                board_name: board_name,
                cards: this.data,
                card_meta: this.card_meta,
                wrapper: this.$result,
                cur_list: this,
                user_settings: this.view_user_settings,
            });
        } else if (board_name === this.kanban.board_name) {
            this.kanban.update(this.data);
        }
    }

    show_kanban_settings() {
        normalizeBoardDoc(this.board);

        const board_name = this.board_name;
        const attachOpenBoardAction = () => {
            const dialog = window.cur_dialog;
            if (!dialog?.fields?.some?.((field) => field.fieldname === "show_labels")) {
                return;
            }

            dialog.set_secondary_action_label(__("Advanced Settings", null, "DinextKanban.Board"));
            dialog.set_secondary_action(() => {
                dialog.hide();
                // Drop any polluted locals so Form reloads a clean Code/JSON string.
                frappe.model?.clear_doc?.("Kanban Board", board_name);
                frappe.set_route("Form", "Kanban Board", board_name);
            });
        };

        if (typeof $ !== "undefined") {
            $(document).one("frappe.ui.Dialog:shown", attachOpenBoardAction);
        }

        return super.show_kanban_settings();
    }
};

frappe.views.KanbanView = DinextKanbanView;

function isKanbanRoute(route) {
    return Array.isArray(route)
        && route[0] === "List"
        && route[2] === "Kanban";
}

async function upgradeActiveKanbanView() {
    const active = window.cur_list;
    if (!active || active.__dinextKanbanUpgraded || active.constructor === DinextKanbanView) {
        return;
    }

    if (!isKanbanRoute(frappe.get_route?.())) {
        return;
    }

    if (!bootstrap) {
        return;
    }

    active.__dinextKanbanUpgraded = true;
    Object.setPrototypeOf(active, DinextKanbanView.prototype);

    try {
        await active.setup_defaults?.();
    } catch {
        // setup_defaults may have already completed for the native instance.
    }

    try {
        await active.set_fields?.();
    } catch {
        // Field setup errors are retried on the next refresh/render cycle.
    }

    try {
        await active.refresh?.();
    } catch {
        // If refresh fails, the next user interaction will retry render.
    }
}

upgradeActiveKanbanView();
