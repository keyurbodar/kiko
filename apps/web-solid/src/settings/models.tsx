import { SearchField } from "@kiko/ui/v2/search-field"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronRightIcon, MoreIcon, PlusIcon, ReasoningIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js"
import { createQuery } from "../state/runtime"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { catalogQuery, type CatalogProvider, type ConnectMethod } from "./catalog"
import { ALL_PROVIDERS, formatContext, modelRef } from "./model-list"
import { Segmented } from "@kiko/ui/v2/segmented"
import { hasModelProvider, isJudgeOnly, JUDGE_NOTE, modelProviders } from "./provider-kinds"
import { connectedProviders, connectedReady } from "./connected"
import { checkProvider, connectProvider, disconnectProvider } from "./credentials"
import { clearReconnect, FIX_LABEL, PROBLEM_LINE, PROBLEM_SHORT, reconnectTarget } from "./provider-problem"
import { startSignIn, type SignIn, type SignInHandle } from "./provider-login"
import {
  Button,
  Empty,
  fieldClass,
  Group,
  Hint,
  iconButtonClass,
  muted,
  Notice,
  Skeleton,
  Spinner,
  Toggle,
} from "./kit"
import { BrandTile, ConnectHead, KeyLink, OrDivider, SecretInput } from "./connect-parts"
import { VList } from "virtua/solid"
import { Dialog } from "../lib/dialog"
import { hiddenModels, setHidden } from "./model-prefs"
import { cn } from "../lib/cn"
import { AgentModels } from "./agent-models"
import { CustomProviderDialog } from "./custom-provider"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import type { ProviderInfo } from "@kiko/protocol"

const METHOD_LABEL: Record<ConnectMethod, string> = {
  api_key: "API key",
  device_code: "Device code sign-in",
  paste_code: "Browser sign-in",
}

const POPULAR: readonly { id: string; note: string }[] = [
  { id: "opencode-go", note: "Low-cost open models from OpenCode." },
  { id: "opencode", note: "Models picked and tested by the OpenCode team." },
  { id: "anthropic", note: "Claude models." },
  { id: "openai", note: "GPT models." },
  { id: "google", note: "Gemini models." },
  { id: "openrouter", note: "Many providers' models behind one key." },
  { id: "github-copilot", note: "The models in your Copilot plan." },
]

const KEY_PAGE: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/keys",
  opencode: "https://opencode.ai/auth",
  "opencode-go": "https://opencode.ai/auth",
  deepseek: "https://platform.deepseek.com/api_keys",
  mistral: "https://console.mistral.ai/api-keys",
  groq: "https://console.groq.com/keys",
  xai: "https://console.x.ai",
}

const SEARCH_FROM = 12
const ROW = 46

const savedOf = (id: string) => connectedProviders().find((p) => p.provider === id)

function statusLine(info: ProviderInfo | undefined): string {
  if (info?.problem) return PROBLEM_LINE[info.problem]
  if (info?.kind !== "api_key") return "Signed in"
  return info.last4 ? `Key ending ${info.last4}` : "Key saved"
}

const [flashed, setFlashed] = createSignal<string | null>(null)

function celebrate(provider: CatalogProvider) {
  showToastV2({ title: `${provider.name} connected`, variant: "success" })
  setFlashed(provider.id)
}

