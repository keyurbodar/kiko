import { createSignal, Show } from "solid-js"
import { signOut } from "./session"
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
    setOpen(false)
    setTyped("")
    setMessage("")
  }

  // A row in the account card. Asked, it opens the confirmation in place, under its own line.
  return (
    <div data-component="delete-account">
      <Row label="Delete account" description="Deletes every chat, agent, file, key, and memory. This cannot be undone.">
        <Show when={!open()}>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Delete account
          </Button>
        </Show>
      </Row>
      <Show when={open()}>
        <form
          class="flex flex-col gap-2.5 px-4 pb-4"
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy()) {
              e.stopPropagation()
              cancel()
            }
          }}
        >
          <label class="flex flex-col gap-1.5 text-xs text-muted">
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
          <div class="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="danger" disabled={typed() !== CONFIRM_PHRASE || busy()}>
              Delete my account forever
            </Button>
            <Button variant="ghost" onClick={cancel}>
              Keep my account
            </Button>
          </div>
          <Show when={message()}>
            <Notice>{message()}</Notice>
          </Show>
        </form>
      </Show>
    </div>
  )
}
