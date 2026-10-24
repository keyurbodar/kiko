import { useNavigate } from "@tanstack/solid-router"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { Match, Show, Switch, createSignal, onMount } from "solid-js"
import { detachBackend, detachSentence, livePorts } from "../app/connect-flow"
import { hosted, profile } from "../app/hosted"
import { session, signOut } from "../app/session"
import {
  backendStorage,
  backendVersion,
  checkForUpdates,
  clientIsBehind,
  currentSkew,
  refreshBackend,
  refreshLatest,
  startUpdate,
  view,
} from "../app/update-flow"
import { base, write } from "../lib/api-base"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { APP_VERSION } from "../lib/version-skew"
import { Button, Group, Item, Pill, Row, Spinner } from "./kit"
import { StorageGroup } from "./storage-group"

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  apple: "Apple",
  microsoft: "Microsoft",
}
const providerLabel = (id: string) => PROVIDER_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1)

const SKEW_TEXT = { ok: "Up to date", update: "Update available", blocked: "Update required" } as const

function DisconnectBackend() {
  const [leaving, setLeaving] = createSignal(false)
  const [problem, setProblem] = createSignal("")
  const disconnect = async () => {
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
    <Row
      label="Disconnect backend"
      description={
        <>
          Unlinks this backend from your sign-in and signs you out. Its chats stay in your Cloudflare account, and
          connecting that account again brings them back.
          <Show when={problem()}>
            {(text) => (
              <span class="mt-1 block text-[var(--bad)]" role="alert" data-field="disconnect-problem">
                {text()}
              </span>
            )}
          </Show>
        </>
      }
    >
      <Button data-action="disconnect-backend" busy={leaving()} onClick={() => void disconnect()}>
        Disconnect
      </Button>
    </Row>
  )
}

function Backend() {
  const navigate = useNavigate()
  const [checking, setChecking] = createSignal(false)
  onMount(() => void refreshBackend().then(() => refreshLatest()))
  const check = () => {
    setChecking(true)
    void checkForUpdates().finally(() => setChecking(false))
  }
  const status = () =>
    clientIsBehind() && currentSkew() !== "blocked"
      ? SKEW_TEXT.update
      : currentSkew()
        ? SKEW_TEXT[currentSkew()!]
        : undefined
  return (
    <Group title="Backend" data-component="account-backend">
      <Row label="Address">
        <span class="truncate text-md" data-field="backend-address">
          {base() || location.origin}
        </span>
      </Row>
      <Row label="App version">
        <span class="text-md" data-field="app-version">
          {APP_VERSION}
        </span>
      </Row>
      <Row label="Backend version">
        <span class="text-md" data-field="backend-version">
          {backendVersion() ?? "Unknown"}
        </span>
      </Row>
      <Row label="Updates">
        <Show when={status()}>
          {(text) => (
            <Pill tone={status() === "Up to date" ? "success" : "accent"} data-field="backend-status">
              {text()}
            </Pill>
          )}
        </Show>
        <Switch>
          <Match when={view().kind === "busy"}>
            <span class="inline-flex items-center gap-2 text-fg2" role="status" data-part="update-progress">
              <Spinner size={12} />
              {(view() as { text: string }).text}
            </span>
          </Match>
          <Match when={view().kind === "update" || view().kind === "failed"}>
            <Button variant="primary" data-action="update-start" onClick={() => void startUpdate()}>
              {view().kind === "failed" ? "Retry update" : "Update"}
            </Button>
          </Match>
          <Match when={true}>
            <Button data-action="check-updates" busy={checking()} onClick={check}>
              Check for updates
            </Button>
          </Match>
        </Switch>
      </Row>
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
                <span class="text-md" data-field="file-storage">
                  R2
                </span>
              }
            >
              <a
                class="text-sm text-fg underline underline-offset-2"
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
      <Row label="Cloudflare" description="Install or update your backend again in your Cloudflare account.">
        <Button
          data-action="reconnect-cloudflare"
          onClick={() => void navigate({ to: "/connect", search: { reconnect: 1 } })}
        >
          Reconnect Cloudflare
        </Button>
      </Row>
      <DisconnectBackend />
    </Group>
  )
}

export function Account() {
  const user = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  const [leaving, setLeaving] = createSignal(false)
  const signOutButton = () => (
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
  )
  return (
    <div class="flex flex-col gap-8" data-component="account">
      <Show
        when={hosted}
        fallback={
          <>
            <Group title="Account">
              <Item
                icon={<IdentityAvatar seed={user()?.id ?? "you"} size={24} />}
                title={user()?.name ?? "You"}
                actions={signOutButton()}
              />
            </Group>
            <StorageGroup />
          </>
        }
      >
        <Group title="Profile">
          <Item
            icon={
              <Show when={profile()?.imageUrl} fallback={<IdentityAvatar seed={user()?.id ?? "you"} size={24} />}>
                {(src) => <img src={src()} alt="" class="size-full object-cover" data-field="avatar" />}
              </Show>
            }
            title={profile()?.name ?? user()?.name ?? "You"}
            meta={profile()?.email}
            actions={
              <Show when={profile()?.provider}>{(p) => <Pill data-field="provider">{providerLabel(p())}</Pill>}</Show>
            }
          />
        </Group>
        <Backend />
        <StorageGroup />
        <Group>
          <Row label="Sign out" description="Ends this session. Your backend and its data stay as they are.">
            {signOutButton()}
          </Row>
        </Group>
      </Show>
    </div>
  )
}
