<template>
  <div
    class="kanban-card-extra-info"
    @click.stop
    @dblclick.stop
    @pointerdown.stop
  >
    <button
      type="button"
      class="extra-info-action"
      :aria-label="__('Copy link', null, ctx)"
      :title="__('Copy link', null, ctx)"
      @click="onCopyLink"
    >
      <svg class="icon icon-sm" aria-hidden="true">
        <use href="#es-line-link"></use>
      </svg>
    </button>

    <button
      ref="likeButtonRef"
      type="button"
      class="extra-info-action like-action"
      :class="isLiked ? 'liked' : 'not-liked'"
      :aria-label="isLiked ? __('Unlike', null, ctx) : __('Like', null, ctx)"
      :title="isLiked ? __('Unlike', null, ctx) : __('Like', null, ctx)"
      :aria-pressed="String(isLiked)"
      :disabled="likeBusy"
      @click="onToggleLike"
    >
      <svg class="icon icon-sm" aria-hidden="true">
        <use :href="isLiked ? '#es-solid-heart' : '#es-line-heart'"></use>
      </svg>
    </button>

    <button
      v-if="!useRavenChat"
      type="button"
      class="extra-info-action extra-info-action--count"
      :aria-label="__('Comments', null, ctx)"
      :title="__('Comments', null, ctx)"
      @click="onOpenComments"
    >
      <svg class="icon icon-sm" aria-hidden="true">
        <use href="#es-line-chat-alt"></use>
      </svg>
      <span class="extra-info-count">{{ commentCountLabel }}</span>
    </button>

    <div v-else class="extra-info-files extra-info-raven">
      <button
        ref="ravenButtonRef"
        type="button"
        class="extra-info-action extra-info-raven-action"
        :aria-label="__('Chat', null, ctx)"
        :title="__('Chat', null, ctx)"
        :aria-expanded="String(ravenMenuOpen)"
        :disabled="ravenLoading"
        @click="onRavenChatClick"
      >
        <svg class="icon icon-sm" aria-hidden="true">
          <use href="#es-line-chat-alt"></use>
        </svg>
      </button>

      <Teleport to="body">
        <div
          v-if="ravenMenuOpen"
          ref="ravenMenuRef"
          class="extra-info-files-menu extra-info-raven-menu"
          role="menu"
          :aria-label="__('Chat', null, ctx)"
          :style="ravenMenuStyle"
        >
          <div v-if="ravenLoading" class="extra-info-files-empty">
            {{ __('Loading…', null, ctx) }}
          </div>
          <template v-else>
            <button
              v-for="channel in ravenChannels"
              :key="channel.name"
              type="button"
              class="dropdown-item extra-info-raven-item"
              role="menuitem"
              @click="onOpenRavenChannel(channel)"
            >
              {{ channel.channel_name || channel.name }}
            </button>
            <template v-if="!ravenChannels.length">
              <button
                type="button"
                class="dropdown-item extra-info-raven-item"
                role="menuitem"
                @click="onSendToRaven"
              >
                {{ __('Send to chat or channel', null, ravenCtx) }}
              </button>
              <button
                type="button"
                class="dropdown-item extra-info-raven-item"
                role="menuitem"
                @click="onCreateRavenChannel"
              >
                {{ __('Create channel', null, ravenCtx) }}
              </button>
            </template>
          </template>
        </div>
      </Teleport>
    </div>

    <div class="extra-info-files">
      <button
        ref="filesButtonRef"
        type="button"
        class="extra-info-action extra-info-action--count"
        :aria-label="__('Attachments', null, ctx)"
        :title="__('Attachments', null, ctx)"
        :aria-expanded="String(filesMenuOpen)"
        :disabled="filesLoading"
        @click="toggleFilesMenu"
      >
        <svg class="icon icon-sm" aria-hidden="true">
          <use href="#es-line-attachment"></use>
        </svg>
        <span class="extra-info-count">{{ attachmentCountLabel }}</span>
      </button>

      <Teleport to="body">
        <div
          v-if="filesMenuOpen"
          ref="filesMenuRef"
          class="extra-info-files-menu"
          role="menu"
          :aria-label="__('Attachments', null, ctx)"
          :style="filesMenuStyle"
        >
          <div v-if="filesLoading" class="extra-info-files-empty">
            {{ __('Loading…', null, ctx) }}
          </div>
          <template v-else>
            <div
              v-if="!attachments.length"
              class="extra-info-files-empty"
            >
              {{ __('No attachments', null, ctx) }}
            </div>
            <ul
              v-else
              class="extra-info-files-list list-unstyled"
            >
              <li
                v-for="file in attachments"
                :key="file.name"
                class="extra-info-file-row"
              >
                <button
                  type="button"
                  class="dropdown-item extra-info-file-name"
                  role="menuitem"
                  :title="file.file_name"
                  @click="onOpenFile(file)"
                >
                  {{ file.file_name || file.file_url }}
                </button>
                <button
                  v-if="canDelete"
                  type="button"
                  class="extra-info-file-delete"
                  :aria-label="__('Delete {0}', [file.file_name || file.name], ctx)"
                  :title="__('Delete', null, ctx)"
                  @click="onDeleteFile(file)"
                >
                  <svg class="icon icon-sm" aria-hidden="true">
                    <use href="#es-line-delete"></use>
                  </svg>
                </button>
              </li>
            </ul>
            <button
              v-if="canUpload"
              type="button"
              class="dropdown-item extra-info-upload"
              role="menuitem"
              @click="onUpload"
            >
              {{ __('+ Upload', null, ctx) }}
            </button>
          </template>
        </div>
      </Teleport>
    </div>

    <button
      v-if="showDeleteCard"
      type="button"
      class="extra-info-action extra-info-action--danger"
      :aria-label="__('Delete', null, ctx)"
      :title="__('Delete', null, ctx)"
      :disabled="deleteBusy"
      @click="onDeleteCard"
    >
      <svg class="icon icon-sm" aria-hidden="true">
        <use href="#es-line-delete"></use>
      </svg>
    </button>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useStore } from 'vuex'
