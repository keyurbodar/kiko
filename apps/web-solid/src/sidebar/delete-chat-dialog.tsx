import type { JSX } from "solid-js"
import { Button } from "../settings/kit"
import { room } from "../state/room"
import { Dialog } from "../lib/dialog"
import { cancelDeleteChat, deleteChat, deletingChatId } from "./actions"

export default function DeleteChatDialog(): JSX.Element {
  const id = deletingChatId
  const description = () => {
    const row = id() === null ? undefined : room.chatById(id()!)
    return row
      ? `“${row.name}” and its messages will be removed from this device and the server. You can undo it for a few seconds.`
      : "Its messages will be removed from this device and the server. You can undo it for a few seconds."
  }
  const confirm = () => {
    const target = id()
    cancelDeleteChat()
    if (target) deleteChat(target, room.activeId())
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
