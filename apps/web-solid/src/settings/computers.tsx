import { Segmented } from "@kiko/ui/v2/segmented"
import type { ComputerSummary } from "@kiko/protocol"
import { EditIcon, MonitorIcon, PlusIcon } from "@kiko/ui/icons"
import { CopyCheckIcon } from "@kiko/ui/v2/copy-check-icon"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import {
  computers,
  removeComputer,
  renameComputer,
  requestPairCode,
  startComputers,
  type PairCode,
} from "../chat/computers"
import { Button, fieldClass, Group, IconButton, Item, Notice } from "./kit"
import { clearPairing, readPairing, savePairing } from "./pairing"

const OS: Record<ComputerSummary["os"], string> = { macos: "macOS", linux: "Linux", windows: "Windows" }

type Shell = "unix" | "windows"

const REMOVE_CONFIRM_MS = 4_000

const COPIED_MS = 1_200

const SHINE = { "--run-text": "var(--fg3)", "--visible-animation-state": "running" }

function command(shell: Shell, url: string): string {
  const origin = new URL(url).origin
  return shell === "unix"
    ? `curl -fsSL ${origin}/pc/install.sh | sh -s -- '${url}'`
    : `& ([scriptblock]::Create((irm ${origin}/pc/install.ps1))) '${url}'`
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function meta(computer: ComputerSummary): string {
  const parts = [OS[computer.os], computer.online ? "Online" : "Offline"]
  if (computer.holder === "human") parts.push("You have control")
  else if (computer.agent) parts.push("Waiting for you")
  return parts.join(", ")
}

function Pairing(props: { pair: PairCode; onNew: () => void; onClose: () => void }): JSX.Element {
  const [shell, setShell] = createSignal<Shell>("unix")
  const [now, setNow] = createSignal(Date.now())
  const [copied, setCopied] = createSignal(false)
  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))
  const left = () => props.pair.expiresAt - now()
  const text = () => command(shell(), props.pair.url)
  const copy = async () => {
    await navigator.clipboard.writeText(text())
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
  }
  return (
    <div class="flex flex-col gap-3 px-4 py-3.5" data-component="computer-pairing">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="type-ui font-medium text-fg">Run this on the computer you want to add</span>
        <Segmented<Shell>
          label="Operating system"
          value={shell()}
          options={[
            { value: "unix", label: "macOS / Linux" },
            { value: "windows", label: "Windows" },
          ]}
          onChange={setShell}
        />
      </div>
      <Show
        when={left() > 0}
        fallback={
          <div class="flex items-center justify-between gap-3">
            <Notice tone="muted">This code expired.</Notice>
            <Button onClick={props.onNew} data-action="computer-new-code">
              New code
            </Button>
          </div>
        }
      >
        <div class="relative">
          <pre
            class="overflow-x-auto rounded-tile bg-[color-mix(in_oklab,var(--fg)_6%,transparent)] py-3 pr-24 pl-3 font-mono text-hint leading-relaxed whitespace-pre-wrap break-all text-fg"
            data-field="computer-command"
          >
            {text()}
          </pre>
          <button
            type="button"
            aria-label={copied() ? "Copied" : "Copy the command"}
            class="absolute top-2 right-2 flex h-7 cursor-pointer items-center gap-1.5 rounded-control px-2 type-label text-fg2 transition-[background-color,color,transform] duration-(--dur-hover) ease-kiko hover:bg-hover hover:text-fg active:scale-[0.96]"
            data-action="computer-copy"
            data-copied={copied() ? "" : undefined}
            onClick={() => void copy()}
          >
            <CopyCheckIcon copied={copied()} size={14} class={cn(copied() && "text-ok")} />
            <Show when={copied()}>
              <span>Copied</span>
            </Show>
          </button>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="flex min-w-0 flex-col gap-0.5" role="status" data-field="computer-waiting">
            <span class="motion-shine w-fit type-ui text-fg3" style={SHINE}>
              Waiting for your computer
            </span>
            <span class="type-hint text-fg4">
              The code works once and expires in <span class="tabular-nums">{clock(left())}</span>
            </span>
          </span>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
        </div>
      </Show>
    </div>
  )
}

