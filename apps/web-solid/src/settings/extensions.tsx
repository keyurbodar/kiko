import { describeManifest, type ExtensionBundle, type ExtensionCatalogEntry, type ExtensionInfo, type ExtensionOp, type ExtensionProposal, type ExtensionResult, type ReviewLine } from "@yuki/protocol"
import { useNavigate } from "@solidjs/router"
import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useApp } from "../lib/store"
import { lineDiff } from "./line-diff"
import { reviewChange, type ReviewChange } from "./review-diff"
import { cn } from "../lib/cn"
import { Button, DetailsButton, fieldClass, Group, Hint, Item, line, muted, Notice, Pill, Row, Toggle } from "./kit"

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

const focus = "outline-none"

/** Manifests and review lines are written in lower case; the interface starts each sentence with a capital. */
const sentence = (text: string) => text.replace(/(^|[.!?]\s+)([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase())

/** Where an extension came from, as its meta line says it. */
const origin = (x: { source: string; by?: string | null }) => (x.source === "catalog" ? "From the catalog" : x.by ? `Written by @${x.by}` : "From your files")

/** The first letter of the name, in the item's icon tile. */
const Initial = (props: { name: string }) => <span class="text-[13px] font-semibold text-text">{props.name.slice(0, 1)}</span>

const LEVEL_ORDER: Record<ReviewLine["level"], number> = { warning: 0, notice: 1, info: 2 }

export default function ExtensionsPage() {
  const navigate = useNavigate()
  const [error, setError] = createSignal<string | null>(null)
  const extensions = () => app.user()?.extensions() ?? []
  const proposals = () => app.user()?.proposals() ?? []
  const [catalog] = createResource(loadCatalog)
  const installedNames = createMemo(() => new Set(extensions().map((x) => x.name)))
  const waitingNames = createMemo(() => new Set(proposals().map((p) => p.name)))
  const entries = () => (catalog.error ? [] : (catalog() ?? []))

  async function run(op: ExtensionOp) {
    setError(null)
    const out = await send(op)
    if (!out.ok) setError(`${out.error}${out.problems?.length ? `: ${out.problems.join("; ")}` : ""}`)
    return out
  }

  function askYuki() {
    const yuki = app.yukiChatId()
    if (!yuki) return
    app.drafts()?.save(yuki, { text: "Build me an extension that " })
    navigate(`/chat/${yuki}`)
  }

  return (
    <div class="flex flex-col gap-8" data-component="extensions-page">
      <Show when={error()}>
        <Notice data-component="extensions-error">{error()!}</Notice>
      </Show>

      <Show when={proposals().length}>
        <Group title="Waiting for you" data-component="extension-proposals">
          <For each={proposals()}>{(p) => <ProposalCard proposal={p} installed={extensions().find((x) => x.name === p.name)} run={run} />}</For>
        </Group>
      </Show>

      <Group
        title="Installed"
        data-component="extensions-installed"
        bare={!extensions().length}
        action={
          <Button variant="ghost" data-action="ask-yuki" onClick={askYuki}>
            Build one with Yuki
          </Button>
        }
      >
        <For each={extensions()} fallback={<Hint data-component="extensions-empty">No extensions installed.</Hint>}>
          {(x) => <InstalledRow extension={x} run={run} />}
        </For>
      </Group>

      <Group title="Catalog" data-component="extension-catalog" bare={!entries().length}>
        <For
          each={entries()}
          fallback={<Hint>{catalog.error ? "The catalog did not load. Reload to try again." : catalog.loading ? "Loading the catalog" : "The catalog is empty"}</Hint>}
        >
          {(entry) => <CatalogCard entry={entry} installed={installedNames().has(entry.name)} waiting={waitingNames().has(entry.name)} run={run} />}
        </For>
      </Group>
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
  return (
    <Item
      data-extension-proposal={p().name}
      icon={<Initial name={p().name} />}
      title={p().name}
      meta={`${props.installed ? `${props.installed.version} → ${p().version}` : p().version} · ${origin(p())}`}
    >
      <div class="flex flex-col gap-3">
        <p class={cn("text-[13px] leading-relaxed", muted)}>{sentence(m().description)}</p>
        <Show when={props.installed} fallback={<Review lines={describeManifest(m())} />}>
          {(old) => <UpdateReview change={reviewChange(describeManifest(old().manifest), describeManifest(m()))} />}
        </Show>
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
  )
}

/** The powers, riskiest first, as plain lines. A warning has a red dot, a notice an accent one, an info a faint one. */
function Review(props: { lines: ReviewLine[] }) {
  const sorted = () => [...props.lines].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  return (
    <ul class="flex flex-col gap-1" data-component="extension-review">
      <For each={sorted()}>
        {(entry) => (
          <li class="flex items-start gap-2 text-[13px] leading-relaxed" data-level={entry.level}>
            <span
              class={`mt-[8px] size-1.5 shrink-0 rounded-full ${entry.level === "warning" ? "bg-[var(--danger)]" : entry.level === "notice" ? "bg-[var(--accent)]" : "bg-[var(--text-faint)]"}`}
              aria-hidden="true"
            />
            <span class={entry.level === "warning" ? "text-text" : muted}>{sentence(entry.text)}</span>
          </li>
        )}
      </For>
    </ul>
  )
}

/** An update's powers: what this version adds or drops, and how many stay the same. */
function UpdateReview(props: { change: ReviewChange }) {
  const c = () => props.change
  return (
    <div class="flex flex-col gap-2" data-component="extension-update-review">
      <Show when={c().added.length} fallback={<p class={cn("text-[13px]", muted)}>No new powers.</p>}>
        <Review lines={c().added} />
      </Show>
      <Show when={c().removed.length}>
        <ul class="flex flex-col gap-1" data-component="extension-review-removed">
          <For each={c().removed}>{(entry) => <li class={cn("text-[13px] leading-relaxed line-through", muted)}>{sentence(entry.text)}</li>}</For>
        </ul>
      </Show>
      <Show when={c().unchanged}>
        <p class={cn("text-[13px]", muted)}>Unchanged powers: {c().unchanged}</p>
      </Show>
    </div>
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
    <Item
      data-extension={x().name}
      data-enabled={String(x().enabled)}
      icon={<Initial name={x().name} />}
      title={
        <>
          <span class="truncate">{x().name}</span>
          <span class={cn("shrink-0 text-[12px] font-normal", muted)}>{x().version}</span>
          <Show when={x().error}>
            <Pill tone="danger" data-component="extension-has-error">
              Error
            </Pill>
          </Show>
          <Show when={missing()}>
            <Pill data-component="extension-needs-secret">Needs {missing() === 1 ? "a secret" : `${missing()} secrets`}</Pill>
          </Show>
        </>
      }
      meta={sentence(x().description)}
      actions={
        <>
          <Toggle label={`Enable ${x().name}`} on={x().enabled} data-action="toggle-extension" onChange={(on) => void props.run({ op: "enable", name: x().name, enabled: on })} />
          <DetailsButton open={open()} onToggle={() => setOpen(!open())} data-action="open-extension" />
        </>
      }
    >
      {/* An expression, not a Show: the item draws its details row only while there is something in it. */}
      {open() && (
        <div class="flex flex-col gap-4" data-component="extension-detail">
          <Show when={x().error}>
            <p class="font-mono text-[12px] leading-relaxed break-words text-[var(--danger)]">{x().error}</p>
          </Show>
          <Review lines={describeManifest(x().manifest)} />
          <Show when={tools().length}>
            <p class={cn("text-[13px]", muted)}>
              Tools: <span class="font-mono text-text">{tools().join(", ")}</span>
            </p>
          </Show>
          <AgentScope extension={x()} run={props.run} />
          <Show when={x().secrets.length}>
            <div class="flex flex-col" data-component="extension-secrets">
              <span class={cn("text-[13px]", muted)}>Secrets are sealed on the server. The extension's code never sees them.</span>
              <For each={x().secrets}>{(s) => <SecretField extension={x()} name={s.name} set={s.set} run={props.run} />}</For>
            </div>
          </Show>
          <p class={cn("text-[13px]", muted)}>
            {origin(x())} · Updated {new Date(x().updatedAt).toLocaleDateString()}
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
              <span class={cn("ml-auto text-[13px]", muted)}>Remove it and its notes?</span>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Keep
              </Button>
              <Button variant="danger" data-action="confirm-uninstall" onClick={() => void props.run({ op: "uninstall", name: x().name })}>
                Remove
              </Button>
            </Show>
          </div>
          <Show when={code()}>
            <Show when={source()} fallback={<p class={cn("text-[13px]", muted)}>{source.loading ? "Loading the code" : "The code did not load"}</p>}>
              {(b) => <CodeView bundle={b()} />}
            </Show>
          </Show>
        </div>
      )}
    </Item>
  )
}

/** Every agent, or only the ones picked. Each is a button that stays pressed while it is picked. */
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
      <span class={cn("text-[13px]", muted)}>Used by</span>
      <div class="flex flex-wrap gap-1.5">
        <Chip on={scope() === null} onClick={() => set(null)} label="Every agent" />
        <Chip on={scope()?.includes("yuki" as never) ?? false} onClick={() => toggle("yuki")} label="@yuki" />
        <For each={agents()}>{(a) => <Chip on={scope()?.includes(a.slug) ?? false} onClick={() => toggle(a.slug)} label={`@${a.slug}`} />}</For>
      </div>
    </div>
  )
}

/** A kit button that toggles: pressed, it fills with the accent and leads with a check. */
function Chip(props: { on: boolean; label: string; onClick: () => void }) {
  return (
    <Button aria-pressed={props.on} onClick={props.onClick}>
      <Show when={props.on}>
        <svg class="size-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </Show>
      {props.label}
    </Button>
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
    <Row
      class="px-0"
      data-secret={props.name}
      data-set={String(props.set)}
      label={
        <>
          <span class="font-mono text-[13px]">{props.name}</span>
          <Show when={props.set}>
            <Pill tone="success">Set</Pill>
          </Show>
        </>
      }
      description={
        <>
          Sent only to {hosts()}
          <Show when={hint()}>. {sentence(hint()!)}</Show>
        </>
      }
      details={
        editing() ? (
          <form class="flex gap-2" onSubmit={save}>
            <input
              ref={input}
              type="password"
              name={`yuki-extension-secret-${props.name}`}
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
        ) : undefined
      }
    >
      <Show when={props.set && !editing()}>
        <Button variant="ghost" data-action="replace-secret" onClick={() => setEditing(true)}>
          Replace
        </Button>
        <Button variant="ghost" data-action="clear-secret" onClick={() => void props.run({ op: "secret", name: props.extension.name, secret: props.name, value: null })}>
          Clear
        </Button>
      </Show>
    </Row>
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
    <Item
      data-catalog={props.entry.name}
      title={props.entry.name}
      meta={sentence(props.entry.description)}
      actions={
        <>
          <DetailsButton open={open()} onToggle={() => setOpen(!open())} data-action="catalog-details" />
          <Show when={!props.installed} fallback={<Pill tone="success" data-component="catalog-installed">Installed</Pill>}>
            <Button disabled={busy() || props.waiting} data-action="add-from-catalog" onClick={() => void add()}>
              {props.waiting ? "Review above" : busy() ? "Adding" : "Add"}
            </Button>
          </Show>
        </>
      }
    >
      {open() && <Review lines={describeManifest(props.entry.bundle.manifest)} />}
    </Item>
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
