frappe.provide("frappe.views");

const NativeKanbanView = frappe.views.KanbanView;
const bootstrap = window.quickKanbanBootstrap;
let configPromise;

function removeStaleQuickKanbanStylesheets(href) {
    document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
        const linkHref = link.getAttribute("href") || "";
        if (linkHref.includes("quick_kanban.bundle") && linkHref !== href) {
            link.remove();
        }
    });
}

function loadStylesheet(href) {
    if (bootstrap?.loadStylesheet) {
        return bootstrap.loadStylesheet(href);
    }

    return new Promise((resolve, reject) => {
        removeStaleQuickKanbanStylesheets(href);

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

function removeStaleQuickKanbanScripts(href) {
    document.querySelectorAll("script[src*='quick_kanban.bundle']").forEach((script) => {
        const src = script.getAttribute("src") || "";
        if (src.includes("quick_kanban.bundle") && src !== href) {
            bootstrap?.forgetScript?.(src);
            script.remove();
        }
    });
}

/**
 * nginx caches /assets/* for 1y, including assets.json. Desk boot can also
 * keep a stale assets map for the whole SPA session. Refresh the map with a
 * cache-busted fetch so rebuilds load the new hashed quick_kanban bundle.
 */
async function refreshQuickKanbanAssetMap() {
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

async function ensureQuickKanbanBundle() {
    await refreshQuickKanbanAssetMap();
    const cssUrl = frappe.assets.bundled_asset("quick_kanban.bundle.css");
    const bundleUrl = frappe.assets.bundled_asset("quick_kanban.bundle.js");
    const existing = document.querySelector("script[src*='quick_kanban.bundle']");
    const existingSrc = existing?.getAttribute("src") || "";
    if (existingSrc && existingSrc !== bundleUrl) {
        window.unmountQuickKanban?.();
        delete window.mountQuickKanban;
        delete window.hydrateQuickKanban;
        delete window.isQuickKanbanMountedOn;
        removeStaleQuickKanbanScripts(bundleUrl);
    }
    await loadStylesheet(cssUrl);
    const hasCurrentScript = Boolean(document.querySelector(`script[src="${bundleUrl}"]`));
    if (!hasCurrentScript || !window.mountQuickKanban) {
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

const getConfig = () => {
    if (!bootstrap) {
        return Promise.reject(new Error("Quick Kanban bootstrap is unavailable"));
    }
    if (!configPromise) {
        configPromise = bootstrap.loadConfig(frappe.call.bind(frappe));
    }
    return configPromise;
};

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

const QuickKanbanView = class KanbanView extends NativeKanbanView {
    set_board_perms_and_push_menu_items() {
        // Perms arrive async after first paint; remount Group By when write is known.
        return Promise.resolve(super.set_board_perms_and_push_menu_items()).then(() => {
            if (!bootstrap?.shouldUseBeta) {
                this.setup_groupby_control();
                return;
            }
            return getConfig()
                .then((config) => {
                    if (bootstrap.shouldUseBeta(config, frappe.session.user)) {
                        this.setup_groupby_control();
                    }
                })
                .catch(() => {});
        });
    }

    async setup_defaults() {
        await super.setup_defaults();
        try {
            const config = await getConfig();
            if (bootstrap.shouldUseBeta(config, frappe.session.user)) {
                this.page_length = 100;
            }
        } catch {
            // The render path falls back to the native board.
        }
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
        let useBeta = false;
        try {
            const config = await getConfig();
            useBeta = bootstrap.shouldUseBeta(config, frappe.session.user);
        } catch {
            return super.set_fields();
        }
        if (!useBeta) return super.set_fields();

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
            return localStorage.getItem(`quick_kanban:minimize_cards:${boardName}`) === "1";
        } catch {
            return false;
        }
    }

    getShowChildTasksPreference() {
        const boardName = this.board_name || this.board?.name || "";
        try {
            return localStorage.getItem(`quick_kanban:show_child_tasks:${boardName}`) === "1";
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
        return Boolean(window.__quickKanbanStore?.getters?.canEditBoard);
    }

    setup_minimize_cards_control() {
        const placement = this.resolveCustomActionsHost();
        if (!placement) {
            return;
        }
        const { host, insertBeforeNode } = placement;

        let control = host.querySelector(".quick-kanban-minimize-control");

        if (!control) {
            const labelText = __("Minimize", null, "QuickKanban.Board");
            control = document.createElement("label");
            control.className = "quick-kanban-minimize-control";
            control.setAttribute("title", labelText);
            control.setAttribute("aria-label", labelText);

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            const labelSpan = document.createElement("span");
            labelSpan.className = "quick-kanban-minimize-label";
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
                window.setQuickKanbanMinimizeCards?.(checkbox.checked);
            });

            host.insertBefore(control, insertBeforeNode);
        }

        const checkbox = control.querySelector('input[type="checkbox"]');
        if (checkbox) {
            const preferred = window.__quickKanbanStore
                ? Boolean(window.__quickKanbanStore.state.minimize_cards)
                : this.getMinimizeCardsPreference();
            checkbox.checked = preferred;
            if (!window.__quickKanbanStore) {
                window.setQuickKanbanMinimizeCards?.(preferred, { persist: false });
            }
        }

        this.$minimize_cards_control = control;
    }

    remove_minimize_cards_control() {
        const control = this.$minimize_cards_control
            || document.querySelector(".quick-kanban-minimize-control");
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

        let control = host.querySelector(".quick-kanban-show-child-tasks-control");

        if (!control) {
            const labelText = __("Show child tasks", null, "QuickKanban.Board");
            control = document.createElement("label");
            control.className = "quick-kanban-show-child-tasks-control";
            control.setAttribute("title", labelText);
            control.setAttribute("aria-label", labelText);

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            const labelSpan = document.createElement("span");
            labelSpan.className = "quick-kanban-show-child-tasks-label";
            labelSpan.setAttribute("aria-hidden", "true");
            // Same glyph as card child-count badge (#es-line-bullet-list).
            labelSpan.innerHTML =
                '<svg class="icon icon-sm" aria-hidden="true"><use href="#es-line-bullet-list"></use></svg>';
            control.append(checkbox, labelSpan);

            checkbox.addEventListener("change", () => {
                window.setQuickKanbanShowChildTasks?.(checkbox.checked);
            });

            host.insertBefore(control, insertBeforeNode);
        }

        const checkbox = control.querySelector('input[type="checkbox"]');
        if (checkbox) {
            const preferred = window.__quickKanbanStore
                ? Boolean(window.__quickKanbanStore.state.show_child_tasks)
                : this.getShowChildTasksPreference();
            checkbox.checked = preferred;
            if (!window.__quickKanbanStore) {
                window.setQuickKanbanShowChildTasks?.(preferred, { persist: false });
            }
        }

        this.$show_child_tasks_control = control;
    }

    remove_show_child_tasks_control() {
        const control = this.$show_child_tasks_control
            || document.querySelector(".quick-kanban-show-child-tasks-control");
        control?.remove?.();
        this.$show_child_tasks_control = null;
    }

    getSwimlaneFieldValue() {
        return String(this.board?.custom_swimlane_field || "").trim();
    }

    getGroupByNoneLabel() {
        return __("No Grouping", null, "QuickKanban.Board");
    }

    updateGroupByButtonLabel() {
        const control = this.$groupby_control
            || document.querySelector(".quick-kanban-groupby-control");
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

        let control = host.querySelector(".quick-kanban-groupby-control");
        if (!control) {
            control = document.createElement("div");
            control.className = "quick-kanban-groupby-control";

            const btnGroup = document.createElement("div");
            btnGroup.className = "btn-group";

            const groupByLabel = __("Group By", null, "QuickKanban.Board");
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
            method: "quick_kanban.api.get_swimlane_field_options",
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
            method: "quick_kanban.api.set_swimlane_field",
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
                const store = window.__quickKanbanStore;
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
            || document.querySelector(".quick-kanban-groupby-control");
        control?.remove?.();
        this.$groupby_control = null;
        this._groupby_labels = null;
        this._groupby_options_token = null;
    }

    render() {
        const renderToken = Symbol("quick-kanban-render");
        this.quick_kanban_render_token = renderToken;

        getConfig()
            .then((config) => {
                if (this.quick_kanban_render_token !== renderToken) return;
                if (bootstrap.shouldUseBeta(config, frappe.session.user)) {
                    return this.renderBeta();
                }
                this.remove_minimize_cards_control();
                this.remove_show_child_tasks_control();
                this.remove_groupby_control();
                this.renderOld();
            })
            .catch(() => {
                if (this.quick_kanban_render_token !== renderToken) return;
                frappe.show_alert({
                    message: __("Quick Kanban could not start. Using the standard Kanban view."),
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

        if (mountNode && window.isQuickKanbanMountedOn?.(mountNode) && window.hydrateQuickKanban) {
            window.hydrateQuickKanban(initialData);
            return;
        }

        if (mountNode) {
            window.unmountQuickKanban?.();
            window.quickKanbanInitialData = initialData;
            try {
                await ensureQuickKanbanBundle();
                window.mountQuickKanban?.(mountNode);
                this.setup_page_head_controls();
            } catch {
                delete window.quickKanbanInitialData;
                this.remove_minimize_cards_control();
                this.remove_show_child_tasks_control();
                this.remove_groupby_control();
                frappe.show_alert({
                    message: __("Quick Kanban failed to load. Using the standard Kanban view."),
                    indicator: "orange",
                });
                this.renderOld();
            }
            return;
        }

        window.unmountQuickKanban?.();
        window.quickKanbanInitialData = initialData;
        this.$result.html(`<div id="kanbanapp"></div>`);
        try {
            await ensureQuickKanbanBundle();
            window.mountQuickKanban?.(this.$result.find("#kanbanapp")[0]);
            this.setup_page_head_controls();
        } catch {
            delete window.quickKanbanInitialData;
            this.remove_minimize_cards_control();
            this.remove_show_child_tasks_control();
            this.remove_groupby_control();
            frappe.show_alert({
                message: __("Quick Kanban failed to load. Using the standard Kanban view."),
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
        window.unmountQuickKanban?.();
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

            dialog.set_secondary_action_label(__("Advanced Settings", null, "QuickKanban.Board"));
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

frappe.views.KanbanView = QuickKanbanView;

function isKanbanRoute(route) {
    return Array.isArray(route)
        && route[0] === "List"
        && route[2] === "Kanban";
}

async function upgradeActiveKanbanView() {
    const active = window.cur_list;
    if (!active || active.__quickKanbanUpgraded || active.constructor === QuickKanbanView) {
        return;
    }

    if (!isKanbanRoute(frappe.get_route?.())) {
        return;
    }

    try {
        const config = await getConfig();
        if (!bootstrap?.shouldUseBeta(config, frappe.session.user)) {
            return;
        }
    } catch {
        return;
    }

    active.__quickKanbanUpgraded = true;
    Object.setPrototypeOf(active, QuickKanbanView.prototype);

    try {
        await active.setup_defaults?.();
    } catch {
        // setup_defaults may have already completed for the native instance.
    }

    try {
        await active.set_fields?.();
    } catch {
        // Field setup falls back to native behavior when config is unavailable.
    }

    try {
        await active.refresh?.();
    } catch {
        // If refresh fails, the next user interaction will retry render.
    }
}

upgradeActiveKanbanView();
