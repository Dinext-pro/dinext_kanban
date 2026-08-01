import { beforeEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const bootstrapSource = readFileSync(
  resolve(process.cwd(), '../dinext_kanban/public/js/kanban_bootstrap.js'),
  'utf8',
)

function installBootstrap({ scheduleBridge = true } = {}) {
  delete window.dinextKanbanBootstrap
  delete window.__dinextKanbanViewInstalled
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

  await expect(window.dinextKanbanBootstrap.loadConfig(call)).resolves.toEqual({
    kanban_beta: 1,
    kanban_beta_users: [],
  })
})

describe('shouldUseBeta', () => {
  test('enables beta globally when no user allowlist exists', () => {
    expect(window.dinextKanbanBootstrap.shouldUseBeta(
      { kanban_beta: 1, kanban_beta_users: [] },
      'user@example.com',
    )).toBe(true)
  })

  test('respects the per-user allowlist', () => {
    const config = {
      kanban_beta: 1,
      kanban_beta_users: ['allowed@example.com'],
    }

    expect(window.dinextKanbanBootstrap.shouldUseBeta(
      config,
      'other@example.com',
    )).toBe(false)
  })
})

test('loadScript resolves after load and reuses the same element', async () => {
  const firstLoad = window.dinextKanbanBootstrap.loadScript('/assets/kanban.js')
  const script = document.querySelector('script[src="/assets/kanban.js"]')

  expect(script).not.toBeNull()
  script.dispatchEvent(new Event('load'))
  await expect(firstLoad).resolves.toBe(script)

  await expect(
    window.dinextKanbanBootstrap.loadScript('/assets/kanban.js'),
  ).resolves.toBe(script)
  expect(document.querySelectorAll('script[src="/assets/kanban.js"]')).toHaveLength(1)
})

test('loadScript rejects when the bundle cannot be loaded', async () => {
  const load = window.dinextKanbanBootstrap.loadScript('/assets/missing.js')
  const script = document.querySelector('script[src="/assets/missing.js"]')
  script.dispatchEvent(new Event('error'))

  await expect(load).rejects.toThrow('missing.js')
})

test('loadStylesheet resolves after load and reuses the same element', async () => {
  const firstLoad = window.dinextKanbanBootstrap.loadStylesheet('/assets/kanban.css')
  const link = document.querySelector('link[rel="stylesheet"][href="/assets/kanban.css"]')

  expect(link).not.toBeNull()
  link.dispatchEvent(new Event('load'))
  await expect(firstLoad).resolves.toBe(link)

  await expect(
    window.dinextKanbanBootstrap.loadStylesheet('/assets/kanban.css'),
  ).resolves.toBe(link)
  expect(document.querySelectorAll('link[rel="stylesheet"][href="/assets/kanban.css"]')).toHaveLength(1)
})

test('loadStylesheet removes stale dinext_kanban bundle links before loading a new hash', async () => {
  const stale = document.createElement('link')
  stale.rel = 'stylesheet'
  stale.href = '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.OLD.css'
  document.head.appendChild(stale)

  const load = window.dinextKanbanBootstrap.loadStylesheet(
    '/assets/dinext_kanban/dist/css/dinext_kanban.bundle.NEW.css',
  )
  const link = document.querySelector(
    'link[rel="stylesheet"][href="/assets/dinext_kanban/dist/css/dinext_kanban.bundle.NEW.css"]',
  )

  expect(link).not.toBeNull()
  expect(
    document.querySelector('link[href="/assets/dinext_kanban/dist/css/dinext_kanban.bundle.OLD.css"]'),
  ).toBeNull()

  link.dispatchEvent(new Event('load'))
  await expect(load).resolves.toBe(link)
})

test('ensureKanbanViewBridge loads the view bridge without waiting for config', async () => {
  const bridgeUrl = '/assets/dinext_kanban/dist/js/kanban_view.bundle.HASH123.js'
  window.frappe = {
    ready: (callback) => callback(),
    call: vi.fn(),
    session: { user: 'user@example.com' },
    assets: {
      bundled_asset: vi.fn(() => bridgeUrl),
    },
    views: {
      KanbanView: class NativeKanbanView {},
    },
  }
  installBootstrap({ scheduleBridge: false })

  const promise = window.dinextKanbanBootstrap.ensureKanbanViewBridge()
  await vi.waitFor(() => {
    expect(
      document.querySelector(`script[src="${bridgeUrl}"]`),
    ).not.toBeNull()
  })
  const script = document.querySelector(`script[src="${bridgeUrl}"]`)
  script.dispatchEvent(new Event('load'))

  await expect(promise).resolves.toBe(true)
  expect(window.frappe.assets.bundled_asset).toHaveBeenCalledWith('kanban_view.bundle.js')
  expect(window.frappe.call).not.toHaveBeenCalled()
  await expect(window.dinextKanbanBootstrap.ensureKanbanViewBridge()).resolves.toBe(true)
  expect(document.querySelectorAll(`script[src="${bridgeUrl}"]`)).toHaveLength(1)
})

test('ensureKanbanViewBridge resolves the bridge URL via frappe.assets.bundled_asset', async () => {
  const hashedUrl = '/assets/dinext_kanban/dist/js/kanban_view.bundle.ABC123.js'
  const bundled_asset = vi.fn(() => hashedUrl)
  window.frappe = {
    ready: (callback) => callback(),
    assets: { bundled_asset },
    views: {
      KanbanView: class NativeKanbanView {},
    },
  }
  installBootstrap({ scheduleBridge: false })

  const promise = window.dinextKanbanBootstrap.ensureKanbanViewBridge()
  await vi.waitFor(() => {
    expect(document.querySelector(`script[src="${hashedUrl}"]`)).not.toBeNull()
  })

  expect(bundled_asset).toHaveBeenCalledWith('kanban_view.bundle.js')
  document.querySelector(`script[src="${hashedUrl}"]`).dispatchEvent(new Event('load'))
  await expect(promise).resolves.toBe(true)

  await window.dinextKanbanBootstrap.ensureKanbanViewBridge()
  expect(document.querySelectorAll(`script[src="${hashedUrl}"]`)).toHaveLength(1)
})

test('ensureKanbanViewBridge still loads when beta config is disabled', async () => {
  const bridgeUrl = '/assets/dinext_kanban/dist/js/kanban_view.bundle.HASH123.js'
  window.frappe = {
    ready: (callback) => callback(),
    call: vi.fn().mockResolvedValue({
      message: { kanban_beta: 0, kanban_beta_users: [] },
    }),
    session: { user: 'user@example.com' },
    assets: {
      bundled_asset: vi.fn(() => bridgeUrl),
    },
    views: {
      KanbanView: class NativeKanbanView {},
    },
  }
  installBootstrap({ scheduleBridge: false })

  const promise = window.dinextKanbanBootstrap.ensureKanbanViewBridge()
  await vi.waitFor(() => {
    expect(
      document.querySelector(`script[src="${bridgeUrl}"]`),
    ).not.toBeNull()
  })
  const script = document.querySelector(`script[src="${bridgeUrl}"]`)
  script.dispatchEvent(new Event('load'))

  await expect(promise).resolves.toBe(true)
  expect(window.frappe.call).not.toHaveBeenCalled()
})
