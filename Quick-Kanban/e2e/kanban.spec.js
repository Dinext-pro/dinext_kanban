import { expect, test } from '@playwright/test'

const openWithoutAutoScroll = (trigger) =>
  trigger.evaluate((element) => element.click())

const waitUntilMoveReady = async (page) => {
  await expect(page.getByLabel('Move First task')).toBeEnabled({ timeout: 10000 })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/e2e/fixture.html')
  await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()
})

test('shows the filtered server total before the column name', async ({ page }) => {
  const header = page.locator('.kanban-column-header').first()
  const badge = header.locator('.column-count')
  const title = header.getByRole('heading', { name: 'Open' })

  await expect(badge).toHaveText('51')
  const badgeBox = await badge.boundingBox()
  const titleBox = await title.boundingBox()
  if (!badgeBox || !titleBox) throw new Error('Column header bounds are unavailable')
  expect(badgeBox.x).toBeLessThan(titleBox.x)
  await expect(
    header.locator('.quick-kanban-indicator-swatch'),
  ).toHaveCount(0)

  await expect.poll(() =>
    page.evaluate(() => window.__countCalls.length),
  ).toBe(1)
  const request = await page.evaluate(() => window.__countCalls[0])
  expect(request).toMatchObject({
    doctype: 'Task',
    fieldname: 'status',
    columns: ['Open', 'Done'],
    filters: [],
  })
})

test('opens the filtered list view when the column count is double-clicked', async ({ page }) => {
  const badge = page.locator('.kanban-column-header').first().locator('.column-count')
  await badge.dispatchEvent('dblclick')

  const navigation = await page.evaluate(() => window.__lastListRoute)
  expect(navigation).toEqual({
    route: ['List', 'Task', 'List'],
    routeOptions: {
      priority: 'High',
      status: 'Open',
    },
  })
})

test('keeps column color palettes hidden until opened', async ({ page }) => {
  const grayOption = page.getByLabel('Set Open color to Gray')
  await expect(grayOption).toBeHidden()

  await page.getByLabel('Change Open column color').click()
  await expect(grayOption).toBeVisible()
  const swatch = grayOption.locator('.quick-kanban-indicator-swatch')
  const swatchMetrics = await swatch.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    beforeContent: getComputedStyle(element, '::before').content,
  }))
  expect(swatchMetrics.width).toBe(swatchMetrics.height)
  expect(swatchMetrics.beforeContent).toBe('none')

  await page.keyboard.press('Escape')
  await expect(grayOption).toBeHidden()
})

test('dismisses the color palette on external interactions but not arrows', async ({ page }) => {
  const trigger = page.getByLabel('Change Open column color')
  const palette = page.getByLabel('Column colors')
  const list = page.getByLabel('Cards in Open')

  await trigger.click()
  await page.keyboard.press('ArrowDown')
  await expect(palette).toBeVisible()

  await list.focus()
  await page.keyboard.press('a')
  await expect(palette).toBeHidden()
  await expect(list).toBeFocused()

  await trigger.click()
  await list.focus()
  await list.evaluate((element) => element.dispatchEvent(new Event('scroll')))
  await expect(palette).toBeHidden()
  await expect(list).toBeFocused()

  await trigger.click()
  await page.locator('body').dispatchEvent('pointerdown')
  await expect(palette).toBeHidden()

  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('moves a card with the keyboard control', async ({ page }) => {
  await waitUntilMoveReady(page)
  const card = page.locator('.kanban-card').first()
  const list = page.getByLabel('Cards in Open')
  const beforeBox = await card.boundingBox()
  const beforeScrollLeft = await list.evaluate((element) => element.scrollLeft)
  await openWithoutAutoScroll(page.getByLabel('Move First task'))
  const afterBox = await card.boundingBox()
  expect(await page.getByLabel('Move First task to column').evaluate(
    (element) => element.parentElement?.tagName,
  )).toBe('BODY')
  expect(await list.evaluate((element) => element.scrollLeft)).toBe(beforeScrollLeft)
  expect(afterBox?.x).toBe(beforeBox?.x)
  expect(afterBox?.width).toBe(beforeBox?.width)
  await page.getByLabel('Move First task to Done').click()

  await expect(page.getByLabel('Cards in Open')).not.toContainText('First task')
  await expect(page.getByLabel('Cards in Done')).toContainText('First task')
  await expect(page.locator('.column-count').nth(0)).toHaveText('50')
  await expect(page.locator('.column-count').nth(1)).toHaveText('13')
  await expect.poll(() =>
    page.evaluate(() => window.__quickKanbanAlerts.at(-1)?.indicator),
  ).toBe('green')
})

test('menu move scrolls horizontally to the destination column', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/e2e/fixture.html')
  await waitUntilMoveReady(page)

  const board = page.locator('.kanban')
  await board.evaluate((element) => {
    element.scrollLeft = 0
  })
  const beforeScrollLeft = await board.evaluate((element) => element.scrollLeft)

  await openWithoutAutoScroll(page.getByLabel('Move First task'))
  await page.getByLabel('Move First task to Done').click()

  await expect(page.getByLabel('Cards in Done')).toContainText('First task')
  await expect.poll(() => board.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(beforeScrollLeft)

  const doneListBox = await page.getByLabel('Cards in Done').boundingBox()
  const boardBox = await board.boundingBox()
  if (!doneListBox || !boardBox) throw new Error('Scroll target bounds are unavailable')
  expect(doneListBox.x).toBeGreaterThanOrEqual(boardBox.x)
  expect(doneListBox.x).toBeLessThan(boardBox.x + boardBox.width)
})

test('menu move places the card at the top of the destination column', async ({ page }) => {
  await page.addInitScript(() => {
    window.__customQuickKanbanCards = [
      {
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        expected_end_date: '2026-07-10',
        project: 'TEST-PROJECT',
        modified: '2026-07-10 10:00:00',
      },
      ...Array.from({ length: 35 }, (_, index) => ({
        name: `DONE-${index + 1}`,
        subject: `Done task ${index + 1}`,
        status: 'Done',
        priority: 'Low',
        expected_end_date: '2026-07-11',
        project: 'SECOND-PROJECT',
        modified: '2026-07-10 10:00:00',
      })),
    ]
  })
  await page.goto('/e2e/fixture.html')
  await waitUntilMoveReady(page)

  const doneList = page.getByLabel('Cards in Done')
  await doneList.evaluate((element) => {
    element.scrollTop = 200
  })

  await openWithoutAutoScroll(page.getByLabel('Move First task'))
  await page.getByLabel('Move First task to Done').click()

  await expect(doneList).toContainText('First task')
  await expect(doneList.locator('.kanban-card').first()).toContainText('First task')
  await expect.poll(() => doneList.evaluate((element) => element.scrollTop))
    .toBeLessThan(40)
})

test('menu move scrolls to the card in a paginated destination column', async ({ page }) => {
  await page.evaluate(async () => {
    window.__columnTotals = { Open: 1, Done: 40 }
    window.__columnPages = {
      Done: [window.__makeColumnPage('Done', 0, 15)],
    }
    await window.hydrateQuickKanban({
      board: {
        name: 'Paginated Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject'],
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'blue' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
        ],
      },
      cards: [{
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        modified: '2026-07-10 10:00:00',
      }],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  await waitUntilMoveReady(page)
  const doneList = page.getByLabel('Cards in Done')
  await expect(doneList.locator('.kanban-card')).toHaveCount(15)

  await doneList.evaluate((element) => {
    element.scrollTop = 0
  })

  await openWithoutAutoScroll(page.getByLabel('Move First task'))
  await page.getByLabel('Move First task to Done').click()

  await expect(doneList).toContainText('First task')
  await expect(doneList.locator('.kanban-card').first()).toContainText('First task')

  const visible = await page.evaluate(() => {
    const list = document.querySelector('[aria-label="Cards in Done"]')
    const card = list?.querySelector('article.kanban-card[data-card-name="TASK-1"]')
      || list?.querySelector('[data-key="TASK-1"] .kanban-card')
    if (!list || !card) {
      return false
    }
    const listRect = list.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    return cardRect.bottom > listRect.top + 8 && cardRect.top < listRect.bottom - 8
  })
  expect(visible).toBe(true)
})

test('menu move expands a collapsed destination column and reveals the card', async ({ page }) => {
  await waitUntilMoveReady(page)
  await page.evaluate(() => {
    window.__quickKanbanStore.commit('SET_COLUMN_COLLAPSED', {
      columnKey: 'Done',
      collapsed: true,
    })
  })
  await expect(page.locator('.kanban-column[data-column-value="Done"]')).toHaveClass(
    /kanban-column--collapsed/,
  )

  await openWithoutAutoScroll(page.getByLabel('Move First task'))
  await page.getByLabel('Move First task to Done').click()

  await expect(page.locator('.kanban-column[data-column-value="Done"]')).not.toHaveClass(
    /kanban-column--collapsed/,
  )
  await expect(page.getByLabel('Cards in Done')).toContainText('First task')
  await expect(page.locator('.kanban-card[data-card-name="TASK-1"]')).toBeVisible()
})

test('drag drop expands a collapsed destination column and reveals the card', async ({ page }) => {
  await waitUntilMoveReady(page)
  await page.evaluate(() => {
    window.__quickKanbanStore.commit('SET_COLUMN_COLLAPSED', {
      columnKey: 'Done',
      collapsed: true,
    })
  })
  await expect(page.locator('.kanban-column[data-column-value="Done"]')).toHaveClass(
    /kanban-column--collapsed/,
  )

  const source = await page.getByLabel('Drag First task').boundingBox()
  const target = await page.locator('.kanban-column[data-column-value="Done"]').boundingBox()
  if (!source || !target) throw new Error('Drag coordinates are unavailable')

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 8, source.y + source.height / 2 + 8, {
    steps: 4,
  })
  // Dwell so Sortable can target the collapsed strip; post-drop expand still required.
  await page.waitForTimeout(450)
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
    steps: 20,
  })
  await page.mouse.up()

  await expect(page.locator('.kanban-column[data-column-value="Done"]')).not.toHaveClass(
    /kanban-column--collapsed/,
  )
  await expect(page.getByLabel('Cards in Done')).toContainText('First task')
  await expect(page.locator('.kanban-card[data-card-name="TASK-1"]')).toBeVisible()
})

test('swimlane menu move expands a collapsed destination column and reveals the card', async ({ page }) => {
  await page.evaluate(() => {
    window.__quickKanbanPermissiveMoves = true
    const store = window.__quickKanbanStore
    const makeCards = (prefix, status, count) => Array.from({ length: count }, (_, index) => ({
      name: `${prefix}-${index + 1}`,
      subject: `${prefix} ${index + 1}`,
      status,
      project: 'Alpha',
      modified: '2026-07-10 10:00:00',
    }))
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      board_name: 'Swim Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'subject', 'status', 'project'],
      title_field: 'subject',
      title_field_meta: {
        fieldname: 'subject',
        label: 'Subject',
        fieldtype: 'Data',
        parent: 'Task',
      },
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
    store.commit('SET_CELL_TOTALS', {
      alpha: { Open: 2, Done: 1 },
    })
    store.commit('SET_EXPANDED_LANE_KEYS', ['alpha'])
    store.commit('SET_COLUMN_COLLAPSED', {
      columnKey: 'Done',
      collapsed: true,
    })
    store.commit('SET_LOADING', false)
    store.commit('SET_ERROR', '')
  })

  await expect(page.locator('.kanban--swimlanes')).toBeVisible()
  await expect(
    page.locator('.swimlane-header-row .kanban-column[data-column-value="Done"]'),
  ).toHaveClass(/kanban-column--collapsed/)

  const moveTrigger = page.getByLabel('Move OPEN-A 1')
  await expect(moveTrigger).toBeEnabled({ timeout: 10000 })
  await openWithoutAutoScroll(moveTrigger)
  await page.getByLabel('Move OPEN-A 1 to Done').click()

  await expect(
    page.locator('.swimlane-header-row .kanban-column[data-column-value="Done"]'),
  ).not.toHaveClass(/kanban-column--collapsed/)
  await expect(
    page.locator(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-group[data-column-value="Done"] .kanban-card[data-card-name="OPEN-A-1"]',
    ),
  ).toBeVisible()
})

test('restores a card after a rejected move', async ({ page }) => {
  await waitUntilMoveReady(page)
  await page.evaluate(() => {
    window.__failNextMove = true
  })
  await openWithoutAutoScroll(page.getByLabel('Move First task'))
  await page.getByLabel('Move First task to Done').click()

  await expect(page.locator('.column-count').nth(0)).toHaveText('51')
  await expect(page.locator('.column-count').nth(1)).toHaveText('12')
  await expect.poll(() =>
    page.evaluate(() => window.__quickKanbanAlerts.at(-1)?.indicator),
  ).toBe('red')
})

test('keeps the move disclosure inside the viewport and restores focus on Escape', async ({ page }) => {
  await waitUntilMoveReady(page)
  const trigger = page.getByLabel('Move First task')
  await openWithoutAutoScroll(trigger)
  const menu = page.getByLabel('Move First task to column')
  const box = await menu.boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) throw new Error('Move menu bounds are unavailable')

  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)

  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('dismisses the move menu on external interactions but not arrows', async ({ page }) => {
  await waitUntilMoveReady(page)
  const trigger = page.getByLabel('Move First task')
  const menu = page.getByLabel('Move First task to column')
  const list = page.getByLabel('Cards in Open')

  await openWithoutAutoScroll(trigger)
  await page.keyboard.press('ArrowRight')
  await expect(menu).toBeVisible()

  await list.focus()
  await page.keyboard.press('a')
  await expect(menu).toHaveCount(0)
  await expect(list).toBeFocused()

  await openWithoutAutoScroll(trigger)
  await list.focus()
  await list.evaluate((element) => element.dispatchEvent(new Event('scroll')))
  await expect(menu).toHaveCount(0)
  await expect(list).toBeFocused()

  await openWithoutAutoScroll(trigger)
  await page.locator('body').dispatchEvent('pointerdown')
  await expect(menu).toHaveCount(0)
})

test('activates menu actions with native keyboard input before closing', async ({ page }) => {
  await waitUntilMoveReady(page)
  const colorTrigger = page.getByLabel('Change Open column color')
  const palette = page.getByLabel('Column colors')
  await colorTrigger.click()
  await page.getByLabel('Set Open color to Blue').focus()
  await page.keyboard.press('Enter')

  await expect(palette).toBeHidden()
  await expect(page.locator('.kanban-column').first()).toHaveAttribute(
    'style',
    /kanban-column-blue/,
  )

  await openWithoutAutoScroll(page.getByLabel('Move First task'))
  const moveAction = page.getByLabel('Move First task to Done')
  await moveAction.focus()
  await page.keyboard.press('Space')

  await expect(moveAction).toHaveCount(0)
  await expect(page.getByLabel('Cards in Open')).not.toContainText('First task')
  await expect(page.getByLabel('Cards in Done')).toContainText('First task')
  await expect(page.locator('.column-count').nth(0)).toHaveText('50')
  await expect(page.locator('.column-count').nth(1)).toHaveText('13')
})

test('uses the real drag list contract for a cross-column move', async ({ page }) => {
  await waitUntilMoveReady(page)
  const source = await page.getByLabel('Drag First task').boundingBox()
  const target = await page.getByText('Second task').boundingBox()
  if (!source || !target) throw new Error('Drag coordinates are unavailable')

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 8, source.y + source.height / 2 + 8, {
    steps: 4,
  })
  await expect.poll(() => page.locator('.chosen-card').count()).toBeGreaterThan(0)
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
    steps: 20,
  })
  await page.mouse.up()

  await expect(page.locator('.column-count').nth(0)).toHaveText('50')
  await expect(page.locator('.column-count').nth(1)).toHaveText('13')
})

