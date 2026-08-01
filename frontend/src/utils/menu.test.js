import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useDismissibleMenu } from './menu'

function mountMenu() {
  const closeCalls = []
  const component = defineComponent({
    setup() {
      const isOpen = ref(false)
      const triggerRef = ref(null)
      const menuRef = ref(null)
      const close = (options = {}) => {
        closeCalls.push(options)
        isOpen.value = false
      }

      useDismissibleMenu({
        isOpen,
        triggerRef,
        menuRef,
        close,
      })

      return {
        isOpen,
        menuRef,
        triggerRef,
        close,
      }
    },
    template: `
      <div>
        <button ref="triggerRef" data-test="trigger" @click="isOpen = true">Open</button>
        <div v-if="isOpen" ref="menuRef" data-test="menu">
          <button data-test="action" @click="close({ restoreFocus: true })">Choose</button>
        </div>
        <button data-test="outside">Outside</button>
      </div>
    `,
  })

  return {
    closeCalls,
    wrapper: mount(component, { attachTo: document.body }),
  }
}

async function openMenu(wrapper) {
  await wrapper.get('[data-test="trigger"]').trigger('click')
  await nextTick()
}

test('closes on an outside pointerdown but not an inside pointerdown', async () => {
  const { closeCalls, wrapper } = mountMenu()
  await openMenu(wrapper)

  await wrapper.get('[data-test="menu"]').trigger('pointerdown')
  expect(wrapper.find('[data-test="menu"]').exists()).toBe(true)

  await wrapper.get('[data-test="outside"]').trigger('pointerdown')
  expect(closeCalls).toEqual([{ restoreFocus: false }])
  expect(wrapper.find('[data-test="menu"]').exists()).toBe(false)
  wrapper.unmount()
})

test.each([
  ['scroll', window],
  ['resize', window],
  ['blur', window],
])('closes on %s without restoring focus', async (eventName, target) => {
  const { closeCalls, wrapper } = mountMenu()
  await openMenu(wrapper)

  target.dispatchEvent(new Event(eventName))
  await nextTick()

  expect(closeCalls).toEqual([{ restoreFocus: false }])
  wrapper.unmount()
})

test('closes when the document becomes hidden', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  const { closeCalls, wrapper } = mountMenu()
  await openMenu(wrapper)

  document.dispatchEvent(new Event('visibilitychange'))
  await nextTick()

  expect(closeCalls).toEqual([{ restoreFocus: false }])
  hidden.mockRestore()
  wrapper.unmount()
})

test('keeps arrow keys open and closes on other keys', async () => {
  const { closeCalls, wrapper } = mountMenu()
  await openMenu(wrapper)

  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }
  await nextTick()
  expect(closeCalls).toEqual([])
  expect(wrapper.find('[data-test="menu"]').exists()).toBe(true)

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
  await nextTick()
  expect(closeCalls).toEqual([{ restoreFocus: false }])
  wrapper.unmount()
})

test('requests focus restoration only for Escape', async () => {
  const { closeCalls, wrapper } = mountMenu()
  await openMenu(wrapper)

  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(event)
  await nextTick()

  expect(event.defaultPrevented).toBe(true)
  expect(closeCalls).toEqual([{ restoreFocus: true }])
  wrapper.unmount()
})

test.each(['Enter', ' '])('lets %s activate an action before closing', async (key) => {
  const { closeCalls, wrapper } = mountMenu()
  await openMenu(wrapper)
  const action = wrapper.get('[data-test="action"]')

  await action.trigger('keydown', { key })
  expect(closeCalls).toEqual([])

  await action.trigger('click')
  expect(closeCalls).toEqual([{ restoreFocus: true }])
  wrapper.unmount()
})

test('stops listening immediately after the first dismissal', async () => {
  const { closeCalls, wrapper } = mountMenu()
  await openMenu(wrapper)

  window.dispatchEvent(new Event('resize'))
  window.dispatchEvent(new Event('blur'))

  expect(closeCalls).toEqual([{ restoreFocus: false }])
  wrapper.unmount()
})

test('registers global listeners only for the open menu', async () => {
  const documentListeners = vi.spyOn(document, 'addEventListener')
  const windowListeners = vi.spyOn(window, 'addEventListener')
  const menus = Array.from({ length: 5 }, () => mountMenu())
  const dismissalDocumentEvents = ['pointerdown', 'keydown', 'visibilitychange']
  const dismissalWindowEvents = ['scroll', 'resize', 'blur']

  expect(documentListeners.mock.calls.filter(
    ([eventName]) => dismissalDocumentEvents.includes(eventName),
  )).toHaveLength(0)
  expect(windowListeners.mock.calls.filter(
    ([eventName]) => dismissalWindowEvents.includes(eventName),
  )).toHaveLength(0)

  await openMenu(menus[0].wrapper)

  for (const eventName of dismissalDocumentEvents) {
    expect(documentListeners.mock.calls.filter(
      ([registeredEvent]) => registeredEvent === eventName,
    )).toHaveLength(1)
  }
  for (const eventName of dismissalWindowEvents) {
    expect(windowListeners.mock.calls.filter(
      ([registeredEvent]) => registeredEvent === eventName,
    )).toHaveLength(1)
  }

  menus.forEach(({ wrapper }) => wrapper.unmount())
})

test('removes global listeners when unmounted', async () => {
  const { closeCalls, wrapper } = mountMenu()
  await openMenu(wrapper)
  wrapper.unmount()

  window.dispatchEvent(new Event('resize'))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
  await nextTick()

  expect(closeCalls).toEqual([])
})
