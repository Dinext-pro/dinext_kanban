const INDICATOR_DEFINITIONS = [
  { value: 'Blue', class: 'blue' },
  { value: 'Cyan', class: 'cyan' },
  { value: 'Gray', class: 'gray' },
  { value: 'Green', class: 'green' },
  { value: 'Light Blue', class: 'light-blue' },
  { value: 'Orange', class: 'orange' },
  { value: 'Pink', class: 'pink' },
  { value: 'Purple', class: 'purple' },
  { value: 'Red', class: 'red' },
  { value: 'Yellow', class: 'yellow' },
]

export function getIndicators() {
  const translate = globalThis.__ || ((message) => message)

  return INDICATOR_DEFINITIONS.map(({ value, class: cssClass }) => ({
    name: translate(value),
    value,
    class: cssClass,
  }))
}

export function getIndicatorDefinition(value) {
  return INDICATOR_DEFINITIONS.find((indicator) =>
    indicator.value === value || indicator.class === value,
  )
}