import { useDismissibleMenu } from '../../utils/menu'
import {
  canDeleteAttachment,
  canDeleteCard,
  canUseRavenChat,
  confirmDeleteAttachment,
  confirmDeleteCard,
  copyFormLink,
  fetchDocumentChannels,
  formatActivityCount,
  getAttachmentCount,
  getCommentCount,
  getExtraInfoContext,
  getRavenContext,
  isLikedByUser,
  navigateToFormComments,
  openAttachmentPreviewOrFile,
  resolveRavenChatAction,
  toggleLikedByValue,
} from '../../utils/cardExtraInfo'

const props = defineProps({
  card: { type: Object, required: true },
  doctype: { type: String, required: true },
})
const emit = defineEmits(['files-menu-open'])

const store = useStore()
const __ = globalThis.__
const ctx = getExtraInfoContext()
const ravenCtx = getRavenContext()

const likeButtonRef = ref(null)
const likeBusy = ref(false)
const filesButtonRef = ref(null)
const filesMenuRef = ref(null)
const filesMenuOpen = ref(false)
const filesMenuStyle = ref({})
const filesLoading = ref(false)
const attachments = ref([])
const ravenButtonRef = ref(null)
const ravenMenuRef = ref(null)
const ravenMenuOpen = ref(false)
const ravenMenuStyle = ref({})
const ravenLoading = ref(false)
const ravenChannels = ref([])
const docstatus = ref(Number(props.card.docstatus) || 0)
const deleteBusy = ref(false)
const useRavenChat = computed(() => canUseRavenChat(props.doctype, props.card.name))

watch(
  () => props.card.docstatus,
  (value) => {
    if (value != null) {
      docstatus.value = Number(value) || 0
    }
  },
)

watch(filesMenuOpen, (open) => {
  emit('files-menu-open', open)
})

onBeforeUnmount(() => {
  if (filesMenuOpen.value) {
    emit('files-menu-open', false)
  }
})

const sessionUser = computed(() => globalThis.frappe?.session?.user || '')
const isLiked = computed(() => isLikedByUser(props.card._liked_by, sessionUser.value))
const commentCountLabel = computed(() => formatActivityCount(getCommentCount(props.card)))
const attachmentCountLabel = computed(() => formatActivityCount(getAttachmentCount(props.card)))

const canWrite = computed(() => Boolean(
  props.doctype && globalThis.frappe?.model?.can_write?.(props.doctype),
))
const canDeleteDoc = computed(() => Boolean(
  props.doctype && globalThis.frappe?.model?.can_delete?.(props.doctype),
))
const protectAttachedFiles = computed(() => Boolean(
  globalThis.frappe?.get_meta?.(props.doctype)?.protect_attached_files,
))
const canDelete = computed(() => canDeleteAttachment({
  canWrite: canWrite.value,
  canDelete: canDeleteDoc.value,
  protectAttachedFiles: protectAttachedFiles.value,
  docstatus: docstatus.value,
}))
const canUpload = computed(() => canWrite.value)
const showDeleteCard = computed(() => canDeleteCard({
  canDelete: canDeleteDoc.value,
  docstatus: docstatus.value,
}))

