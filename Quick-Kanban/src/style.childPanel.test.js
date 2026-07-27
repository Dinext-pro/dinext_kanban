import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const stylePath = join(dirname(fileURLToPath(import.meta.url)), 'style.css')
const styleCss = readFileSync(stylePath, 'utf8')

describe('child panel geometry CSS', () => {
  test('portal sits above flat columns without zero-size box', () => {
    expect(styleCss).toMatch(/\.child-panel-portal\s*\{[^}]*z-index:\s*50/s)
    expect(styleCss).not.toMatch(/\.child-panel-portal\s*\{[^}]*width:\s*0/s)
    expect(styleCss).toMatch(
      /\.kanban:not\(\.kanban--swimlanes\)\s*>\s*\.kanban-column\s*\{[^}]*z-index:\s*1/s,
    )
    expect(styleCss).toMatch(/\.kanban\s*\{[^}]*isolation:\s*isolate/s)
  })

  test('teleported child panel does not min-stretch to portal width', () => {
    expect(styleCss).toMatch(
      /\.child-panel--teleported\s*\{[^}]*min-width:\s*0/s,
    )
    expect(styleCss).toMatch(/\.child-panel\s*\{[^}]*min-width:\s*100%/s)
  })

  test('child panel scroll grid stretches tracks; deepest panel fills viewport', () => {
    expect(styleCss).toMatch(/\.child-panel-scroll\s*\{[^}]*align-items:\s*stretch/s)
    expect(styleCss).toMatch(/\.child-panel--viewport-fill\s+\.child-panel-scroll\s*\{[^}]*height:\s*100%/s)
    expect(styleCss).toMatch(
      /\.child-panel--viewport-fill\s+\.kanban-card-list[^{]*\{[^}]*overflow-y:\s*auto\s*!important/s,
    )
    expect(styleCss).toMatch(
      /\.kanban--child-panel-open\s+\.kanban-card-list\s*\{[^}]*overflow-y:\s*hidden\s*!important/s,
    )
    expect(styleCss).toMatch(
      /\.kanban--swimlanes\.kanban--child-panel-open\s*\{[^}]*overflow-y:\s*hidden/s,
    )
  })

  test('child panel columns stretch with board gutters and zero padding', () => {
    expect(styleCss).toMatch(/\.child-panel-scroll\s*\{[^}]*align-items:\s*stretch/s)
    expect(styleCss).toMatch(
      /\.child-panel-scroll\s*\{[^}]*gap:\s*var\(--kanban-column-gutter,\s*8px\)/s,
    )
    expect(styleCss).not.toMatch(/\.child-panel-scroll\s*\{[^}]*gap:\s*0/s)
    expect(styleCss).toMatch(/\.child-panel\s*\{[^}]*padding:\s*0/s)
    expect(styleCss).toMatch(/\.child-panel\s*\{[^}]*border:\s*0/s)
    expect(styleCss).toMatch(
      /\.child-panel\s*\{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+1px/s,
    )
    expect(styleCss).not.toMatch(/\.child-panel\s*\{[^}]*padding:\s*8px/s)
  })

  test('child panel top inset sits on column track, not scrolling card list', () => {
    expect(styleCss).toMatch(
      /\.child-panel-group,\s*\n?#kanbanapp \.child-panel-cell-spacer\s*\{[^}]*padding-top:\s*8px/s,
    )
    expect(styleCss).toMatch(
      /\.child-panel\s+\.kanban-card-list[^{]*\{[^}]*padding-top:\s*0/s,
    )
    expect(styleCss).not.toMatch(
      /\.child-panel\s+\.kanban-card-list[^{]*\{[^}]*padding-top:\s*8px/s,
    )
    expect(styleCss).not.toMatch(/\.child-panel-scroll\s*\{[^}]*padding(?:-top)?:\s*8px/s)
  })

  test('inert cards are dimmed; ancestor cards are compact and accept body click', () => {
    expect(styleCss).toMatch(
      /\.kanban-card--panel-inert\s*\{[^}]*opacity:\s*0\.45/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-inert\s*\{[^}]*pointer-events:\s*auto/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-inert\s+\*\s*\{[^}]*pointer-events:\s*none/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s*\{[^}]*pointer-events:\s*auto/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s*\{[^}]*border-radius:\s*8px\s+8px\s+0\s+0\s*!important/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s*\{[^}]*border-bottom:\s*0/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s*\{[^}]*box-shadow:\s*none/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s*\{[^}]*margin-bottom:\s*0/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s*\{[^}]*linear-gradient\(\s*to bottom/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s*\{[^}]*var\(--card-bg\)\s+90%/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s*\{[^}]*--kanban-host-panel-border:/s,
    )
    expect(styleCss).toMatch(
      /--kanban-host-panel-border:\s*color-mix\([\s\S]*?28%/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\.kanban-card--panel-host-nested\s*\{[\s\S]*?40%/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\.kanban-card--has-color\s*\{[^}]*linear-gradient\(\s*to bottom/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s+\*\s*\{[^}]*pointer-events:\s*none/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s+\.kanban-child-count\s*\{[^}]*pointer-events:\s*auto/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s+\.kanban-card-meta\s*\{[^}]*max-height:\s*0/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s+\.kanban-card-meta\s*\{[^}]*opacity:\s*0/s,
    )
  })

  test('collapsed flat child-panel host keeps card-list in flow', () => {
    expect(styleCss).toMatch(
      /\.kanban-column--collapsed\.kanban-column--child-panel-host\s+\.kanban-card-list\s*\{[^}]*position:\s*relative/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-column--collapsed\.kanban-column--child-panel-host\s+\.kanban-card-list\s*\{[^}]*inset:\s*auto/s,
    )
  })

  test('column collapse width transition matches track tween tokens', () => {
    expect(styleCss).toMatch(/--kanban-column-collapse-ms:\s*220ms/)
    expect(styleCss).toMatch(
      /--kanban-column-collapse-ease:\s*cubic-bezier\(0\.215,\s*0\.61,\s*0\.355,\s*1\)/,
    )
    expect(styleCss).toMatch(
      /\.kanban-column\s*\{[^}]*width\s+var\(--kanban-column-collapse-ms/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-column\s*\{[^}]*flex-basis\s+var\(--kanban-column-collapse-ms/s,
    )
    expect(styleCss).not.toMatch(
      /\.kanban-column\s*\{[^}]*width\s+220ms\s+ease[,\s]/s,
    )
  })

  test('child panel open/close uses animation tokens and transitions', () => {
    expect(styleCss).toMatch(/--kanban-child-panel-anim-ms:\s*200ms/)
    expect(styleCss).toMatch(/--kanban-child-panel-pin-ms:\s*300ms/)
    expect(styleCss).toMatch(
      /\.child-panel-spacer--animate\s*\{[^}]*transition:\s*height\s+var\(--kanban-child-panel-anim-ms/s,
    )
    expect(styleCss).not.toMatch(
      /\.child-panel-spacer\s*\{[^}]*transition:\s*height/s,
    )
    expect(styleCss).toMatch(/\.child-panel-enter-active/)
    expect(styleCss).toMatch(/\.child-panel-leave-active/)
    expect(styleCss).toMatch(/\.child-panel-enter-from/)
    expect(styleCss).toMatch(/\.child-panel-leave-to/)
    expect(styleCss).toMatch(
      /\.child-panel-move\s*\{[^}]*transition:\s*none/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-card--panel-ancestor\s*\{[^}]*transition:/s,
    )
  })
  test('child panel has full inset outline including top', () => {
    expect(styleCss).toMatch(
      /\.child-panel\s*\{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+1px\s+var\(--child-panel-border\)/s,
    )
    expect(styleCss).toMatch(
      /\.child-panel--nested\s*\{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+1\.5px\s+var\(--child-panel-border-nested\)/s,
    )
  })

  test('child panel column tracks use inset tint wash like swimlane', () => {
    expect(styleCss).toMatch(
      /box-shadow:\s*inset\s+0\s+0\s+0\s+100vmax\s+var\(--child-panel-column-tint/s,
    )
    expect(styleCss).toMatch(/\.child-panel-group/s)
    expect(styleCss).toMatch(/\.child-panel-cell-spacer/s)
  })

  test('nested collapsed spacer fills group without duplicate wash', () => {
    expect(styleCss).toMatch(
      /\.child-panel-group\s*>\s*\.child-panel-cell-spacer\s*\{[^}]*flex:\s*1\s+1\s+auto/s,
    )
    expect(styleCss).toMatch(
      /\.child-panel-group\s*>\s*\.child-panel-cell-spacer\s*\{[^}]*padding-top:\s*0/s,
    )
    expect(styleCss).toMatch(
      /\.child-panel-group\s*>\s*\.child-panel-cell-spacer\s*\{[^}]*box-shadow:\s*none/s,
    )
  })

  test('collapsed floating chrome sits above panel without strip background', () => {
    expect(styleCss).toMatch(
      /\.kanban-collapsed-chrome--floating\s*\{[^}]*z-index:\s*5/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-collapsed-chrome--floating\s*\{[^}]*background:\s*transparent\s*!important/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-collapsed-chrome--floating\s*\{[^}]*box-shadow:\s*none\s*!important/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-collapsed-chrome--floating\s+\.header-item\s*\{[^}]*border:\s*0\s*!important/s,
    )
    expect(styleCss).toMatch(
      /\.kanban-collapsed-chrome--floating\.column-title--draggable\s*\{[^}]*cursor:\s*grab/s,
    )
    expect(styleCss).toMatch(
      /html\.kanban-column-sortable-dragging\s+\.kanban-collapsed-chrome--floating\s*\{[^}]*visibility:\s*hidden\s*!important/s,
    )
    expect(styleCss).toMatch(
      /html\.kanban-column-sortable-dragging\s+\.child-panel[,\s{][\s\S]*?pointer-events:\s*none\s*!important/s,
    )
    expect(styleCss).toMatch(
      /html\.kanban-column-sortable-dragging\s+\.kanban-column--collapsed\s+\.kanban-card-list[,\s{][\s\S]*?pointer-events:\s*none\s*!important/s,
    )
    // Stacking: portal above columns (inside .kanban isolate); float z=5 on body
    // above the board SC and below Desk .page-head (z=6).
    expect(styleCss).toMatch(/\.child-panel-portal\s*\{[^}]*z-index:\s*50/s)
    expect(styleCss).toMatch(
      /\.kanban:not\(\.kanban--swimlanes\)\s*>\s*\.kanban-column\s*\{[^}]*z-index:\s*1/s,
    )
  })

  test('header-only width 100% is scoped to swimlane header row only', () => {
    expect(styleCss).toMatch(
      /\.swimlane-header-row\s+\.kanban-column--header-only\s*\{[^}]*width:\s*100%\s*!important/s,
    )
    expect(styleCss).not.toMatch(
      /#kanbanapp\s+\.kanban-column--header-only\s*\{[^}]*width:\s*100%\s*!important/s,
    )
    expect(styleCss).not.toMatch(
      /#kanbanapp\s+\.swimlane-column--header\.kanban-column\s*,\s*\n?#kanbanapp\s+\.kanban-column--header-only\s*\{/s,
    )
  })
})
