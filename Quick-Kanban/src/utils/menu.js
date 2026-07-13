import { onBeforeUnmount, watch } from 'vue'

const ARROW_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])
const ACTION_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="menuitem"]',
].join(',')

export function useDismissibleMenu({
  isOpen,
  triggerRef,
  menuRef,
  close,
}) {
  let listening = false

  function containsTarget(target) {
    return target instanceof Node && (
      triggerRef.value?.contains(target)
      || menuRef.value?.contains(target)
    )
  }

  function dismiss() {
    stopListening()
    close({ restoreFocus: false })
  }

  function onPointerDown(event) {
    if (!containsTarget(event.target)) dismiss()
  }

  function onKeyDown(event) {
    if (ARROW_KEYS.has(event.key)) return

    const isActivationKey = event.key === 'Enter' || event.key === ' '
    const action = event.target instanceof Element
      ? event.target.closest(ACTION_SELECTOR)
      : null
    if (isActivationKey && action && containsTarget(action)) return

    if (event.key === 'Escape') {
      event.preventDefault()
      stopListening()
      close({ restoreFocus: true })
      return
    }

    dismiss()
  }

  function onVisibilityChange() {
    if (document.hidden) dismiss()
  }

  function startListening() {
    if (listening) return
    listening = true
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
  }

  function stopListening() {
    if (!listening) return
    listening = false
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('scroll', dismiss, true)
    window.removeEventListener('resize', dismiss)
    window.removeEventListener('blur', dismiss)
  }

  watch(isOpen, (open) => {
    if (open) {
      startListening()
    } else {
      stopListening()
    }
  }, { flush: 'post' })

  onBeforeUnmount(stopListening)
}
