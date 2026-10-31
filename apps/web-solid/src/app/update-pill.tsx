import { useNavigate } from "@tanstack/solid-router"
import { Match, onMount, Show, Switch } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { DownloadIcon, ResetIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { APP_VERSION } from "../lib/version-skew"
import { backendVersion, startUpdate, view, watchLatest } from "./update-flow"

function Versions(props: { note?: string }) {
  return (
    <div class="flex flex-col gap-1">
      <Show when={props.note}>{(note) => <p class="type-sm">{note()}</p>}</Show>
      <dl class="grid grid-cols-[auto_auto] gap-x-3 type-sm" data-part="update-versions">
        <dt class="text-tertiary">App</dt>
        <dd data-part="app-version">{APP_VERSION}</dd>
        <dt class="text-tertiary">Backend</dt>
        <dd data-part="backend-version">{backendVersion() ?? "Unknown"}</dd>
      </dl>
    </div>
  )
}

const LABEL = {
  failed: "Update didn't finish",
  reconnect: "Sign in to Cloudflare to update",
  update: "Update Kiko",
} as const

const ICON = { failed: ResetIcon, reconnect: DownloadIcon, update: DownloadIcon } as const

const BUSY: Record<string, string> = { Updating: "Updating your backend", Restarting: "Restarting your backend" }

const busyText = () => {
  const current = view()
  return current.kind === "busy" ? current.text : null
}

const offered = (): keyof typeof LABEL | null => {
  const { kind } = view()
  return kind === "failed" || kind === "reconnect" || kind === "update" ? kind : null
}

const row =
  "flex h-sidebar-row w-full min-w-0 items-center gap-1.5 rounded-base px-1.5 type-base text-secondary transition-[background-color,color,transform] duration-(--duration-fast) ease-sharp"

export default function UpdatePill() {
  const navigate = useNavigate()
  onMount(watchLatest)
  const act = () =>
    offered() === "reconnect" ? void navigate({ to: "/connect", search: { reconnect: 1 } }) : void startUpdate()
  return (
    <Show when={view().kind !== "none"}>
      <div class="px-sidebar-inset pb-px" data-component="update-pill-row">
        <TooltipV2
          placement="top"
          openDelay={500}
          value={<Versions note={offered() === "reconnect" ? "Your chats stay." : undefined} />}
        >
          <Switch>
            <Match when={busyText()}>
              {(text) => (
                <span class={row} role="status" data-component="update-pill" data-kind="busy">
                  <RemixIcon icon={DownloadIcon} size={14} class="shrink-0 icon-tertiary" />
                  <span
                    class="motion-shine min-w-0 truncate"
                    style={{ "--run-text": "var(--text-tertiary)", "--visible-animation-state": "running" }}
                  >
                    {BUSY[text()] ?? text()}
                  </span>
                </span>
              )}
            </Match>
            <Match when={offered()}>
              {(kind) => (
                <button
                  type="button"
                  class={`${row} cursor-pointer hover:bg-quaternary hover:text-primary active:scale-(--press-scale)`}
                  data-component="update-pill"
                  data-kind={kind()}
                  onClick={act}
                >
                  <RemixIcon icon={ICON[kind()]} size={14} class="shrink-0 icon-secondary" />
                  <span class="min-w-0 flex-1 truncate text-left">{LABEL[kind()]}</span>
                  <Show when={kind() === "failed"}>
                    <span class="shrink-0 text-primary">Retry</span>
                  </Show>
                </button>
              )}
            </Match>
          </Switch>
        </TooltipV2>
      </div>
    </Show>
  )
}
