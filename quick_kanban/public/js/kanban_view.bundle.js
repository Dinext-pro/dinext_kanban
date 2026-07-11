frappe.provide("frappe.views");

const NativeKanbanView = frappe.views.KanbanView;
const bootstrap = window.quickKanbanBootstrap;
let configPromise;
const getConfig = () => {
    if (!bootstrap) {
        return Promise.reject(new Error("Quick Kanban bootstrap is unavailable"));
    }
    if (!configPromise) {
        configPromise = bootstrap.loadConfig(frappe.call.bind(frappe));
    }
    return configPromise;
};

frappe.views.KanbanView = class KanbanView extends NativeKanbanView {
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
        if (this.$result.find("#kanbanapp").length && window.hydrateQuickKanban) {
            window.hydrateQuickKanban(initialData);
            return;
        }

        window.unmountQuickKanban?.();
        window.quickKanbanInitialData = initialData;
        this.$result.html(`<div id="kanbanapp"></div>`);
        try {
            const cssUrl = frappe.assets.bundled_asset("quick_kanban.bundle.css");
            const bundleUrl = frappe.assets.bundled_asset("quick_kanban.bundle.js");
            await bootstrap.loadStylesheet(cssUrl);
            await bootstrap.loadScript(bundleUrl);
            window.mountQuickKanban?.();
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
