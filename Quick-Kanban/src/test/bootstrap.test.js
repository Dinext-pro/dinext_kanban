import { beforeEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const bootstrapSource = readFileSync(
  resolve(process.cwd(), '../quick_kanban/public/js/kanban_bootstrap.js'),
  'utf8',
)

function installBootstrap({ scheduleBridge = true } = {}) {
  delete window.quickKanbanBootstrap
  delete window.__quickKanbanViewInstalled
  document.head.innerHTML = ''
  const source = scheduleBridge
    ? bootstrapSource
    : bootstrapSource.replace('  scheduleKanbanViewBridge()\n', '')
  new Function('window', source)(window)
}

beforeEach(() => {
  installBootstrap({ scheduleBridge: false })
})

test('loadConfig resolves the Frappe message', async () => {
  const call = vi.fn().mockResolvedValue({
    message: { kanban_beta: 1, kanban_beta_users: [] },
  })

  await expect(window.quickKanbanBootstrap.loadConfig(call)).resolves.toEqual({
    kanban_beta: 1,
    kanban_beta_users: [],
  })
})

describe('shouldUseBeta', () => {
  test('enables beta globally when no user allowlist exists', () => {
    expect(window.quickKanbanBootstrap.shouldUseBeta(
      { kanban_beta: 1, kanban_beta_users: [] },
      'user@example.com',
    )).toBe(true)
  })

  test('respects the per-user allowlist', () => {
    const config = {
      kanban_beta: 1,
      kanban_beta_users: ['allowed@example.com'],
    }

    expect(window.quickKanbanBootstrap.shouldUseBeta(
      config,
      'other@example.com',
    )).toBe(false)
  })
})

test('loadScript resolves after load and reuses the same element', async () => {
  const firstLoad = window.quickKanbanBootstrap.loadScript('/assets/kanban.js')
  const script = document.querySelector('script[src="/assets/kanban.js"]')

  expect(script).not.toBeNull()
  script.dispatchEvent(new Event('load'))
  await expect(firstLoad).resolves.toBe(script)

  await expect(
    window.quickKanbanBootstrap.loadScript('/assets/kanban.js'),
  ).resolves.toBe(script)
  expect(document.querySelectorAll('script[src="/assets/kanban.js"]')).toHaveLength(1)
})

test('loadScript rejects when the bundle cannot be loaded', async () => {
  const load = window.quickKanbanBootstrap.loadScript('/assets/missing.js')
  const script = document.querySelector('script[src="/assets/missing.js"]')
  script.dispatchEvent(new Event('error'))

  await expect(load).rejects.toThrow('missing.js')
})

test('loadStylesheet resolves after load and reuses the same element', async () => {
  const firstLoad = window.quickKanbanBootstrap.loadStylesheet('/assets/kanban.css')
  const link = document.querySelector('link[rel="stylesheet"][href="/assets/kanban.css"]')

  expect(link).not.toBeNull()
  link.dispatchEvent(new Event('load'))
  await expect(firstLoad).resolves.toBe(link)

  await expect(
    window.quickKanbanBootstrap.loadStylesheet('/assets/kanban.css'),
  ).resolves.toBe(link)
  expect(document.querySelectorAll('link[rel="stylesheet"][href="/assets/kanban.css"]')).toHaveLength(1)
})

test('ensureKanbanViewBridge loads the view bridge only when beta is enabled', async () => {
  window.frappe = {
    ready: (callback) => callback(),
    call: vi.fn().mockResolvedValue({
      message: { kanban_beta: 1, kanban_beta_users: [] },
    }),
    session: { user: 'user@example.com' },
    views: {
      KanbanView: class NativeKanbanView {},
    },
  }
  installBootstrap({ scheduleBridge: false })

  const promise = window.quickKanbanBootstrap.ensureKanbanViewBridge()
  await vi.waitFor(() => {
    expect(
      document.querySelector('script[src="/assets/quick_kanban/js/kanban_view.bundle.js"]'),
    ).not.toBeNull()
  })
  const script = document.querySelector('script[src="/assets/quick_kanban/js/kanban_view.bundle.js"]')
  script.dispatchEvent(new Event('load'))

  await expect(promise).resolves.toBe(true)
  await expect(window.quickKanbanBootstrap.ensureKanbanViewBridge()).resolves.toBe(true)
  expect(document.querySelectorAll('script[src="/assets/quick_kanban/js/kanban_view.bundle.js"]')).toHaveLength(1)
})

test('ensureKanbanViewBridge skips loading when beta is disabled', async () => {
  window.frappe = {
    ready: (callback) => callback(),
    call: vi.fn().mockResolvedValue({
      message: { kanban_beta: 0, kanban_beta_users: [] },
    }),
    session: { user: 'user@example.com' },
    views: {
      KanbanView: class NativeKanbanView {},
    },
  }
  installBootstrap({ scheduleBridge: false })

  const loadScript = vi.spyOn(window.quickKanbanBootstrap, 'loadScript')

  await expect(window.quickKanbanBootstrap.ensureKanbanViewBridge()).resolves.toBe(false)
  expect(loadScript).not.toHaveBeenCalled()
})
