import { Match, Show, Switch, createSignal, lazy } from "solid-js"
import type { Backend, NeedsBackendReason } from "../phase"
import { connectCloudflare, forgetBackend, phase, retryBackend } from "../session"
import { errorText, primary, secondary } from "./controls"
import { Dots } from "./dots"

const ConnectCloudflare = lazy(() => import("../connect").then((m) => ({ default: m.ConnectCloudflare })))

export const preloadConnect = () => void ConnectCloudflare.preload()

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const NOTICES: Record<NeedsBackendReason, (host: string) => string> = {
  none: () => "",
  gone: (host) => `Kiko can't find your backend at ${host} anymore. Connect Cloudflare to set it up again.`,
  not_owner: () =>
    "This backend belongs to another Kiko account. Connect your own Cloudflare backend, or sign out and use the account that owns it.",
  legacy: (host) =>
    `Your backend at ${host} runs an older Kiko that this app can't open. Connect Cloudflare to update it. Your chats stay.`,
  detached: () =>
    "Kiko no longer uses that backend. Connect Cloudflare to set one up or attach it again. Its chats stay in your Cloudflare account.",
}

function Forget() {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const forget = async () => {
    setBusy(true)
    setError("")
    try {
      await forgetBackend()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kiko could not forget this backend. Try again.")
    }
    setBusy(false)
  }
  return (
    <>
      <button
        type="button"
        class={secondary}
        disabled={busy()}
        data-action="forget-backend"
        onClick={() => void forget()}
      >
        {busy() ? "Forgetting this backend" : "Forget this backend"}
      </button>
      <Show when={error()}>
        <p class={errorText} role="alert">
          {error()}
        </p>
      </Show>
    </>
  )
}

function Unreachable(props: { readonly backend: Backend }) {
  return (
    <div class="welcome-step" data-step="cloudflare" data-phase="Unreachable">
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        Waiting for your backend
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }} role="status">
        Kiko can't reach your backend at {hostOf(props.backend.url)} yet. A new Cloudflare address can take a few
        minutes to reach every network, and Kiko keeps trying. If you use a VPN, Private DNS, or an ad blocker, allow
        workers.dev.
      </p>
      <div class="ob-wait" role="status" style={{ "--i": 2 }}>
        <Dots />
        <span>Still trying</span>
      </div>
      <div class="ob-cta" style={{ "--i": 3 }}>
        <button type="button" class={primary} data-cta data-action="retry-backend" onClick={() => void retryBackend()}>
          Try again
        </button>
        <button
          type="button"
          class={secondary}
          data-action="reconnect-cloudflare"
          onClick={() => void connectCloudflare()}
        >
          Reconnect Cloudflare
        </button>
        <Forget />
      </div>
    </div>
  )
}

function Connect(props: { readonly reason: NeedsBackendReason; readonly previous: Backend | null }) {
  const notice = () => NOTICES[props.reason](props.previous ? hostOf(props.previous.url) : "your backend")
  return (
    <>
      <Show when={notice()}>
        <p class="ob-note" role="status" data-field="backend-notice">
          {notice()}
        </p>
      </Show>
      <ConnectCloudflare />
      <Show when={props.previous && props.reason !== "detached"}>
        <div class="ob-cta ob-cta-loose">
          <Forget />
        </div>
      </Show>
    </>
  )
}

const unreachable = () => {
  const current = phase()
  return current._tag === "Unreachable" ? current : null
}

const needsBackend = () => {
  const current = phase()
  return current._tag === "NeedsBackend" ? current : null
}

export function BackendStep() {
  return (
    <Switch fallback={<ConnectCloudflare />}>
      <Match when={unreachable()}>{(current) => <Unreachable backend={current().backend} />}</Match>
      <Match when={needsBackend()}>
        {(current) => <Connect reason={current().reason} previous={current().previous} />}
      </Match>
    </Switch>
  )
}