export function ModelsPage() {
  const catalog = createQuery(() => catalogQuery())
  const connected = createMemo(() => (catalog()?.providers ?? []).filter((p) => savedOf(p.id)))
  const available = createMemo(() => (catalog()?.providers ?? []).filter((p) => !savedOf(p.id)))
  const [dialog, setDialog] = createSignal<CatalogProvider | null>(null)
  const [browsing, setBrowsing] = createSignal(false)
  const [tab, setTab] = createSignal<"agents" | "providers">("agents")
  const tabbed = () => hasModelProvider(connectedProviders()) && connected().length > 0
  createEffect(() => {
    const wanted = reconnectTarget()
    const provider = wanted ? catalog()?.providers.find((p) => p.id === wanted) : undefined
    if (!provider) return
    setDialog(provider)
    clearReconnect()
  })

  const [cheer, setCheer] = createSignal(false)
  createEffect(
    on(
      () => (connectedReady() ? modelProviders(connectedProviders()).length : -1),
      (count, prev) => {
        if (prev !== 0 || count < 1) return
        setCheer(true)
        const timer = setTimeout(() => setCheer(false), 2400)
        onCleanup(() => clearTimeout(timer))
      },
    ),
  )

  return (
    <div class="flex flex-col gap-[18px]" data-component="models-page">
      <Show when={cheer()}>
        <p
          class="rounded-xl bg-editor px-4 py-3 type-base text-primary"
          data-component="first-provider-cheer"
          role="status"
        >
          Connected. Your agents can reply now.
        </p>
      </Show>
      <Show when={catalog.error}>
        <Notice data-component="catalog-error">The model catalog did not load. Reload to try again.</Notice>
      </Show>
      <Show when={tabbed()}>
        <div data-component="models-tabs">
          <Segmented<"agents" | "providers">
            label="Models"
            value={tab()}
            onChange={setTab}
            options={[
              { value: "agents", label: "Agents" },
              { value: "providers", label: "Providers" },
            ]}
          />
        </div>
      </Show>
      <Show when={hasModelProvider(connectedProviders()) && (tab() === "agents" || !tabbed())}>
        <AgentModels />
      </Show>
      <Show
        when={connected().length && (tab() === "providers" || !tabbed())}
        fallback={
          <Show when={!connected().length}>
            <PopularProviders
              ready={connectedReady() && !!catalog()}
              available={available()}
              onPick={setDialog}
              onBrowse={() => setBrowsing(true)}
            />
          </Show>
        }
      >
        <ProviderList
          providers={connected()}
          available={available()}
          onManage={setDialog}
          onAdd={() => setBrowsing(true)}
        />
        <PickerModels providers={connected()} />
      </Show>

      <AddProviderDialog
        open={browsing()}
        loading={catalog.loading}
        providers={available()}
        onClose={() => setBrowsing(false)}
        onPick={(provider) => {
          setBrowsing(false)
          setDialog(provider)
        }}
      />
      <ConnectDialog provider={dialog()} onClose={() => setDialog(null)} onConnected={celebrate} />
    </div>
  )
}

function PopularProviders(props: {
  ready: boolean
  available: readonly CatalogProvider[]
  onPick: (provider: CatalogProvider) => void
  onBrowse: () => void
}) {
  const popular = createMemo(() =>
    POPULAR.flatMap(({ id, note }) => {
      const provider = props.available.find((p) => p.id === id)
      return provider ? [{ provider, note }] : []
    }).concat(props.available.filter(isJudgeOnly).map((provider) => ({ provider, note: JUDGE_NOTE }))),
  )
  return (
    <Group
      title="Connect a provider"
      data-component="provider-add"
      bare
      action={
        <Button variant="ghost" data-action="view-all-providers" onClick={() => props.onBrowse()}>
          All providers
        </Button>
      }
    >
      <div class="grid grid-cols-1 gap-2 @min-[560px]/settings:grid-cols-2">
        <Show when={props.ready} fallback={<ProviderSkeletons />}>
          <For each={popular()} fallback={<Hint>No providers found.</Hint>}>
            {({ provider, note }) => (
              <button
                type="button"
                class="group flex cursor-pointer items-center gap-3 rounded-xl border border-tertiary bg-editor p-3 text-left transition-[background-color,transform] duration-(--duration-fast) ease-sharp hover:bg-quaternary active:scale-(--press-scale)"
                data-provider={provider.id}
                data-action="connect"
                onClick={() => props.onPick(provider)}
              >
                <BrandTile>
                  <ProviderIcon id={provider.id} width="16" height="16" />
                </BrandTile>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate type-base text-primary">{provider.name}</span>
                  <span class="truncate type-sm text-[var(--text-tertiary)]">{note}</span>
                </span>
                <RemixIcon
                  icon={ChevronRightIcon}
                  size={12}
                  class="shrink-0 icon-tertiary transition-[color,transform] duration-(--duration-fast) group-hover:translate-x-0.5 group-hover:icon-secondary"
                />
              </button>
            )}
          </For>
        </Show>
      </div>
    </Group>
  )
}