test('replaces the board without retaining stale cards', async ({ page }) => {
  await page.evaluate(() => {
    window.__columnTotals.Queued = 1
    window.hydrateQuickKanban({
      board: {
        name: 'Second Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject'],
        columns: [
          { name: 'queued', column_name: 'Queued', indicator: 'blue' },
        ],
      },
      cards: [
        { name: 'TASK-3', subject: 'Third task', status: 'Queued' },
      ],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  await expect(page.locator('.column-count')).toHaveText('1')
  await expect(page.getByText('Third task')).toBeVisible()
  await expect(page.getByText('First task')).toHaveCount(0)
})

test('keeps columns and controls usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()

  const column = await page.locator('.kanban-column').first().boundingBox()
  const addButton = await page.getByLabel('Add Task to Open').boundingBox()
  if (!column || !addButton) throw new Error('Responsive elements are unavailable')

  expect(column.width).toBeLessThanOrEqual(328)
  expect(addButton.width).toBeGreaterThanOrEqual(44)
  expect(addButton.height).toBeGreaterThanOrEqual(44)
})

test('formats card fields without exposing markup or breaking dates', async ({ page }) => {
  const card = page.locator('.kanban-card').first()
  await expect(card.getByText('Expected End Date')).toBeVisible()
  await expect(card.locator('dd[data-fieldtype="Link"] a')).toHaveText('TEST-PROJECT')
  await expect(card).not.toContainText('<a href=')

  const dateStyle = await card.locator('dd[data-fieldtype="Date"]').evaluate(
    (element) => getComputedStyle(element).whiteSpace,
  )
  expect(dateStyle).toBe('nowrap')

  await page.evaluate(() => {
    window.hydrateQuickKanban({
      board: {
        name: 'Browser Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject', 'priority', 'expected_end_date', 'project'],
        custom_highlighted_field: 'priority',
        custom_highlight_table: [{ tag: 'High', color: 'red' }],
        show_labels: 1,
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'gray' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
        ],
      },
      cards: [{
        name: 'TASK-1',
        subject: 'First task',
        status: 'Open',
        priority: 'High',
        expected_end_date: '2026-07-10',
        project: 'TEST-PROJECT',
      }],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  await expect(card.locator('dd[data-fieldtype="Date"]')).toHaveText('2026-07-10')
  await expect(card.locator('dd[data-fieldtype="Link"] a')).toHaveText('TEST-PROJECT')
})

test('loads at least 15 filtered cards into every non-empty column', async ({ page }) => {
  await page.evaluate(async () => {
    const openCards = Array.from({ length: 20 }, (_, index) => ({
      name: `OPEN-${index + 1}`,
      subject: `Open ${index + 1}`,
      status: 'Open',
    }))
    window.__reportviewCalls = []
    window.__columnTotals = { Open: 40, Done: 18, Review: 3, Empty: 0 }
    window.__columnPages = {
      Done: [window.__makeColumnPage('Done', 0, 15)],
      Review: [window.__makeColumnPage('Review', 0, 3)],
    }

    await window.hydrateQuickKanban({
      board: {
        name: 'Balanced Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject'],
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'blue' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
          { name: 'review', column_name: 'Review', indicator: 'orange' },
          { name: 'empty', column_name: 'Empty', indicator: 'gray' },
        ],
      },
      cards: openCards,
      args: {
        doctype: 'Task',
        filters: [['priority', '=', 'High']],
        page_length: 100,
      },
    })
  })

  await expect(page.getByLabel('Cards in Open').locator('.kanban-card')).toHaveCount(20)
  await expect(page.getByLabel('Cards in Done').locator('.kanban-card')).toHaveCount(15)
  await expect(page.getByLabel('Cards in Review').locator('.kanban-card')).toHaveCount(3)
  await expect(page.getByLabel('Cards in Empty').locator('.kanban-card')).toHaveCount(0)

  const requests = await page.evaluate(() => window.__reportviewCalls)
  expect(requests).toHaveLength(2)
  expect(requests.map(({ page_length: pageLength }) => pageLength)).toEqual([15, 3])
  expect(requests.map(({ filters }) => filters.at(-1))).toEqual([
    ['Task', 'status', '=', 'Done'],
    ['Task', 'status', '=', 'Review'],
  ])
  for (const { filters } of requests) {
    expect(filters).toContainEqual(['priority', '=', 'High'])
  }
})

test('loads the next page only for the scrolled column without a global banner', async ({ page }) => {
  await page.evaluate(() => {
    const openCards = Array.from({ length: 51 }, (_, index) => ({
      name: `OPEN-${index + 1}`,
      subject: `Open ${index + 1}`,
      status: 'Open',
    }))
    const doneCards = Array.from({ length: 49 }, (_, index) => ({
      name: `DONE-${index + 1}`,
      subject: `Done ${index + 1}`,
      status: 'Done',
    }))
    window.__reportviewCalls = []
    window.__columnTotals.Open = 150
    window.__columnTotals.Done = 49
    window.__columnPages.Open = [
      window.__makeColumnPage('Open', 51, 30),
      window.__makeColumnPage('Open', 81, 30),
      window.__makeColumnPage('Open', 111, 30),
      window.__makeColumnPage('Open', 141, 9),
    ]
    window.hydrateQuickKanban({
      board: {
        name: 'Infinite Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject'],
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'blue' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
        ],
      },
      cards: [...openCards, ...doneCards],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  await page.waitForFunction(() => {
    const button = document.querySelector('.card-action-button')
    return !button || !button.disabled
  }, { timeout: 10000 })

  const list = page.getByLabel('Cards in Open')
  await expect(page.locator('.column-count').nth(0)).toHaveText('150')
  await expect(list).toHaveCSS('scrollbar-width', 'none')
  await list.focus()
  const initialScrollTop = await list.evaluate((element) => element.scrollTop)
  await page.keyboard.press('PageDown')
  await expect.poll(() =>
    list.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(initialScrollTop)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const previousCalls = await page.evaluate(
      () => window.__reportviewCalls.length,
    )
    if (previousCalls >= 4) break
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(() =>
      page.evaluate(() => window.__reportviewCalls.length),
    ).toBeGreaterThan(previousCalls)
    await page.evaluate(() => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    ))
  }
  await expect.poll(() =>
    page.evaluate(() => window.__reportviewCalls.length),
  ).toBe(4)

  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll'))
  })
  await expect(page.getByText('Open 150', { exact: true })).toBeVisible()
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  ))
  expect(await page.evaluate(() => window.__reportviewCalls.length)).toBe(4)
  await expect(page.locator('.column-count').nth(0)).toHaveText('150')
  const requests = await page.evaluate(() => window.__reportviewCalls)
  expect(requests.map((request) => request.start)).toEqual([51, 81, 111, 141])
  for (const { filters } of requests) {
    expect(filters).toContainEqual(['Task', 'status', '=', 'Open'])
  }
  await expect(page.getByLabel('Load more Kanban cards')).toHaveCount(0)
  await expect(page.getByText(/Showing .* matching cards/)).toHaveCount(0)
})

