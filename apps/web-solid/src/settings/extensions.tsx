import { describeManifest, type ExtensionBundle, type ExtensionCatalogEntry, type ExtensionInfo, type ExtensionOp, type ExtensionProposal, type ExtensionResult, type ReviewLine } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useApp } from "../lib/store"
import { lineDiff } from "./line-diff"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ExtensionsIcon } from "@kiko/ui/icons"
import { cn } from "../lib/cn"
import { Button, DetailsButton, Empty, fieldClass, Group, Hint, Item, line, Notice, Pill, Toggle } from "./kit"

/*
 * Settings, extensions (architecture section 24). Three lists, in the order the human needs them:
 * installs waiting for review, what is installed, and the catalog. Every change is optimistic: the
 * user store lays it over the server's lists at once and rolls it back when the server says no.
 *
 * The review is the manifest's powers in plain lines, worst first, then the code. An update shows
 * what changed against the installed version. Nothing installs without the human pressing install.
 */

const app = useApp

async function send(op: ExtensionOp): Promise<ExtensionResult> {
  const store = app.user()
  if (!store) return { ok: false, error: "Still connecting." }
  return store.extensionOp(op)
}

/** One catalog read per page load; the catalog only changes with a deploy. */
let catalogCache: Promise<readonly ExtensionCatalogEntry[]> | null = null
const loadCatalog = () => {
  catalogCache ??= send({ op: "catalog" }).then((r) => {
    if (!r.ok) {
      catalogCache = null
      throw new Error(r.error)
    }
    return r.catalog ?? []
  })
  return catalogCache
}

/** The card of a list, as the kit's `Group` draws it, for lists that must be a `ul`. */
const card = cn("overflow-hidden rounded-xl border bg-[color-mix(in_oklab,var(--text)_3%,transparent)]", line)
const divided = "[&>*+*]:border-t [&>*+*]:border-[color-mix(in_oklab,var(--text)_6%,transparent)]"
/** The icon tile of a kit `Item`, for a row whose header is one button. */
const tile = "grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-[color-mix(in_oklab,var(--text)_5%,transparent)] text-muted ring-1 ring-inset ring-[color-mix(in_oklab,var(--text)_6%,transparent)]"
const focus = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"

const LEVEL_ORDER: Record<ReviewLine["level"], number> = { warning: 0, notice: 1, info: 2 }

export default function ExtensionsPage() {
  const navigate = useNavigate()
  const [error, setError] = createSignal<string | null>(null)
  const extensions = () => app.user()?.extensions() ?? []
  const proposals = () => app.user()?.proposals() ?? []
  const [catalog] = createResource(loadCatalog)
  const installedNames = createMemo(() => new Set(extensions().map((x) => x.name)))
  const waitingNames = createMemo(() => new Set(proposals().map((p) => p.name)))

  async function run(op: ExtensionOp) {
    setError(null)
    const out = await send(op)
    if (!out.ok) setError(`${out.error}${out.problems?.length ? `: ${out.problems.join("; ")}` : ""}`)
    return out
  }

  function askKiko() {
    const kiko = app.kikoChatId()
    if (!kiko) return
    app.drafts()?.save(kiko, { text: "Build me an extension that " })
    navigate(`/chat/${kiko}`)
  }

  return (
    <div class="flex flex-col gap-8" data-component="extensions-page">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-3" data-component="extensions-intro">
        <Button data-action="ask-kiko" onClick={askKiko}>
          Build one with Kiko
        </Button>
      </div>

      <Show when={error()}>
        <Notice data-component="extensions-error">{error()!}</Notice>
      </Show>

      <Show when={proposals().length}>
        <div data-component="extension-proposals">
          <Group title="Waiting for you">
            <For each={proposals()}>{(p) => <ProposalCard proposal={p} installed={extensions().find((x) => x.name === p.name)} run={run} />}</For>
          </Group>
        </div>
      </Show>

      <div data-component="extensions-installed">
        <Group title="Installed" bare>
          <Show
            when={extensions().length}
            fallback={<Hint data-component="extensions-empty">No extensions installed.</Hint>}
          >
            <ul class={cn(card, divided)}>
              <For each={extensions()}>{(x) => <InstalledRow extension={x} run={run} />}</For>
            </ul>
          </Show>
        </Group>
      </div>

      <div data-component="extension-catalog">
        <Group title="Catalog" bare>
          <Show
            when={!catalog.error}
            fallback={<Hint>The catalog did not load. Reload to try again.</Hint>}
          >
            <Show when={(catalog() ?? []).length} fallback={<Hint>{catalog.loading ? "Loading the catalog" : "The catalog is empty"}</Hint>}>
            <ul class={cn(card, divided)}>
              <For each={catalog() ?? []}>
                {(entry) => <CatalogCard entry={entry} installed={installedNames().has(entry.name)} waiting={waitingNames().has(entry.name)} run={run} />}
              </For>
            </ul>
            </Show>
          </Show>
        </Group>
      </div>
    </div>
  )
}