function ProviderList(props: {
  providers: readonly CatalogProvider[]
  available: readonly CatalogProvider[]
  onManage: (provider: CatalogProvider) => void
  onAdd: () => void
}) {
  const strip = () => {
    const popular = POPULAR.flatMap(({ id }) => props.available.filter((p) => p.id === id))
    return popular.slice(0, 4)
  }
  return (
    <Group title="Providers" data-component="provider-rail">
      <For each={props.providers}>{(provider) => <ProviderRow provider={provider} onManage={props.onManage} />}</For>
      <button
        type="button"
        class="group flex h-12 w-full cursor-pointer items-center gap-3 px-4 text-left transition-colors duration-(--duration-fast) hover:bg-quaternary"
        data-action="view-all-providers"
        onClick={() => props.onAdd()}
      >
        <BrandTile>
          <RemixIcon icon={PlusIcon} size={16} />
        </BrandTile>
        <span class="min-w-0 flex-1 truncate type-base text-secondary group-hover:text-primary">Add a provider</span>
        <span class="flex shrink-0 items-center gap-1.5 text-[var(--text-tertiary)]" aria-hidden="true">
          <For each={strip()}>{(p) => <ProviderIcon id={p.id} width="14" height="14" />}</For>
        </span>
      </button>
    </Group>
  )
}

function ProviderRow(props: { provider: CatalogProvider; onManage: (provider: CatalogProvider) => void }) {
  const info = () => savedOf(props.provider.id)
  let row!: HTMLDivElement
  createEffect(() => {
    if (flashed() !== props.provider.id) return
    row.classList.remove("kit-flash")
    void row.offsetWidth
    row.classList.add("kit-flash")
    setFlashed(null)
  })
  return (
    <div
      ref={row}
      class="flex min-h-12 items-center gap-3 px-4 py-2"
      data-provider={props.provider.id}
      data-connected="true"
      data-problem={info()?.problem}
      data-component="provider-detail"
    >
      <BrandTile>
        <ProviderIcon id={props.provider.id} width="16" height="16" />
      </BrandTile>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate type-base text-primary">{props.provider.name}</span>
        <span
          class={cn("truncate type-sm", info()?.problem ? "text-[var(--text-danger)]" : "text-[var(--text-tertiary)]")}
          data-part="provider-status"
        >
          {statusLine(info())}
        </span>
      </div>
      <Show
        when={info()?.problem}
        fallback={<span class="shrink-0 type-sm text-success max-[420px]:hidden">Connected</span>}
      >
        {(problem) => (
          <span class="shrink-0 type-sm text-[var(--text-danger)] max-[420px]:hidden">{PROBLEM_SHORT[problem()]}</span>
        )}
      </Show>
      <Button data-action="manage-provider" onClick={() => props.onManage(props.provider)}>
        {info()?.problem && FIX_LABEL[info()!.problem!] ? FIX_LABEL[info()!.problem!] : "Manage"}
      </Button>
    </div>
  )
}

type PickerRow = { provider: CatalogProvider; model: CatalogProvider["models"][number]; ref: string }