function Row(props: { computer: ComputerSummary; onError: (message: string | null) => void }): JSX.Element {
  const [editing, setEditing] = createSignal(false)
  const [confirming, setConfirming] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let input: HTMLInputElement | undefined
  onCleanup(() => clearTimeout(timer))

  const rename = async (event: SubmitEvent) => {
    event.preventDefault()
    const name = input?.value.trim() ?? ""
    setEditing(false)
    if (!name || name === props.computer.name) return
    const result = await renameComputer(props.computer.id, name)
    props.onError(result.ok ? null : result.error)
  }

  const remove = async () => {
    if (!confirming()) {
      setConfirming(true)
      timer = setTimeout(() => setConfirming(false), REMOVE_CONFIRM_MS)
      return
    }
    clearTimeout(timer)
    setBusy(true)
    const result = await removeComputer(props.computer.id)
    setBusy(false)
    setConfirming(false)
    props.onError(result.ok ? null : result.error)
  }

  return (
    <Item
      icon={<RemixIcon icon={MonitorIcon} size={14} />}
      data-component="computer-row"
      data-computer={props.computer.id}
      title={
        <Show
          when={editing()}
          fallback={
            <>
              <span
                class={cn(
                  "size-1.5 shrink-0 rounded-full",
                  props.computer.online ? "bg-ok" : "bg-[color-mix(in_oklab,var(--fg)_30%,transparent)]",
                )}
                role="img"
                aria-label={props.computer.online ? "Online" : "Offline"}
                data-field="online"
              />
              <span class="truncate" data-field="name">
                {props.computer.name}
              </span>
            </>
          }
        >
          <form class="flex" onSubmit={(event) => void rename(event)}>
            <input
              ref={(el) => {
                input = el
                queueMicrotask(() => el.select())
              }}
              class={cn(fieldClass, "h-7 w-48")}
              value={props.computer.name}
              maxLength={64}
              aria-label="Computer name"
              onBlur={() => setEditing(false)}
              onKeyDown={(event) => event.key === "Escape" && setEditing(false)}
            />
          </form>
        </Show>
      }
      meta={<span data-field="meta">{meta(props.computer)}</span>}
      actions={
        <>
          <IconButton label="Rename" data-action="computer-rename" onClick={() => setEditing(true)}>
            <RemixIcon icon={EditIcon} size={14} />
          </IconButton>
          <Button variant="danger" busy={busy()} data-action="computer-remove" onClick={() => void remove()}>
            {confirming() ? "Remove it" : "Remove"}
          </Button>
        </>
      }
    />
  )
}

export default function Computers(): JSX.Element {
  startComputers()
  const ids = () => computers().map((computer) => computer.id)
  const [pair, setPair] = createSignal<PairCode | null>(readPairing(ids()))
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const add = async () => {
    setBusy(true)
    setError(null)
    const code = await requestPairCode()
    setBusy(false)
    if (!code) return setError("Kiko did not answer. Try again.")
    savePairing(code, ids())
    setPair(code)
  }

  const close = () => {
    clearPairing()
    setPair(null)
  }

  createEffect(
    on(ids, (now) => {
      if (pair() && !readPairing(now)) setPair(null)
    }),
  )

  const adding = () => (
    <Button busy={busy()} disabled={pair() !== null} data-action="computer-add" onClick={() => void add()}>
      <RemixIcon icon={PlusIcon} size={14} />
      Add a computer
    </Button>
  )

  return (
    <div class="flex flex-col gap-4" data-component="computers">
      <Group title="Your computers" action={computers().length > 0 ? adding() : undefined}>
        <Show when={pair()}>{(code) => <Pairing pair={code()} onNew={() => void add()} onClose={close} />}</Show>
        <For
          each={computers()}
          fallback={
            <Show when={!pair()}>
              <div class="flex flex-col items-center gap-1 px-6 py-10 text-center" data-component="computers-empty">
                <span class="mb-3 grid size-12 place-items-center rounded-tile bg-active text-fg2">
                  <RemixIcon icon={MonitorIcon} size={24} />
                </span>
                <span class="type-row text-fg">No computers yet</span>
                <span class="max-w-sm type-label text-fg3">
                  Add your Mac, PC or a server. Your agents can run commands there, and you can watch and take over.
                </span>
                <Button
                  variant="primary"
                  class="mt-4"
                  busy={busy()}
                  data-action="computer-add"
                  onClick={() => void add()}
                >
                  Add a computer
                </Button>
              </div>
            </Show>
          }
        >
          {(computer) => <Row computer={computer} onError={setError} />}
        </For>
      </Group>
      <Show when={error()}>{(message) => <Notice>{message()}</Notice>}</Show>
    </div>
  )
}
