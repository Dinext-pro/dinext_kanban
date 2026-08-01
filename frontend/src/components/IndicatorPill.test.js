import { expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import IndicatorPill from './IndicatorPill.vue'

test('renders an isolated color swatch without Frappe indicator pseudo-elements', () => {
  const wrapper = mount(IndicatorPill, {
    props: { indicator: 'blue' },
  })

  expect(wrapper.classes()).toContain('dinext-kanban-indicator-swatch')
  expect(wrapper.classes()).toContain('blue')
  expect(wrapper.classes()).not.toContain('indicator-pill')
})