type Run = (op: ExtensionOp) => Promise<ExtensionResult>

/** An install that waits: who asked, what it can do, the code, and install or decline. */
function ProposalCard(props: { proposal: ExtensionProposal; installed?: ExtensionInfo; run: Run }) {
  const p = () => props.proposal
  const m = () => p().bundle.manifest
  const [code, setCode] = createSignal(false)
  const [before] = createResource(
    () => (code() && props.installed ? props.installed.name : null),
    async (name) => {
      const out = await send({ op: "source", name })
      return out.ok ? (out.bundle ?? null) : null
    },
  )
  const from = () => (p().source === "catalog" ? "from the catalog" : p().by ? `written by @${p().by}` : "from your files")
  return (
    <article data-extension-proposal={p().name}>
      <Item
        icon={<span class="text-[13px] font-semibold text-text">{p().name.slice(0, 1)}</span>}
        title={p().name}
        meta={`${props.installed ? `${props.installed.version} → ${p().version}` : p().version} · ${from()}`}
      >
        <div class="flex flex-col gap-3 pl-10">
          <p class="text-xs leading-relaxed text-muted">{m().description}</p>
          <Show when={p().tainted}>
            <Notice tone="danger" data-component="proposal-tainted">
              Written after the agent read outside content, like a web page. Read the code before you install it.
            </Notice>
          </Show>
          <Review lines={describeManifest(m())} />
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="primary" data-action="install-extension" onClick={() => void props.run({ op: "install", id: p().id })}>
              {props.installed ? "Update" : "Install"}
            </Button>
            <Button variant="ghost" data-action="decline-extension" onClick={() => void props.run({ op: "decline", id: p().id })}>
              Decline
            </Button>
            <Show when={Object.keys(p().bundle.files).length}>
              <Button variant="ghost" class="ml-auto" aria-expanded={code()} data-action="show-code" onClick={() => setCode(!code())}>
                {code() ? "Hide code" : props.installed ? "What changed" : "Read the code"}
              </Button>
            </Show>
          </div>
          <Show when={code()}>
            <CodeView bundle={p().bundle} before={props.installed ? (before() ?? undefined) : undefined} />
          </Show>
        </div>
      </Item>
    </article>
  )
}

/** The powers, riskiest first. A warning is red, a notice plain, an info faint. */
function Review(props: { lines: ReviewLine[] }) {
  const sorted = () => [...props.lines].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  return (
    <ul class={cn("flex flex-col gap-1.5 rounded-lg border px-3 py-2.5", line)} data-component="extension-review">
      <For each={sorted()}>
        {(entry) => (
          <li class="flex items-start gap-2 text-xs leading-relaxed" data-level={entry.level}>
            <span
              class={`mt-[7px] size-1.5 shrink-0 rounded-full ${entry.level === "warning" ? "bg-[var(--danger)]" : entry.level === "notice" ? "bg-[var(--accent)]" : "bg-[var(--text-faint)]"}`}
              aria-hidden="true"
            />
            <span class={entry.level === "warning" ? "text-text" : "text-muted"}>{entry.text}</span>
          </li>
        )}
      </For>
    </ul>
  )
}

