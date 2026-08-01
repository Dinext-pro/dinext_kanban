import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import store from './utils/store'
import {
  readCollapsedColumnsPreference,
  readExpandedLanesPreference,
  readMinimizeCardsPreference,
  readShowChildTasksPreference,
  writeCollapsedColumnsPreference,
  writeExpandedLanesPreference,
  writeMinimizeCardsPreference,
  writeShowChildTasksPreference,
} from './utils/kanban'

window.frappe = frappe
window.__dinextKanbanStore = store

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
      const kanbanStore = window.__dinextKanbanStore
      if (!kanbanStore?.state?.pendingCreate) {
        return
      }
      kanbanStore.dispatch('handleCardCreated', { doc })
    },
    after_cancel() {
      window.__dinextKanbanStore?.commit('CLEAR_PENDING_CREATE')
    },
  }
  frappe.ui.form.on(doctype, events)
  createFormHandler = { doctype, events }
}

function syncMinimizeCheckbox(value) {
  const input = document.querySelector(
    '.dinext-kanban-minimize-control input[type="checkbox"]',
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

window.setDinextKanbanMinimizeCards = (value, { persist = true } = {}) => {
  const next = Boolean(value)
  store.commit('SET_MINIMIZE_CARDS', next)
  if (persist) {
    writeMinimizeCardsPreference(store.state.config.board_name, next)
  }
  syncMinimizeCheckbox(next)
  return next
}

function syncShowChildTasksCheckbox(value) {
  const input = document.querySelector(
    '.dinext-kanban-show-child-tasks-control input[type="checkbox"]',
  )
  if (input && input.checked !== value) {
    input.checked = value
  }
}

function applyShowChildTasksPreference(boardName) {
  const value = readShowChildTasksPreference(boardName)
  store.commit('SET_SHOW_CHILD_TASKS', value)
  syncShowChildTasksCheckbox(value)
  return value
}

window.setDinextKanbanShowChildTasks = (value, { persist = true } = {}) => {
  const next = Boolean(value)
  const previous = Boolean(store.state.show_child_tasks)
  store.commit('SET_SHOW_CHILD_TASKS', next)
  if (persist) {
    writeShowChildTasksPreference(store.state.config.board_name, next)
  }
  syncShowChildTasksCheckbox(next)
  if (previous !== next) {
    return Promise.resolve(store.dispatch('refreshBoard')).then(() => next)
  }
  return next
}

function applyCollapsedColumnsPreference(boardName) {
  const value = readCollapsedColumnsPreference(boardName)
  store.commit('SET_COLLAPSED_COLUMNS', value)
  return value
}

function applyExpandedLanePreference(boardName) {
  const value = readExpandedLanesPreference(boardName)
  store.commit('SET_EXPANDED_LANE_KEYS', value)
  return value
}

window.setDinextKanbanColumnCollapsed = (columnKey, collapsed, { persist = true } = {}) => {
  if (!columnKey) {
    return store.state.collapsedColumns
  }
  store.commit('SET_COLUMN_COLLAPSED', {
    columnKey,
    collapsed: Boolean(collapsed),
  })
  if (persist) {
    writeCollapsedColumnsPreference(
      store.state.config.board_name,
      store.state.collapsedColumns,
    )
  }
  return store.state.collapsedColumns
}

store.subscribe((mutation, state) => {
  if (mutation.type === 'SET_KANBAN_CONFIG') {
    const doctype = mutation.payload?.ref_doctype
    if (doctype) {
      bindCreateFormHooks(doctype)
    }
    applyMinimizePreference(state.config.board_name)
    applyShowChildTasksPreference(state.config.board_name)
    applyCollapsedColumnsPreference(state.config.board_name)
    applyExpandedLanePreference(state.config.board_name)
    return
  }
  if (
    mutation.type === 'SET_COLUMN_COLLAPSED'
    || mutation.type === 'REMOVE_COLUMN'
  ) {
    writeCollapsedColumnsPreference(
      state.config.board_name,
      state.collapsedColumns,
    )
  }
  if (
    mutation.type === 'SET_EXPANDED_LANE_KEYS'
    || mutation.type === 'TOGGLE_LANE_EXPANDED'
    || mutation.type === 'ADD_EXPANDED_LANE'
  ) {
    writeExpandedLanesPreference(
      state.config.board_name,
      state.expandedLaneKeys,
    )
  }
})

if (store.state.config?.ref_doctype) {
  bindCreateFormHooks(store.state.config.ref_doctype)
}
applyMinimizePreference(store.state.config?.board_name)
applyShowChildTasksPreference(store.state.config?.board_name)
applyCollapsedColumnsPreference(store.state.config?.board_name)
applyExpandedLanePreference(store.state.config?.board_name)

let app
let mountedTarget

window.isDinextKanbanMountedOn = (target) => (
  Boolean(app && mountedTarget && target === mountedTarget)
)

window.mountDinextKanban = (target) => {
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
    delete window.hydrateDinextKanban
  }

  app = createApp(App)
  app.use(store)
  app.mount(el)
  mountedTarget = el
}

window.unmountDinextKanban = () => {
  if (!app) return
  app.unmount()
  if (mountedTarget?.__vue_app__) {
    delete mountedTarget.__vue_app__
  }
  app = undefined
  mountedTarget = undefined
  delete window.refreshKanbanBoard
  delete window.hydrateDinextKanban
}
