import { useNavigate } from "@solidjs/router"
import { Show, type JSX } from "solid-js"
import { Button } from "../settings/kit"
import { useApp } from "../lib/store"
import { Dialog } from "../lib/dialog"
import { cancelDeleteChat, deleteChat, deletingChatId } from "./actions"

/**
 * The one place a chat is deleted without a menu. The palette can run a destructive command on a
 * single Enter, so it asks here instead of trusting the row menu's two-step to be the only door.
 */
export function DeleteChatDialog(): JSX.Element {
  const navigate = useNavigate()
  const chat = () => {
    const id = deletingChatId()
    return id === null ? undefined : useApp.chatById(id)
  }
  const confirm = () => {
    const id = deletingChatId()
    cancelDeleteChat()
    if (id) deleteChat(id, useApp.activeThreadId(), (to) => navigate(to))
  }
  return (
    <Dialog
      open={deletingChatId() !== null}
      onClose={cancelDeleteChat}
      title="Delete this chat?"
      description={
        <Show when={chat()} fallback="Its messages are removed from this device and the server.">
          {(row) => <>“{row().name}” and its messages are removed from this device and the server. This cannot be undone.</>}
        </Show>
      }
      data-component="delete-chat-dialog"
      footer={
        <>
          <Button variant="ghost" data-action="cancel-delete" onClick={cancelDeleteChat}>
            Cancel
          </Button>
          <Button variant="danger" data-action="confirm-delete" onClick={confirm}>
            Delete
          </Button>
        </>
      }
    />
  )
}
