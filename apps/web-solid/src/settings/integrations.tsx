import type { ComposioResult, ComposioStatus, KernelResult, KernelStatus } from "@kiko/protocol"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { Button, Notice } from "./kit"
import { KeyLink, SecretInput } from "./connect-parts"
import { createComposioClient, createKernelClient, type ComposioClient, type KernelClient } from "./integrations-client"
import LiveBrowser from "./live-browser"
import { createQuery, owner } from "../state/runtime"

const COMPOSIO_PLATFORM = "https://platform.composio.dev"

const KERNEL_HOME = "https://dashboard.onkernel.com"

function ComposioIcon() {
  return <ProviderIcon id="composio" />
}

function KernelIcon() {
  return <ProviderIcon id="kernel" />
}

function GlobeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.7 1.6 2.5 3.4 2.5 5.5S9.7 11.9 8 13.5M8 2.5C6.3 4.1 5.5 5.9 5.5 8s.8 3.9 2.5 5.5" />
    </svg>
  )
}

type Where = "app" | "kernel"
function KeyField(props: {
  id: string
  label: string
  placeholder: string
  submit: string
  busy: boolean
  home: string
  error: string | undefined
  onKey: (key: string) => void
  [data: `data-${string}`]: string | undefined
}) {
  let input: HTMLInputElement | undefined
  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!input) return
    const key = input.value.trim()
    if (key) props.onKey(key)
  }
  return (
    <form class="flex flex-col gap-3" onSubmit={submit}>
      <SecretInput
        id={props.id}
        label={props.label}
        placeholder={props.placeholder}
        ref={(el) => (input = el)}
        error={props.error}
        data-component={props.id}
      />
      <div class="flex items-center justify-between gap-3">
        <KeyLink href={props.home}>Get a key at {props.home.replace(/^https:\/\//, "")}</KeyLink>
        <Button type="submit" variant="primary" busy={props.busy} data-action={props["data-action"]}>
          {props.submit}
        </Button>
      </div>
    </form>
  )
}

export function useIntegrations(props: { client?: ComposioClient; kernel?: KernelClient } = {}) {
  const composioQuery = createQuery(() => owner.queries.composio({}))
  const kernelQuery = createQuery(() => owner.queries.kernel(undefined))
  const [pushedStatus, setPushedStatus] = createSignal<ComposioStatus | null>(null)
  const [pushedKernel, setPushedKernel] = createSignal<KernelStatus | null>(null)
  const [error, setError] = createSignal<{ where: Where; text: string } | null>(null)
  const [busy, setBusy] = createSignal(false)
  const errorAt = (where: Where) => (error()?.where === where ? error()?.text : undefined)
  const status = (): ComposioStatus | null => {
    const result = composioQuery()
    return pushedStatus() ?? (result?.ok ? result.status : null)
  }
  const kernel = (): KernelStatus | null => {
    const result = kernelQuery()
    return pushedKernel() ?? (result?.ok ? result.status : null)
  }
  let client: ComposioClient | undefined
  let kernelClient: KernelClient | undefined

  function applyKernel(result: KernelResult) {
    if (!result.ok) return setError({ where: "kernel", text: result.error })
    setError(null)
    setPushedKernel(result.status)
    kernelQuery.refetch()
  }

  function apply(result: ComposioResult) {
    if (!result.ok) return setError({ where: "app", text: result.error })
    setError(null)
    setPushedStatus(result.status)
    composioQuery.refetch()
  }

  onMount(() => {
    client = props.client ?? createComposioClient()
    client.onPush(apply)
    kernelClient = props.kernel ?? createKernelClient()
    kernelClient.onPush(applyKernel)
  })
  onCleanup(() => {
    if (!props.client) client?.close()
    if (!props.kernel) kernelClient?.close()
  })

  async function runKernel(ask: () => Promise<KernelResult | undefined>) {
    setBusy(true)
    setError(null)
    try {
      const result = await ask()
      if (result) applyKernel(result)
    } finally {
      setBusy(false)
    }
  }

  async function run(ask: () => Promise<ComposioResult | undefined>) {
    setBusy(true)
    setError(null)
    try {
      const result = await ask()
      if (result) apply(result)
    } finally {
      setBusy(false)
    }
  }

  return {
    status,
    kernel,
    busy,
    errorAt,
    connectComposio: (apiKey: string) => void run(async () => client?.request({ t: "connectComposio", apiKey })),
    disconnectComposio: () => void run(async () => client?.request({ t: "disconnectComposio" })),
    connectKernel: (apiKey: string) =>
      void runKernel(async () => kernelClient?.request({ t: "connectKernel", apiKey })),
    disconnectKernel: () => void runKernel(async () => kernelClient?.request({ t: "disconnectKernel" })),
  }
}

export type Integrations = ReturnType<typeof useIntegrations>

export const APPS = {
  composio: {
    name: "Composio",
    description: "Connect your apps through your own Composio account.",
    home: COMPOSIO_PLATFORM,
    placeholder: "ak_...",
    icon: ComposioIcon,
  },
  kernel: {
    name: "Kernel browser",
    description: "Lets your agents use a real browser, in your own Kernel account.",
    home: KERNEL_HOME,
    placeholder: "sk_...",
    icon: KernelIcon,
  },
} as const

export type AppId = keyof typeof APPS

export function appState(api: Integrations, id: AppId): "connected" | "broken" | "empty" {
  if (id === "composio") return api.status()?.connected ? "connected" : "empty"
  const k = api.kernel()
  return k?.broken ? "broken" : k?.connected ? "connected" : "empty"
}

export function AppDetail(props: { id: AppId; api: Integrations }) {
  const app = () => APPS[props.id]
  const state = () => appState(props.api, props.id)
  const where = () => (props.id === "composio" ? "app" : "kernel") as Where
  return (
    <div class="flex flex-col gap-3" data-component={props.id} data-state={state()}>
      <Show
        when={state() === "connected"}
        fallback={
          <KeyField
            id={`${props.id}-key`}
            label={`${app().name} API key`}
            placeholder={app().placeholder}
            submit="Connect"
            busy={props.api.busy()}
            home={app().home}
            error={props.api.errorAt(where())}
            data-action={`${props.id}-connect`}
            onKey={props.id === "composio" ? props.api.connectComposio : props.api.connectKernel}
          />
        }
      >
        <div class="flex items-center justify-between gap-3">
          <span class="type-base text-success">Connected</span>
          <Button
            variant="danger"
            data-action={`${props.id}-disconnect`}
            busy={props.api.busy()}
            onClick={props.id === "composio" ? props.api.disconnectComposio : props.api.disconnectKernel}
          >
            Disconnect
          </Button>
        </div>
        <Show when={props.id === "kernel"}>
          <LiveBrowser icon={<GlobeIcon />} />
        </Show>
      </Show>
      <Show when={state() === "connected" && props.api.errorAt(where())}>{(text) => <Notice>{text()}</Notice>}</Show>
    </div>
  )
}
