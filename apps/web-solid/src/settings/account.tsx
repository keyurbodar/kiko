import { CopyCheckIcon } from "@kiko/ui/v2/copy-check-icon"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import { useNavigate } from "@tanstack/solid-router"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { Match, Show, Switch, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { detachBackend, detachSentence, livePorts } from "../app/connect-flow"
import { hosted, profile } from "../app/hosted"
import { session, signOut } from "../app/session"
import {
  backendStorage,
  backendVersion,
  checkForUpdates,
  currentSkew,
  refreshBackend,
  refreshLatest,
  startUpdate,
  view,
} from "../app/update-flow"
import { base, write } from "../lib/api-base"
import { cn } from "../lib/cn"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { APP_VERSION } from "../lib/version-skew"
import { connection } from "../state/connection"
import { Button, Group, IconButton, Row } from "./kit"
import { StorageGroup } from "./storage-group"

const SHINE = { "--run-text": "var(--fg3)", "--visible-animation-state": "running" }

const COPIED_MS = 1_200

const SKEW_TEXT = {
  ok: ", up to date",
  update: ", update available",
  blocked: ", update required",
  unknown: "",
} as const

const CONFIRM_MS = 4_000

const BUSY: Record<string, string> = { Updating: "Updating your backend", Restarting: "Restarting your backend" }

function Shine(props: { children: JSX.Element; [data: `data-${string}`]: string | undefined }) {
  return (
    <span class="motion-shine type-label text-fg3" style={SHINE} role="status" data-part={props["data-part"]}>
      {props.children}
    </span>
  )
}

function Profile() {
  const user = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  const name = () => profile()?.name ?? user()?.name ?? "You"
  return (
    <div class="kit-card flex items-center gap-3 px-4 py-3.5" data-component="account-profile">
      <Show
        when={profile()?.imageUrl}
        fallback={<IdentityAvatar seed={user()?.id ?? "you"} size={40} class="rounded-full" />}
      >
        {(src) => <img src={src()} alt="" class="size-10 shrink-0 rounded-full object-cover" data-field="avatar" />}
      </Show>
      <div class="flex min-w-0 flex-col">
        <span class="truncate type-row text-fg" data-field="profile-name">
          {name()}
        </span>
        <Show when={profile()?.email}>
          {(email) => (
            <span class="flex min-w-0 items-center gap-1.5 type-label text-fg3">
              <Show when={profile()?.provider}>
                {(p) => (
                  <ProviderIcon
                    id={p()}
                    width="14"
                    height="14"
                    class="shrink-0"
                    aria-label={p()}
                    data-field="provider"
                  />
                )}
              </Show>
              <span class="truncate">{email()}</span>
            </span>
          )}
        </Show>
      </div>
    </div>
  )
}

function Health() {
  const state = () => {
    if (connection.connected()) return "ok"
    return connection.view() === "disconnected" ? "down" : "checking"
  }
  return (
    <Switch>
      <Match when={state() === "ok"}>
        <span class="type-label text-ok" data-field="backend-health">
          Healthy
        </span>
      </Match>
      <Match when={state() === "down"}>
        <span class="type-label text-bad" data-field="backend-health">
          Not reachable
        </span>
      </Match>
      <Match when={true}>
        <Shine data-part="backend-health">Checking</Shine>
      </Match>
    </Switch>
  )
}

function Version() {
  const navigate = useNavigate()
  const [checking, setChecking] = createSignal(false)
  const check = () => {
    setChecking(true)
    void checkForUpdates().finally(() => setChecking(false))
  }
  const reconnect = () => void navigate({ to: "/connect", search: { reconnect: 1 } })
  return (
    <Row label="Version" id="version">
      <span class="flex min-w-0 flex-col items-end">
        <Switch>
          <Match when={view().kind === "busy"}>
            <Shine data-part="update-progress">
              {BUSY[(view() as { text: string }).text] ?? (view() as { text: string }).text}
            </Shine>
          </Match>
          <Match when={checking()}>
            <Shine>Checking</Shine>
          </Match>
          <Match when={view().kind === "update"}>
            <span class="type-label text-fg" data-field="backend-status">
              A new version is ready
            </span>
          </Match>
          <Match when={view().kind === "failed"}>
            <span class="type-label text-bad" data-field="backend-status">
              Update didn't finish
            </span>
          </Match>
          <Match when={view().kind === "reconnect"}>
            <span class="type-label text-fg3" data-field="backend-status">
              Sign in to Cloudflare to update
            </span>
          </Match>
          <Match when={true}>
            <span class="type-label text-fg3" data-field="backend-status">
              <span data-field="backend-version">{backendVersion() ?? "Unknown"}</span>
              {SKEW_TEXT[currentSkew() ?? "unknown"]}
            </span>
          </Match>
        </Switch>
        <Show when={backendVersion() !== APP_VERSION}>
          <span class="type-hint text-fg4">
            App <span data-field="app-version">{APP_VERSION}</span>
          </span>
        </Show>
      </span>
      <Switch>
        <Match when={view().kind === "busy"}>{null}</Match>
        <Match when={view().kind === "update"}>
          <Button variant="primary" data-action="update-start" onClick={() => void startUpdate()}>
            Update
          </Button>
        </Match>
        <Match when={view().kind === "failed"}>
          <Button variant="primary" data-action="update-start" onClick={() => void startUpdate()}>
            Retry
          </Button>
        </Match>
        <Match when={view().kind === "reconnect"}>
          <Button variant="primary" data-action="reconnect-cloudflare" onClick={reconnect}>
            Sign in to Cloudflare
          </Button>
        </Match>
        <Match when={true}>
          <Button data-action="check-updates" disabled={checking()} onClick={check}>
            Check
          </Button>
        </Match>
      </Switch>
    </Row>
  )
}

function Address() {
  const address = () => base() || location.origin
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = async () => {
    await navigator.clipboard.writeText(address())
    setCopied(true)
    clearTimeout(timer)
    timer = setTimeout(() => setCopied(false), COPIED_MS)
  }
  return (
    <Row label="Address" id="address">
      <span class="flex min-w-0 items-center gap-1">
        <span class="truncate font-mono text-label text-fg2" data-field="backend-address">
          {address().replace(/^https?:\/\//, "")}
        </span>
        <IconButton
          label={copied() ? "Copied" : "Copy the address"}
          data-action="copy-address"
          onClick={() => void copy()}
        >
          <CopyCheckIcon copied={copied()} size={16} class={cn(copied() && "text-ok")} />
        </IconButton>
      </span>
    </Row>
  )
}

function FileStorage() {
  return (
    <Show when={backendStorage()}>
      {(storage) => (
        <Row
          label="File storage"
          description={
            storage() === "r2"
              ? "Cloudflare R2. Files up to 512 MB."
              : "Built-in, because R2 is not turned on in your Cloudflare account. Files up to 100 MB, and 800 MB per chat."
          }
        >
          <Show
            when={storage() === "built-in"}
            fallback={
              <span class="type-label text-fg3" data-field="file-storage">
                R2
              </span>
            }
          >
            <a
              class="link-grow type-label text-fg"
              href="https://developers.cloudflare.com/r2/pricing/"
              target="_blank"
              rel="noreferrer"
              data-field="file-storage"
            >
              About R2
            </a>
          </Show>
        </Row>
      )}
    </Show>
  )
}

function Server() {
  onMount(() => void refreshBackend().then(() => refreshLatest()))
  return (
    <Group title="Your Kiko server" data-component="account-backend">
      <div
        class="flex items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_color-mix(in_oklab,var(--fg)_5%,transparent)]"
        data-setting="backend"
      >
        <span class="grid size-8 shrink-0 place-items-center rounded-control bg-[#fff] text-[#f38020]">
          <ProviderIcon id="cloudflare-workers-ai" width="18" height="18" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate type-ui font-medium text-fg">Running on your Cloudflare</span>
          <span class="truncate type-label text-fg3">Your chats never leave your account</span>
        </span>
        <Health />
      </div>
      <Version />
      <Address />
      <FileStorage />
    </Group>
  )
}

function SignOut() {
  const [leaving, setLeaving] = createSignal(false)
  return (
    <Row label="Sign out" id="sign-out" description="Your server and its data stay as they are.">
      <Button
        data-action="sign-out"
        busy={leaving()}
        onClick={() => {
          setLeaving(true)
          void signOut().finally(() => setLeaving(false))
        }}
      >
        Sign out
      </Button>
    </Row>
  )
}

function DisconnectBackend() {
  const navigate = useNavigate()
  const [leaving, setLeaving] = createSignal(false)
  const [confirming, setConfirming] = createSignal(false)
  const [problem, setProblem] = createSignal("")
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const disconnect = async () => {
    if (!confirming()) {
      setConfirming(true)
      timer = setTimeout(() => setConfirming(false), CONFIRM_MS)
      return
    }
    clearTimeout(timer)
    setConfirming(false)
    setLeaving(true)
    setProblem("")
    const detached = await Effect.runPromise(Effect.result(detachBackend(livePorts)))
    if (Result.isFailure(detached)) {
      setProblem(detachSentence(detached.failure))
      setLeaving(false)
      return
    }
    write("kiko:backend", null)
    await signOut().finally(() => setLeaving(false))
  }
  return (
    <>
      <Row
        label="Reinstall on Cloudflare"
        id="reinstall"
        description="Sign in to Cloudflare again to install or update your server. Your chats stay."
      >
        <Button
          data-action="reconnect-cloudflare"
          onClick={() => void navigate({ to: "/connect", search: { reconnect: 1 } })}
        >
          Sign in to Cloudflare
        </Button>
      </Row>
      <Row
        label={<span class="text-bad">Disconnect server</span>}
        id="disconnect"
        description={
          <>
            Unlinks this server from your sign-in and signs you out. Its chats stay in your Cloudflare account, and
            connecting that account again brings them back.
            <Show when={problem()}>
              {(text) => (
                <span class="mt-1 block text-bad" role="alert" data-field="disconnect-problem">
                  {text()}
                </span>
              )}
            </Show>
          </>
        }
      >
        <Button variant="danger" data-action="disconnect-backend" busy={leaving()} onClick={() => void disconnect()}>
          {confirming() ? "Click again to disconnect" : "Disconnect"}
        </Button>
      </Row>
    </>
  )
}

export function Account() {
  return (
    <div class="flex flex-col gap-8" data-component="account">
      <Profile />
      <Server />
      <StorageGroup />
      <Group title="Leaving" data-component="account-leaving">
        <SignOut />
        <Show when={hosted}>
          <DisconnectBackend />
        </Show>
      </Group>
    </div>
  )
}
