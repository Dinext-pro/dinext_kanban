(function setupQuickKanbanBootstrap(global) {
  const scriptLoads = new Map()
  const stylesheetLoads = new Map()
  const KANBAN_VIEW_URL = '/assets/quick_kanban/js/kanban_view.bundle.js'

  async function loadConfig(call) {
    const response = await call({
      method: 'quick_kanban.get_beta_users.get_kanban_config',
    })
    return response?.message || {}
  }

  function shouldUseBeta(config, user) {
    if (!config?.kanban_beta) return false

    const allowedUsers = Array.isArray(config.kanban_beta_users)
      ? config.kanban_beta_users
      : []
    return allowedUsers.length === 0 || allowedUsers.includes(user)
  }

  function loadScript(src, documentRef = global.document) {
    if (scriptLoads.has(src)) return scriptLoads.get(src)

    const existing = documentRef.querySelector(`script[src="${src}"]`)
    if (existing?.dataset.loaded === 'true') {
      return Promise.resolve(existing)
    }

    const script = existing || documentRef.createElement('script')
    const load = new Promise((resolve, reject) => {
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true'
        resolve(script)
      }, { once: true })
      script.addEventListener('error', () => {
        scriptLoads.delete(src)
        reject(new Error(`Failed to load ${src}`))
      }, { once: true })
    })

    scriptLoads.set(src, load)
    if (!existing) {
      script.src = src
      documentRef.head.appendChild(script)
    }
    return load
  }

  function loadStylesheet(href, documentRef = global.document) {
    if (stylesheetLoads.has(href)) return stylesheetLoads.get(href)

    const existing = documentRef.querySelector(`link[rel="stylesheet"][href="${href}"]`)
    if (existing?.dataset.loaded === 'true') {
      return Promise.resolve(existing)
    }

    const link = existing || documentRef.createElement('link')
    const load = new Promise((resolve, reject) => {
      link.addEventListener('load', () => {
        link.dataset.loaded = 'true'
        resolve(link)
      }, { once: true })
      link.addEventListener('error', () => {
        stylesheetLoads.delete(href)
        reject(new Error(`Failed to load ${href}`))
      }, { once: true })
    })

    stylesheetLoads.set(href, load)
    if (!existing) {
      link.rel = 'stylesheet'
      link.href = href
      documentRef.head.appendChild(link)
    }
    return load
  }

  function waitForKanbanView(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const check = () => {
        if (global.frappe?.views?.KanbanView) {
          resolve(global.frappe.views.KanbanView)
          return
        }
        if (Date.now() - started >= timeoutMs) {
          reject(new Error('KanbanView is unavailable'))
          return
        }
        global.setTimeout(check, 50)
      }
      check()
    })
  }

  let bridgePromise

  async function ensureKanbanViewBridge() {
    if (global.__quickKanbanViewInstalled) return true

    if (bridgePromise) {
      const installed = await bridgePromise
      if (installed) return true
      bridgePromise = null
    }

    bridgePromise = (async () => {
      if (!global.frappe?.call) return false

      const config = await loadConfig(global.frappe.call.bind(global.frappe))
      const user = global.frappe.session?.user || ''
      if (!shouldUseBeta(config, user)) return false

      await waitForKanbanView()
      if (global.__quickKanbanViewInstalled) return true

      await loadScript(KANBAN_VIEW_URL)
      global.__quickKanbanViewInstalled = true
      return true
    })().catch(() => false)

    return bridgePromise
  }

  function scheduleKanbanViewBridge() {
    const boot = () => {
      ensureKanbanViewBridge()
    }

    if (global.frappe?.ready) {
      global.frappe.ready(boot)
      return
    }

    global.addEventListener('DOMContentLoaded', boot)
  }

  global.quickKanbanBootstrap = {
    loadConfig,
    loadScript,
    loadStylesheet,
    shouldUseBeta,
    ensureKanbanViewBridge,
  }

  scheduleKanbanViewBridge()
})(window)
