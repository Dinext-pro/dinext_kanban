const DEFAULT_DURATION_MS = 280

export function prefersReducedMotion() {
  return Boolean(
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
  )
}

export function findCardElement(cardName, root = globalThis.document) {
  if (!cardName || !root) {
    return null
  }
  const keyed = root.querySelector(`[data-key="${cardName}"]`)
  if (keyed) {
    if (keyed.classList?.contains('kanban-card')) {
      return keyed
    }
    const nested = keyed.querySelector('.kanban-card')
    if (nested) {
      return nested
    }
    return keyed.closest('.kanban-card') || keyed
  }
  return root.querySelector(`article.kanban-card[data-card-name="${cardName}"]`)
}

export function captureCardRect(cardName, root = globalThis.document) {
  const element = findCardElement(cardName, root)
  return element ? element.getBoundingClientRect() : null
}

export function animateCardRollback(
  cardName,
  destinationRect,
  { duration = DEFAULT_DURATION_MS, root = globalThis.document } = {},
) {
  if (!destinationRect || prefersReducedMotion()) {
    return Promise.resolve(false)
  }

  const cardEl = findCardElement(cardName, root)
  if (!cardEl) {
    return Promise.resolve(false)
  }

  const sourceRect = cardEl.getBoundingClientRect()
  const dx = destinationRect.left - sourceRect.left
  const dy = destinationRect.top - sourceRect.top
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
    return Promise.resolve(false)
  }

  cardEl.classList.add('kanban-card-rollback-animating')
  cardEl.style.transform = `translate(${dx}px, ${dy}px)`
  cardEl.style.transition = 'none'

  return new Promise((resolve) => {
    let finished = false
    const finish = () => {
      if (finished) {
        return
      }
      finished = true
      cardEl.classList.remove('kanban-card-rollback-animating')
      cardEl.style.transition = ''
      cardEl.style.transform = ''
      resolve(true)
    }

    requestAnimationFrame(() => {
      cardEl.style.transition = `transform ${duration}ms ease-out`
      cardEl.style.transform = ''
    })

    cardEl.addEventListener('transitionend', finish, { once: true })
    globalThis.setTimeout(finish, duration + 60)
  })
}
