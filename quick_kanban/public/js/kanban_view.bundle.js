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

        await frappe.views.ListView.prototype.set_fields.call(this);
        this._add_field(this.card_meta.title_field);
        (this.board.fields || []).forEach((field) => this._add_field(field));
        this._add_field(this.board.custom_highlighted_field);
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
                this.renderOld();
            })
            .catch(() => {
                if (this.quick_kanban_render_token !== renderToken) return;
                frappe.show_alert({
                    message: __("Quick Kanban could not start. Using the standard Kanban view."),
                    indicator: "orange",
                });
                this.renderOld();
            });
    }

    async renderBeta() {
        const initialData = {
            board: this.board,
            cards: this.data,
            args: this.get_args(),
        };
        const mountNode = this.$result.find("#kanbanapp")[0] || null;

        if (mountNode && window.isQuickKanbanMountedOn?.(mountNode) && window.hydrateQuickKanban) {
            window.hydrateQuickKanban(initialData);
            return;
        }

        if (mountNode) {
            window.unmountQuickKanban?.();
            window.quickKanbanInitialData = initialData;
            try {
                if (!window.mountQuickKanban) {
                    const cssUrl = frappe.assets.bundled_asset("quick_kanban.bundle.css");
                    const bundleUrl = frappe.assets.bundled_asset("quick_kanban.bundle.js");
                    await loadStylesheet(cssUrl);
                    await loadScript(bundleUrl);
                }
                window.mountQuickKanban?.(mountNode);
            } catch {
                delete window.quickKanbanInitialData;
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
            const cssUrl = frappe.assets.bundled_asset("quick_kanban.bundle.css");
            const bundleUrl = frappe.assets.bundled_asset("quick_kanban.bundle.js");
            await loadStylesheet(cssUrl);
            await loadScript(bundleUrl);
            window.mountQuickKanban?.(this.$result.find("#kanbanapp")[0]);
        } catch {
            delete window.quickKanbanInitialData;
            frappe.show_alert({
                message: __("Quick Kanban failed to load. Using the standard Kanban view."),
                indicator: "orange",
            });
            this.renderOld();
        }
    }

    renderOld() {
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
