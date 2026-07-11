import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import store from './utils/store'

window.frappe = frappe

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
