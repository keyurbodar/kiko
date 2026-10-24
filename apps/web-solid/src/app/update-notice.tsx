import { useNavigate } from "@tanstack/solid-router"
import { Show } from "solid-js"
import type { Notice } from "../lib/update"
import { Button } from "../settings/kit"
import { notice, startUpdate } from "./update-flow"

type Action = { readonly id: string; readonly label: string; readonly run: () => void }

const LINE: Record<Notice["kind"], string> = {
  checking: "Checking your backend…",
  updating: "Updating your backend…",
  reconnect: "Your backend runs an older version of Kiko.",
  retry: "Your backend did not finish updating.",
  reload: "A new version of Kiko is ready.",
}

const lineOf = (current: Notice): string =>
  current.kind === "reconnect" && current.reason !== "legacy"
    ? "Kiko needs your Cloudflare sign-in again to update your backend. Your chats stay."
    : LINE[current.kind]

const busy = (current: Notice) => current.kind === "checking" || current.kind === "updating"

export default function UpdateNotice() {
  const navigate = useNavigate()
  const actionOf = (current: Notice): Action | null => {
    switch (current.kind) {
      case "reconnect":
        return {
          id: "reconnect-cloudflare",
          label: "Sign in to Cloudflare",
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
          class="motion-page-in mx-3 mb-2 flex min-h-11 items-center gap-3 rounded-tile bg-panel py-1.5 pr-1.5 pl-3.5 type-label text-fg2"
          role="status"
          data-component="update-notice"
          data-kind={current().kind}
        >
          <span
            class="min-w-0 flex-1"
            classList={{ "motion-shine": busy(current()) }}
            style={busy(current()) ? { "--run-text": "var(--fg3)", "--visible-animation-state": "running" } : undefined}
          >
            {lineOf(current())}
          </span>
          <Show when={actionOf(current())}>
            {(action) => (
              <Button variant="secondary" class="shrink-0" data-action={action().id} onClick={action().run}>
                {action().label}
              </Button>
            )}
          </Show>
        </div>
      )}
    </Show>
  )
}
