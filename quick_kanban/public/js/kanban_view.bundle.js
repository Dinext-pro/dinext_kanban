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

function normalizeBoardDoc(board) {
    if (!board) {
        return;
    }

    if (typeof board.fields === "string") {
        try {
            board.fields = JSON.parse(board.fields || "[]");
        } catch {
            board.fields = [];
        }
    }

    if (!Array.isArray(board.fields)) {
        board.fields = [];
    }

    if (typeof board.filters === "string") {
        try {
            board.filters_array = JSON.parse(board.filters || "[]");
        } catch {
            board.filters_array = [];
        }
    }
}

const QuickKanbanView = class KanbanView extends NativeKanbanView {
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

    setup_minimize_cards_control() {
        const filterSelector = this.resolveFilterSelector();
        if (!filterSelector?.parentNode) {
            return;
        }

        // Prefer sibling of .filter-section under .custom-actions so we don't
        // inflate the filter row or fight Bootstrap label styles inside it.
        const filterSection = filterSelector.closest?.(".filter-section")
            || (filterSelector.parentNode?.classList?.contains?.("filter-section")
                ? filterSelector.parentNode
                : null);
        const host = filterSection?.parentNode || filterSelector.parentNode;
        const insertBeforeNode = filterSection || filterSelector;

        let control = host.querySelector(".quick-kanban-minimize-control");

        if (!control) {
            const labelText = __("Minimize", null, "QuickKanban.Board");
            control = document.createElement("label");
            control.className = "quick-kanban-minimize-control";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            const labelSpan = document.createElement("span");
            labelSpan.className = "quick-kanban-minimize-label";
            labelSpan.textContent = labelText;
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
                this.renderOld();
            })
            .catch(() => {
                if (this.quick_kanban_render_token !== renderToken) return;
                frappe.show_alert({
                    message: __("Quick Kanban could not start. Using the standard Kanban view."),
                    indicator: "orange",
                });
                this.remove_minimize_cards_control();
                this.renderOld();
            });
    }

    async renderBeta() {
        const initialData = {
            board: this.board,
            cards: this.data,
            args: this.get_args(),
            board_perms: this.board_perms || {},
        };
        const mountNode = this.$result.find("#kanbanapp")[0] || null;

        this.setup_minimize_cards_control();

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
                this.setup_minimize_cards_control();
            } catch {
                delete window.quickKanbanInitialData;
                this.remove_minimize_cards_control();
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
            this.setup_minimize_cards_control();
        } catch {
            delete window.quickKanbanInitialData;
            this.remove_minimize_cards_control();
            frappe.show_alert({
                message: __("Quick Kanban failed to load. Using the standard Kanban view."),
                indicator: "orange",
            });
            this.renderOld();
        }
    }

    renderOld() {
        this.remove_minimize_cards_control();
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

            dialog.set_secondary_action_label(__("Open Kanban Board"));
            dialog.set_secondary_action(() => {
                dialog.hide();
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
