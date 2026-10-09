import { createSignal, Show } from "solid-js"
import { signOut } from "./session"
import { Dialog } from "../lib/dialog"
import { Button, fieldClass, Notice, Row } from "../settings/kit"

/*
 * Account deletion (P9-02). The person types a phrase to confirm, and the server
 * also requires a recent sign-in. On success the server has already signed this
 * browser out, and the local sign-out drops the warm tier.
 */
export const CONFIRM_PHRASE = "delete my account"

export function DeleteAccount() {
  const [open, setOpen] = createSignal(false)
  const [typed, setTyped] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal("")

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (typed() !== CONFIRM_PHRASE || busy()) return
    setBusy(true)
    setMessage("")
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: typed() }),
      })
      if (res.status === 202) return await signOut()
      if (res.status === 403) {
        setMessage("Sign in again, then delete your account within ten minutes.")
        return await signOut()
      }
      setMessage("The account was not deleted. Try again.")
    } catch {
      setMessage("The account was not deleted. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    if (busy()) return
    setOpen(false)
    setTyped("")
    setMessage("")
  }

  // A row in the account card. Asked, it opens a dialog that holds the typed confirmation.
  return (
    <div data-component="delete-account">
      <Row label="Delete your account and everything in it" description="This cannot be undone.">
        <Button variant="danger" data-action="delete-account" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </Row>
      <Dialog
        open={open()}
        onClose={cancel}
        title="Delete your account?"
        description="This deletes every chat, agent, file, key, and memory. It cannot be undone."
        onSubmit={submit}
        data-component="delete-account-dialog"
        footer={
          <>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={typed() !== CONFIRM_PHRASE || busy()} data-action="confirm-delete-account">
              Delete account
            </Button>
          </>
        }
      >
        <div class="flex flex-col gap-2.5">
          <label class="flex flex-col gap-1.5 text-[13px] text-text">
            Type "{CONFIRM_PHRASE}" to confirm
            <input
              class={fieldClass}
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              ref={(el) => queueMicrotask(() => el.focus())}
              value={typed()}
              onInput={(e) => setTyped(e.currentTarget.value)}
            />
          </label>
          <Show when={message()}>
            <Notice>{message()}</Notice>
          </Show>
        </div>
      </Dialog>
    </div>
  )
}
