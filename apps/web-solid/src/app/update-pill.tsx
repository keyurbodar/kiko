import { useNavigate } from "@tanstack/solid-router"
import { Match, onMount, Show, Switch } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { DownloadIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { APP_VERSION } from "../lib/version-skew"
import { backendVersion, startUpdate, view, watchLatest } from "./update-flow"

function Versions() {
  return (
    <dl class="grid grid-cols-[auto_auto] gap-x-3 text-sm" data-part="update-versions">
      <dt class="opacity-70">App</dt>
      <dd data-part="app-version">{APP_VERSION}</dd>
      <dt class="opacity-70">Backend</dt>
      <dd data-part="backend-version">{backendVersion() ?? "Unknown"}</dd>
    </dl>
  )
}

const LABEL = { failed: "Retry update", reconnect: "Reconnect Cloudflare", update: "Update" } as const

const busyText = () => {
  const current = view()
  return current.kind === "busy" ? current.text : null
}

const offered = (): keyof typeof LABEL | null => {
  const { kind } = view()
  return kind === "failed" || kind === "reconnect" || kind === "update" ? kind : null
}

export default function UpdatePill() {
  const navigate = useNavigate()
  onMount(watchLatest)
  const act = () =>
    offered() === "reconnect" ? void navigate({ to: "/connect", search: { reconnect: 1 } }) : void startUpdate()
  return (
    <Show when={view().kind !== "none"}>
      <div class="px-2 pb-1" data-component="update-pill-row">
        <TooltipV2 placement="top" openDelay={400} value={<Versions />}>
          <Switch>
            <Match when={busyText()}>
              {(text) => (
                <span class="update-pill" role="status" data-component="update-pill" data-kind="busy">
                  <span
                    class="motion-spin inline-block size-3 rounded-full border-2 border-current border-t-transparent"
                    aria-hidden="true"
                  />
                  {text()}
                </span>
              )}
            </Match>
            <Match when={offered()}>
              {(kind) => (
                <button type="button" class="update-pill" data-component="update-pill" data-kind={kind()} onClick={act}>
                  <RemixIcon icon={DownloadIcon} size={14} />
                  {LABEL[kind()]}
                </button>
              )}
            </Match>
          </Switch>
        </TooltipV2>
      </div>
    </Show>
  )
}
