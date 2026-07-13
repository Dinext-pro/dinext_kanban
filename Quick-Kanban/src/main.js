import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import store from './utils/store'
import {
  readMinimizeCardsPreference,
  writeMinimizeCardsPreference,
} from './utils/kanban'

window.frappe = frappe
window.__quickKanbanStore = store

let createFormHandler = null

function bindCreateFormHooks(doctype) {
  if (!doctype || !frappe.ui?.form?.on) {
    return
  }
  if (createFormHandler?.doctype === doctype) {
    return
  }
  if (createFormHandler) {
    frappe.ui.form.off(createFormHandler.doctype, createFormHandler.events)
  }
  const events = {
    after_save(doc) {
      const kanbanStore = window.__quickKanbanStore
      if (!kanbanStore?.state?.pendingCreate) {
        return
      }
      kanbanStore.dispatch('handleCardCreated', { doc })
    },
    after_cancel() {
      window.__quickKanbanStore?.commit('CLEAR_PENDING_CREATE')
    },
  }
  frappe.ui.form.on(doctype, events)
  createFormHandler = { doctype, events }
}

function syncMinimizeCheckbox(value) {
  const input = document.querySelector(
    '.quick-kanban-minimize-control input[type="checkbox"]',
  )
  if (input && input.checked !== value) {
    input.checked = value
  }
}

function applyMinimizePreference(boardName) {
  const value = readMinimizeCardsPreference(boardName)
  store.commit('SET_MINIMIZE_CARDS', value)
  syncMinimizeCheckbox(value)
  return value
}

window.setQuickKanbanMinimizeCards = (value, { persist = true } = {}) => {
  const next = Boolean(value)
  store.commit('SET_MINIMIZE_CARDS', next)
  if (persist) {
    writeMinimizeCardsPreference(store.state.config.board_name, next)
  }
  syncMinimizeCheckbox(next)
  return next
}

store.subscribe((mutation, state) => {
  if (mutation.type === 'SET_KANBAN_CONFIG') {
    const doctype = mutation.payload?.ref_doctype
    if (doctype) {
      bindCreateFormHooks(doctype)
    }
    applyMinimizePreference(state.config.board_name)
    return
  }
})

if (store.state.config?.ref_doctype) {
  bindCreateFormHooks(store.state.config.ref_doctype)
}
applyMinimizePreference(store.state.config?.board_name)

let app
let mountedTarget

window.isQuickKanbanMountedOn = (target) => (
  Boolean(app && mountedTarget && target === mountedTarget)
)

window.mountQuickKanban = (target) => {
  const el = target || document.querySelector('#kanbanapp')
  if (!el) return
  if (mountedTarget === el && app) return

  if (app) {
    app.unmount()
    if (mountedTarget?.__vue_app__) {
      delete mountedTarget.__vue_app__
    }
    app = undefined
    mountedTarget = undefined
    delete window.refreshKanbanBoard
    delete window.hydrateQuickKanban
  }

  app = createApp(App)
  app.use(store)
  app.mount(el)
  mountedTarget = el
}

window.unmountQuickKanban = () => {
  if (!app) return
  app.unmount()
  if (mountedTarget?.__vue_app__) {
    delete mountedTarget.__vue_app__
  }
  app = undefined
  mountedTarget = undefined
  delete window.refreshKanbanBoard
  delete window.hydrateQuickKanban
}
