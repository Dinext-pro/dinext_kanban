import { test, expect } from '@playwright/test'

test('collapsed swimlane column chrome is count then title then menu', async ({ page }) => {
  await page.goto('/e2e/fixture.html')
  await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()
  await page.evaluate(() => {
    const store = window.__dinextKanbanStore
    const makeCards = (prefix, status, count) => Array.from({ length: count }, (_, index) => ({
      name: `${prefix}-${index + 1}`,
      subject: `${prefix} ${index + 1}`,
      status,
    }))
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Swim Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject', 'status', 'project'],
      title_field: 'subject',
      swimlane_field: 'project',
      swimlane_mode: 'field',
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        display_name: 'Open',
        indicator: 'blue',
        custom_column_width: 720,
        cards: [],
      },
      {
        name: 'done',
        column_name: 'Done',
        display_name: 'Done',
        indicator: 'green',
        custom_column_width: 720,
        cards: [],
      },
    ])
    store.commit('SET_LANES', [
      {
        key: 'alpha',
        label: 'Alpha',
        columns: [
          { name: 'open', column_name: 'Open', cards: makeCards('OPEN-A', 'Open', 5) },
          { name: 'done', column_name: 'Done', cards: makeCards('DONE-A', 'Done', 2) },
        ],
      },
      {
        key: 'beta',
        label: 'Beta',
        columns: [
          { name: 'open', column_name: 'Open', cards: makeCards('OPEN-B', 'Open', 1) },
          { name: 'done', column_name: 'Done', cards: makeCards('DONE-B', 'Done', 1) },
        ],
      },
    ])
    store.commit('SET_CELL_TOTALS', {
      alpha: { Open: 5, Done: 2 },
      beta: { Open: 1, Done: 1 },
    })
    store.commit('SET_EXPANDED_LANE_KEYS', ['alpha'])
    store.commit('SET_LOADING', false)
    store.commit('SET_ERROR', '')
  })

  await expect(page.locator('.kanban--swimlanes')).toBeVisible()

  const beforeCollapse = await page.evaluate(() => {
    const header = document.querySelector('.swimlane-header-row')
    return { headerHeight: Math.round(header.getBoundingClientRect().height) }
  })

  await page.evaluate(() => {
    window.__dinextKanbanStore.commit('SET_COLUMN_COLLAPSED', {
      columnKey: 'Open',
      collapsed: true,
    })
  })

  await expect.poll(async () => page.evaluate(() => {
    const header = document.querySelector('.swimlane-header-row')
    const collapsed = document.querySelector(
      '.swimlane-header-row .kanban-column--header-only.kanban-column--collapsed',
    )
    const expanded = [...document.querySelectorAll(
      '.swimlane-header-row .kanban-column--header-only:not(.kanban-column--collapsed)',
    )][0]
    if (!collapsed || !expanded) return null
    const count = collapsed.querySelector('.column-count')
    const title = collapsed.querySelector('.column-title')
    const menuBtn = collapsed.querySelector('.dinext-kanban-column-menu .header-item')
    const columnHeader = collapsed.querySelector('.kanban-column-header')
    const countTop = count ? Math.round(count.getBoundingClientRect().top) : null
    const titleTop = title ? Math.round(title.getBoundingClientRect().top) : null
    const menuTop = menuBtn ? Math.round(menuBtn.getBoundingClientRect().top) : null
    return {
      headerPosition: getComputedStyle(columnHeader).position,
      chromeOrderOk: countTop != null && titleTop != null && menuTop != null
        && countTop < titleTop
        && titleTop < menuTop,
      stretchFill: Math.round(expanded.getBoundingClientRect().height)
        === Math.round(header.getBoundingClientRect().height),
      headerHeight: Math.round(header.getBoundingClientRect().height),
    }
  })).toMatchObject({
    headerPosition: 'absolute',
    chromeOrderOk: true,
    stretchFill: true,
  })

  const after = await page.evaluate(() => ({
    headerHeight: Math.round(
      document.querySelector('.swimlane-header-row').getBoundingClientRect().height,
    ),
  }))
  expect(after.headerHeight).toBeLessThanOrEqual(beforeCollapse.headerHeight + 12)

  const collapsedColumn = page.locator(
    '.swimlane-header-row .kanban-column--header-only.kanban-column--collapsed',
  )
  await collapsedColumn.getByLabel('Change Open column color').click()
  await expect(collapsedColumn.locator('.column-dropdown')).toBeVisible()
  await expect(collapsedColumn.getByLabel('Open Open column')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(collapsedColumn.locator('.column-dropdown')).toHaveCount(0)

  await collapsedColumn.getByLabel('Change Open column color').click()
  await collapsedColumn.getByLabel('Open Open column').click()
  await expect(
    page.locator('.swimlane-header-row .kanban-column--header-only.kanban-column--collapsed'),
  ).toHaveCount(0)
})

test('double-click expands a collapsed swimlane column from header title and cell spacer', async ({ page }) => {
  await page.goto('/e2e/fixture.html')
  await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()
  await page.evaluate(() => {
    const store = window.__dinextKanbanStore
    const makeCards = (prefix, status, count) => Array.from({ length: count }, (_, index) => ({
      name: `${prefix}-${index + 1}`,
      subject: `${prefix} ${index + 1}`,
      status,
    }))
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Swim Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject', 'status', 'project'],
      title_field: 'subject',
      swimlane_field: 'project',
      swimlane_mode: 'field',
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        display_name: 'Open',
        indicator: 'blue',
        custom_column_width: 720,
        cards: [],
      },
      {
        name: 'done',
        column_name: 'Done',
        display_name: 'Done',
        indicator: 'green',
        custom_column_width: 720,
        cards: [],
      },
    ])
    store.commit('SET_LANES', [
      {
        key: 'alpha',
        label: 'Alpha',
        columns: [
          { name: 'open', column_name: 'Open', cards: makeCards('OPEN-A', 'Open', 2) },
          { name: 'done', column_name: 'Done', cards: makeCards('DONE-A', 'Done', 1) },
        ],
      },
    ])
    store.commit('SET_CELL_TOTALS', { alpha: { Open: 2, Done: 1 } })
    store.commit('SET_EXPANDED_LANE_KEYS', ['alpha'])
    store.commit('SET_LOADING', false)
    store.commit('SET_ERROR', '')
  })

  await expect(page.locator('.kanban--swimlanes')).toBeVisible()

  await page.evaluate(() => {
    window.__dinextKanbanStore.commit('SET_COLUMN_COLLAPSED', {
      columnKey: 'Open',
      collapsed: true,
    })
  })

  const collapsedHeader = page.locator(
    '.swimlane-header-row .kanban-column--header-only.kanban-column--collapsed',
  )
  await expect(collapsedHeader).toBeVisible()
  await collapsedHeader.locator('.column-title').dispatchEvent('dblclick')
  await expect(collapsedHeader).toHaveCount(0)

  await page.evaluate(() => {
    window.__dinextKanbanStore.commit('SET_COLUMN_COLLAPSED', {
      columnKey: 'Open',
      collapsed: true,
    })
  })

  const spacer = page.locator('.swimlane-cell-spacer[data-column-value="Open"]')
  await expect(spacer).toBeVisible()
  await spacer.dispatchEvent('dblclick')
  await expect(spacer).toHaveCount(0)
  await expect(
    page.locator('.swimlane-header-row .kanban-column--header-only.kanban-column--collapsed'),
  ).toHaveCount(0)
})
