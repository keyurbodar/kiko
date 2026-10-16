import { PROTOCOL } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { Show, createResource, createSignal } from "solid-js"
import { hosted, profile } from "../app/hosted"
import { session, signOut } from "../app/session"
import { apiFetch } from "../lib/api"
import { base } from "../lib/api-base"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { APP_VERSION, type BackendBuild, backendSkew } from "../lib/version-skew"
import { Button, Group, Item, Pill, Row } from "./kit"

const PROVIDER_LABEL: Record<string, string> = { google: "Google", github: "GitHub", apple: "Apple", microsoft: "Microsoft" }
const providerLabel = (id: string) => PROVIDER_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1)

const SKEW_TEXT = { ok: "Up to date", update: "Update available", blocked: "Update required" } as const

async function fetchBackend(): Promise<BackendBuild | null> {
  const res = await apiFetch("/api/version").catch(() => null)
  return res?.ok ? ((await res.json().catch(() => null)) as BackendBuild | null) : null
}

function Backend() {
  const [build] = createResource(fetchBackend)
  const version = () => build()?.version
  const navigate = useNavigate()
  return (
    <Group title="Backend" data-component="account-backend">
      <Row label="Address">
        <span class="truncate text-md" data-field="backend-address">{base() || location.origin}</span>
      </Row>
      <Row label="Version">
        <span class="text-md" data-field="backend-version">{version() ?? (build.loading ? "Checking" : "Unknown")}</span>
        <Show when={build()}>
          {(b) => (
            <Pill tone={backendSkew({ version: APP_VERSION, protocol: PROTOCOL }, b()) === "ok" ? "success" : "accent"} data-field="backend-status">
              {SKEW_TEXT[backendSkew({ version: APP_VERSION, protocol: PROTOCOL }, b())]}
            </Pill>
          )}
        </Show>
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
