(function setupDinextKanbanBootstrap(global) {
  const scriptLoads = new Map()
  const stylesheetLoads = new Map()
  const KANBAN_VIEW_FALLBACK_URL = '/assets/dinext_kanban/js/kanban_view.bundle.js'

  function resolveKanbanViewUrl() {
    return global.frappe?.assets?.bundled_asset?.('kanban_view.bundle.js')
      || KANBAN_VIEW_FALLBACK_URL
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

  function forgetScript(src) {
    scriptLoads.delete(src)
  }

  function removeStaleDinextKanbanStylesheets(href, documentRef = global.document) {
    documentRef.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const linkHref = link.getAttribute('href') || ''
      if (linkHref.includes('dinext_kanban.bundle') && linkHref !== href) {
        stylesheetLoads.delete(linkHref)
        link.remove()
      }
    })
  }

  function loadStylesheet(href, documentRef = global.document) {
    if (stylesheetLoads.has(href)) return stylesheetLoads.get(href)

    removeStaleDinextKanbanStylesheets(href, documentRef)

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
    if (global.__dinextKanbanViewInstalled) return true

    if (bridgePromise) {
      const installed = await bridgePromise
      if (installed) return true
      bridgePromise = null
    }

    bridgePromise = (async () => {
      await waitForKanbanView()
      if (global.__dinextKanbanViewInstalled) return true

      await loadScript(resolveKanbanViewUrl())
      global.__dinextKanbanViewInstalled = true
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

  global.dinextKanbanBootstrap = {
    loadScript,
    forgetScript,
    loadStylesheet,
    ensureKanbanViewBridge,
  }

  scheduleKanbanViewBridge()
})(window)