function closeFilesMenu({ restoreFocus = false } = {}) {
  filesMenuOpen.value = false
  if (restoreFocus) {
    filesButtonRef.value?.focus?.()
  }
}

function closeRavenMenu({ restoreFocus = false } = {}) {
  ravenMenuOpen.value = false
  if (restoreFocus) {
    ravenButtonRef.value?.focus?.()
  }
}

useDismissibleMenu({
  isOpen: filesMenuOpen,
  triggerRef: filesButtonRef,
  menuRef: filesMenuRef,
  close: closeFilesMenu,
})

useDismissibleMenu({
  isOpen: ravenMenuOpen,
  triggerRef: ravenButtonRef,
  menuRef: ravenMenuRef,
  close: closeRavenMenu,
})

function onCopyLink() {
  copyFormLink(props.doctype, props.card.name)
}

async function onToggleLike() {
  if (likeBusy.value || !props.doctype || !props.card.name) {
    return
  }
  likeBusy.value = true
  const add = isLiked.value ? 'No' : 'Yes'
  try {
    if (typeof frappe.ui?.toggle_like === 'function' && likeButtonRef.value && globalThis.$) {
      await new Promise((resolve, reject) => {
        try {
          frappe.ui.toggle_like($(likeButtonRef.value), props.doctype, props.card.name, resolve)
        } catch (error) {
          reject(error)
        }
      })
    } else {
      await frappe.call({
        method: 'frappe.desk.like.toggle_like',
        args: {
          doctype: props.doctype,
          name: props.card.name,
          add,
        },
      })
    }
    store.commit('UPDATE_CARD_FIELD', {
      cardName: props.card.name,
      fieldname: '_liked_by',
      value: toggleLikedByValue(props.card._liked_by, sessionUser.value, add === 'Yes'),
    })
  } catch (_error) {
    const message = __('Could not update like.')
    if (typeof globalThis.frappe?.show_alert === 'function') {
      globalThis.frappe.show_alert({ message, indicator: 'red' })
    }
  } finally {
    likeBusy.value = false
  }
}

function onOpenComments() {
  navigateToFormComments(props.doctype, props.card.name)
}

function ravenDocumentContext() {
  const titleField = store.state.config?.title_field
  return {
    doctype: props.doctype,
    docname: props.card.name,
    doc: props.card,
    meta: {
      title_field: titleField,
      ...(globalThis.frappe?.get_meta?.(props.doctype) || {}),
    },
  }
}

function onOpenRavenChannel(channel) {
  closeRavenMenu()
  globalThis.dinext_raven?.open_channel?.(channel)
}

function onSendToRaven() {
  closeRavenMenu()
  globalThis.dinext_raven?.show_send_raven_dialog?.(ravenDocumentContext())
}

function onCreateRavenChannel() {
  closeRavenMenu()
  const raven = globalThis.dinext_raven
  if (!raven?.show_create_channel_dialog) {
    return
  }
  raven.show_create_channel_dialog(ravenDocumentContext(), (channel) => {
    if (typeof raven.open_created_channel === 'function') {
      raven.open_created_channel(channel)
      return
    }
    raven.open_channel?.(channel)
  })
}

function positionRavenMenu() {
  ravenMenuStyle.value = { visibility: 'hidden' }
  nextTick(() => {
    const triggerRect = ravenButtonRef.value?.getBoundingClientRect()
    const menuRect = ravenMenuRef.value?.getBoundingClientRect()
    if (!triggerRect || !menuRect) return
    const margin = 8
    const left = Math.min(
      Math.max(margin, triggerRect.right - menuRect.width),
      window.innerWidth - menuRect.width - margin,
    )
    const preferredTop = triggerRect.bottom + 4
    const top = preferredTop + menuRect.height <= window.innerHeight - margin
      ? preferredTop
      : Math.max(margin, triggerRect.top - menuRect.height - 4)
    ravenMenuStyle.value = {
      top: `${top}px`,
      left: `${left}px`,
      visibility: 'visible',
    }
  })
}

