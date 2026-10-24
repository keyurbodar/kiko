import { useNavigate } from "@tanstack/solid-router"
import { Show } from "solid-js"
import type { Notice } from "../lib/update"
import { notice, startUpdate } from "./update-flow"

type Action = { readonly id: string; readonly label: string; readonly run: () => void }

const LINE: Record<Notice["kind"], string> = {
  checking: "Checking your backend…",
  updating: "Updating your backend…",
  reconnect: "Your backend runs an older version of Kiko.",
  retry: "Your backend did not finish updating.",
  reload: "Kiko has a newer version.",
}

const lineOf = (current: Notice): string =>
  current.kind === "reconnect" && current.reason !== "legacy"
    ? "Kiko needs your Cloudflare sign-in again to update your backend."
    : LINE[current.kind]

export default function UpdateNotice() {
  const navigate = useNavigate()
  const actionOf = (current: Notice): Action | null => {
    switch (current.kind) {
      case "reconnect":
        return {
          id: "reconnect-cloudflare",
          label: "Reconnect Cloudflare (keeps chats)",
          run: () => void navigate({ to: "/connect", search: { reconnect: 1 } }),
        }
      case "retry":
        return { id: "update-retry", label: "Try again", run: () => void startUpdate() }
      case "reload":
        return { id: "reload", label: "Reload", run: () => location.reload() }
      case "checking":
      case "updating":
        return null
    }
  }
  return (
    <Show when={notice()}>
      {(current) => (
        <div
          class="mx-3 mb-2 flex min-h-9 items-center gap-2 rounded-row bg-[color-mix(in_oklab,var(--fg)_6%,transparent)] px-3 py-1.5 text-label text-fg3"
          role="status"
          data-component="update-notice"
          data-kind={current().kind}
        >
          <Show when={current().kind === "checking" || current().kind === "updating"}>
            <span
              class="motion-spin inline-block size-3 shrink-0 rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
          </Show>
          <span class="min-w-0 flex-1 truncate">{lineOf(current())}</span>
          <Show when={actionOf(current())}>
            {(action) => (
              <button type="button" class="update-pill shrink-0" data-action={action().id} onClick={action().run}>
                {action().label}
              </button>
            )}
          </Show>
        </div>
      )}
    </Show>
  )
}
