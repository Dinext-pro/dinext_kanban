import { describe, expect, test } from 'vitest'
import {
  CHILD_TREE_ICON_NAME,
  getChildTreeIconSvg,
} from './childTreeIcon'

describe('childTreeIcon', () => {
  test('emits theme-aware SVG with child-tree marker', () => {
    const html = getChildTreeIconSvg()
    expect(html).toContain(`data-icon="${CHILD_TREE_ICON_NAME}"`)
    expect(html).toContain('var(--icon-stroke)')
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(html).toContain('viewBox="0 0 16 16"')
  })
})
