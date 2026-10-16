import { useNavigate } from "@solidjs/router"
import { Match, Show, Switch, createSignal, onMount } from "solid-js"
import { hosted, profile } from "../app/hosted"
import { session, signOut } from "../app/session"
import { backendVersion, checkForUpdates, clientIsBehind, currentSkew, refreshBackend, refreshLatest, startUpdate, view } from "../app/update-flow"
import { base } from "../lib/api-base"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { APP_VERSION } from "../lib/version-skew"
import { Button, Group, Item, Pill, Row, Spinner } from "./kit"

const PROVIDER_LABEL: Record<string, string> = { google: "Google", github: "GitHub", apple: "Apple", microsoft: "Microsoft" }
const providerLabel = (id: string) => PROVIDER_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1)

const SKEW_TEXT = { ok: "Up to date", update: "Update available", blocked: "Update required" } as const

function Backend() {
  const navigate = useNavigate()
  const [checking, setChecking] = createSignal(false)
  onMount(() => void refreshBackend().then(() => refreshLatest()))
  const check = () => {
    setChecking(true)
    void checkForUpdates().finally(() => setChecking(false))
  }
  const status = () => (clientIsBehind() && currentSkew() !== "blocked" ? SKEW_TEXT.update : currentSkew() ? SKEW_TEXT[currentSkew()!] : undefined)
  return (
    <Group title="Backend" data-component="account-backend">
      <Row label="Address">
        <span class="truncate text-md" data-field="backend-address">{base() || location.origin}</span>
      </Row>
      <Row label="App version">
        <span class="text-md" data-field="app-version">{APP_VERSION}</span>
      </Row>
      <Row label="Backend version">
        <span class="text-md" data-field="backend-version">{backendVersion() ?? "Unknown"}</span>
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
            <span class="inline-flex items-center gap-2 text-muted-foreground" role="status" data-part="update-progress">
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
      <Row label="Cloudflare" description="Install or update your backend again in your Cloudflare account.">
        <Button data-action="reconnect-cloudflare" onClick={() => navigate("/connect?reconnect=1")}>
          Reconnect Cloudflare
        </Button>
      </Row>
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
    <Button data-action="sign-out" busy={leaving()} onClick={() => {
        setLeaving(true)
        void signOut().finally(() => setLeaving(false))
      }}>
      Sign out
    </Button>
  )
  return (
    <div class="flex flex-col gap-8" data-component="account">
      <Show
        when={hosted}
        fallback={
          <Group title="Account">
            <Item icon={<IdentityAvatar seed={user()?.id ?? "you"} size={24} />} title={user()?.name ?? "You"} actions={signOutButton()} />
          </Group>
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
        <Group>
          <Row label="Sign out" description="Ends this session. Your backend and its data stay as they are.">
            {signOutButton()}
          </Row>
        </Group>
      </Show>
    </div>
  )
}