test('renders assignment photos with a two-plus-count overflow', async ({ page }) => {
  await page.evaluate(() => {
    window.__assignDialogOpened = false
    window.__assignDialogShown = false
    window.__assignmentDialogOpened = false
    window.frappe.boot.user_info = {
      'one@example.com': { fullname: 'One User', image: '/files/one.png' },
      'two@example.com': { fullname: 'Two User', image: '/files/two.png' },
      'three@example.com': { fullname: 'Three User' },
      'four@example.com': { fullname: 'Four User' },
    }
    window.hydrateQuickKanban({
      board: {
        name: 'Browser Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject'],
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'gray' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
        ],
      },
      cards: [{
        name: 'TASK-ASSIGN',
        subject: 'Assigned task',
        status: 'Open',
        _assign: '["one@example.com","two@example.com","three@example.com","four@example.com"]',
      }],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  const card = page.locator('.kanban-card', { hasText: 'Assigned task' })
  const block = card.getByRole('group', { name: /Assignments:/ })
  await expect(block).toBeVisible()
  await expect(block.locator('.avatar-frame[style*="background-image"]')).toHaveCount(2)
  await expect(block.locator('.avatar-extra-count')).toHaveText('+2')
  await expect(block.locator('.avatar-action')).toHaveCount(1)
})

test('opens the assignment edit dialog from avatar and overflow clicks', async ({ page }) => {
  await page.evaluate(() => {
    window.__assignDialogOpened = false
    window.__assignDialogShown = false
    window.__assignmentDialogOpened = false
    window.frappe.boot.user_info = {
      'one@example.com': { fullname: 'One User', image: '/files/one.png' },
      'two@example.com': { fullname: 'Two User', image: '/files/two.png' },
      'three@example.com': { fullname: 'Three User' },
      'four@example.com': { fullname: 'Four User' },
    }
    window.hydrateQuickKanban({
      board: {
        name: 'Browser Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject'],
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'gray' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
        ],
      },
      cards: [{
        name: 'TASK-ASSIGN',
        subject: 'Assigned task',
        status: 'Open',
        _assign: '["one@example.com","two@example.com","three@example.com","four@example.com"]',
      }],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  const card = page.locator('.kanban-card', { hasText: 'Assigned task' })
  const block = card.getByRole('group', { name: /Assignments:/ })
  await card.scrollIntoViewIfNeeded()

  await page.evaluate(() => {
    const cardElement = [...document.querySelectorAll('.kanban-card')].find(
      (element) => element.textContent.includes('Assigned task'),
    )
    const avatar = cardElement?.querySelector('.assignments-block .avatar-group .avatar')
    avatar?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect.poll(() => page.evaluate(() => window.__assignmentDialogOpened)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__assignDialogOpened)).toBe(false)

  await page.evaluate(() => {
    window.__assignmentDialogOpened = false
    const cardElement = [...document.querySelectorAll('.kanban-card')].find(
      (element) => element.textContent.includes('Assigned task'),
    )
    const overflow = cardElement?.querySelector('.assignments-block .avatar-extra-count')
    overflow?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect.poll(() => page.evaluate(() => window.__assignmentDialogOpened)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__assignDialogOpened)).toBe(false)
})

test('opens the add assignment dialog from the plus action only', async ({ page }) => {
  await page.evaluate(() => {
    window.__assignDialogOpened = false
    window.__assignDialogShown = false
    window.__assignmentDialogOpened = false
    window.frappe.boot.user_info = {
      'one@example.com': { fullname: 'One User', image: '/files/one.png' },
      'two@example.com': { fullname: 'Two User', image: '/files/two.png' },
      'three@example.com': { fullname: 'Three User' },
      'four@example.com': { fullname: 'Four User' },
    }
    window.hydrateQuickKanban({
      board: {
        name: 'Browser Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject'],
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'gray' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
        ],
      },
      cards: [{
        name: 'TASK-ASSIGN',
        subject: 'Assigned task',
        status: 'Open',
        _assign: '["one@example.com","two@example.com","three@example.com","four@example.com"]',
      }],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  const card = page.locator('.kanban-card', { hasText: 'Assigned task' })
  await card.scrollIntoViewIfNeeded()

  await page.evaluate(() => {
    const cardElement = [...document.querySelectorAll('.kanban-card')].find(
      (element) => element.textContent.includes('Assigned task'),
    )
    const action = cardElement?.querySelector('.assignments-block .avatar-action')
    action?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect.poll(() => page.evaluate(() => window.__assignDialogOpened)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__assignDialogShown)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__assignmentDialogOpened)).toBe(false)
})

test('keeps assignment actions on one row while hovering three assignees', async ({ page }) => {
  await page.evaluate(() => {
    window.frappe.boot.user_info = {
      'one@example.com': { fullname: 'One User', image: '/files/one.png' },
      'two@example.com': { fullname: 'Two User', image: '/files/two.png' },
      'three@example.com': { fullname: 'Three User', image: '/files/three.png' },
    }
    window.hydrateQuickKanban({
      board: {
        name: 'Browser Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject'],
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'gray' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
        ],
      },
      cards: [{
        name: 'TASK-THREE',
        subject: 'Three assignees',
        status: 'Open',
        _assign: '["one@example.com","two@example.com","three@example.com"]',
      }],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  const card = page.locator('.kanban-card', { hasText: 'Three assignees' })
  const block = card.locator('.assignments-block')
  const actions = card.locator('.kanban-card-actions')
  const frame = block.locator('.avatar-frame').first()

  const layoutBefore = await page.evaluate(() => {
    const cardElement = [...document.querySelectorAll('.kanban-card')].find(
      (element) => element.textContent.includes('Three assignees'),
    )
    const actionsElement = cardElement?.querySelector('.kanban-card-actions')
    const group = cardElement?.querySelector('.assignments-block .avatar-group.overlap')
    const secondAvatar = group?.querySelector('.avatar + .avatar')
    if (!actionsElement || !group || !secondAvatar) {
      throw new Error('Assignment layout is incomplete')
    }

    const actionsRect = actionsElement.getBoundingClientRect()
    const groupRect = group.getBoundingClientRect()
    return {
      avatarCount: group.querySelectorAll('.avatar.avatar-small').length,
      top: actionsRect.top,
      actionsWidth: actionsRect.width,
      actionsHeight: actionsRect.height,
      groupWidth: groupRect.width,
      groupHeight: groupRect.height,
      marginLeft: getComputedStyle(secondAvatar).marginLeft,
      actionsFlexWrap: getComputedStyle(actionsElement).flexWrap,
    }
  })

  const shadowBefore = await frame.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  )

  await card.scrollIntoViewIfNeeded()
  await card.getByRole('group', { name: /Assignments:/ }).focus()

  const shadowAfter = await frame.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  )
  const layoutAfter = await page.evaluate(() => {
    const cardElement = [...document.querySelectorAll('.kanban-card')].find(
      (element) => element.textContent.includes('Three assignees'),
    )
    const actionsElement = cardElement?.querySelector('.kanban-card-actions')
    const group = cardElement?.querySelector('.assignments-block .avatar-group.overlap')
    const secondAvatar = group?.querySelector('.avatar + .avatar')
    const actionsRect = actionsElement.getBoundingClientRect()
    const groupRect = group.getBoundingClientRect()
    return {
      top: actionsRect.top,
      actionsWidth: actionsRect.width,
      actionsHeight: actionsRect.height,
      groupWidth: groupRect.width,
      groupHeight: groupRect.height,
      marginLeft: getComputedStyle(secondAvatar).marginLeft,
    }
  })

  expect(layoutBefore.avatarCount).toBe(4)
  expect(layoutBefore.actionsFlexWrap).toBe('nowrap')
  expect(layoutBefore.top).toBe(layoutAfter.top)
  expect(layoutBefore.marginLeft).toBe(layoutAfter.marginLeft)
  expect(layoutBefore.actionsWidth).toBe(layoutAfter.actionsWidth)
  expect(layoutBefore.actionsHeight).toBe(layoutAfter.actionsHeight)
  expect(layoutBefore.groupWidth).toBe(layoutAfter.groupWidth)
  expect(layoutBefore.groupHeight).toBe(layoutAfter.groupHeight)
  expect(shadowAfter).not.toBe('none')
  expect(shadowAfter).not.toBe(shadowBefore)
})

test('renders readable column backgrounds in light and dark themes', async ({ page }) => {
  await page.evaluate(() => window.__setQuickKanbanTheme('light'))
  const lightBackground = await page.evaluate(() =>
    window.__getQuickKanbanColumnBackground('Open'),
  )
  expect(lightBackground).not.toBe('')

  await page.evaluate(() => window.__setQuickKanbanTheme('dark'))
  await expect.poll(async () =>
    page.evaluate(() => window.__getQuickKanbanColumnBackground('Open')),
  ).not.toBe(lightBackground)
})

test('updates column styling when the theme toggles at runtime', async ({ page }) => {
  await page.evaluate(() => window.__setQuickKanbanTheme('light'))
  const lightBackground = await page.evaluate(() =>
    window.__getQuickKanbanColumnBackground('Open'),
  )

  await page.evaluate(() => window.__setQuickKanbanTheme('dark'))
  await expect.poll(async () =>
    page.evaluate(() => window.__getQuickKanbanColumnBackground('Open')),
  ).not.toBe(lightBackground)

  await page.evaluate(() => window.__setQuickKanbanTheme('light'))
  await expect.poll(async () =>
    page.evaluate(() => window.__getQuickKanbanColumnBackground('Open')),
  ).toBe(lightBackground)
})

test('uses theme-aware assignment ring colors in dark mode', async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    window.frappe.boot.user_info = {
      'one@example.com': { fullname: 'One User', image: '/files/one.png' },
    }
    window.hydrateQuickKanban({
      board: {
        name: 'Browser Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject'],
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'gray' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
        ],
      },
      cards: [{
        name: 'TASK-DARK',
        subject: 'Dark theme assignee',
        status: 'Open',
        _assign: '["one@example.com"]',
      }],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  const card = page.locator('.kanban-card', { hasText: 'Dark theme assignee' })
  const block = card.locator('.assignments-block')
  const frame = block.locator('.avatar-frame').first()
  const ringColors = await page.evaluate(() => {
    const root = document.documentElement
    const inner = getComputedStyle(root).getPropertyValue('--kanban-assignment-ring-inner').trim()
    const outer = getComputedStyle(root).getPropertyValue('--kanban-assignment-ring-outer').trim()
    return { inner, outer }
  })

  expect(ringColors.inner).toMatch(/gray-600|525252/)
  expect(ringColors.outer).toMatch(/blue-400|primary|7ec1ff|2491ef/)

  await card.scrollIntoViewIfNeeded()
  await block.focus({ force: true })
  const shadowAfter = await frame.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  )
  expect(shadowAfter).not.toBe('none')
})

test('cards have 8px horizontal gutter from column edge', async ({ page }) => {
  const column = page.locator('.kanban-column').first()
  const card = column.locator('.kanban-card').first()
  await expect(card).toBeVisible()

  const colBox = await column.boundingBox()
  const cardBox = await card.boundingBox()
  if (!colBox || !cardBox) throw new Error('Column or card bounds are unavailable')

  expect(cardBox.x - colBox.x).toBeCloseTo(8, 0)
  expect(colBox.x + colBox.width - (cardBox.x + cardBox.width)).toBeCloseTo(8, 0)
})

test('shows translated metadata labels and column names while keeping raw API values', async ({ page }) => {
  await page.evaluate(async () => {
    window.__translationMap = {
      'Expected End Date': 'Ожидаемая дата окончания',
      'Project': 'Проект',
      'Priority': 'Приоритет',
      Open: 'Открыто',
      Done: 'Готово',
      High: 'Высокий',
      Low: 'Низкий',
    }
    window.__moveCalls = []
    window.__ = (message, values = [], context) => {
      const contextualKey = context ? `${message}::${context}` : message
      const translated = window.__translationMap[contextualKey]
        || window.__translationMap[message]
        || message
      return (values || []).reduce(
        (result, value, index) => result.replace(`{${index}}`, value),
        translated,
      )
    }
    const originalCall = window.frappe.call
    window.frappe.call = async (request) => {
      if (request.method === 'quick_kanban.api.move_card') {
        window.__moveCalls.push(request.args)
      }
      return originalCall(request)
    }
    await window.hydrateQuickKanban({
      board: {
        name: 'Browser Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject', 'priority', 'expected_end_date', 'project'],
        custom_highlighted_field: 'priority',
        custom_highlight_table: [{ tag: 'High', color: 'red' }],
        show_labels: 1,
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'gray' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
        ],
      },
      cards: [
        {
          name: 'TASK-1',
          subject: 'First task',
          status: 'Open',
          priority: 'High',
          expected_end_date: '2026-07-10',
          project: 'TEST-PROJECT',
          modified: '2026-07-10 10:00:00',
        },
      ],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  await expect(page.getByRole('heading', { name: 'Открыто' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Готово' })).toBeVisible()

  const card = page.locator('.kanban-card').first()
  await expect(card.getByText('Ожидаемая дата окончания')).toBeVisible()
  await expect(card.locator('.kanban-highlight')).toHaveText('Высокий')

  await waitUntilMoveReady(page)
  await openWithoutAutoScroll(page.getByLabel('Move First task'))
  await expect(page.getByLabel('Move First task to Готово')).toBeVisible()
  await page.getByLabel('Move First task to Готово').click()

  await expect.poll(() =>
    page.evaluate(() => window.__quickKanbanAlerts.at(-1)?.message),
  ).toContain('Готово')
  await expect.poll(() =>
    page.evaluate(() => window.__moveCalls.at(-1)?.value),
  ).toBe('Done')

  await page.evaluate(() => {
    document.querySelector('[aria-label="Add Task to Открыто"]')?.click()
  })
  await expect.poll(() =>
    page.evaluate(() => window.__lastNewDoc),
  ).toEqual({
    doctype: 'Task',
    doc: expect.objectContaining({ status: 'Open' }),
    defaults: { status: 'Open' },
    mode: 'quick_entry',
  })
})

test('prepends a newly created Overdue card after quick entry save', async ({ page }) => {
  await page.goto('/e2e/fixture.html')
  await expect(page.getByLabel('Cards in Open').getByText('First task')).toBeVisible()
  await page.evaluate(async () => {
    await window.hydrateQuickKanban({
      board: {
        name: 'Browser Board',
        reference_doctype: 'Task',
        field_name: 'status',
        fields: ['name', 'subject', 'status'],
        custom_highlighted_field: null,
        custom_highlight_table: [],
        show_labels: 0,
        columns: [
          { name: 'open', column_name: 'Open', indicator: 'gray' },
          { name: 'overdue', column_name: 'Overdue', indicator: 'red' },
          { name: 'done', column_name: 'Done', indicator: 'green' },
        ],
      },
      cards: [
        {
          name: 'TASK-1',
          subject: 'First task',
          status: 'Open',
          modified: '2026-07-10 10:00:00',
        },
      ],
      args: { doctype: 'Task', page_length: 100 },
    })
  })

  await page.evaluate(() => {
    document.querySelector('[aria-label="Add Task to Overdue"]')?.click()
  })
  await expect.poll(() =>
    page.evaluate(() => window.__lastNewDoc?.doc?.status),
  ).toBe('Overdue')

  await page.evaluate(() => {
    window.__lastQuickEntryAfterInsert({
      name: 'TASK-OVERDUE',
      subject: 'Late task',
      status: 'Overdue',
      modified: '2026-07-12 12:00:00',
    })
  })

  await expect(page.getByLabel('Cards in Overdue').locator('.kanban-card').first())
    .toContainText('Late task')
  await expect(page.getByLabel('Cards in Open').getByText('First task')).toBeVisible()
})

test('prepends a newly created card to the top of the initiating column', async ({ page }) => {
  await page.goto('/e2e/fixture.html')
  await expect(page.getByLabel('Cards in Open').getByText('First task')).toBeVisible()

  await page.evaluate(() => {
    window.__quickKanbanStore.commit('SET_PENDING_CREATE', {
      column_name: 'Open',
      columnIndex: 0,
      board_name: 'Browser Board',
      form_mode: 'quick_entry',
    })
    window.__quickKanbanStore.dispatch('handleCardCreated', {
      doc: {
        name: 'TASK-NEW',
        subject: 'Fresh task',
        status: 'Open',
        modified: '2026-07-12 12:00:00',
      },
    })
  })

  await expect(page.getByLabel('Cards in Open').locator('.kanban-card').first())
    .toContainText('Fresh task')
  await expect(page.getByLabel('Cards in Open').getByText('First task')).toBeVisible()
})

test('vertical gap between cards stays 8px', async ({ page }) => {
  await expect(page.locator('.kanban-card').first()).toHaveCSS('margin-bottom', '8px')
})

const loadRestrictedMoveFixture = async (page, policy = {}) => {
  await page.addInitScript((config) => {
    window.__configureQuickKanbanMovePolicyOnLoad = config
  }, {
    permissive: false,
    forbiddenColumns: ['Done'],
    reason: 'workflow_denied',
    ...policy,
  })
  await page.goto('/e2e/fixture.html')
  await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()
  await waitUntilMoveReady(page)
}

test('returns a forbidden drag drop with rollback and a specific reason', async ({ page }) => {
  await loadRestrictedMoveFixture(page)

  const openCountBefore = await page.locator('.column-count').nth(0).innerText()
  const source = await page.getByLabel('Drag First task').boundingBox()
  const target = await page.getByText('Second task').boundingBox()
  if (!source || !target) throw new Error('Drag coordinates are unavailable')

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 8, source.y + source.height / 2 + 8, {
    steps: 4,
  })
  await expect.poll(async () =>
    page.evaluate(() => window.__getQuickKanbanDropStyles('Done')),
  ).toMatchObject({
    forbidden: true,
    overlayVisible: true,
  })
  await expect.poll(async () =>
    page.evaluate(() => window.__getQuickKanbanDropStyles('Open')),
  ).toMatchObject({
    allowed: true,
    overlayVisible: false,
  })

  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 })
  await page.mouse.up()

  await expect(page.locator('.column-count').nth(0)).toHaveText(openCountBefore)
  await expect(page.getByLabel('Cards in Open').getByText('First task')).toBeVisible()
  await expect(page.getByLabel('Cards in Done').getByText('First task')).toHaveCount(0)
  await expect.poll(() =>
    page.evaluate(() => window.__quickKanbanAlerts.at(-1)?.indicator),
  ).toBe('red')
  await expect.poll(() =>
    page.evaluate(() => window.__quickKanbanAlerts.at(-1)?.message),
  ).toContain('Workflow State')
  await expect.poll(async () =>
    page.evaluate(() => window.__getQuickKanbanDropStyles('Done')),
  ).toMatchObject({
    forbidden: false,
    overlayVisible: false,
  })
})

test('shows readable drop highlights in light and dark themes', async ({ page }) => {
  await loadRestrictedMoveFixture(page, { reason: 'workflow_denied' })

  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => window.__setQuickKanbanTheme(value), theme)
    const source = await page.getByLabel('Drag First task').boundingBox()
    if (!source) throw new Error('Drag handle is unavailable')

    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(source.x + source.width / 2 + 8, source.y + source.height / 2 + 8, {
      steps: 4,
    })

    const styles = await page.evaluate(() => ({
      open: window.__getQuickKanbanDropStyles('Open'),
      done: window.__getQuickKanbanDropStyles('Done'),
    }))
    expect(styles.open.allowed).toBe(true)
    expect(styles.done.forbidden).toBe(true)
    expect(styles.done.overlayVisible).toBe(true)
    expect(styles.done.overlayBackground).not.toBe('rgba(0, 0, 0, 0)')
    expect(styles.open.outlineColor).not.toBe('rgba(0, 0, 0, 0)')

    await page.mouse.up()
    await expect.poll(async () =>
      page.evaluate(() => window.__getQuickKanbanDropStyles('Done')),
    ).toMatchObject({
      forbidden: false,
      overlayVisible: false,
    })
  }
})

test('clears drop highlights after releasing without a cross-column move', async ({ page }) => {
  await loadRestrictedMoveFixture(page, { reason: 'workflow_denied' })

  const source = await page.getByLabel('Drag First task').boundingBox()
  if (!source) throw new Error('Drag handle is unavailable')

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 8, source.y + source.height / 2 + 8, {
    steps: 4,
  })
  await expect.poll(async () =>
    page.evaluate(() => window.__getQuickKanbanDropStyles('Open')?.allowed),
  ).toBe(true)

  await page.mouse.up()
  await expect.poll(async () =>
    page.evaluate(() => {
      const open = window.__getQuickKanbanDropStyles('Open')
      const done = window.__getQuickKanbanDropStyles('Done')
      return !open?.allowed && !open?.forbidden && !done?.allowed && !done?.forbidden
    }),
  ).toBe(true)
})

test('persists column order when the board is reordered with write access', async ({ page }) => {
  await expect(page.locator('.column-title--draggable')).toHaveCount(2)

  await page.evaluate(async () => {
    await window.__reorderQuickKanbanColumns(['Done', 'Open'])
  })

  await expect.poll(() => page.evaluate(() => window.__columnOrderCalls?.length || 0))
    .toBeGreaterThan(0)

  const lastCall = await page.evaluate(() => window.__columnOrderCalls.at(-1))
  expect(lastCall.board_name).toBe('Browser Board')
  expect(lastCall.order).toBe(JSON.stringify(['Done', 'Open']))
})

test('classic columns keep cards inside the column scrollport', async ({ page }) => {
  await expect(page.locator('.kanban:not(.kanban--swimlanes)')).toBeVisible()
  const bounds = await page.evaluate(() => {
    const board = document.querySelector('.kanban:not(.kanban--swimlanes)')
    const column = board?.querySelector('.kanban-column:not(.kanban-column--collapsed)')
    const list = column?.querySelector('.kanban-card-list')
    const cards = [...(column?.querySelectorAll('.kanban-card') || [])]
    if (!board || !column || !list || !cards.length) {
      return null
    }
    const columnRect = column.getBoundingClientRect()
    const boardRect = board.getBoundingClientRect()
    const cardBottoms = cards.map((card) => Math.round(card.getBoundingClientRect().bottom))
    return {
      listOverflowY: getComputedStyle(list).overflowY,
      columnOverflow: getComputedStyle(column).overflow,
      boardOverflowY: getComputedStyle(board).overflowY,
      maxCardBottom: Math.max(...cardBottoms),
      columnBottom: Math.round(columnRect.bottom),
      boardBottom: Math.round(boardRect.bottom),
    }
  })
  expect(bounds).not.toBeNull()
  expect(bounds.listOverflowY).toBe('auto')
  expect(bounds.columnOverflow).toBe('hidden')
  expect(bounds.boardOverflowY).toBe('hidden')
  expect(bounds.maxCardBottom).toBeLessThanOrEqual(bounds.columnBottom + 1)
  expect(bounds.maxCardBottom).toBeLessThanOrEqual(bounds.boardBottom + 1)
})

test('opens inline editor after with_doc and saves through set_value', async ({ page }) => {
  const card = page.getByRole('listitem').filter({ hasText: 'First task' })
  const title = card.locator('.kanban-inline-field--title')
  await expect(title).toBeVisible()
  const displayMetrics = await title.locator('.kanban-inline-display').evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const styles = getComputedStyle(el)
    return {
      height: rect.height,
      width: rect.width,
      fontSize: styles.fontSize,
    }
  })
  await title.click()
  await expect.poll(() =>
    page.evaluate(() => window.__withDocCalls?.length || 0),
  ).toBeGreaterThan(0)
  const editing = page.locator('.kanban-inline-field--title.is-editing')
  await expect(editing.locator('input')).toBeVisible()
  const controlMetrics = await editing.locator('.kanban-inline-control').evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const input = el.querySelector('input, textarea, select')
    const styles = input ? getComputedStyle(input) : getComputedStyle(el)
    return {
      height: rect.height,
      width: rect.width,
      fontSize: styles.fontSize,
      outlineStyle: styles.outlineStyle,
      borderTopWidth: styles.borderTopWidth,
    }
  })
  expect(Math.abs(controlMetrics.height - displayMetrics.height)).toBeLessThanOrEqual(2)
  expect(Math.abs(controlMetrics.width - displayMetrics.width)).toBeLessThanOrEqual(2)
  expect(controlMetrics.fontSize).toBe(displayMetrics.fontSize)
  expect(controlMetrics.outlineStyle).toBe('none')
  expect(controlMetrics.borderTopWidth).toBe('0px')

  await editing.locator('input').fill('Renamed task')
  await editing.locator('input').dispatchEvent('change')

  await expect.poll(() =>
    page.evaluate(() => window.__setValueCalls?.at(-1)),
  ).toMatchObject({
    doctype: 'Task',
    name: 'TASK-1',
    values: { subject: 'Renamed task' },
  })
  await expect(page.getByLabel('Cards in Open')).toContainText('Renamed task')
})

test('double-click on title opens the card form and Link opens the linked record', async ({ page }) => {
  await page
    .getByRole('listitem')
    .filter({ hasText: 'First task' })
    .locator('.kanban-inline-field--title')
    .dispatchEvent('dblclick')
  await expect.poll(() =>
    page.evaluate(() => window.__lastFormRoute),
  ).toEqual(['Form', 'Task', 'TASK-1'])

  await page.locator('.kanban-card-fields [data-fieldtype="Link"] .kanban-inline-field')
    .first()
    .dispatchEvent('dblclick')
  await expect.poll(() =>
    page.evaluate(() => window.__lastFormRoute),
  ).toEqual(['Form', 'Project', 'TEST-PROJECT'])
})

test('single click on Link opens editor without form navigation', async ({ page }) => {
  await page.evaluate(() => {
    window.__lastFormRoute = null
    window.__withDocCalls = []
  })
  const linkField = page.locator('.kanban-card-fields [data-fieldtype="Link"] .kanban-inline-field').first()
  await expect(linkField.locator('a')).not.toHaveAttribute('href', /./)
  const displayMetrics = await linkField.locator('.kanban-inline-display').evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const styles = getComputedStyle(el)
    return {
      height: rect.height,
      width: rect.width,
      fontSize: styles.fontSize,
    }
  })
  await linkField.click()
  await expect.poll(() =>
    page.evaluate(() => window.__withDocCalls?.some((call) => call.name === 'TASK-1')),
  ).toBe(true)
  await expect(linkField).toHaveClass(/is-editing/)
  await expect.poll(() =>
    page.evaluate(() => window.__lastFormRoute),
  ).toBeNull()

  const cardOverflow = await linkField.evaluate((el) => {
    const card = el.closest('.kanban-card')
    return card ? getComputedStyle(card).overflow : null
  })
  expect(cardOverflow).toBe('visible')

  const controlMetrics = await linkField.locator('.kanban-inline-control').evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const input = el.querySelector('input, textarea, select')
    const styles = input ? getComputedStyle(input) : getComputedStyle(el)
    return {
      height: rect.height,
      width: rect.width,
      fontSize: styles.fontSize,
    }
  })
  expect(Math.abs(controlMetrics.height - displayMetrics.height)).toBeLessThanOrEqual(2)
  expect(Math.abs(controlMetrics.width - displayMetrics.width)).toBeLessThanOrEqual(2)
  expect(controlMetrics.fontSize).toBe(displayMetrics.fontSize)
})

