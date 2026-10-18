import { useNavigate } from "@solidjs/router"
import type { JSX } from "solid-js"
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
  const id = deletingChatId
  // A plain string, not a component in a prop getter: the dialog reads `description` twice, and a
  // second `Show` instance created there throws a stale-accessor error inside a store update, which
  // aborts the batch that was painting the chat list.
  const description = () => {
    const row = id() === null ? undefined : useApp.chatById(id()!)
    return row
      ? `“${row.name}” and its messages are removed from this device and the server. This cannot be undone.`
      : "Its messages are removed from this device and the server. This cannot be undone."
  }
  const confirm = () => {
    const target = id()
    cancelDeleteChat()
    if (target) deleteChat(target, useApp.activeThreadId(), (to) => navigate(to))
  }
  return (
    <Dialog
      open={id() !== null}
      onClose={cancelDeleteChat}
      title="Delete this chat?"
      description={description()}
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