function PickerModels(props: { providers: readonly CatalogProvider[] }) {
  const [query, setQuery] = createSignal("")
  const [tab, setTab] = createSignal(ALL_PROVIDERS)
  const hidden = createMemo(() => new Set(hiddenModels()))
  const scoped = createMemo(() =>
    tab() === ALL_PROVIDERS ? props.providers : props.providers.filter((p) => p.id === tab()),
  )
  const tabs = createMemo(() => [
    { value: ALL_PROVIDERS, label: "All" },
    ...props.providers.map((p) => ({ value: p.id, label: p.name })),
  ])
  const all = createMemo<PickerRow[]>(() =>
    scoped().flatMap((provider) =>
      [...provider.models]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((model) => ({ provider, model, ref: modelRef(provider.id, model.id) })),
    ),
  )
  const rows = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    return all().filter((r) =>
      words.every((w) => `${r.provider.name} ${r.model.name} ${r.model.id}`.toLowerCase().includes(w)),
    )
  })
  const shownCount = () => rows().filter((r) => !hidden().has(r.ref)).length
  const many = () => scoped().length > 1
  return (
    <Group
      title="In your picker"
      description={
        <span>
          {shownCount()} of {rows().length} models show in the model picker
        </span>
      }
      data-component="model-list"
      bare
      action={
        <MenuV2 gutter={4} placement="bottom-end">
          <MenuV2.Trigger class={iconButtonClass} aria-label="Picker options" data-action="picker-options">
            <RemixIcon icon={MoreIcon} size={16} />
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Item
                disabled={shownCount() === rows().length}
                onSelect={() =>
                  setHidden(
                    rows().map((r) => r.ref),
                    false,
                  )
                }
              >
                Show all
              </MenuV2.Item>
              <MenuV2.Item
                disabled={shownCount() === 0}
                onSelect={() =>
                  setHidden(
                    rows().map((r) => r.ref),
                    true,
                  )
                }
              >
                Hide all
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      }
    >
      <div class="flex flex-col gap-2">
        <Show when={props.providers.length > 1}>
          <div class="max-w-full overflow-x-auto [scrollbar-width:none]" data-component="model-provider-tabs">
            <Segmented<string> label="Providers" value={tab()} options={tabs()} onChange={setTab} />
          </div>
        </Show>
        <Show when={all().length > SEARCH_FROM}>
          <SearchField
            placeholder="Search models"
            aria-label="Search models"
            value={query()}
            onValue={setQuery}
            data-component="model-search"
          />
        </Show>
        <Show
          when={rows().length}
          fallback={
            <div class="kit-card">
              <Empty>
                {query().trim() ? `No models match "${query().trim()}"` : "These providers have no chat models."}
              </Empty>
            </div>
          }
        >
          <VList
            class="kit-card"
            style={{ height: `${Math.min(rows().length * ROW, 552)}px` }}
            data={rows()}
            itemSize={ROW}
          >
            {(r) => <PickerModelRow row={r} hidden={hidden().has(r.ref)} showProvider={many()} />}
          </VList>
        </Show>
      </div>
    </Group>
  )
}

function PickerModelRow(props: { row: PickerRow; hidden: boolean; showProvider: boolean }): JSX.Element {
  const toggle = () => setHidden([props.row.ref], !props.hidden)
  const label = () => `Show ${props.row.model.name} in the model picker`
  return (
    <div
      class="flex h-[46px] cursor-pointer items-center gap-3 px-4 outline-none transition-colors duration-(--duration-fast) hover:bg-quaternary focus-visible:bg-quaternary"
      role="switch"
      tabIndex={0}
      aria-checked={!props.hidden}
      aria-label={label()}
      data-model={props.row.ref}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key !== "Enter" && e.key !== " ") return
        e.preventDefault()
        toggle()
      }}
    >
      <Show when={props.showProvider}>
        <ProviderIcon id={props.row.provider.id} width="14" height="14" class="shrink-0 text-[var(--text-tertiary)]" />
      </Show>
      <span
        class={cn("min-w-0 flex-1 truncate type-base", props.hidden ? "text-[var(--text-tertiary)]" : "text-primary")}
        title={props.row.model.id}
      >
        {props.row.model.name}
      </span>
      <Show when={props.row.model.reasoning}>
        <TooltipV2 placement="top" value="Reasoning">
          <span
            class="grid shrink-0 place-items-center text-[var(--text-quaternary)]"
            aria-label="Reasoning"
            role="img"
          >
            <RemixIcon icon={ReasoningIcon} size={16} />
          </span>
        </TooltipV2>
      </Show>
      <span class="w-10 shrink-0 text-right type-xs text-[var(--text-quaternary)]">
        {formatContext(props.row.model.contextWindow)}
      </span>
      <span onClick={(event) => event.stopPropagation()}>
        <Toggle label={label()} on={!props.hidden} onChange={(on) => setHidden([props.row.ref], !on)} />
      </span>
    </div>
  )
}

function ProviderSkeletons() {
  return <For each={[0, 1, 2, 3]}>{() => <Skeleton class="h-[54px] rounded-xl" />}</For>
}

function CheckAgain(props: { id: string }) {
  const [checking, setChecking] = createSignal(false)
  async function run() {
    setChecking(true)
    try {
      await checkProvider(props.id)
    } catch (e) {
      showToastV2({
        title: "Could not check the provider",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      })
    } finally {
      setChecking(false)
    }
  }
  return (
    <Button variant="ghost" data-action="check-again" busy={checking()} onClick={() => void run()}>
      {checking() ? "Checking" : "Check again"}
    </Button>
  )
}

