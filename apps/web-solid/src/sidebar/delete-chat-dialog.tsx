import type { JSX } from "solid-js"
import { Button } from "../settings/kit"
import { useApp } from "../lib/store"
import { Dialog } from "../lib/dialog"
import { cancelDeleteChat, deleteChat, deletingChatId } from "./actions"

export default function DeleteChatDialog(): JSX.Element {
  const id = deletingChatId
  const description = () => {
    const row = id() === null ? undefined : useApp.chatById(id()!)
    return row
      ? `“${row.name}” and its messages are removed from this device and the server. This cannot be undone.`
      : "Its messages are removed from this device and the server. This cannot be undone."
  }
  const confirm = () => {
    const target = id()
    cancelDeleteChat()
    if (target) deleteChat(target, useApp.activeThreadId())
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