/** One installed extension: the switch, and on open its powers, agents, secrets, code, and remove. */
function InstalledRow(props: { extension: ExtensionInfo; run: Run }) {
  const x = () => props.extension
  const [open, setOpen] = createSignal(false)
  const [code, setCode] = createSignal(false)
  const [confirm, setConfirm] = createSignal(false)
  const [source] = createResource(
    () => (code() ? `${x().name}@${x().hash}` : null),
    async () => {
      const out = await send({ op: "source", name: x().name })
      return out.ok ? (out.bundle ?? null) : null
    },
  )
  const missing = () => x().secrets.filter((s) => !s.set).length
  const tools = () => Object.keys(x().manifest.tools ?? {})
  return (
    <li class="flex flex-col" data-extension={x().name} data-enabled={x().enabled}>
      <div class="flex min-h-14 items-center gap-3 px-4 py-2.5">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <span class={cn(tile, "text-[13px] font-semibold text-text")} aria-hidden="true">
            {x().name.slice(0, 1)}
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5 text-[13px] font-medium text-text">
              <span class="truncate">{x().name}</span>
              <span class="shrink-0 text-xs font-normal text-muted">{x().version}</span>
              <Show when={x().error}>
                <span class="size-1.5 shrink-0 rounded-full bg-[var(--danger)]" aria-hidden="true" />
                <Pill tone="danger" data-component="extension-has-error">
                  Error
                </Pill>
              </Show>
              <Show when={missing()}>
                <Pill tone="accent" data-component="extension-needs-secret">
                  Needs {missing() === 1 ? "a secret" : `${missing()} secrets`}
                </Pill>
              </Show>
            </span>
            <span class="mt-0.5 block truncate text-xs text-muted">{x().description}</span>
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <Toggle
            label={`Enable ${x().name}`}
            on={x().enabled}
            data-action="toggle-extension"
            onChange={(on) => void props.run({ op: "enable", name: x().name, enabled: on })}
          />
          <DetailsButton open={open()} onToggle={() => setOpen(!open())} data-action="open-extension" />
        </div>
      </div>
      <Show when={open()}>
        <div class="flex flex-col gap-4 px-4 pb-4 pl-14" data-component="extension-detail">
          <Show when={x().error}>
            <p class="font-mono text-xs leading-relaxed break-words text-[var(--danger)]">{x().error}</p>
          </Show>
          <Review lines={describeManifest(x().manifest)} />
          <Show when={tools().length}>
            <p class="text-xs text-muted">
              Tools: <span class="font-mono text-text">{tools().join(", ")}</span>
            </p>
          </Show>
          <AgentScope extension={x()} run={props.run} />
          <Show when={x().secrets.length}>
            <div class="flex flex-col gap-2" data-component="extension-secrets">
              <span class="text-xs text-muted">Secrets are sealed on the server. The extension's code never sees them.</span>
              <For each={x().secrets}>{(s) => <SecretField extension={x()} name={s.name} set={s.set} run={props.run} />}</For>
            </div>
          </Show>
          <p class="text-xs text-muted">
            {x().source === "catalog" ? "From the catalog" : x().by ? `Written by @${x().by}` : "From your files"} · updated {new Date(x().updatedAt).toLocaleDateString()}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <Show when={Object.keys(x().manifest.tools ?? {}).length || x().manifest.hooks?.length || Object.values(x().manifest.sections ?? {}).some((s) => s.text === undefined)}>
              <Button variant="ghost" aria-expanded={code()} data-action="show-code" onClick={() => setCode(!code())}>
                {code() ? "Hide code" : "Read the code"}
              </Button>
            </Show>
            <Show
              when={confirm()}
              fallback={
                <Button variant="danger" class="ml-auto" data-action="uninstall-extension" onClick={() => setConfirm(true)}>
                  Remove
                </Button>
              }
            >
              <span class="ml-auto text-xs text-muted">Remove it and its notes?</span>
              <Button variant="danger" data-action="confirm-uninstall" onClick={() => void props.run({ op: "uninstall", name: x().name })}>
                Remove
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Keep
              </Button>
            </Show>
          </div>
          <Show when={code()}>
            <Show when={source()} fallback={<p class="text-xs text-muted">{source.loading ? "Loading the code" : "The code did not load"}</p>}>
              {(b) => <CodeView bundle={b()} />}
            </Show>
          </Show>
        </div>
      </Show>
    </li>
  )
}