function DisconnectButton(props: { id: string; onGone: () => void }) {
  const [removing, setRemoving] = createSignal(false)
  const [sure, setSure] = createSignal(false)
  async function remove() {
    setRemoving(true)
    try {
      await disconnectProvider(props.id)
      props.onGone()
    } catch (e) {
      showToastV2({
        title: "Could not disconnect",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      })
    } finally {
      setRemoving(false)
      setSure(false)
    }
  }
  return (
    <Button
      variant="danger"
      data-action="disconnect"
      busy={removing()}
      onBlur={() => setSure(false)}
      onClick={() => (sure() ? void remove() : setSure(true))}
    >
      {sure() ? "Disconnect for good" : "Disconnect"}
    </Button>
  )
}

export function AddProviderDialog(props: {
  open: boolean
  loading: boolean
  providers: readonly CatalogProvider[]
  onClose: () => void
  onPick: (provider: CatalogProvider) => void
}) {
  const [query, setQuery] = createSignal("")
  const [custom, setCustom] = createSignal(false)
  const shown = createMemo(() => {
    const q = query().trim().toLowerCase()
    return q
      ? props.providers.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      : props.providers
  })
  return (
    <Dialog
      open={props.open}
      onClose={() => {
        setQuery("")
        props.onClose()
      }}
      title="Add a provider"
      size="md"
      class="h-[min(560px,86dvh)]"
      bodyClass="flex flex-col gap-3 overflow-hidden px-3"
      data-component="provider-browser"
    >
      <form
        role="search"
        class="px-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault()
          const first = shown()[0]
          if (first) props.onPick(first)
        }}
      >
        <SearchField
          placeholder="Search providers"
          aria-label="Search providers"
          value={query()}
          ref={(el) => requestAnimationFrame(() => el.focus())}
          onValue={setQuery}
          data-component="provider-search"
        />
      </form>
      <ul class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" data-component="provider-list">
        <For
          each={shown()}
          fallback={
            <li class={cn("px-2 type-sm", muted)}>
              {props.loading ? <Skeleton class="h-8" /> : "No provider matches"}
            </li>
          }
        >
          {(provider) => (
            <li data-provider={provider.id}>
              <button
                type="button"
                class="flex h-12 w-full cursor-pointer items-center gap-3 rounded-base px-2 text-left outline-none transition-[background-color,transform] duration-(--duration-fast) ease-sharp hover:bg-quaternary focus-visible:bg-quaternary active:scale-(--press-scale)"
                data-action="connect"
                onClick={() => props.onPick(provider)}
              >
                <BrandTile>
                  <ProviderIcon id={provider.id} width="16" height="16" />
                </BrandTile>
                <span class="min-w-0 flex-1 truncate type-base text-primary">{provider.name}</span>
                <span class="shrink-0 type-xs text-[var(--text-quaternary)]">
                  {provider.models.length} {provider.models.length === 1 ? "model" : "models"}
                </span>
              </button>
            </li>
          )}
        </For>
        <li data-provider="custom">
          <button
            type="button"
            class="flex h-12 w-full cursor-pointer items-center gap-3 rounded-base px-2 text-left outline-none transition-[background-color,transform] duration-(--duration-fast) ease-sharp hover:bg-quaternary focus-visible:bg-quaternary active:scale-(--press-scale)"
            data-action="custom-provider"
            onClick={() => setCustom(true)}
          >
            <BrandTile>
              <RemixIcon icon={PlusIcon} size={16} />
            </BrandTile>
            <span class="min-w-0 flex-1 truncate type-base text-primary">Custom provider</span>
            <span class="shrink-0 type-xs text-[var(--text-quaternary)]">OpenAI or Anthropic compatible</span>
          </button>
        </li>
      </ul>
      <CustomProviderDialog
        open={custom()}
        onClose={() => setCustom(false)}
        onAdded={(name) => {
          setCustom(false)
          setQuery("")
          props.onClose()
          showToastV2({ title: `${name} connected`, variant: "success" })
        }}
      />
    </Dialog>
  )
}