async function onRavenChatClick() {
  if (ravenMenuOpen.value) {
    closeRavenMenu()
    return
  }
  closeFilesMenu()
  ravenLoading.value = true
  ravenChannels.value = []
  ravenMenuOpen.value = true
  positionRavenMenu()
  try {
    const channels = await fetchDocumentChannels(props.doctype, props.card.name)
    const action = resolveRavenChatAction(channels)
    if (action.type === 'open') {
      closeRavenMenu()
      onOpenRavenChannel(action.channels[0])
      return
    }
    ravenChannels.value = action.channels
    positionRavenMenu()
  } catch {
    closeRavenMenu()
    const message = __('Could not load channels.', null, ctx)
    if (typeof globalThis.frappe?.show_alert === 'function') {
      globalThis.frappe.show_alert({ message, indicator: 'red' })
    }
  } finally {
    ravenLoading.value = false
  }
}

async function loadAttachments() {
  filesLoading.value = true
  try {
    const response = await frappe.call({
      method: 'frappe.desk.form.load.get_docinfo',
      args: {
        doctype: props.doctype,
        name: props.card.name,
      },
    })
    const docinfo = response.docinfo || response.message || {}
    attachments.value = Array.isArray(docinfo.attachments) ? docinfo.attachments : []
    if (docinfo.docstatus != null) {
      docstatus.value = Number(docinfo.docstatus) || 0
    } else if (props.card.docstatus != null) {
      docstatus.value = Number(props.card.docstatus) || 0
    }
    store.commit('UPDATE_CARD_FIELD', {
      cardName: props.card.name,
      fieldname: '_attachment_count',
      value: attachments.value.length,
    })
  } catch {
    attachments.value = []
  } finally {
    filesLoading.value = false
  }
}

function positionFilesMenu() {
  filesMenuStyle.value = { visibility: 'hidden' }
  nextTick(() => {
    const triggerRect = filesButtonRef.value?.getBoundingClientRect()
    const menuRect = filesMenuRef.value?.getBoundingClientRect()
    if (!triggerRect || !menuRect) return
    const margin = 8
    const left = Math.min(
      Math.max(margin, triggerRect.right - menuRect.width),
      window.innerWidth - menuRect.width - margin,
    )
    const preferredTop = triggerRect.bottom + 4
    const top = preferredTop + menuRect.height <= window.innerHeight - margin
      ? preferredTop
      : Math.max(margin, triggerRect.top - menuRect.height - 4)
    filesMenuStyle.value = {
      top: `${top}px`,
      left: `${left}px`,
      visibility: 'visible',
    }
  })
}

async function toggleFilesMenu() {
  if (filesMenuOpen.value) {
    closeFilesMenu()
    return
  }
  closeRavenMenu()
  filesMenuOpen.value = true
  positionFilesMenu()
  await loadAttachments()
  positionFilesMenu()
}

function onOpenFile(file) {
  openAttachmentPreviewOrFile(file)
}

async function onDeleteFile(file) {
  if (!canDelete.value || !file?.name) {
    return
  }
  const confirmed = await confirmDeleteAttachment()
  if (!confirmed) {
    return
  }
  try {
    await frappe.call({
      method: 'frappe.desk.form.utils.remove_attach',
      type: 'DELETE',
      args: {
        fid: file.name,
        dt: props.doctype,
        dn: props.card.name,
      },
    })
    attachments.value = attachments.value.filter((entry) => entry.name !== file.name)
    store.commit('UPDATE_CARD_FIELD', {
      cardName: props.card.name,
      fieldname: '_attachment_count',
      value: attachments.value.length,
    })
  } catch {
    // Desk shows server messages; keep menu open.
  }
}

function onUpload() {
  if (!canUpload.value || typeof frappe.ui?.FileUploader !== 'function') {
    return
  }
  new frappe.ui.FileUploader({
    doctype: props.doctype,
    docname: props.card.name,
    folder: 'Home/Attachments',
    on_success: async () => {
      await loadAttachments()
      positionFilesMenu()
    },
  })
}

async function onDeleteCard() {
  if (!showDeleteCard.value || deleteBusy.value || !props.card.name) {
    return
  }
  const titleField = store.state.config?.title_field
  const label = (titleField && props.card[titleField]) || props.card.name
  const confirmed = await confirmDeleteCard(label)
  if (!confirmed) {
    return
  }
  deleteBusy.value = true
  try {
    await store.dispatch('deleteCard', { cardName: props.card.name })
  } finally {
    deleteBusy.value = false
  }
}
</script>
