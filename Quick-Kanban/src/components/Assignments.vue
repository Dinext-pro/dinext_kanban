<template>
  <div
    class="assignments-block"
    role="group"
    tabindex="0"
    :aria-label="ariaLabel"
  >
    <span ref="mountRef" class="assignments-mount" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  assignments: {
    type: Object,
    default: () => ({}),
  },
})

const emit = defineEmits(['assign-edit', 'assign-add'])

const mountRef = ref(null)
let groupClickHandler = null

const users = computed(() => Object.keys(props.assignments))

const ariaLabel = computed(() => {
  const names = users.value.map(
    (user) => props.assignments[user] || frappe.user_info(user)?.fullname || user,
  )
  if (!names.length) return __('Assign')
  return __('Assignments: {0}', [names.join(', ')])
})

function getAvatarGroupNode($group) {
  return $group?.[0] ?? $group?.get?.(0) ?? null
}

function handleGroupClick(event) {
  if (event.target.closest('.avatar-action')) return
  if (!users.value.length) return

  const avatar = event.target.closest('.avatar')
  if (!avatar) return

  event.preventDefault()
  event.stopPropagation()
  emit('assign-edit')
}

function handleAddClick(event) {
  event.preventDefault()
  event.stopPropagation()
  emit('assign-add')
}

function clearGroupListener() {
  const mount = mountRef.value
  const groupNode = mount?.firstElementChild
  if (groupNode && groupClickHandler) {
    groupNode.removeEventListener('click', groupClickHandler)
    groupClickHandler = null
  }
}

function renderAssignments() {
  const mount = mountRef.value
  if (!mount) return

  clearGroupListener()
  mount.replaceChildren()

  const $group = frappe.avatar_group(users.value, 2, {
    css_class: 'avatar avatar-small',
    action_icon: 'add',
    action: handleAddClick,
  })
  const groupNode = getAvatarGroupNode($group)
  if (!groupNode) return

  groupClickHandler = handleGroupClick
  groupNode.addEventListener('click', groupClickHandler)
  mount.appendChild(groupNode)
}

watch(users, () => nextTick(renderAssignments), { deep: true })
onMounted(() => nextTick(renderAssignments))
onBeforeUnmount(() => {
  clearGroupListener()
  mountRef.value?.replaceChildren()
})
</script>
