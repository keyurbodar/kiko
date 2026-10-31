import type { WebApp, WebAppsResult } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { Button, buttonClass, EmptyState, Group, Hint, Item, Notice, Row, Skeleton } from "./kit"
import { call, owner } from "../state/runtime"

const POLL_MS = 4000
const DAY_MS = 86_400_000

type Ready = Extract<WebAppsResult, { ok: true }>

const failed = (e: unknown): WebAppsResult => ({
  ok: false,
  error: e instanceof Error ? e.message : "Kiko did not answer.",
})

function expiry(app: WebApp): string {
  if (app.owned) return "Yours, never expires"
  if (!app.expiresAt) return "Expires soon unless claimed"
  const days = Math.ceil((Date.parse(app.expiresAt) - Date.now()) / DAY_MS)
  if (days <= 0) return "Expired"
  return `Expires in ${days} ${days === 1 ? "day" : "days"} unless claimed`
}

const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "")

function openLink(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer")
}

function Account(props: { state: Ready; busy: boolean; onConnect: () => void; onDisconnect: () => void }): JSX.Element {
  return (
    <Switch>
      <Match when={props.state.account.state === "connected" && props.state.account}>
        {(account) => (
          <Row
            label="Lakebed account"
            id="lakebed-account"
            description={`Connected${account().login ? ` as ${account().login}` : ""}. Every new app is yours, never expires, and can use secrets and your own domain.`}
          >
            <Button variant="ghost" busy={props.busy} onClick={props.onDisconnect} data-action="lakebed-disconnect">
              Disconnect
            </Button>
          </Row>
        )}
      </Match>
      <Match when={props.state.account.state === "waiting" && props.state.account}>
        {(account) => (
          <Row
            label="Lakebed account"
            id="lakebed-account"
            description={
              <>
                Approve code <span class="font-mono text-primary">{account().code}</span> on Lakebed. This page updates
                when you do.
              </>
            }
          >
            <Button variant="ghost" busy={props.busy} onClick={props.onDisconnect} data-action="lakebed-cancel">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => openLink(account().url)} data-action="lakebed-open">
              Open Lakebed
            </Button>
          </Row>
        )}
      </Match>
      <Match when={props.state.account.state === "none"}>
        <Row
          label="Lakebed account"
          id="lakebed-account"
          description="Connect once and every app your agents build is yours: it never expires, and can use secrets and your own domain."
        >
          <Button variant="primary" busy={props.busy} onClick={props.onConnect} data-action="lakebed-connect">
            Connect
          </Button>
        </Row>
      </Match>
    </Switch>
  )
}

function AppRow(props: { app: WebApp; claiming: boolean; onClaim: () => void }): JSX.Element {
  return (
    <Item
      title={props.app.name}
      meta={
        <>
          <a class="hover:text-primary hover:underline" href={props.app.url} target="_blank" rel="noopener noreferrer">
            {host(props.app.url)}
          </a>
          {", "}
          <span class={props.app.owned ? "text-success" : undefined}>{expiry(props.app)}</span>
        </>
      }
      data-web-app={props.app.name}
      actions={
        <>
          <a class={buttonClass("ghost")} href={props.app.url} target="_blank" rel="noopener noreferrer">
            Open
          </a>
          <Show when={!props.app.owned}>
            <Button variant="secondary" busy={props.claiming} onClick={props.onClaim} data-action="web-app-claim">
              Claim
            </Button>
          </Show>
        </>
      }
    />
  )
}

export default function WebApps(): JSX.Element {
  const [state, setState] = createSignal<WebAppsResult | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [claiming, setClaiming] = createSignal<string | null>(null)
  const [watching, setWatching] = createSignal(false)

  const load = (pending: Promise<WebAppsResult>) =>
    pending.catch(failed).then((next) => {
      setState(next)
      if (next.ok && next.account.state === "connected" && next.apps.every((app) => app.owned)) setWatching(false)
    })
  const refresh = () => load(call(owner.commands.webAppsStatus, {}))

  const act = async (pending: () => Promise<WebAppsResult>) => {
    setBusy(true)
    await load(pending())
    setBusy(false)
  }
  const connect = () => {
    setWatching(true)
    return act(() => call(owner.commands.webAppsConnect, {}))
  }
  const disconnect = () => act(() => call(owner.commands.webAppsDisconnect, {}))
  const claim = async (name: string) => {
    setClaiming(name)
    const link = await call(owner.commands.webAppsClaim, { name }).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : "Kiko did not answer.",
    }))
    setClaiming(null)
    if (!link.ok) {
      showToastV2({ title: "Could not get a claim link", description: link.error, variant: "error" })
      return
    }
    setWatching(true)
    openLink(link.url)
    showToastV2({ title: `Approve code ${link.code} on Lakebed`, description: "Claiming also connects your account." })
  }

  onMount(() => {
    void refresh()
    const timer = setInterval(() => {
      if (watching() && document.visibilityState === "visible") void refresh()
    }, POLL_MS)
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    onCleanup(() => {
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    })
  })

  return (
    <div class="flex flex-col gap-[18px]" data-component="web-apps-settings">
      <Show
        when={state()}
        fallback={
          <Group title="Account">
            <Row label="Lakebed account">
              <Skeleton class="h-7 w-24" />
            </Row>
          </Group>
        }
      >
        {(current) => (
          <Show
            when={current().ok && (current() as Ready)}
            fallback={<Notice data-field="web-apps-error">{(current() as { error: string }).error}</Notice>}
          >
            {(ready) => (
              <Show
                when={ready().available}
                fallback={
                  <Hint data-field="web-apps-unavailable">
                    Kiko is installing the app builder. This takes a few minutes.
                  </Hint>
                }
              >
                <Group title="Account">
                  <Account state={ready()} busy={busy()} onConnect={connect} onDisconnect={disconnect} />
                </Group>
                <Group title="Apps">
                  <For
                    each={ready().apps}
                    fallback={<EmptyState art="web" title="No apps yet" line="Ask any agent to build one." />}
                  >
                    {(app) => (
                      <AppRow app={app} claiming={claiming() === app.name} onClaim={() => void claim(app.name)} />
                    )}
                  </For>
                </Group>
              </Show>
            )}
          </Show>
        )}
      </Show>
    </div>
  )
}
