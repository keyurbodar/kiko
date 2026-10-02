import { createSignal, Show } from "solid-js"
import { signOut } from "./session"

/*
 * Account deletion (P9-02). The person types a phrase to confirm, and the server
 * also requires a recent sign-in. On success the server has already signed this
 * browser out, and the local sign-out drops the warm tier.
 */
export const CONFIRM_PHRASE = "delete my account"

const button =
  "flex h-10 items-center justify-center rounded-[10px] bg-btn px-4 text-sm font-medium text-danger outline-none hover:bg-btn-hover focus-visible:ring-2 focus-visible:ring-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"

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
        setMessage("sign in again, then delete your account within ten minutes")
        return await signOut()
      }
      setMessage("the account was not deleted. try again")
    } catch {
      setMessage("the account was not deleted. check your connection")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="flex flex-col gap-3" data-component="delete-account">
      <Show
        when={open()}
        fallback={
          <button type="button" class={button} onClick={() => setOpen(true)}>
            delete account
          </button>
        }
      >
        <form
          class="flex w-full max-w-sm flex-col gap-3"
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy()) {
              e.stopPropagation()
              setOpen(false)
              setTyped("")
            }
          }}
        >
          <p class="text-sm text-text">
            this deletes every chat, agent, file, key, and memory you have. it cannot be undone.
          </p>
          <label class="flex flex-col gap-1 text-sm text-weak">
            type "{CONFIRM_PHRASE}" to confirm
            <input
              class="h-10 rounded-[10px] bg-btn px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              ref={(el) => queueMicrotask(() => el.focus())}
              value={typed()}
              onInput={(e) => setTyped(e.currentTarget.value)}
            />
          </label>
          <button type="submit" class={button} disabled={typed() !== CONFIRM_PHRASE || busy()}>
            delete my account forever
          </button>
          <button
            type="button"
            class="h-10 rounded-[10px] px-4 text-sm text-muted outline-none hover:bg-[var(--tab-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            onClick={() => {
              setOpen(false)
              setTyped("")
              setMessage("")
            }}
          >
            keep my account
          </button>
          <Show when={message()}>
            <p class="text-sm text-[var(--danger)]" role="alert">{message()}</p>
          </Show>
        </form>
      </Show>
    </section>
  )
}