/** Every agent, or only the ones picked. A tap on a chip picks or unpicks it. */
function AgentScope(props: { extension: ExtensionInfo; run: Run }) {
  const agents = () => app.agents()
  const scope = () => props.extension.agents
  const set = (next: readonly string[] | null) => void props.run({ op: "agents", name: props.extension.name, agents: next as never })
  const toggle = (slug: string) => {
    const now = scope() ?? []
    const next = now.includes(slug as never) ? now.filter((s) => s !== slug) : [...now, slug]
    set(next.length ? next : null)
  }
  return (
    <div class="flex flex-col gap-2" data-component="extension-agents">
      <span class="text-xs text-muted">Used by</span>
      <div class="flex flex-wrap gap-1.5">
        <Chip on={scope() === null} onClick={() => set(null)} label="Every agent" />
        <Chip on={scope()?.includes("kiko" as never) ?? false} onClick={() => toggle("kiko")} label="@kiko" />
        <For each={agents()}>{(a) => <Chip on={scope()?.includes(a.slug) ?? false} onClick={() => toggle(a.slug)} label={`@${a.slug}`} />}</For>
      </div>
    </div>
  )
}

function Chip(props: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      class={cn(
        "h-7 rounded-md border px-2.5 text-xs text-muted hover:text-text aria-pressed:bg-[var(--selected-bg)] aria-pressed:text-text",
        line,
        focus,
      )}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

/*
 * The value lives in the field and in the one frame. The field is cleared before the frame leaves,
 * so a secret never outlives the click.
 */
function SecretField(props: { extension: ExtensionInfo; name: string; set: boolean; run: Run }) {
  const [editing, setEditing] = createSignal(!props.set)
  let input: HTMLInputElement | undefined
  const hint = () => props.extension.manifest.secrets?.[props.name]?.description
  const hosts = () => props.extension.manifest.secrets?.[props.name]?.hosts.join(", ")
  async function save(event: SubmitEvent) {
    event.preventDefault()
    const value = input?.value.trim() ?? ""
    if (input) input.value = ""
    if (!value) return
    const out = await props.run({ op: "secret", name: props.extension.name, secret: props.name, value })
    if (out.ok) setEditing(false)
  }
  return (
    <div class={cn("flex flex-col gap-1.5 rounded-lg border px-3 py-2.5", line)} data-secret={props.name} data-set={props.set}>
      <div class="flex min-h-7 items-center gap-2">
        <span class="font-mono text-xs text-text">{props.name}</span>
        <span class="min-w-0 flex-1 truncate text-xs text-muted">Sent only to {hosts()}</span>
        <Show when={props.set && !editing()}>
          <Pill tone="accent">Set</Pill>
          <Button variant="ghost" data-action="replace-secret" onClick={() => setEditing(true)}>
            Replace
          </Button>
          <Button variant="ghost" data-action="clear-secret" onClick={() => void props.run({ op: "secret", name: props.extension.name, secret: props.name, value: null })}>
            Clear
          </Button>
        </Show>
      </div>
      <Show when={hint()}>
        <span class="text-xs text-muted">{hint()}</span>
      </Show>
      <Show when={editing()}>
        <form class="flex gap-2 pt-0.5" onSubmit={save}>
          <input
            ref={input}
            type="password"
            name={`kiko-extension-secret-${props.name}`}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            aria-label={`Value of ${props.name}`}
            class={cn(fieldClass, "flex-1")}
            data-component="secret-input"
          />
          <Button type="submit" variant="primary" data-action="save-secret">
            Save
          </Button>
        </form>
      </Show>
    </div>
  )
}

/** A catalog entry: what it is, a "details" button for its powers, and "add" to review it above. */
function CatalogCard(props: { entry: ExtensionCatalogEntry; installed: boolean; waiting: boolean; run: Run }) {
  const [open, setOpen] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  // Add puts it with the other installs that wait, so every install goes through the same review.
  async function add() {
    setBusy(true)
    await props.run({ op: "propose_catalog", name: props.entry.name })
    setBusy(false)
  }
  return (
    <li class="flex flex-col" data-catalog={props.entry.name}>
      <div class="flex items-center gap-4 py-3 pr-3 pl-4">
        <div class="min-w-0 flex-1">
          <span class="block text-[13px] font-medium text-text">{props.entry.name}</span>
          <span class="mt-0.5 block text-[12px] leading-relaxed text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{props.entry.description}</span>
        </div>
        <DetailsButton open={open()} onToggle={() => setOpen(!open())} data-action="catalog-details" />
        <Show when={!props.installed} fallback={<Pill data-component="catalog-installed">Installed</Pill>}>
          <Button disabled={busy() || props.waiting} data-action="add-from-catalog" onClick={() => void add()}>
            {props.waiting ? "Review above" : busy() ? "Adding" : "Add"}
          </Button>
        </Show>
      </div>
      <Show when={open()}>
        <div class="px-4 pb-3.5">
          <Review lines={describeManifest(props.entry.bundle.manifest)} />
        </div>
      </Show>
    </li>
  )
}

/** The bundle's files as tabs. With `before`, each file shows its changes against the installed version. */
function CodeView(props: { bundle: ExtensionBundle; before?: ExtensionBundle }) {
  const files = createMemo(() => {
    const manifest = `${JSON.stringify(props.bundle.manifest, null, 2)}\n`
    const now: Record<string, string> = { "extension.json": manifest, ...props.bundle.files }
    const was: Record<string, string> | null = props.before ? { "extension.json": `${JSON.stringify(props.before.manifest, null, 2)}\n`, ...props.before.files } : null
    const names = [...new Set([...Object.keys(now), ...Object.keys(was ?? {})])]
    return names.map((name) => ({ name, now: now[name], was: was ? was[name] : undefined, changed: was ? now[name] !== was[name] : false }))
  })
  const [active, setActive] = createSignal(0)
  const file = () => files()[Math.min(active(), files().length - 1)]
  return (
    <div class={cn("flex flex-col overflow-hidden rounded-lg border", line)} data-component="extension-code">
      <div class={cn("flex gap-1 overflow-x-auto border-b p-1 [scrollbar-width:none]", line)} role="tablist">
        <For each={files()}>
          {(f, i) => (
            <button
              type="button"
              role="tab"
              aria-selected={i() === active()}
              class={cn("h-7 shrink-0 rounded-md px-2 font-mono text-xs", focus, i() === active() ? "bg-[var(--selected-bg)] text-text" : "text-muted hover:text-text")}
              onClick={() => setActive(i())}
            >
              {f.name}
              <Show when={f.changed}>
                <span class="ml-1 text-[var(--accent)]">{f.was === undefined ? "New" : f.now === undefined ? "Gone" : "Changed"}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <pre class="max-h-[420px] overflow-auto p-3 font-mono text-xs leading-[1.55] text-muted" data-component="extension-code-body">
        <Show when={props.before && file()?.changed} fallback={<code>{file()?.now ?? ""}</code>}>
          <code>
            <For each={lineDiff(file()?.was ?? "", file()?.now ?? "")}>
              {(line) => (
                <span
                  class={`block ${line.kind === "add" ? "bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-text" : line.kind === "del" ? "bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] text-weak line-through" : ""}`}
                >
                  {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
                  {line.text}
                </span>
              )}
            </For>
          </code>
        </Show>
      </pre>
    </div>
  )
}

function PuzzleIcon() {
  return <HugeIcon icon={ExtensionsIcon} size={16} />
}