test('double-click on highlight opens the card form; single click edits after with_doc', async ({ page }) => {
  await page.evaluate(() => {
    window.__lastFormRoute = null
    window.__withDocCalls = []
  })
  const highlight = page.locator('.kanban-inline-field--highlight').first()
  await highlight.dispatchEvent('dblclick')
  await expect.poll(() =>
    page.evaluate(() => window.__lastFormRoute),
  ).toEqual(['Form', 'Task', 'TASK-1'])

  await page.evaluate(() => {
    window.__lastFormRoute = null
    window.__withDocCalls = []
  })
  await highlight.click()
  await expect.poll(() =>
    page.evaluate(() => window.__withDocCalls?.some((call) => call.name === 'TASK-1')),
  ).toBe(true)
  const select = page.locator('.kanban-inline-field--highlight.is-editing select')
  await expect(select).toBeVisible()
  await expect.poll(async () => {
    const size = await select.evaluate((el) => Number(el.size) || 1)
    const optionsVisible = await select.locator('option').count()
    return size > 1 || optionsVisible > 0
  }).toBe(true)
})

test('double-click on card chrome opens the card form', async ({ page }) => {
  await page.evaluate(() => {
    window.__lastFormRoute = null
  })
  await page
    .getByRole('listitem')
    .filter({ hasText: 'First task' })
    .locator('.drag-handle')
    .dispatchEvent('dblclick')
  await expect.poll(() =>
    page.evaluate(() => window.__lastFormRoute),
  ).toEqual(['Form', 'Task', 'TASK-1'])
})

