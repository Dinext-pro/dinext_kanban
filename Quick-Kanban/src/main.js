import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import store from './utils/store'

window.frappe = frappe

let app

window.mountQuickKanban = () => {
  const target = document.querySelector('#kanbanapp')
  if (!target || target.__vue_app__) return

  app = createApp(App)
  app.use(store)
  app.mount(target)
}

window.unmountQuickKanban = () => {
  if (!app) return
  app.unmount()
  app = undefined
  delete window.refreshKanbanBoard
}