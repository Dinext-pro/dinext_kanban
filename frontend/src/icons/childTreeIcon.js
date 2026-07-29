/** Hierarchy glyph for child-count badge / show-child-tasks control. */
export const CHILD_TREE_ICON_NAME = 'child-tree'
export const CHILD_TREE_ICON_VIEWBOX = '0 0 16 16'

/**
 * Stem + two child nodes (rounded rects). Stroke uses var(--icon-stroke)
 * so Desk light/dark themes apply via existing CSS on the host.
 */
export const CHILD_TREE_ICON_MARKUP = [
  `<path stroke="var(--icon-stroke)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M3.25 2.5h4M5.25 2.5v9.75c0 .69.56 1.25 1.25 1.25H8.5"/>`,
  `<path stroke="var(--icon-stroke)" stroke-width="1.5" stroke-linecap="round" d="M5.25 6.5H8.5"/>`,
  `<rect x="8.5" y="4.5" width="5" height="4" rx="1" stroke="var(--icon-stroke)" stroke-width="1.5"/>`,
  `<rect x="8.5" y="11" width="5" height="4" rx="1" stroke="var(--icon-stroke)" stroke-width="1.5"/>`,
].join('')

/**
 * Full SVG string for Desk scripts (kanban_view.bundle.js).
 * Keep markup in sync with KanbanCard.vue usage of CHILD_TREE_ICON_MARKUP.
 */
export function getChildTreeIconSvg(className = 'icon icon-sm') {
  return [
    `<svg class="${className}" viewBox="${CHILD_TREE_ICON_VIEWBOX}" fill="none"`,
    ` data-icon="${CHILD_TREE_ICON_NAME}" aria-hidden="true">`,
    CHILD_TREE_ICON_MARKUP,
    `</svg>`,
  ].join('')
}
