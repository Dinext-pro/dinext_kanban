import { expect, test } from '@playwright/test'

async function openChildPanelFixture(page, {
  parentStatus = 'Done',
  otherStatus = 'Open',
} = {}) {
  await page.addInitScript(({ parentStatus: parentCol, otherStatus: otherCol }) => {
    window.__childCounts = {
      'TASK-PARENT': 2,
      'TASK-OTHER': 0,
    }
    window.__childColumnTotals = {
      'TASK-PARENT': { Open: 1, Done: 1 },
    }
    window.__customQuickKanbanCards = [
      {
        name: 'TASK-OTHER',
        subject: 'Other root in first column',
        status: otherCol,
        priority: 'Low',
        expected_end_date: '2026-07-11',
        project: 'SECOND-PROJECT',
        modified: '2026-07-10 10:00:00',
      },
      {
        name: 'TASK-PARENT',
        subject: 'Parent in second column',
        status: parentCol,
        priority: 'High',
        expected_end_date: '2026-07-10',
        project: 'TEST-PROJECT',
        modified: '2026-07-10 10:00:00',
      },
    ]
  }, { parentStatus, otherStatus })

  await page.goto('/e2e/fixture.html')
  await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()
  await expect(page.getByText('Parent in second column')).toBeVisible()
}