function connectMethods(provider: CatalogProvider | null, only: "sign_in" | "api_key" | undefined): ConnectMethod[] {
  const saved = provider ? savedOf(provider.id) : undefined
  const offered = (provider?.connect ?? []).filter((m) => !only || (only === "api_key") === (m === "api_key"))
  const usable =
    provider && saved?.problem
      ? offered.filter((m) => (saved.kind === "oauth" ? m !== "api_key" : m === "api_key"))
      : offered
  return [...usable].sort((a, b) => Number(a === "api_key") - Number(b === "api_key"))
}

export function ConnectDialog(props: {
  provider: CatalogProvider | null
  only?: "sign_in" | "api_key"
  onClose: () => void
  onConnected?: (provider: CatalogProvider) => void
}) {
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  let input: HTMLInputElement | undefined

  const saved = () => (props.provider ? savedOf(props.provider.id) : undefined)
  const connected = (provider: CatalogProvider) => {
    props.onClose()
    props.onConnected?.(provider)
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const provider = props.provider
    if (!provider || !input) return
    const key = input.value.trim()
    if (!key) return
    setBusy(true)
    setError(null)
    try {
      await connectProvider(provider.id, key)
      input.value = ""
      connected(provider)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the key.")
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setError(null)
    props.onClose()
  }
  const methods = () => connectMethods(props.provider, props.only)
  const signIns = () => methods().filter((m) => m !== "api_key")
  const [signingIn, setSigningIn] = createSignal(false)
  const byKey = () => methods().includes("api_key") && !signingIn()
  const hint = () => {
    const info = saved()
    if (info) return statusLine(info)
    if (!byKey()) return "Sign in with your account."
    return signIns().length
      ? "Sign in with your plan, or paste a key. Either stays on your Kiko."
      : "Paste a key from your account. It stays on your Kiko."
  }

  return (
    <Dialog
      open={props.provider !== null}
      onClose={close}
      title={
        <span data-component="connect-title">
          {saved() ? props.provider?.name : `Connect ${props.provider?.name ?? ""}`}
        </span>
      }
      data-component="provider-connect"
      footer={
        <Show when={byKey() || saved()}>
          <Show when={saved() && props.provider}>
            {(provider) => (
              <span class="mr-auto flex items-center gap-2" data-component="provider-manage">
                <DisconnectButton id={provider().id} onGone={close} />
                <Show when={saved()?.problem}>
                  <CheckAgain id={provider().id} />
                </Show>
              </span>
            )}
          </Show>
          <Show when={byKey()}>
            <Button variant="ghost" data-action="cancel-connect" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="provider-key-form" variant="primary" busy={busy()} data-action="save-key">
              {saved() ? "Replace key" : "Connect"}
            </Button>
          </Show>
        </Show>
      }
    >
      <div class="flex flex-col gap-4">
        <Show when={props.provider}>
          {(provider) => (
            <ConnectHead icon={<ProviderIcon id={provider().id} width="20" height="20" />} hint={hint()} />
          )}
        </Show>
        <For each={signIns()}>
          {(method) => (
            <SignInMethod
              provider={props.provider!.id}
              name={props.provider!.name}
              method={method}
              label={props.provider!.signIn?.method === method ? props.provider!.signIn.label : undefined}
              onRunning={setSigningIn}
              onDone={() => connected(props.provider!)}
            />
          )}
        </For>
        <Show when={byKey()}>
          <Show when={signIns().length}>
            <OrDivider>or use an API key</OrDivider>
          </Show>
          <form id="provider-key-form" class="flex flex-col gap-2" onSubmit={submit} data-method="api_key">
            <SecretInput
              id="provider-key"
              label="API key"
              name="kiko-provider-secret"
              ref={(el) => (input = el)}
              autofocus
              error={error()}
              data-component="provider-key"
            />
            <Show when={props.provider && KEY_PAGE[props.provider.id]}>{(href) => <KeyLink href={href()} />}</Show>
            <Show when={props.provider && isJudgeOnly(props.provider)}>
              <Hint>{JUDGE_NOTE}</Hint>
            </Show>
          </form>
        </Show>
      </div>
    </Dialog>
  )
}

const signInLabel = (label: string) => (/^sign in\b/i.test(label) ? label : `Sign in with ${label}`)

function SignInMethod(props: {
  provider: string
  name: string
  method: ConnectMethod
  label?: string | undefined
  onRunning: (running: boolean) => void
  onDone: () => void
}) {
  const [state, setState] = createSignal<SignIn | null>(null)
  let handle: SignInHandle | undefined
  let input: HTMLInputElement | undefined
  onCleanup(() => handle?.cancel())

  function start() {
    handle?.cancel()
    handle = startSignIn(props.provider, (next) => {
      setState(next)
      if (next.status === "done") props.onDone()
    })
  }

  function answer(event: SubmitEvent) {
    event.preventDefault()
    const prompt = state()?.prompt
    if (!prompt || !input) return
    const value = input.value
    input.value = ""
    handle?.answer(prompt.promptId, value)
  }

  const running = () => state()?.status === "running"
  createEffect(() => props.onRunning(running()))
  onCleanup(() => props.onRunning(false))

  return (
    <div class="flex flex-col gap-2" data-method={props.method} data-sign-in={state()?.status ?? "idle"}>
      <Show
        when={running()}
        fallback={
          <Button size="xl" class="w-full" data-action="sign-in" onClick={start}>
            {state()?.status === "error" ? "Try signing in again" : signInLabel(props.label ?? props.name)}
          </Button>
        }
      >
        <div class="flex items-center justify-between gap-2">
          <span class="type-base text-primary">{props.label ?? METHOD_LABEL[props.method]}</span>
          <Button
            variant="ghost"
            data-action="cancel-sign-in"
            onClick={() => {
              handle?.cancel()
              setState(null)
            }}
          >
            Cancel
          </Button>
        </div>
      </Show>
      <Show when={running() ? state() : null}>
        {(s) => (
          <>
            <Show when={!s().code && !s().link && !s().prompt}>
              <div class={cn("flex items-center gap-2 text-xs", muted)} data-component="sign-in-waiting" role="status">
                <Spinner size={12} />
                Waiting for the provider
              </div>
            </Show>
            <Show when={s().code}>
              {(code) => (
                <div class="flex flex-col gap-1" data-component="device-code">
                  <span class={cn("text-xs", muted)}>Enter this code at the provider</span>
                  <span class="select-all font-mono text-lg tracking-widest text-primary">{code().userCode}</span>
                  <a
                    href={code().verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="truncate text-xs text-[var(--text-accent)]"
                  >
                    Open {code().verificationUri.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
            </Show>
            <Show when={s().link}>
              {(link) => (
                <div class="flex flex-col gap-1" data-component="sign-in-link">
                  <Show when={link().instructions}>
                    <span class={cn("text-xs", muted)}>{link().instructions}</span>
                  </Show>
                  <a
                    href={link().url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="link-grow text-sm text-[var(--text-accent)]"
                  >
                    Open the sign-in page
                  </a>
                </div>
              )}
            </Show>
            <Show when={s().note}>
              <p class={cn("text-xs", muted)} data-component="sign-in-note">
                {s().note}
              </p>
            </Show>
            <Show when={s().prompt}>
              {(p) => {
                const prompt = p().prompt
                return prompt.type === "select" ? (
                  <div class="flex flex-col gap-1.5" data-component="sign-in-select">
                    <span class={cn("text-xs", muted)}>{prompt.message}</span>
                    <For each={prompt.options}>
                      {(option) => (
                        <Button class="w-full justify-start" onClick={() => handle?.answer(p().promptId, option.id)}>
                          {option.label}
                        </Button>
                      )}
                    </For>
                  </div>
                ) : (
                  <form class="flex flex-col gap-2.5" onSubmit={answer} data-component="sign-in-prompt">
                    <label class={cn("text-xs", muted)} for="sign-in-answer">
                      {prompt.message}
                    </label>
                    <input
                      id="sign-in-answer"
                      ref={input}
                      type={prompt.type === "secret" ? "password" : "text"}
                      placeholder={prompt.placeholder}
                      autocomplete="off"
                      autocapitalize="off"
                      spellcheck={false}
                      autofocus
                      class={cn(fieldClass, "w-full")}
                    />
                    <div class="flex justify-end">
                      <Button type="submit" variant="primary" data-action="answer-sign-in">
                        Continue
                      </Button>
                    </div>
                  </form>
                )
              }}
            </Show>
          </>
        )}
      </Show>
      <Show when={state()?.status === "error" ? state()?.error : null}>
        {(error) => <Notice data-component="sign-in-error">{error()}</Notice>}
      </Show>
    </div>
  )
}
