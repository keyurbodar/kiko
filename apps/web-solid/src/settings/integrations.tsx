import type { ComposioResult, ComposioStatus, KernelResult, KernelStatus } from "@kiko/protocol"
import { Show, createSignal, lazy, onCleanup, onMount } from "solid-js"
import { cn } from "../lib/cn"
import { Button, Notice, fieldClass } from "./kit"
import { createComposioClient, createKernelClient, type ComposioClient, type KernelClient } from "./integrations-client"
import { SECRET_FIELD } from "../lib/secret-field"
import { onChanged } from "../sync/changed"

const COMPOSIO_PLATFORM = "https://platform.composio.dev"
const LiveBrowser = lazy(() => import("./live-browser"))

const KERNEL_HOME = "https://dashboard.onkernel.com"

function GridIcon() {
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
      <path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" />
    </svg>
  )
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
  onKey: (key: string) => void
  [data: `data-${string}`]: string | undefined
}) {
  let input: HTMLInputElement | undefined
  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!input) return
    const key = input.value.trim()
    input.value = ""
    if (key) props.onKey(key)
  }
  return (
    <form class="flex gap-2" onSubmit={submit}>
      <label class="sr-only" for={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        ref={input}
        {...SECRET_FIELD}
        name={`kiko-${props.id}-secret`}
        placeholder={props.placeholder}
        class={cn(fieldClass, "flex-1")}
        data-component={props.id}
      />
      <Button type="submit" variant="primary" busy={props.busy} data-action={props["data-action"]}>
        {props.submit}
      </Button>
    </form>
  )
}

export function useIntegrations(props: { client?: ComposioClient; kernel?: KernelClient } = {}) {
  const [status, setStatus] = createSignal<ComposioStatus | null>(null)
  const [error, setError] = createSignal<{ where: Where; text: string } | null>(null)
  const [busy, setBusy] = createSignal(false)
  const errorAt = (where: Where) => (error()?.where === where ? error()?.text : undefined)
  const [kernel, setKernel] = createSignal<KernelStatus | null>(null)
  let client: ComposioClient | undefined
  let kernelClient: KernelClient | undefined
  let closed = false

  function applyKernel(result: KernelResult) {
    if (!result.ok) return setError({ where: "kernel", text: result.error })
    setError(null)
    setKernel(result.status)
  }

  function apply(result: ComposioResult) {
    if (!result.ok) return setError({ where: "app", text: result.error })
    setError(null)
    setStatus(result.status)
  }

  onMount(() => {
    client = props.client ?? createComposioClient()
    client.onPush(apply)
    kernelClient = props.kernel ?? createKernelClient()
    kernelClient.onPush(applyKernel)
    const refresh = () => {
      void client?.request({ t: "composioStatus" }).then((r) => !closed && apply(r))
      void kernelClient?.request({ t: "kernelStatus" }).then((r) => !closed && applyKernel(r))
    }
    refresh()
    const stop = onChanged("memory", refresh)
    onCleanup(stop)
  })
  onCleanup(() => {
    closed = true
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
    icon: GridIcon,
  },
  kernel: {
    name: "Kernel browser",
    description: "Lets your agents use a real browser, in your own Kernel account.",
    home: KERNEL_HOME,
    placeholder: "sk_...",
    icon: GlobeIcon,
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
          <>
            <KeyField
              id={`${props.id}-key`}
              label={`${app().name} API key`}
              placeholder={app().placeholder}
              submit="Connect"
              busy={props.api.busy()}
              data-action={`${props.id}-connect`}
              onKey={props.id === "composio" ? props.api.connectComposio : props.api.connectKernel}
            />
            <a
              class="text-sm text-muted-foreground underline hover:text-foreground"
              href={app().home}
              target="_blank"
              rel="noreferrer"
            >
              Get a key at {app().home.replace(/^https:\/\//, "")}
            </a>
          </>
        }
      >
        <div class="flex items-center justify-between gap-3">
          <span class="text-md text-success">Connected</span>
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
      <Show when={props.api.errorAt(where())}>{(text) => <Notice>{text()}</Notice>}</Show>
    </div>
  )
}