test('swimlane rows share height and horizontal scroll across columns', async ({ page }) => {
  await page.evaluate(() => {
    const store = window.__quickKanbanStore
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
    store.commit('SET_CELL_PAGINATION', {
      'alpha::Open': { offset: 5, hasMore: true, loading: false },
      'alpha::Done': { offset: 2, hasMore: false, loading: false },
      'beta::Open': { offset: 1, hasMore: false, loading: false },
      'beta::Done': { offset: 1, hasMore: false, loading: false },
    })
    store.commit('SET_EXPANDED_LANE_KEYS', ['alpha'])
    store.commit('SET_LOADING', false)
    store.commit('SET_ERROR', '')
  })

  await expect(page.locator('.kanban--swimlanes')).toBeVisible()
  await expect(page.locator('.swimlane-lane[data-lane-key="alpha"]')).toBeVisible()
  await expect(page.getByText('OPEN-A 1')).toBeVisible()

  const laneChrome = await page.evaluate(() => {
    const alpha = document.querySelector('.swimlane-lane[data-lane-key="alpha"]')
    const toggles = [...document.querySelectorAll('.swimlane-lane-toggle')]
    const titles = [...document.querySelectorAll('.swimlane-lane-title')].map((n) => n.textContent.trim())
    const counts = Object.fromEntries(
      [...document.querySelectorAll('.swimlane-lane')].map((lane) => [
        lane.getAttribute('data-lane-key'),
        lane.querySelector('.swimlane-lane-count')?.textContent?.trim() || '',
      ]),
    )
    const sticky = alpha?.querySelector('.swimlane-lane-sticky')
    const laneHeader = alpha?.querySelector('.swimlane-lane-header')
    const toggle = alpha?.querySelector('.swimlane-lane-toggle')
    const board = document.querySelector('.kanban--swimlanes')
    const stickyBg = sticky ? getComputedStyle(sticky).backgroundColor : ''
    const alphaMatch = stickyBg.match(/rgba?\(([^)]+)\)/)
    let chromeAlpha = 1
    if (alphaMatch) {
      const parts = alphaMatch[1].split(',').map((part) => part.trim())
      chromeAlpha = parts.length === 4 ? Number(parts[3]) : 1
    }
    return {
      toggleCount: toggles.length,
      titles,
      counts,
      groupHeaders: document.querySelectorAll('.swimlane-group-header').length,
      chromeRows: document.querySelectorAll('.swimlane-chrome-row').length,
      stickyPosition: sticky ? getComputedStyle(sticky).position : null,
      headerPosition: laneHeader ? getComputedStyle(laneHeader).position : null,
      headerTransparent: laneHeader
        ? ['transparent', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(laneHeader).backgroundColor)
        : false,
      toggleSticky: toggle ? getComputedStyle(toggle).position : null,
      stickyTopVar: board?.style.getPropertyValue('--swimlane-sticky-lanes-top') || '',
      labelInsetVar: board?.style.getPropertyValue('--swimlane-label-inset') || '',
      chromeAlpha,
    }
  })
  expect(laneChrome.toggleCount).toBe(2)
  expect(laneChrome.titles).toEqual(['Alpha', 'Beta'])
  expect(laneChrome.counts).toEqual({ alpha: '7', beta: '2' })
  expect(laneChrome.groupHeaders).toBe(0)
  expect(laneChrome.chromeRows).toBe(2)
  expect(laneChrome.stickyPosition).toBe('sticky')
  expect(laneChrome.headerPosition).toBe('relative')
  expect(laneChrome.headerTransparent).toBe(true)
  expect(laneChrome.toggleSticky).toBe('sticky')
  expect(laneChrome.stickyTopVar).toMatch(/\d+px/)
  expect(laneChrome.labelInsetVar).toBe('0px')
  expect(laneChrome.chromeAlpha).toBeGreaterThan(0.08)
  expect(laneChrome.chromeAlpha).toBeLessThan(0.35)

  const initial = await page.evaluate(() => {
    const lane = document.querySelector('.swimlane-lane[data-lane-key="alpha"]')
    const row = lane.querySelector('.swimlane-row')
    const groups = [...row.querySelectorAll('.swimlane-group')]
    const rects = groups.map((group) => group.getBoundingClientRect())
    const lists = [...row.querySelectorAll('.kanban-card-list')]
    return {
      tops: rects.map((rect) => Math.round(rect.top)),
      bottoms: rects.map((rect) => Math.round(rect.bottom)),
      height: Math.round(rects[0]?.height || 0),
      nestedOverflowY: lists.map((list) => getComputedStyle(list).overflowY),
      nestedOverflowX: [
        ...document.querySelectorAll('.swimlane-row, .swimlane-header-row, .swimlane-group-body'),
      ].map((node) => getComputedStyle(node).overflowX),
    }
  })
  expect(new Set(initial.tops).size).toBe(1)
  expect(new Set(initial.bottoms).size).toBe(1)
  expect(initial.nestedOverflowY.every((value) => !['auto', 'scroll'].includes(value))).toBe(true)
  expect(initial.nestedOverflowX.every((value) => !['auto', 'scroll'].includes(value))).toBe(true)

  await expect.poll(async () => page.evaluate(() => {
    const board = document.querySelector('.kanban--swimlanes')
    return board.scrollWidth > board.clientWidth + 40
  })).toBe(true)
  await page.evaluate(() => {
    document.querySelector('.kanban--swimlanes').scrollLeft = 120
  })
  const scrolled = await page.evaluate(() => {
    const board = document.querySelector('.kanban--swimlanes')
    const header = document.querySelector('.swimlane-header-row')
    const lane = document.querySelector('.swimlane-lane[data-lane-key="alpha"]')
    const row = lane.querySelector('.swimlane-row')
    const toggle = lane.querySelector('.swimlane-lane-toggle')
    const groups = [...row.querySelectorAll('.swimlane-group')]
    const boardLeft = Math.round(board.getBoundingClientRect().left)
    return {
      scrollLeft: board.scrollLeft,
      headerLeft: Math.round(header.getBoundingClientRect().left),
      rowLeft: Math.round(row.getBoundingClientRect().left),
      toggleLeft: Math.round(toggle.getBoundingClientRect().left),
      boardLeft,
      tops: groups.map((group) => Math.round(group.getBoundingClientRect().top)),
    }
  })
  expect(scrolled.scrollLeft).toBeGreaterThanOrEqual(120)
  expect(scrolled.headerLeft).toBe(scrolled.rowLeft)
  expect(Math.abs(scrolled.toggleLeft - scrolled.boardLeft)).toBeLessThanOrEqual(2)
  expect(new Set(scrolled.tops).size).toBe(1)

  await page.evaluate(() => {
    document.querySelector('.kanban--swimlanes').scrollLeft = 0
    document.querySelector('.kanban--swimlanes').scrollTop = 80
  })
  const scrolledY = await page.evaluate(() => {
    const board = document.querySelector('.kanban--swimlanes')
    const colHeader = document.querySelector('.swimlane-header-row')
    const sticky = document.querySelector(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-lane-sticky',
    )
    const title = document.querySelector(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-lane-title',
    )
    if (!board || !colHeader || !sticky || !title) {
      return null
    }
    const headerBg = getComputedStyle(colHeader).backgroundColor
    return {
      scrollTop: board.scrollTop,
      stickyTop: Math.round(sticky.getBoundingClientRect().top),
      colHeaderBottom: Math.round(colHeader.getBoundingClientRect().bottom),
      titleVisible: title.getBoundingClientRect().width > 0
        && getComputedStyle(title).visibility !== 'hidden',
      headerBg,
      headerBgTransparent: headerBg === 'rgba(0, 0, 0, 0)' || headerBg === 'transparent',
    }
  })
  expect(scrolledY).not.toBeNull()
  expect(scrolledY.scrollTop).toBeGreaterThanOrEqual(80)
  expect(Math.abs(scrolledY.stickyTop - scrolledY.colHeaderBottom)).toBeLessThanOrEqual(2)
  expect(scrolledY.titleVisible).toBe(true)
  expect(scrolledY.headerBgTransparent).toBe(false)

  await page.evaluate(() => {
    const store = window.__quickKanbanStore
    const lane = store.state.lanes[0]
    const extra = Array.from({ length: 4 }, (_, index) => ({
      name: `OPEN-A-EXTRA-${index + 1}`,
      subject: `OPEN-A EXTRA ${index + 1}`,
      status: 'Open',
    }))
    store.commit('SET_COLUMN_CARDS', {
      laneIndex: 0,
      columnIndex: 0,
      cards: [...lane.columns[0].cards, ...extra],
    })
    store.commit('BUMP_DRAG_SYNC')
  })
  await expect(page.getByText('OPEN-A EXTRA 1')).toBeVisible()
  await expect.poll(async () => page.evaluate(() => {
    const row = document.querySelector('.swimlane-lane[data-lane-key="alpha"] .swimlane-row')
    const groups = [...row.querySelectorAll('.swimlane-group')]
    const rects = groups.map((group) => group.getBoundingClientRect())
    return {
      height: Math.round(rects[0]?.height || 0),
      sameBottom: Math.round(rects[0].bottom) === Math.round(rects[1].bottom),
    }
  })).toMatchObject({
    sameBottom: true,
  })
  const grown = await page.evaluate(() => {
    const row = document.querySelector('.swimlane-lane[data-lane-key="alpha"] .swimlane-row')
    const groups = [...row.querySelectorAll('.swimlane-group')]
    const rects = groups.map((group) => group.getBoundingClientRect())
    return {
      height: Math.round(row.getBoundingClientRect().height),
      sameBottom: Math.round(rects[0].bottom) === Math.round(rects[1].bottom),
      cardCount: row.querySelectorAll('.kanban-card').length,
    }
  })
  // Row may already fill the viewport (no growth), but cells must stay aligned.
  expect(grown.height).toBeGreaterThanOrEqual(initial.height)
  expect(grown.sameBottom).toBe(true)
  expect(grown.cardCount).toBeGreaterThan(5)

  const containment = await page.evaluate(() => {
    const group = document.querySelector(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-group[data-column-value="Open"]',
    )
    const cell = group?.querySelector('.kanban-column--cell')
    const list = group?.querySelector('.kanban-card-list')
    const cards = [...(group?.querySelectorAll('.kanban-card') || [])]
    const last = cards[cards.length - 1]
    const board = document.querySelector('.kanban--swimlanes')
    if (!group || !cell || !list || !last || !board) {
      return null
    }
    return {
      groupBottom: Math.round(group.getBoundingClientRect().bottom),
      lastCardBottom: Math.round(last.getBoundingClientRect().bottom),
      listOverflowY: getComputedStyle(list).overflowY,
      cellMaxHeight: getComputedStyle(cell).maxHeight,
      boardCanScroll: board.scrollHeight >= board.clientHeight,
    }
  })
  expect(containment).not.toBeNull()
  expect(containment.lastCardBottom).toBeLessThanOrEqual(containment.groupBottom + 1)
  expect(['auto', 'scroll'].includes(containment.listOverflowY)).toBe(false)
  expect(containment.cellMaxHeight).toBe('none')

  const colorMatch = await page.evaluate(() => {
    const header = [...document.querySelectorAll('.swimlane-header-row .kanban-column')]
      .find((node) => node.querySelector('.column-title')?.textContent === 'Open')
    const group = document.querySelector(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-group[data-column-value="Open"]',
    )
    if (!header || !group) {
      return null
    }
    return {
      headerBg: getComputedStyle(header).backgroundColor,
      groupBg: getComputedStyle(group).backgroundColor,
    }
  })
  expect(colorMatch).not.toBeNull()
  expect(colorMatch.groupBg).toBe(colorMatch.headerBg)
  expect(colorMatch.groupBg).not.toBe('rgba(0, 0, 0, 0)')

  const laneTint = await page.evaluate(() => {
    const board = document.querySelector('.kanban--swimlanes')
    const group = document.querySelector(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-group[data-column-value="Open"]',
    )
    const lane = document.querySelector('.swimlane-lane[data-lane-key="alpha"]')
    if (!board || !group || !lane) {
      return null
    }
    return {
      tintVar: getComputedStyle(board).getPropertyValue('--swimlane-lane-tint').trim(),
      groupShadow: getComputedStyle(group).boxShadow,
      laneBg: getComputedStyle(lane).backgroundColor,
    }
  })
  expect(laneTint).not.toBeNull()
  expect(laneTint.tintVar.length).toBeGreaterThan(0)
  expect(laneTint.groupShadow).toContain('inset')
  expect(laneTint.laneBg).not.toBe('rgba(0, 0, 0, 0)')

  await expect(page.locator('.swimlane-header-row .column-title--draggable')).toHaveCount(2)

  const continuousTrack = await page.evaluate(() => {
    const header = document.querySelector('.swimlane-header-row')
    const alphaLane = document.querySelector('.swimlane-lane[data-lane-key="alpha"]')
    const betaLane = document.querySelector('.swimlane-lane[data-lane-key="beta"]')
    const alphaGroup = alphaLane?.querySelector('.swimlane-group[data-column-value="Open"]')
    const sticky = alphaLane?.querySelector('.swimlane-lane-sticky')
    const chromeCell = alphaLane?.querySelector(
      '.swimlane-chrome-cell[data-column-value="Open"]',
    )
    if (!header || !alphaLane || !betaLane || !alphaGroup || !sticky || !chromeCell) {
      return null
    }
    const headerBottom = Math.round(header.getBoundingClientRect().bottom)
    const alphaLaneTop = Math.round(alphaLane.getBoundingClientRect().top)
    const alphaLaneBottom = Math.round(alphaLane.getBoundingClientRect().bottom)
    const betaLaneTop = Math.round(betaLane.getBoundingClientRect().top)
    const stickyBottom = Math.round(sticky.getBoundingClientRect().bottom)
    const alphaGroupTop = Math.round(alphaGroup.getBoundingClientRect().top)
    const openHeader = [...document.querySelectorAll('.swimlane-header-row .kanban-column')]
      .find((node) => node.querySelector('.column-title')?.textContent === 'Open')
    return {
      headerToLaneGap: alphaLaneTop - headerBottom,
      laneToLaneGap: betaLaneTop - alphaLaneBottom,
      stickyToGroupGap: alphaGroupTop - stickyBottom,
      chromeLeft: Math.round(chromeCell.getBoundingClientRect().left),
      headerColLeft: openHeader ? Math.round(openHeader.getBoundingClientRect().left) : null,
      lastLane: betaLane.classList.contains('swimlane-lane--last'),
    }
  })
  expect(continuousTrack).not.toBeNull()
  expect(continuousTrack.headerToLaneGap).toBeLessThanOrEqual(1)
  expect(continuousTrack.laneToLaneGap).toBeLessThanOrEqual(1)
  expect(continuousTrack.stickyToGroupGap).toBeLessThanOrEqual(1)
  expect(Math.abs(continuousTrack.chromeLeft - continuousTrack.headerColLeft))
    .toBeLessThanOrEqual(2)
  expect(continuousTrack.lastLane).toBe(true)

  const collapsedLaneTracks = await page.evaluate(() => {
    const openHeader = [...document.querySelectorAll('.swimlane-header-row .kanban-column')]
      .find((node) => node.querySelector('.column-title')?.textContent === 'Open')
    const betaLane = document.querySelector('.swimlane-lane[data-lane-key="beta"]')
    const chromeCell = betaLane?.querySelector(
      '.swimlane-chrome-cell[data-column-value="Open"]',
    )
    const betaSticky = betaLane?.querySelector('.swimlane-lane-sticky')
    const alphaLane = document.querySelector('.swimlane-lane[data-lane-key="alpha"]')
    if (!openHeader || !betaLane || !chromeCell || !betaSticky || !alphaLane) {
      return null
    }
    const headerRect = openHeader.getBoundingClientRect()
    const chromeRect = chromeCell.getBoundingClientRect()
    const stickyBg = getComputedStyle(betaSticky).backgroundColor
    const alphaMatch = stickyBg.match(/rgba?\(([^)]+)\)/)
    let stickyAlpha = 1
    if (alphaMatch) {
      const parts = alphaMatch[1].split(',').map((part) => part.trim())
      stickyAlpha = parts.length === 4 ? Number(parts[3]) : 1
    }
    return {
      collapsed: betaLane.classList.contains('swimlane-lane--collapsed'),
      chromeWidth: Math.round(chromeRect.width),
      headerColWidth: Math.round(headerRect.width),
      chromeLeft: Math.round(chromeRect.left),
      headerColLeft: Math.round(headerRect.left),
      laneWidth: Math.round(betaLane.getBoundingClientRect().width),
      alphaLaneWidth: Math.round(alphaLane.getBoundingClientRect().width),
      stickyWidth: Math.round(betaSticky.getBoundingClientRect().width),
      stickyAlpha,
      chromeBg: getComputedStyle(chromeCell).backgroundColor,
      headerColBg: getComputedStyle(openHeader).backgroundColor,
    }
  })
  expect(collapsedLaneTracks).not.toBeNull()
  expect(collapsedLaneTracks.collapsed).toBe(true)
  expect(collapsedLaneTracks.chromeWidth).toBeGreaterThan(40)
  expect(Math.abs(collapsedLaneTracks.chromeWidth - collapsedLaneTracks.headerColWidth))
    .toBeLessThanOrEqual(2)
  expect(Math.abs(collapsedLaneTracks.chromeLeft - collapsedLaneTracks.headerColLeft))
    .toBeLessThanOrEqual(2)
  expect(collapsedLaneTracks.laneWidth).toBeGreaterThan(collapsedLaneTracks.chromeWidth)
  expect(Math.abs(collapsedLaneTracks.laneWidth - collapsedLaneTracks.alphaLaneWidth))
    .toBeLessThanOrEqual(2)
  expect(collapsedLaneTracks.stickyWidth).toBeGreaterThanOrEqual(collapsedLaneTracks.laneWidth - 2)
  expect(collapsedLaneTracks.stickyAlpha).toBeGreaterThan(0.08)
  expect(collapsedLaneTracks.stickyAlpha).toBeLessThan(0.35)
  expect(collapsedLaneTracks.chromeBg).toBe(collapsedLaneTracks.headerColBg)

  const beforeCollapse = await page.evaluate(() => {
    const header = document.querySelector('.swimlane-header-row')
    const firstLane = document.querySelector('.swimlane-lane[data-lane-key="alpha"]')
    return {
      gap: Math.round(firstLane.getBoundingClientRect().top - header.getBoundingClientRect().bottom),
      headerHeight: Math.round(header.getBoundingClientRect().height),
    }
  })

  await page.evaluate(() => {
    window.__quickKanbanStore.commit('SET_COLUMN_COLLAPSED', {
      columnKey: 'Open',
      collapsed: true,
    })
  })
  await expect(
    page.locator('.swimlane-lane[data-lane-key="alpha"] .swimlane-cell-spacer'),
  ).toHaveCount(1)
  await expect(
    page.locator('.swimlane-lane[data-lane-key="alpha"] .swimlane-group'),
  ).toHaveCount(1)

  await expect.poll(async () => page.evaluate(() => {
    const board = document.querySelector('.kanban--swimlanes')
    return board?.style.getPropertyValue('--swimlane-label-inset') || ''
  })).toBe('60px')

  const labelInsetAlign = await page.evaluate(() => {
    document.querySelector('.kanban--swimlanes').scrollLeft = 0
    const doneHeader = [...document.querySelectorAll('.swimlane-header-row .kanban-column')]
      .find((node) => node.querySelector('.column-title')?.textContent === 'Done')
    const toggle = document.querySelector(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-lane-toggle',
    )
    if (!doneHeader || !toggle) {
      return null
    }
    return {
      toggleLeft: Math.round(toggle.getBoundingClientRect().left),
      firstOpenColLeft: Math.round(doneHeader.getBoundingClientRect().left),
    }
  })
  expect(labelInsetAlign).not.toBeNull()
  expect(Math.abs(labelInsetAlign.toggleLeft - labelInsetAlign.firstOpenColLeft))
    .toBeLessThanOrEqual(4)

  await expect.poll(async () => page.evaluate(() => {
    const header = document.querySelector('.swimlane-header-row')
    const firstLane = document.querySelector('.swimlane-lane[data-lane-key="alpha"]')
    const laneHeader = firstLane?.querySelector('.swimlane-lane-header')
    const collapsed = document.querySelector(
      '.swimlane-header-row .kanban-column--header-only.kanban-column--collapsed',
    )
    const expanded = [...document.querySelectorAll(
      '.swimlane-header-row .kanban-column--header-only:not(.kanban-column--collapsed)',
    )][0]
    const spacer = document.querySelector(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-cell-spacer[data-column-value="Open"]',
    )
    const doneGroup = document.querySelector(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-group[data-column-value="Done"]',
    )
    if (!collapsed || !spacer || !expanded || !doneGroup || !laneHeader) {
      return null
    }
    const count = collapsed.querySelector('.column-count')
    const title = collapsed.querySelector('.column-title')
    const menuBtn = collapsed.querySelector('.quick-kanban-column-menu .header-item')
    const columnHeader = collapsed.querySelector('.kanban-column-header')
    const headerStyle = columnHeader ? getComputedStyle(columnHeader) : null
    const headerHeight = Math.round(header.getBoundingClientRect().height)
    const expandedHeight = Math.round(expanded.getBoundingClientRect().height)
    const countTop = count ? Math.round(count.getBoundingClientRect().top) : null
    const titleTop = title ? Math.round(title.getBoundingClientRect().top) : null
    const menuTop = menuBtn ? Math.round(menuBtn.getBoundingClientRect().top) : null
    return {
      gap: Math.round(firstLane.getBoundingClientRect().top - header.getBoundingClientRect().bottom),
      collapsedHeight: Math.round(collapsed.getBoundingClientRect().height),
      headerHeight,
      expandedHeight,
      stretchFill: expandedHeight === headerHeight,
      stickyToGroupGap: Math.round(
        doneGroup.getBoundingClientRect().top
          - firstLane.querySelector('.swimlane-lane-sticky').getBoundingClientRect().bottom,
      ),
      headerBg: getComputedStyle(collapsed).backgroundColor,
      spacerBg: getComputedStyle(spacer).backgroundColor,
      headerPosition: headerStyle?.position || null,
      chromeOrderOk: countTop != null && titleTop != null && menuTop != null
        && countTop < titleTop
        && titleTop < menuTop,
      spacerAlignedWithDone: Math.round(spacer.getBoundingClientRect().top)
        === Math.round(doneGroup.getBoundingClientRect().top),
    }
  })).toMatchObject({
    headerPosition: 'absolute',
    chromeOrderOk: true,
    stretchFill: true,
  })
  const afterCollapse = await page.evaluate(() => {
    const header = document.querySelector('.swimlane-header-row')
    const firstLane = document.querySelector('.swimlane-lane[data-lane-key="alpha"]')
    const sticky = firstLane.querySelector('.swimlane-lane-sticky')
    const collapsed = document.querySelector(
      '.swimlane-header-row .kanban-column--header-only.kanban-column--collapsed',
    )
    const expanded = [...document.querySelectorAll(
      '.swimlane-header-row .kanban-column--header-only:not(.kanban-column--collapsed)',
    )][0]
    const spacer = document.querySelector(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-cell-spacer[data-column-value="Open"]',
    )
    const doneGroup = document.querySelector(
      '.swimlane-lane[data-lane-key="alpha"] .swimlane-group[data-column-value="Done"]',
    )
    return {
      gap: Math.round(firstLane.getBoundingClientRect().top - header.getBoundingClientRect().bottom),
      collapsedHeight: Math.round(collapsed.getBoundingClientRect().height),
      headerHeight: Math.round(header.getBoundingClientRect().height),
      expandedHeight: Math.round(expanded.getBoundingClientRect().height),
      stickyToGroupGap: Math.round(
        doneGroup.getBoundingClientRect().top - sticky.getBoundingClientRect().bottom,
      ),
      headerBg: getComputedStyle(collapsed).backgroundColor,
      spacerBg: getComputedStyle(spacer).backgroundColor,
      spacerAlignedWithDone: Math.round(spacer.getBoundingClientRect().top)
        === Math.round(doneGroup.getBoundingClientRect().top),
    }
  })
  expect(afterCollapse.collapsedHeight).toBeGreaterThan(0)
  expect(afterCollapse.expandedHeight).toBe(afterCollapse.headerHeight)
  expect(afterCollapse.stickyToGroupGap).toBeLessThanOrEqual(1)
  expect(afterCollapse.spacerAlignedWithDone).toBe(true)
  // Compact collapsed chrome must not inflate sticky row past expanded header height.
  expect(afterCollapse.headerHeight).toBeLessThanOrEqual(beforeCollapse.headerHeight + 12)
  expect(afterCollapse.gap).toBeLessThanOrEqual(beforeCollapse.gap + 2)
  expect(afterCollapse.headerBg).toBe(afterCollapse.spacerBg)
  expect(afterCollapse.headerBg).not.toBe('rgba(0, 0, 0, 0)')

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
  await expect(
    page.locator('.swimlane-lane[data-lane-key="alpha"] .swimlane-cell-spacer'),
  ).toHaveCount(0)

  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => window.__setQuickKanbanTheme(value), theme)
    await expect(page.locator('.swimlane-lane[data-lane-key="alpha"]')).toBeVisible()
  }

  await expect(
    page.locator('.swimlane-lane[data-lane-key="alpha"] .drag-handle').first(),
  ).toBeVisible()
})