test.describe('child tasks panel', () => {
  test('opens from child-count badge and loads direct children', async ({ page }) => {
    await openChildPanelFixture(page)

    const badge = page.locator(
      '.kanban-card:has-text("Parent in second column") .kanban-child-count',
    )
    await expect(badge).toBeVisible()
    await badge.click()

    const panel = page.locator('.child-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('aria-label', /Child records of TASK-PARENT/)
    await expect(
      page.locator('.kanban-card:has-text("Parent in second column")'),
    ).toHaveClass(/kanban-card--minimized/)
    await expect(page.getByText('Child of TASK-PARENT in Open')).toBeVisible()
    await expect(page.getByText('Child of TASK-PARENT in Done')).toBeVisible()

    await expect.poll(() =>
      page.evaluate(() => (window.__childPageCalls || []).length),
    ).toBeGreaterThan(0)
    const pageArgs = await page.evaluate(() => window.__childPageCalls[0])
    expect(pageArgs).toMatchObject({
      parent_name: 'TASK-PARENT',
      parent_field: 'parent_task',
    })
  })

  test('panel starts at first column and spans board width above other cards', async ({ page }) => {
    await openChildPanelFixture(page)

    await page.locator(
      '.kanban-card:has-text("Parent in second column") .kanban-child-count',
    ).click()

    const panel = page.locator('.child-panel.child-panel--teleported')
    await expect(panel).toBeVisible()

    const metrics = await page.evaluate(() => {
      const board = document.querySelector('#kanbanapp .kanban')
      const firstColumn = board?.querySelector('.kanban-column')
      const panelEl = document.querySelector('.child-panel.child-panel--teleported')
      const otherCard = [...document.querySelectorAll('.kanban-card')]
        .find((card) => card.textContent.includes('Other root in first column'))
      if (!board || !firstColumn || !panelEl || !otherCard) {
        return null
      }
      const boardRect = board.getBoundingClientRect()
      const columnRect = firstColumn.getBoundingClientRect()
      const panelRect = panelEl.getBoundingClientRect()
      const otherRect = otherCard.getBoundingClientRect()
      const style = getComputedStyle(panelEl)
      const scroll = panelEl.querySelector('.child-panel-scroll')
      const scrollStyle = scroll ? getComputedStyle(scroll) : null
      const midX = otherRect.left + otherRect.width / 2
      const midY = panelRect.top + Math.min(40, panelRect.height / 2)
      const topEl = document.elementFromPoint(midX, midY)
      return {
        panelLeft: panelRect.left,
        firstColumnLeft: columnRect.left,
        boardLeft: boardRect.left,
        panelWidth: panelRect.width,
        boardScrollWidth: board.scrollWidth,
        panelInlineLeft: style.left,
        panelPosition: style.position,
        scrollOverflow: scrollStyle?.overflow,
        scrollOverflowY: scrollStyle?.overflowY,
        scrollMaxHeight: scrollStyle?.maxHeight,
        topElClass: topEl?.className || '',
        topElIsPanel: Boolean(topEl?.closest?.('.child-panel')),
        topElIsOtherCard: Boolean(topEl?.closest?.('.kanban-card')?.textContent.includes('Other root')),
      }
    })

    expect(metrics).not.toBeNull()
    expect(metrics.panelPosition).toBe('absolute')
    expect(metrics.panelInlineLeft).toBe('0px')
    expect(Math.abs(metrics.panelLeft - metrics.firstColumnLeft)).toBeLessThan(12)
    expect(metrics.panelWidth).toBeGreaterThan(metrics.boardScrollWidth * 0.9)
    expect(metrics.topElIsPanel).toBe(true)
    expect(metrics.topElIsOtherCard).toBe(false)
  })

  test('child panel columns match board gutters and align with board columns', async ({ page }) => {
    await openChildPanelFixture(page)
    await page.locator(
      '.kanban-card:has-text("Parent in second column") .kanban-child-count',
    ).click()
    await expect(page.locator('.child-panel')).toBeVisible()
    await expect(page.getByText('Child of TASK-PARENT in Open')).toBeVisible()

    const layout = await page.evaluate(() => {
      const board = document.querySelector('#kanbanapp .kanban')
      const panel = document.querySelector('.child-panel')
      const scroll = panel?.querySelector('.child-panel-scroll')
      const groups = [...(panel?.querySelectorAll('.child-panel-group') || [])]
      const flatColumns = board?.classList.contains('kanban--swimlanes')
        ? [...(board.querySelectorAll('.swimlane-header-row .kanban-column') || [])]
        : [...(board?.querySelectorAll(':scope > .kanban-column') || [])]
      if (!panel || !scroll || groups.length < 2 || flatColumns.length < 2) {
        return null
      }
      const panelStyle = getComputedStyle(panel)
      const scrollStyle = getComputedStyle(scroll)
      const scrollHeight = scroll.getBoundingClientRect().height
      const groupRects = groups.map((group) => group.getBoundingClientRect())
      const columnRects = flatColumns.map((column) => column.getBoundingClientRect())
      const gutter = Number.parseFloat(scrollStyle.columnGap || scrollStyle.gap) || 0
      return {
        panelPadding: panelStyle.padding,
        panelBorderWidth: panelStyle.borderWidth,
        scrollGap: scrollStyle.gap || scrollStyle.columnGap,
        scrollAlign: scrollStyle.alignItems,
        scrollHeight,
        maxHeightDelta: Math.max(
          ...groupRects.map((rect) => Math.abs(rect.height - scrollHeight)),
        ),
        firstGroupLeft: groupRects[0].left,
        firstColumnLeft: columnRects[0].left,
        groupStep: groupRects[1].left - groupRects[0].left,
        columnStep: columnRects[1].left - columnRects[0].left,
        firstGroupWidth: groupRects[0].width,
        firstColumnWidth: columnRects[0].width,
        gutter,
        groupBoxShadow: getComputedStyle(groups[0]).boxShadow,
        panelTintVar: panelStyle.getPropertyValue('--child-panel-column-tint').trim(),
        viewportFill: panel.classList.contains('child-panel--viewport-fill'),
        panelHeight: panel.getBoundingClientRect().height,
        expectedFillHeight: (() => {
          const host = document.querySelector('.kanban-card[data-card-name="TASK-PARENT"]')
          if (!host) {
            return null
          }
          const hostBottom = host.getBoundingClientRect().bottom
          return board.clientHeight - (hostBottom - board.getBoundingClientRect().top)
        })(),
        listOverflowY: getComputedStyle(
          panel.querySelector('.kanban-card-list'),
        ).overflowY,
        outerListOverflowY: getComputedStyle(
          board.querySelector(':scope > .kanban-column .kanban-card-list')
            || board.querySelector('.kanban-card-list'),
        ).overflowY,
        cardTopInset: (() => {
          const group = groups.find((el) => el.querySelector('.kanban-card'))
          const card = group?.querySelector('.kanban-card')
          if (!group || !card) {
            return null
          }
          return card.getBoundingClientRect().top - group.getBoundingClientRect().top
        })(),
        cardTopInsetAfterScroll: (() => {
          const group = groups.find((el) => el.querySelector('.kanban-card'))
          const list = group?.querySelector('.kanban-card-list')
          if (!group || !list) {
            return null
          }
          list.scrollTop = Math.max(list.scrollHeight - list.clientHeight, 200)
          // Gap is between group top and scrollport top (padding on group stays put).
          return list.getBoundingClientRect().top - group.getBoundingClientRect().top
        })(),
      }
    })

    expect(layout).not.toBeNull()
    expect(layout.panelPadding).toBe('0px')
    expect(layout.scrollGap).toBe('8px')
    expect(layout.scrollAlign).toBe('stretch')
    expect(layout.maxHeightDelta).toBeLessThan(2)
    expect(Math.abs(layout.firstGroupLeft - layout.firstColumnLeft)).toBeLessThan(2)
    expect(Math.abs(layout.groupStep - layout.columnStep)).toBeLessThan(2)
    expect(Math.abs(layout.firstGroupWidth - layout.firstColumnWidth)).toBeLessThan(2)
    expect(layout.groupBoxShadow).toMatch(/inset/)
    expect(layout.panelTintVar).toMatch(/8%/)
    expect(layout.viewportFill).toBe(true)
    expect(layout.expectedFillHeight).not.toBeNull()
    expect(Math.abs(layout.panelHeight - layout.expectedFillHeight)).toBeLessThanOrEqual(8)
    expect(['auto', 'scroll']).toContain(layout.listOverflowY)
    expect(layout.outerListOverflowY).toBe('hidden')
    expect(layout.cardTopInset).not.toBeNull()
    expect(Math.abs(layout.cardTopInset - 8)).toBeLessThan(2)
    expect(layout.cardTopInsetAfterScroll).not.toBeNull()
    expect(Math.abs(layout.cardTopInsetAfterScroll - 8)).toBeLessThan(2)
  })

  test('closing the badge toggles the panel off', async ({ page }) => {
    await openChildPanelFixture(page)
    const badge = page.locator(
      '.kanban-card:has-text("Parent in second column") .kanban-child-count',
    )
    await badge.click()
    await expect(page.locator('.child-panel')).toBeVisible()
    await badge.click()
    await expect(page.locator('.child-panel')).toHaveCount(0)
  })

  test('scrolls the minimized host card to the top of the board on open', async ({ page }) => {
    await page.addInitScript(() => {
      window.__childCounts = { 'TASK-PARENT': 2, 'TASK-OTHER': 0 }
      window.__childColumnTotals = {
        'TASK-PARENT': { Open: 1, Done: 1 },
      }
      const fillers = Array.from({ length: 18 }, (_, index) => ({
        name: `TASK-FILLER-${index + 1}`,
        subject: `Filler card ${index + 1}`,
        status: 'Done',
        priority: 'Low',
        expected_end_date: '2026-07-10',
        project: 'TEST-PROJECT',
        modified: `2026-07-10 09:${String(index).padStart(2, '0')}:00`,
      }))
      window.__customQuickKanbanCards = [
        {
          name: 'TASK-OTHER',
          subject: 'Other root in first column',
          status: 'Open',
          priority: 'Low',
          expected_end_date: '2026-07-11',
          project: 'SECOND-PROJECT',
          modified: '2026-07-10 10:00:00',
        },
        ...fillers,
        {
          name: 'TASK-PARENT',
          subject: 'Parent in second column',
          status: 'Done',
          priority: 'High',
          expected_end_date: '2026-07-10',
          project: 'TEST-PROJECT',
          modified: '2026-07-10 11:00:00',
        },
      ]
    })

    await page.goto('/e2e/fixture.html')
    const host = page.locator('.kanban-card[data-card-name="TASK-PARENT"]')
    await expect(host).toBeVisible()
    await host.scrollIntoViewIfNeeded()

    await host.locator('.kanban-child-count').click()
    await expect(page.locator('.child-panel')).toBeVisible()
    await expect(host).toHaveClass(/kanban-card--minimized/)
    await expect(host).toHaveClass(/kanban-card--panel-ancestor/)
    await expect(host.locator('.kanban-child-count use')).toHaveAttribute(
      'href',
      '#icon-collapse',
    )

    const metrics = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      await sleep(300)
      const board = document.querySelector('#kanbanapp .kanban')
      const hostCard = document.querySelector('.kanban-card[data-card-name="TASK-PARENT"]')
      if (!board || !hostCard) {
        return null
      }
      const scroller = board.classList.contains('kanban--swimlanes')
        ? board
        : (hostCard.closest('.kanban-card-list') || board)
      const scrollerRect = scroller.getBoundingClientRect()
      const hostRect = hostCard.getBoundingClientRect()
      return {
        offset: hostRect.top - scrollerRect.top,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        maxScroll: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
        hostHeight: hostRect.height,
        spacerHeight: Number.parseFloat(
          hostCard.parentElement?.querySelector('.child-panel-spacer')?.style.height || '0',
        ),
      }
    })
    expect(metrics).not.toBeNull()
    // Host pinned near the column scroller top (margin/virtual-list slack).
    expect(metrics.offset).toBeGreaterThanOrEqual(-4)
    expect(metrics.offset).toBeLessThan(120)
    expect(metrics.scrollTop).toBeGreaterThan(0)
  })

  test('dims and blocks cards outside the focused child panel', async ({ page }) => {
    const nestedParent = 'TASK-PARENT-CHILD-Open'
    await page.addInitScript(({ nestedParent: nested }) => {
      window.__childCounts = {
        'TASK-PARENT': 2,
        'TASK-OTHER': 0,
        [nested]: 2,
      }
      window.__childColumnTotals = {
        'TASK-PARENT': { Open: 1, Done: 1 },
        [nested]: { Open: 1, Done: 1 },
      }
      window.__customQuickKanbanCards = [
        {
          name: 'TASK-OTHER',
          subject: 'Other root in first column',
          status: 'Open',
          priority: 'Low',
          expected_end_date: '2026-07-11',
          project: 'SECOND-PROJECT',
          modified: '2026-07-10 10:00:00',
        },
        {
          name: 'TASK-PARENT',
          subject: 'Parent in second column',
          status: 'Done',
          priority: 'High',
          expected_end_date: '2026-07-10',
          project: 'TEST-PROJECT',
          modified: '2026-07-10 10:00:00',
        },
      ]
    }, { nestedParent })

    await page.goto('/e2e/fixture.html')
    await page.locator(
      '.kanban-card:has-text("Parent in second column") .kanban-child-count',
    ).click()
    await expect(page.getByText('Child of TASK-PARENT in Open')).toBeVisible()

    const depth0Host = page.locator('.kanban-card[data-card-name="TASK-PARENT"]')
    const otherRoot = page.locator('.kanban-card[data-card-name="TASK-OTHER"]')
    const depth0Child = page.locator('.kanban-card[data-card-name="TASK-PARENT-CHILD-Open"]')
    await expect(depth0Host).toHaveClass(/kanban-card--panel-ancestor/)
    await expect(otherRoot).toHaveClass(/kanban-card--panel-inert/)
    await expect(depth0Child).not.toHaveClass(/kanban-card--panel-inert/)
    await expect(depth0Child).not.toHaveClass(/kanban-card--panel-ancestor/)

    await page.locator(
      '.kanban-card:has-text("Child of TASK-PARENT in Open") .kanban-child-count',
    ).click()
    await expect(page.getByText(`Child of ${nestedParent} in Open`)).toBeVisible()

    const nestedHost = page.locator(`.kanban-card[data-card-name="${nestedParent}"]`)
    const depth0Sibling = page.locator('.kanban-card[data-card-name="TASK-PARENT-CHILD-Done"]')
    const deepestChild = page.locator(
      `.kanban-card[data-card-name="${nestedParent}-CHILD-Open"]`,
    )
    await expect(depth0Host).toHaveClass(/kanban-card--panel-ancestor/)
    await expect(nestedHost).toHaveClass(/kanban-card--panel-ancestor/)
    await expect(otherRoot).toHaveClass(/kanban-card--panel-inert/)
    await expect(depth0Sibling).toHaveClass(/kanban-card--panel-inert/)
    await expect(deepestChild).not.toHaveClass(/kanban-card--panel-inert/)
    await expect(deepestChild).not.toHaveClass(/kanban-card--panel-ancestor/)
  })

  test('nested child panel is board-hosted and aligns with board columns', async ({ page }) => {
    const nestedParent = 'TASK-PARENT-CHILD-Open'
    await page.addInitScript(({ nestedParent: nested }) => {
      window.__childCounts = {
        'TASK-PARENT': 2,
        'TASK-OTHER': 0,
        [nested]: 2,
      }
      window.__childColumnTotals = {
        'TASK-PARENT': { Open: 1, Done: 1 },
        [nested]: { Open: 1, Done: 1 },
      }
      window.__customQuickKanbanCards = [
        {
          name: 'TASK-OTHER',
          subject: 'Other root in first column',
          status: 'Open',
          priority: 'Low',
          expected_end_date: '2026-07-11',
          project: 'SECOND-PROJECT',
          modified: '2026-07-10 10:00:00',
        },
        {
          name: 'TASK-PARENT',
          subject: 'Parent in second column',
          status: 'Done',
          priority: 'High',
          expected_end_date: '2026-07-10',
          project: 'TEST-PROJECT',
          modified: '2026-07-10 10:00:00',
        },
      ]
    }, { nestedParent })

    await page.goto('/e2e/fixture.html')
    await expect(page.getByText('Parent in second column')).toBeVisible()

    await page.locator(
      '.kanban-card:has-text("Parent in second column") .kanban-child-count',
    ).click()
    await expect(page.getByText(`Child of TASK-PARENT in Open`)).toBeVisible()

    const nestedBadge = page.locator(
      `.kanban-card:has-text("Child of TASK-PARENT in Open") .kanban-child-count`,
    )
    await expect(nestedBadge).toBeVisible()
    await nestedBadge.click()

    const panels = page.locator('.child-panel.child-panel--teleported')
    await expect(panels).toHaveCount(2)
    await expect(page.getByText(`Child of ${nestedParent} in Open`)).toBeVisible()
    await expect(page.locator('.child-panel--viewport-fill')).toHaveCount(1)
    await expect(page.locator('.child-panel[data-child-depth="1"]')).toHaveClass(
      /child-panel--viewport-fill/,
    )
    await expect(page.locator('.child-panel[data-child-depth="0"]')).not.toHaveClass(
      /child-panel--viewport-fill/,
    )

    const layout = await page.evaluate((nested) => {
      const board = document.querySelector('#kanbanapp .kanban')
      const teleported = [...document.querySelectorAll('.child-panel.child-panel--teleported')]
      const nestedPanel = teleported.find((panel) =>
        panel.getAttribute('aria-label')?.includes(nested),
      )
      const flatColumns = board?.classList.contains('kanban--swimlanes')
        ? [...(board.querySelectorAll('.swimlane-header-row .kanban-column') || [])]
        : [...(board?.querySelectorAll(':scope > .kanban-column') || [])]
      const groups = [...(nestedPanel?.querySelectorAll('.child-panel-group') || [])]
      if (!board || !nestedPanel || groups.length < 2 || flatColumns.length < 2) {
        return null
      }
      const groupRects = groups.map((group) => group.getBoundingClientRect())
      const columnRects = flatColumns.map((column) => column.getBoundingClientRect())
      const scrollStyle = getComputedStyle(nestedPanel.querySelector('.child-panel-scroll'))
      const hostParentColumn = flatColumns.find((column) =>
        [...column.querySelectorAll('.kanban-card')].some((card) =>
          card.textContent.includes('Parent in second column'),
        ),
      )
      const nestedLeft = nestedPanel.getBoundingClientRect().left
      const hostParentColumnLeft = hostParentColumn?.getBoundingClientRect().left ?? null
      return {
        firstGroupLeft: groupRects[0].left,
        firstColumnLeft: columnRects[0].left,
        groupStep: groupRects[1].left - groupRects[0].left,
        columnStep: columnRects[1].left - columnRects[0].left,
        firstGroupWidth: groupRects[0].width,
        firstColumnWidth: columnRects[0].width,
        gutter: Number.parseFloat(scrollStyle.columnGap || scrollStyle.gap) || 0,
        nestedLeft,
        hostParentColumnLeft,
        nestedWiderThanOneColumn:
          nestedPanel.getBoundingClientRect().width > columnRects[0].width * 1.5,
      }
    }, nestedParent)

    expect(layout).not.toBeNull()
    expect(layout.gutter).toBe(8)
    expect(Math.abs(layout.firstGroupLeft - layout.firstColumnLeft)).toBeLessThan(2)
    expect(Math.abs(layout.groupStep - layout.columnStep)).toBeLessThan(2)
    expect(Math.abs(layout.firstGroupWidth - layout.firstColumnWidth)).toBeLessThan(2)
    expect(layout.nestedWiderThanOneColumn).toBe(true)
    expect(layout.hostParentColumnLeft).not.toBeNull()
    expect(layout.nestedLeft).toBeLessThan(layout.hostParentColumnLeft - 20)
  })

  test('deepest panel fills viewport and scrolls columns; outer Y scroll locked', async ({ page }) => {
    await page.addInitScript(() => {
      window.__childCounts = { 'TASK-PARENT': 12 }
      window.__childColumnTotals = {
        'TASK-PARENT': { Open: 12, Done: 0 },
      }
      window.__childColumnPages = {
        'TASK-PARENT': {
          Open: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: Array.from({ length: 12 }, (_, index) => [
              `TASK-PARENT-CHILD-${index + 1}`,
              `Tall child ${index + 1}`,
              'Open',
              'TASK-PARENT',
            ]),
            user_info: {},
          },
          Done: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [],
            user_info: {},
          },
        },
      }
      window.__customQuickKanbanCards = [
        {
          name: 'TASK-PARENT',
          subject: 'Parent in second column',
          status: 'Done',
          priority: 'High',
          expected_end_date: '2026-07-10',
          project: 'TEST-PROJECT',
          modified: '2026-07-10 10:00:00',
        },
      ]
    })
    await page.goto('/e2e/fixture.html')
    await page.locator(
      '.kanban-card:has-text("Parent in second column") .kanban-child-count',
    ).click()

    const panel = page.locator('.child-panel.child-panel--viewport-fill')
    await expect(panel).toBeVisible()
    await expect(page.getByText('Tall child 12')).toBeVisible()

    const metrics = await page.evaluate(() => {
      const board = document.querySelector('#kanbanapp .kanban')
      const panelEl = document.querySelector('.child-panel--viewport-fill')
      const list = panelEl?.querySelector('.kanban-card-list')
      const outerList = board?.querySelector(':scope > .kanban-column .kanban-card-list')
        || board?.querySelector('.kanban-card-list:not(.child-panel .kanban-card-list)')
      if (!board || !panelEl || !list) {
        return null
      }
      const listStyle = getComputedStyle(list)
      return {
        panelHeight: panelEl.getBoundingClientRect().height,
        boardClientHeight: board.clientHeight,
        listOverflowY: listStyle.overflowY,
        listScrollable: list.scrollHeight > list.clientHeight + 2,
        outerOverflowY: outerList ? getComputedStyle(outerList).overflowY : null,
        boardOverflowY: getComputedStyle(board).overflowY,
      }
    })

    expect(metrics).not.toBeNull()
    expect(metrics.panelHeight).toBeGreaterThan(metrics.boardClientHeight * 0.4)
    expect(['auto', 'scroll']).toContain(metrics.listOverflowY)
    expect(metrics.listScrollable).toBe(true)
    expect(metrics.outerOverflowY).toBe('hidden')
  })

  test('swimlane nested child panel keeps lane sticky above parent panel', async ({ page }) => {
    const nestedParent = 'TASK-PARENT-CHILD-Open'
    await page.addInitScript(({ nestedParent: nested }) => {
      window.__childCounts = {
        'TASK-PARENT': 2,
        [nested]: 2,
      }
      window.__childColumnTotals = {
        'TASK-PARENT': { Open: 1, Done: 1 },
        [nested]: { Open: 1, Done: 1 },
      }
    }, { nestedParent })

    await page.goto('/e2e/fixture.html')
    await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()

    await page.evaluate(() => {
      const store = window.__quickKanbanStore
      const filler = Array.from({ length: 8 }, (_, index) => ({
        name: `FILLER-${index + 1}`,
        subject: `Filler ${index + 1}`,
        status: 'Open',
        project: 'TEST-PROJECT',
      }))
      const openCards = [
        ...filler,
        {
          name: 'TASK-PARENT',
          subject: 'Parent in second column',
          status: 'Open',
          project: 'TEST-PROJECT',
          _child_count: 2,
        },
      ]
      store.commit('SET_KANBAN_CONFIG', {
        ...store.state.config,
        board_name: 'Swim Child Board',
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
          custom_column_width: 320,
          cards: [],
        },
        {
          name: 'done',
          column_name: 'Done',
          display_name: 'Done',
          indicator: 'green',
          custom_column_width: 320,
          cards: [],
        },
      ])
      store.commit('SET_LANES', [
        {
          key: 'test-project',
          label: 'TEST-PROJECT',
          columns: [
            {
              name: 'open',
              column_name: 'Open',
              cards: openCards,
            },
            {
              name: 'done',
              column_name: 'Done',
              cards: [],
            },
          ],
        },
      ])
      store.commit('SET_CELL_TOTALS', {
        'test-project': { Open: openCards.length, Done: 0 },
      })
      store.commit('SET_CELL_PAGINATION', {
        'test-project::Open': {
          offset: openCards.length,
          hasMore: false,
          loading: false,
        },
        'test-project::Done': { offset: 0, hasMore: false, loading: false },
      })
      store.commit('SET_EXPANDED_LANE_KEYS', ['test-project'])
      // Prevent ensureLaneHydrated from wiping seeded cards via empty fixture API.
      store.commit('SET_LANE_HYDRATION', { laneKey: 'test-project', status: 'ready' })
      store.commit('SET_LOADING', false)
      store.commit('SET_ERROR', '')
    })

    await expect(page.locator('.kanban--swimlanes')).toBeVisible()
    const parentCard = page.locator('.kanban-card:has-text("Parent in second column")')
    await parentCard.scrollIntoViewIfNeeded()
    await expect(parentCard).toBeVisible()

    await parentCard.locator('.kanban-child-count').click()
    await expect(page.getByText('Child of TASK-PARENT in Open')).toBeVisible()

    await page.locator(
      '.kanban-card:has-text("Child of TASK-PARENT in Open") .kanban-child-count',
    ).click()
    await expect(page.getByText(`Child of ${nestedParent} in Open`)).toBeVisible()
    await expect(page.locator('.child-panel.child-panel--teleported')).toHaveCount(2)
    await expect(parentCard).toBeVisible()

    const metrics = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      await sleep(300)
      const board = document.querySelector('#kanbanapp .kanban--swimlanes')
      const sticky = board?.querySelector('.swimlane-lane-sticky')
      const parentPanel = board?.querySelector('.child-panel[data-child-depth="0"]')
      const header = board?.querySelector('.swimlane-header-row')
      const depth0Host = board?.querySelector('.kanban-card[data-card-name="TASK-PARENT"]')
      if (!board || !sticky || !parentPanel || !header || !depth0Host) {
        return null
      }
      const stickyRect = sticky.getBoundingClientRect()
      const panelRect = parentPanel.getBoundingClientRect()
      const headerRect = header.getBoundingClientRect()
      const hostRect = depth0Host.getBoundingClientRect()
      const midX = stickyRect.left + Math.min(40, stickyRect.width / 2)
      const midY = stickyRect.top + stickyRect.height / 2
      const topEl = document.elementFromPoint(midX, midY)
      return {
        stickyBottom: stickyRect.bottom,
        parentPanelTop: panelRect.top,
        headerBottom: headerRect.bottom,
        stickyCoveredByPanel: Boolean(topEl?.closest?.('.child-panel')),
        stickyVisible: stickyRect.height > 0 && stickyRect.width > 0,
        depth0HostTop: hostRect.top,
        depth0HostBottom: hostRect.bottom,
        depth0HostHeight: hostRect.height,
      }
    })

    expect(metrics).not.toBeNull()
    expect(metrics.stickyVisible).toBe(true)
    expect(metrics.stickyCoveredByPanel).toBe(false)
    // Parent panel must clear column headers by lane-chrome height (not rise flush under them).
    expect(metrics.parentPanelTop).toBeGreaterThan(metrics.headerBottom + 20)
    expect(metrics.stickyBottom).toBeGreaterThan(metrics.headerBottom + 20)
    // Depth-0 host must stay visible under lane chrome (not scrolled away above sticky).
    expect(metrics.depth0HostHeight).toBeGreaterThan(0)
    expect(metrics.depth0HostBottom).toBeGreaterThan(metrics.stickyBottom - 2)
    expect(metrics.depth0HostTop).toBeGreaterThanOrEqual(metrics.stickyBottom - 4)
  })

  test('swimlane nested mid-card ChildPanel pins host in parent panel list', async ({ page }) => {
    const depth0 = 'TASK-PARENT'
    const firstChild = 'TASK-PARENT-CHILD-A'
    const nestedMid = 'TASK-PARENT-CHILD-B'
    const thirdChild = 'TASK-PARENT-CHILD-C'

    await page.addInitScript(({ depth0: root, firstChild: a, nestedMid: b, thirdChild: c }) => {
      window.__childCounts = {
        [root]: 3,
        [b]: 2,
      }
      window.__childColumnTotals = {
        [root]: { Open: 3, Done: 0 },
        [b]: { Open: 1, Done: 1 },
      }
      window.__childColumnPages = {
        [root]: {
          Open: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [
              [a, 'First sibling above nested', 'Open', root],
              [b, 'Nested mid parent', 'Open', root],
              [c, 'Third sibling below', 'Open', root],
            ],
            user_info: {},
          },
          Done: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [],
            user_info: {},
          },
        },
      }
    }, { depth0, firstChild, nestedMid, thirdChild })

    await page.goto('/e2e/fixture.html')
    await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()

    await page.evaluate(({ depth0: root }) => {
      const store = window.__quickKanbanStore
      store.commit('SET_KANBAN_CONFIG', {
        ...store.state.config,
        board_name: 'Swim Nested Mid Board',
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
          custom_column_width: 320,
          cards: [],
        },
        {
          name: 'done',
          column_name: 'Done',
          display_name: 'Done',
          indicator: 'green',
          custom_column_width: 320,
          cards: [],
        },
      ])
      const openCards = [
        {
          name: root,
          subject: 'Depth-0 parent',
          status: 'Open',
          project: 'TEST-PROJECT',
          _child_count: 3,
        },
      ]
      store.commit('SET_LANES', [
        {
          key: 'test-project',
          label: 'TEST-PROJECT',
          columns: [
            { name: 'open', column_name: 'Open', cards: openCards },
            { name: 'done', column_name: 'Done', cards: [] },
          ],
        },
      ])
      store.commit('SET_CELL_TOTALS', {
        'test-project': { Open: openCards.length, Done: 0 },
      })
      store.commit('SET_CELL_PAGINATION', {
        'test-project::Open': {
          offset: openCards.length,
          hasMore: false,
          loading: false,
        },
        'test-project::Done': { offset: 0, hasMore: false, loading: false },
      })
      store.commit('SET_EXPANDED_LANE_KEYS', ['test-project'])
      store.commit('SET_LANE_HYDRATION', { laneKey: 'test-project', status: 'ready' })
      store.commit('SET_LOADING', false)
      store.commit('SET_ERROR', '')
    }, { depth0 })

    await expect(page.locator('.kanban--swimlanes')).toBeVisible()
    const depth0Card = page.locator(`.kanban-card[data-card-name="${depth0}"]`)
    await expect(depth0Card).toBeVisible()
    await depth0Card.locator('.kanban-child-count').click()
    await expect(page.getByText('Nested mid parent')).toBeVisible()

    const nestedCard = page.locator(`.kanban-card[data-card-name="${nestedMid}"]`)
    await expect(nestedCard).toBeVisible()
    await nestedCard.locator('.kanban-child-count').click()
    await expect(page.locator('.child-panel.child-panel--teleported')).toHaveCount(2)
    await expect(page.getByText(`Child of ${nestedMid} in Open`)).toBeVisible()

    const metrics = await page.evaluate(async ({ nestedMid: host, firstChild: first, depth0: root }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      await sleep(700)
      const board = document.querySelector('#kanbanapp .kanban--swimlanes')
      const sticky = board?.querySelector('.swimlane-lane-sticky')
      const hostEl = document.querySelector(`.kanban-card[data-card-name="${host}"]`)
      const firstEl = document.querySelector(`.kanban-card[data-card-name="${first}"]`)
      const depth0El = document.querySelector(`.kanban-card[data-card-name="${root}"]`)
      const list = hostEl?.closest('.kanban-card-list')
      const spacer = document.querySelector(`.child-panel-spacer[data-panel-parent="${host}"]`)
      if (!board || !sticky || !hostEl || !list) {
        return null
      }
      const hostRect = hostEl.getBoundingClientRect()
      const listRect = list.getBoundingClientRect()
      const firstRect = firstEl?.getBoundingClientRect()
      const stickyRect = sticky.getBoundingClientRect()
      const depth0Rect = depth0El?.getBoundingClientRect()
      return {
        nestedInPanel: Boolean(hostEl.closest('.child-panel')),
        nestedDelta: hostRect.top - listRect.top,
        listScrollTop: list.scrollTop,
        listOverflowY: getComputedStyle(list).overflowY,
        nestedPinClass: list.classList.contains('kanban-card-list--nested-pin'),
        firstBottom: firstRect ? firstRect.bottom : null,
        listTop: listRect.top,
        depth0Top: depth0Rect?.top ?? null,
        stickyBottom: stickyRect.bottom,
        spacerPresent: Boolean(spacer),
        panelCount: document.querySelectorAll('.child-panel').length,
      }
    }, { nestedMid, firstChild, depth0 })

    expect(metrics).not.toBeNull()
    expect(metrics.panelCount).toBe(2)
    expect(metrics.nestedInPanel).toBe(true)
    expect(metrics.listScrollTop).toBeGreaterThan(0)
    expect(Math.abs(metrics.nestedDelta)).toBeLessThan(8)
    expect(metrics.firstBottom).not.toBeNull()
    expect(metrics.firstBottom).toBeLessThanOrEqual(metrics.listTop + 2)
    // Depth-0 stays under lane sticky (not scrolled away).
    expect(metrics.depth0Top).toBeGreaterThanOrEqual(metrics.stickyBottom - 4)
    // Parent list stays a bounded scrollport while nested panel is open.
    expect(metrics.nestedPinClass).toBe(true)
    expect(metrics.listOverflowY).toBe('auto')

    await nestedCard.locator('.kanban-child-count').click()
    await expect(page.locator('.child-panel')).toHaveCount(1)
    const closed = await page.evaluate(({ nestedMid: host }) => {
      const list = document.querySelector('.child-panel .kanban-card-list')
      return {
        spacer: Boolean(document.querySelector(`.child-panel-spacer[data-panel-parent="${host}"]`)),
        nestedPinClass: Boolean(list?.classList.contains('kanban-card-list--nested-pin')),
        inlineHeight: list?.style?.getPropertyValue('height') || '',
      }
    }, { nestedMid })
    expect(closed.spacer).toBe(false)
    expect(closed.nestedPinClass).toBe(false)
    expect(closed.inlineHeight).toBe('')
  })

  test('swimlane 3-level ChildPanel keeps ancestor hosts pinned', async ({ page }) => {
    const depth0 = 'TASK-L0'
    const firstL1 = 'TASK-L1-A'
    const midL1 = 'TASK-L1-B'
    const thirdL1 = 'TASK-L1-C'
    const firstL2 = 'TASK-L2-A'
    const midL2 = 'TASK-L2-B'

    await page.addInitScript(({ depth0: root, firstL1: a1, midL1: b1, thirdL1: c1, firstL2: a2, midL2: b2 }) => {
      window.__childCounts = {
        [root]: 3,
        [b1]: 2,
        [b2]: 1,
      }
      window.__childColumnTotals = {
        [root]: { Open: 3, Done: 0 },
        [b1]: { Open: 2, Done: 0 },
        [b2]: { Open: 1, Done: 0 },
      }
      window.__childColumnPages = {
        [root]: {
          Open: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [
              [a1, 'L1 above', 'Open', root],
              [b1, 'L1 mid host', 'Open', root],
              [c1, 'L1 below', 'Open', root],
            ],
            user_info: {},
          },
          Done: { keys: ['name', 'subject', 'status', 'parent_task'], values: [], user_info: {} },
        },
        [b1]: {
          Open: {
            keys: ['name', 'subject', 'status', 'parent_task'],
            values: [
              [a2, 'L2 above', 'Open', b1],
              [b2, 'L2 mid host', 'Open', b1],
            ],
            user_info: {},
          },
          Done: { keys: ['name', 'subject', 'status', 'parent_task'], values: [], user_info: {} },
        },
      }
    }, { depth0, firstL1, midL1, thirdL1, firstL2, midL2 })

    await page.goto('/e2e/fixture.html')
    await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()

    await page.evaluate(({ depth0: root }) => {
      const store = window.__quickKanbanStore
      store.commit('SET_KANBAN_CONFIG', {
        ...store.state.config,
        board_name: 'Swim 3-Level Pin Board',
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
          custom_column_width: 320,
          cards: [],
        },
        {
          name: 'done',
          column_name: 'Done',
          display_name: 'Done',
          indicator: 'green',
          custom_column_width: 320,
          cards: [],
        },
      ])
      const openCards = [
        {
          name: root,
          subject: 'Depth-0 parent',
          status: 'Open',
          project: 'TEST-PROJECT',
          _child_count: 3,
        },
      ]
      store.commit('SET_LANES', [
        {
          key: 'test-project',
          label: 'TEST-PROJECT',
          columns: [
            { name: 'open', column_name: 'Open', cards: openCards },
            { name: 'done', column_name: 'Done', cards: [] },
          ],
        },
      ])
      store.commit('SET_CELL_TOTALS', {
        'test-project': { Open: openCards.length, Done: 0 },
      })
      store.commit('SET_CELL_PAGINATION', {
        'test-project::Open': {
          offset: openCards.length,
          hasMore: false,
          loading: false,
        },
        'test-project::Done': { offset: 0, hasMore: false, loading: false },
      })
      store.commit('SET_EXPANDED_LANE_KEYS', ['test-project'])
      store.commit('SET_LANE_HYDRATION', { laneKey: 'test-project', status: 'ready' })
      store.commit('SET_LOADING', false)
      store.commit('SET_ERROR', '')
    }, { depth0 })

    await expect(page.locator('.kanban--swimlanes')).toBeVisible()
    await page.locator(`.kanban-card[data-card-name="${depth0}"] .kanban-child-count`).click()
    await expect(page.getByText('L1 mid host')).toBeVisible()
    await page.locator(`.kanban-card[data-card-name="${midL1}"] .kanban-child-count`).click()
    await expect(page.locator('.child-panel')).toHaveCount(2)
    await expect(page.getByText('L2 mid host')).toBeVisible()

    const afterL1 = await page.evaluate(async ({ midL1: host, depth0: root }) => {
      await new Promise((r) => setTimeout(r, 700))
      const board = document.querySelector('#kanbanapp .kanban--swimlanes')
      const sticky = board?.querySelector('.swimlane-lane-sticky')
      const mid = document.querySelector(`.kanban-card[data-card-name="${host}"]`)
      const d0 = document.querySelector(`.kanban-card[data-card-name="${root}"]`)
      const list = mid?.closest('.kanban-card-list')
      if (!mid || !list || !sticky || !d0) {
        return null
      }
      return {
        midDelta: mid.getBoundingClientRect().top - list.getBoundingClientRect().top,
        midScrollTop: list.scrollTop,
        midPin: list.classList.contains('kanban-card-list--nested-pin'),
        depth0Top: d0.getBoundingClientRect().top,
        stickyBottom: sticky.getBoundingClientRect().bottom,
      }
    }, { midL1, depth0 })
    expect(afterL1).not.toBeNull()
    expect(Math.abs(afterL1.midDelta)).toBeLessThan(8)
    expect(afterL1.midScrollTop).toBeGreaterThan(0)
    expect(afterL1.midPin).toBe(true)
    expect(afterL1.depth0Top).toBeGreaterThanOrEqual(afterL1.stickyBottom - 4)

    await page.locator(`.kanban-card[data-card-name="${midL2}"] .kanban-child-count`).click()
    await expect(page.locator('.child-panel')).toHaveCount(3)
    await expect(page.getByText(`Child of ${midL2} in Open`)).toBeVisible()

    const afterL2 = await page.evaluate(async ({ midL1: l1, midL2: l2, depth0: root }) => {
      await new Promise((r) => setTimeout(r, 900))
      const board = document.querySelector('#kanbanapp .kanban--swimlanes')
      const sticky = board?.querySelector('.swimlane-lane-sticky')
      const mid1 = document.querySelector(`.kanban-card[data-card-name="${l1}"]`)
      const mid2 = document.querySelector(`.kanban-card[data-card-name="${l2}"]`)
      const d0 = document.querySelector(`.kanban-card[data-card-name="${root}"]`)
      const list1 = mid1?.closest('.kanban-card-list')
      const list2 = mid2?.closest('.kanban-card-list')
      if (!mid1 || !mid2 || !list1 || !list2 || !sticky || !d0) {
        return null
      }
      return {
        panels: document.querySelectorAll('.child-panel').length,
        l1Delta: mid1.getBoundingClientRect().top - list1.getBoundingClientRect().top,
        l2Delta: mid2.getBoundingClientRect().top - list2.getBoundingClientRect().top,
        l1Pin: list1.classList.contains('kanban-card-list--nested-pin'),
        l2Pin: list2.classList.contains('kanban-card-list--nested-pin'),
        l1ScrollTop: list1.scrollTop,
        l2ScrollTop: list2.scrollTop,
        depth0Top: d0.getBoundingClientRect().top,
        stickyBottom: sticky.getBoundingClientRect().bottom,
        distinctLists: list1 !== list2,
      }
    }, { midL1, midL2, depth0 })

    expect(afterL2).not.toBeNull()
    expect(afterL2.panels).toBe(3)
    expect(afterL2.distinctLists).toBe(true)
    expect(Math.abs(afterL2.l2Delta)).toBeLessThan(8)
    expect(Math.abs(afterL2.l1Delta)).toBeLessThan(8)
    expect(afterL2.l1Pin).toBe(true)
    expect(afterL2.l2Pin).toBe(true)
    expect(afterL2.l1ScrollTop).toBeGreaterThan(0)
    expect(afterL2.depth0Top).toBeGreaterThanOrEqual(afterL2.stickyBottom - 4)
  })

  test('swimlane mid-column ChildPanel keeps host card mounted and visible', async ({ page }) => {
    const midHost = 'MID-HOST'
    await page.addInitScript(({ midHost: host }) => {
      window.__childCounts = {
        [host]: 2,
      }
      window.__childColumnTotals = {
        [host]: { Open: 1, Done: 1 },
      }
    }, { midHost })

    await page.goto('/e2e/fixture.html')
    await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()

    await page.evaluate(({ midHost: host }) => {
      const store = window.__quickKanbanStore
      const fillers = Array.from({ length: 10 }, (_, index) => ({
        name: `FILLER-${index + 1}`,
        subject: `Filler ${index + 1}`,
        status: 'Open',
        project: 'TEST-PROJECT',
      }))
      const openCards = [
        ...fillers.slice(0, 5),
        {
          name: host,
          subject: 'Mid column parent',
          status: 'Open',
          project: 'TEST-PROJECT',
          _child_count: 2,
        },
        ...fillers.slice(5),
      ]
      store.commit('SET_KANBAN_CONFIG', {
        ...store.state.config,
        board_name: 'Swim Mid Host Board',
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
          custom_column_width: 320,
          cards: [],
        },
        {
          name: 'done',
          column_name: 'Done',
          display_name: 'Done',
          indicator: 'green',
          custom_column_width: 320,
          cards: [],
        },
      ])
      store.commit('SET_LANES', [
        {
          key: 'test-project',
          label: 'TEST-PROJECT',
          columns: [
            { name: 'open', column_name: 'Open', cards: openCards },
            { name: 'done', column_name: 'Done', cards: [] },
          ],
        },
      ])
      store.commit('SET_CELL_TOTALS', {
        'test-project': { Open: openCards.length, Done: 0 },
      })
      store.commit('SET_CELL_PAGINATION', {
        'test-project::Open': {
          offset: openCards.length,
          hasMore: false,
          loading: false,
        },
        'test-project::Done': { offset: 0, hasMore: false, loading: false },
      })
      store.commit('SET_EXPANDED_LANE_KEYS', ['test-project'])
      store.commit('SET_LANE_HYDRATION', { laneKey: 'test-project', status: 'ready' })
      store.commit('SET_LOADING', false)
      store.commit('SET_ERROR', '')
    }, { midHost })

    await expect(page.locator('.kanban--swimlanes')).toBeVisible()
    const hostCard = page.locator(`.kanban-card[data-card-name="${midHost}"]`)
    await hostCard.scrollIntoViewIfNeeded()
    await expect(hostCard).toBeVisible()

    await hostCard.locator('.kanban-child-count').click()
    await expect(page.locator('.child-panel.child-panel--teleported')).toBeVisible()
    await expect(page.getByText(`Child of ${midHost} in Open`)).toBeVisible()

    // Host must remain in the DOM (not virtualized away) and under lane sticky.
    await expect(hostCard).toBeVisible()
    const metrics = await page.evaluate(async ({ midHost: host }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      await sleep(300)
      const board = document.querySelector('#kanbanapp .kanban--swimlanes')
      const sticky = board?.querySelector('.swimlane-lane-sticky')
      const hostEl = board?.querySelector(`.kanban-card[data-card-name="${host}"]`)
      const spacer = board?.querySelector(`.child-panel-spacer[data-panel-parent="${host}"]`)
      if (!board || !sticky || !hostEl) {
        return null
      }
      const stickyRect = sticky.getBoundingClientRect()
      const hostRect = hostEl.getBoundingClientRect()
      return {
        hostInDom: true,
        hostHeight: hostRect.height,
        hostTop: hostRect.top,
        stickyBottom: stickyRect.bottom,
        spacerPresent: Boolean(spacer),
      }
    }, { midHost })

    expect(metrics).not.toBeNull()
    expect(metrics.hostInDom).toBe(true)
    expect(metrics.hostHeight).toBeGreaterThan(0)
    expect(metrics.spacerPresent).toBe(true)
    expect(metrics.hostTop).toBeGreaterThanOrEqual(metrics.stickyBottom - 4)
    // Must pin near sticky top — not merely somewhere below sticky.
    expect(metrics.hostTop).toBeLessThan(metrics.stickyBottom + 12)
  })

  test('swimlane second-card ChildPanel pins host under sticky (short column)', async ({ page }) => {
    const secondHost = 'SECOND-HOST'
    const firstCard = 'FIRST-CARD'
    await page.addInitScript(({ secondHost: host }) => {
      window.__childCounts = { [host]: 1 }
      window.__childColumnTotals = { [host]: { Open: 1, Done: 0 } }
    }, { secondHost })

    await page.goto('/e2e/fixture.html')
    await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()

    await page.evaluate(({ secondHost: host, firstCard: first }) => {
      const store = window.__quickKanbanStore
      const openCards = [
        {
          name: first,
          subject: 'First card above host',
          status: 'Open',
          project: 'TEST-PROJECT',
        },
        {
          name: host,
          subject: 'Second card parent',
          status: 'Open',
          project: 'TEST-PROJECT',
          _child_count: 1,
        },
        {
          name: 'THIRD-CARD',
          subject: 'Third card below',
          status: 'Open',
          project: 'TEST-PROJECT',
        },
      ]
      store.commit('SET_KANBAN_CONFIG', {
        ...store.state.config,
        board_name: 'Swim Second Host Board',
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
          custom_column_width: 320,
          cards: [],
        },
        {
          name: 'done',
          column_name: 'Done',
          display_name: 'Done',
          indicator: 'green',
          custom_column_width: 320,
          cards: [],
        },
      ])
      store.commit('SET_LANES', [
        {
          key: 'test-project',
          label: 'TEST-PROJECT',
          columns: [
            { name: 'open', column_name: 'Open', cards: openCards },
            { name: 'done', column_name: 'Done', cards: [] },
          ],
        },
      ])
      store.commit('SET_CELL_TOTALS', {
        'test-project': { Open: openCards.length, Done: 0 },
      })
      store.commit('SET_CELL_PAGINATION', {
        'test-project::Open': {
          offset: openCards.length,
          hasMore: false,
          loading: false,
        },
        'test-project::Done': { offset: 0, hasMore: false, loading: false },
      })
      store.commit('SET_EXPANDED_LANE_KEYS', ['test-project'])
      store.commit('SET_LANE_HYDRATION', { laneKey: 'test-project', status: 'ready' })
      store.commit('SET_LOADING', false)
      store.commit('SET_ERROR', '')
    }, { secondHost, firstCard })

    await expect(page.locator('.kanban--swimlanes')).toBeVisible()
    const hostCard = page.locator(`.kanban-card[data-card-name="${secondHost}"]`)
    await expect(hostCard).toBeVisible()

    await hostCard.locator('.kanban-child-count').click()
    await expect(page.locator('.child-panel.child-panel--teleported')).toBeVisible()
    await expect(page.getByText(`Child of ${secondHost} in Open`)).toBeVisible()

    const metrics = await page.evaluate(async ({ secondHost: host, firstCard: first }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      // Allow spacer layout + VL remount + settle re-pin (board Y unlock/relock).
      await sleep(700)
      const board = document.querySelector('#kanbanapp .kanban--swimlanes')
      const sticky = board?.querySelector('.swimlane-lane-sticky')
      const hostEl = board?.querySelector(`.kanban-card[data-card-name="${host}"]`)
      const firstEl = board?.querySelector(`.kanban-card[data-card-name="${first}"]`)
      const spacer = board?.querySelector(`.child-panel-spacer[data-panel-parent="${host}"]`)
      if (!board || !sticky || !hostEl) {
        return null
      }
      const stickyRect = sticky.getBoundingClientRect()
      const hostRect = hostEl.getBoundingClientRect()
      const firstRect = firstEl?.getBoundingClientRect()
      return {
        hostTop: hostRect.top,
        stickyBottom: stickyRect.bottom,
        spacerHeight: spacer ? spacer.getBoundingClientRect().height : 0,
        scrollTop: board.scrollTop,
        boardOverflowY: getComputedStyle(board).overflowY,
        firstBottom: firstRect ? firstRect.bottom : null,
        firstTop: firstRect ? firstRect.top : null,
      }
    }, { secondHost, firstCard })

    expect(metrics).not.toBeNull()
    expect(metrics.spacerHeight).toBeGreaterThan(100)
    expect(metrics.scrollTop).toBeGreaterThan(0)
    expect(metrics.hostTop).toBeGreaterThanOrEqual(metrics.stickyBottom - 4)
    expect(metrics.hostTop).toBeLessThan(metrics.stickyBottom + 12)
    // User Y-lock restored after programmatic pin.
    expect(metrics.boardOverflowY).toBe('hidden')
    // Card above host must be scrolled out above sticky.
    expect(metrics.firstBottom).not.toBeNull()
    expect(metrics.firstBottom).toBeLessThanOrEqual(metrics.stickyBottom + 2)
  })

  test('swimlane bottom-column ChildPanel pins host to top and removes spacer on close', async ({ page }) => {
    const bottomHost = 'BOTTOM-HOST'
    await page.addInitScript(({ bottomHost: host }) => {
      window.__childCounts = { [host]: 2 }
      window.__childColumnTotals = { [host]: { Open: 1, Done: 1 } }
    }, { bottomHost })

    await page.goto('/e2e/fixture.html')
    await expect(page.getByRole('heading', { name: /Open/ })).toBeVisible()

    await page.evaluate(({ bottomHost: host }) => {
      const store = window.__quickKanbanStore
      const fillers = Array.from({ length: 12 }, (_, index) => ({
        name: `FILLER-${index + 1}`,
        subject: `Filler ${index + 1}`,
        status: 'Open',
        project: 'TEST-PROJECT',
      }))
      const openCards = [
        ...fillers,
        {
          name: host,
          subject: 'Bottom column parent',
          status: 'Open',
          project: 'TEST-PROJECT',
          _child_count: 2,
        },
      ]
      store.commit('SET_KANBAN_CONFIG', {
        ...store.state.config,
        board_name: 'Swim Bottom Host Board',
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
          custom_column_width: 320,
          cards: [],
        },
        {
          name: 'done',
          column_name: 'Done',
          display_name: 'Done',
          indicator: 'green',
          custom_column_width: 320,
          cards: [],
        },
      ])
      store.commit('SET_LANES', [
        {
          key: 'test-project',
          label: 'TEST-PROJECT',
          columns: [
            { name: 'open', column_name: 'Open', cards: openCards },
            { name: 'done', column_name: 'Done', cards: [] },
          ],
        },
      ])
      store.commit('SET_CELL_TOTALS', {
        'test-project': { Open: openCards.length, Done: 0 },
      })
      store.commit('SET_CELL_PAGINATION', {
        'test-project::Open': {
          offset: openCards.length,
          hasMore: false,
          loading: false,
        },
        'test-project::Done': { offset: 0, hasMore: false, loading: false },
      })
      store.commit('SET_EXPANDED_LANE_KEYS', ['test-project'])
      store.commit('SET_LANE_HYDRATION', { laneKey: 'test-project', status: 'ready' })
      store.commit('SET_LOADING', false)
      store.commit('SET_ERROR', '')
    }, { bottomHost })

    await expect(page.locator('.kanban--swimlanes')).toBeVisible()
    const hostCard = page.locator(`.kanban-card[data-card-name="${bottomHost}"]`)
    await hostCard.scrollIntoViewIfNeeded()
    await expect(hostCard).toBeVisible()

    await hostCard.locator('.kanban-child-count').click()
    await expect(page.locator('.child-panel.child-panel--teleported')).toBeVisible()
    await expect(page.getByText(`Child of ${bottomHost} in Open`)).toBeVisible()

    const openMetrics = await page.evaluate(async ({ bottomHost: host }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      await sleep(400)
      const board = document.querySelector('#kanbanapp .kanban--swimlanes')
      const sticky = board?.querySelector('.swimlane-lane-sticky')
      const hostEl = board?.querySelector(`.kanban-card[data-card-name="${host}"]`)
      const spacer = board?.querySelector(`.child-panel-spacer[data-panel-parent="${host}"]`)
      if (!board || !sticky || !hostEl) {
        return null
      }
      const stickyRect = sticky.getBoundingClientRect()
      const hostRect = hostEl.getBoundingClientRect()
      return {
        hostTop: hostRect.top,
        stickyBottom: stickyRect.bottom,
        spacerHeight: spacer ? spacer.getBoundingClientRect().height : 0,
        scrollTop: board.scrollTop,
      }
    }, { bottomHost })

    expect(openMetrics).not.toBeNull()
    expect(openMetrics.scrollTop).toBeGreaterThan(0)
    expect(openMetrics.spacerHeight).toBeGreaterThan(100)
    expect(openMetrics.hostTop).toBeGreaterThanOrEqual(openMetrics.stickyBottom - 4)
    expect(openMetrics.hostTop).toBeLessThan(openMetrics.stickyBottom + 80)

    await hostCard.locator('.kanban-child-count').click()
    await expect(page.locator('.child-panel')).toHaveCount(0)

    const closedMetrics = await page.evaluate(({ bottomHost: host }) => {
      const spacer = document.querySelector(`.child-panel-spacer[data-panel-parent="${host}"]`)
      return { spacerPresent: Boolean(spacer) }
    }, { bottomHost })
    expect(closedMetrics.spacerPresent).toBe(false)
  })
})
