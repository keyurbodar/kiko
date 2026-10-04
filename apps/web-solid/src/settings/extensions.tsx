import { describeManifest, type ExtensionBundle, type ExtensionCatalogEntry, type ExtensionInfo, type ExtensionOp, type ExtensionProposal, type ExtensionResult, type ReviewLine } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { For, Show, createMemo, createResource, createSignal, type JSX } from "solid-js"
import { useApp } from "../lib/store"
import { lineDiff } from "./line-diff"
import { SECTION_ICON } from "./sections"

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
  if (!store) return { ok: false, error: "still connecting" }
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
    if (!out.ok) setError(`${out.error}${out.problems?.length ? `: ${out.problems.join("; ")}` : ""}`.toLowerCase())
    return out
  }

  function askKiko() {
    const kiko = app.kikoChatId()
    if (!kiko) return
    app.drafts()?.save(kiko, { text: "build me an extension that " })
    navigate(`/chat/${kiko}`)
  }

  return (
    <div class="flex flex-col gap-6" data-component="extensions-page">
      <section class="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--surface-raised)] p-4" data-component="extensions-intro">
        <span class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--tab-bg-active)] text-[var(--accent)]" aria-hidden="true">
          <PuzzleIcon />
        </span>
        <span class="min-w-[200px] flex-1">
          <span class="block text-sm text-text">teach your agents something new</span>
          <span class="block text-xs text-weak">extensions add tools, instructions, and schedules. they run sandboxed on kiko's server, and keys never reach their code.</span>
        </span>
        <button
          type="button"
          class="h-9 w-full shrink-0 rounded-[10px] bg-[var(--accent-fill)] px-3 text-sm text-[var(--on-accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:w-auto md:h-8"
          data-action="ask-kiko"
          onClick={askKiko}
        >
          build one with kiko
        </button>
      </section>

      <Show when={error()}>
        <p class="rounded-[10px] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-3 py-2 text-xs text-[var(--danger)]" role="alert" data-component="extensions-error">
          {error()}
        </p>
      </Show>

      <Show when={proposals().length}>
        <section class="flex flex-col gap-2" data-component="extension-proposals">
          <h2 class="px-1 text-xs text-weak">waiting for you</h2>
          <For each={proposals()}>{(p) => <ProposalCard proposal={p} installed={extensions().find((x) => x.name === p.name)} run={run} />}</For>
        </section>
      </Show>

      <section class="flex flex-col gap-2" data-component="extensions-installed">
        <h2 class="px-1 text-xs text-weak">installed</h2>
        <Show
          when={extensions().length}
          fallback={<p class="rounded-2xl bg-[var(--surface-raised)] px-4 py-3 text-sm text-weak" data-component="extensions-empty">nothing yet. add one from the catalog below, or ask kiko to build one.</p>}
        >
          <ul class="flex flex-col gap-1 rounded-2xl bg-[var(--surface-raised)] p-1">
            <For each={extensions()}>{(x) => <InstalledRow extension={x} run={run} />}</For>
          </ul>
        </Show>
      </section>

      <section class="flex flex-col gap-2" data-component="extension-catalog">
        <h2 class="px-1 text-xs text-weak">catalog</h2>
        <Show when={!catalog.error} fallback={<p class="px-1 text-sm text-weak">the catalog did not load. reload to try again.</p>}>
          <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <For each={catalog() ?? []} fallback={<li class="px-1 text-sm text-weak">{catalog.loading ? "loading the catalog" : "the catalog is empty"}</li>}>
              {(entry) => <CatalogCard entry={entry} installed={installedNames().has(entry.name)} waiting={waitingNames().has(entry.name)} run={run} />}
            </For>
          </ul>
        </Show>
      </section>
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
    <article class="flex flex-col gap-3 rounded-2xl bg-[var(--surface-raised)] p-4" data-extension-proposal={p().name}>
      <header class="flex items-start gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--tab-bg-active)] text-sm font-semibold text-text" aria-hidden="true">
          {p().name.slice(0, 1)}
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-baseline gap-x-2">
            <span class="text-sm font-medium text-text">{p().name}</span>
            <span class="text-xs text-weak">
              {props.installed ? `${props.installed.version} → ${p().version}` : p().version} · {from()}
            </span>
          </span>
          <span class="block text-xs text-muted">{m().description.toLowerCase()}</span>
        </span>
      </header>
      <Show when={p().tainted}>
        <p class="rounded-[10px] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-3 py-2 text-xs text-[var(--danger)]" data-component="proposal-tainted">
          written after the agent read outside content, like a web page. read the code before you install it.
        </p>
      </Show>
      <Review lines={describeManifest(m())} />
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="h-9 rounded-[10px] bg-[var(--accent-fill)] px-4 text-sm text-[var(--on-accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:h-8"
          data-action="install-extension"
          onClick={() => void props.run({ op: "install", id: p().id })}
        >
          {props.installed ? "update" : "install"}
        </button>
        <button
          type="button"
          class="h-9 rounded-[10px] px-3 text-sm text-muted outline-none hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:h-8"
          data-action="decline-extension"
          onClick={() => void props.run({ op: "decline", id: p().id })}
        >
          decline
        </button>
        <Show when={Object.keys(p().bundle.files).length}>
          <button
            type="button"
            class="ml-auto h-9 rounded-[10px] px-3 text-xs text-weak outline-none hover:bg-[var(--nav-hover-bg)] hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:h-8"
            aria-expanded={code()}
            data-action="show-code"
            onClick={() => setCode(!code())}
          >
            {code() ? "hide code" : props.installed ? "what changed" : "read the code"}
          </button>
        </Show>
      </div>
      <Show when={code()}>
        <CodeView bundle={p().bundle} before={props.installed ? (before() ?? undefined) : undefined} />
      </Show>
    </article>
  )
}

/** The powers, riskiest first. A warning is red, a notice plain, an info faint. */
function Review(props: { lines: ReviewLine[] }) {
  const sorted = () => [...props.lines].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  return (
    <ul class="flex flex-col gap-1" data-component="extension-review">
      <For each={sorted()}>
        {(line) => (
          <li class="flex items-start gap-2 text-xs" data-level={line.level}>
            <span
              class={`mt-[5px] size-1.5 shrink-0 rounded-full ${line.level === "warning" ? "bg-[var(--danger)]" : line.level === "notice" ? "bg-[var(--accent)]" : "bg-[var(--text-faint)]"}`}
              aria-hidden="true"
            />
            <span class={line.level === "warning" ? "text-text" : "text-muted"}>{line.text}</span>
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
      <div class="flex min-h-12 items-center gap-3 rounded-[12px] px-3 py-2 hover:bg-[var(--nav-hover-bg)]">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          aria-expanded={open()}
          data-action="open-extension"
          onClick={() => setOpen(!open())}
        >
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline gap-2">
              <span class="truncate text-sm text-text">{x().name}</span>
              <span class="shrink-0 text-xs text-weak">{x().version}</span>
              <Show when={x().error}>
                <span class="shrink-0 text-xs text-[var(--danger)]" data-component="extension-has-error">error</span>
              </Show>
              <Show when={missing()}>
                <span class="shrink-0 text-xs text-[var(--accent)]" data-component="extension-needs-secret">needs {missing() === 1 ? "a secret" : `${missing()} secrets`}</span>
              </Show>
            </span>
            <span class="block truncate text-xs text-weak">{x().description.toLowerCase()}</span>
          </span>
        </button>
        <Toggle on={x().enabled} label={`${x().name} on`} onChange={(on) => void props.run({ op: "enable", name: x().name, enabled: on })} />
      </div>
      <Show when={open()}>
        <div class="flex flex-col gap-4 px-3 pt-1 pb-3" data-component="extension-detail">
          <Show when={x().error}>
            <p class="rounded-[10px] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-3 py-2 font-mono text-xs break-words text-[var(--danger)]">{x().error}</p>
          </Show>
          <Review lines={describeManifest(x().manifest)} />
          <Show when={tools().length}>
            <p class="text-xs text-weak">
              tools: <span class="font-mono text-muted">{tools().join(", ")}</span>
            </p>
          </Show>
          <AgentScope extension={x()} run={props.run} />
          <Show when={x().secrets.length}>
            <div class="flex flex-col gap-2" data-component="extension-secrets">
              <span class="text-xs text-weak">secrets, sealed on the server. the extension's code never sees them.</span>
              <For each={x().secrets}>{(s) => <SecretField extension={x()} name={s.name} set={s.set} run={props.run} />}</For>
            </div>
          </Show>
          <p class="text-xs text-weak">
            {x().source === "catalog" ? "from the catalog" : x().by ? `written by @${x().by}` : "from your files"} · updated {new Date(x().updatedAt).toLocaleDateString().toLowerCase()}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <Show when={Object.keys(x().manifest.tools ?? {}).length || x().manifest.hooks?.length || Object.values(x().manifest.sections ?? {}).some((s) => s.text === undefined)}>
              <button
                type="button"
                class="h-8 rounded-[10px] px-3 text-xs text-weak outline-none hover:bg-[var(--tab-bg-active)] hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-expanded={code()}
                data-action="show-code"
                onClick={() => setCode(!code())}
              >
                {code() ? "hide code" : "read the code"}
              </button>
            </Show>
            <Show
              when={confirm()}
              fallback={
                <button
                  type="button"
                  class="ml-auto h-8 rounded-[10px] px-3 text-xs text-weak outline-none hover:bg-[var(--tab-bg-active)] hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  data-action="uninstall-extension"
                  onClick={() => setConfirm(true)}
                >
                  remove
                </button>
              }
            >
              <span class="ml-auto text-xs text-muted">remove it and its notes?</span>
              <button
                type="button"
                class="h-8 rounded-[10px] bg-[var(--danger)] px-3 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                data-action="confirm-uninstall"
                onClick={() => void props.run({ op: "uninstall", name: x().name })}
              >
                remove
              </button>
              <button type="button" class="h-8 rounded-[10px] px-3 text-xs text-muted hover:bg-[var(--tab-bg-active)]" onClick={() => setConfirm(false)}>
                keep
              </button>
            </Show>
          </div>
          <Show when={code()}>
            <Show when={source()} fallback={<p class="text-xs text-weak">{source.loading ? "loading the code" : "the code did not load"}</p>}>
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
      <span class="text-xs text-weak">who uses it</span>
      <div class="flex flex-wrap gap-1.5">
        <Chip on={scope() === null} onClick={() => set(null)} label="every agent" />
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
      class={`h-8 rounded-full px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:h-7 ${props.on ? "bg-[var(--accent-fill)] text-[var(--on-accent)]" : "bg-[var(--tab-bg-active)] text-muted hover:text-text"}`}
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
    <div class="flex flex-col gap-1 rounded-[12px] bg-[var(--input-bg)] p-3" data-secret={props.name} data-set={props.set}>
      <div class="flex items-center gap-2">
        <span class="font-mono text-xs text-text">{props.name}</span>
        <span class="min-w-0 flex-1 truncate text-xs text-weak">sent only to {hosts()}</span>
        <Show when={props.set && !editing()}>
          <span class="text-xs text-[var(--accent)]">set</span>
          <button type="button" class="h-7 rounded-[8px] px-2 text-xs text-weak hover:text-text" data-action="replace-secret" onClick={() => setEditing(true)}>
            replace
          </button>
          <button
            type="button"
            class="h-7 rounded-[8px] px-2 text-xs text-weak hover:text-[var(--danger)]"
            data-action="clear-secret"
            onClick={() => void props.run({ op: "secret", name: props.extension.name, secret: props.name, value: null })}
          >
            clear
          </button>
        </Show>
      </div>
      <Show when={hint()}>
        <span class="text-xs text-weak">{hint()!.toLowerCase()}</span>
      </Show>
      <Show when={editing()}>
        <form class="flex gap-2" onSubmit={save}>
          <input
            ref={input}
            type="password"
            name={`kiko-extension-secret-${props.name}`}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            aria-label={`${props.name} value`}
            class="h-9 min-w-0 flex-1 rounded-[10px] bg-[var(--surface-raised)] px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:h-8"
            data-component="secret-input"
          />
          <button type="submit" class="h-9 shrink-0 rounded-[10px] bg-[var(--accent-fill)] px-3 text-xs text-[var(--on-accent)] md:h-8" data-action="save-secret">
            save
          </button>
        </form>
      </Show>
    </div>
  )
}

/** A catalog entry: what it is, its powers on open, and one tap to review it. */
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
    <li class="flex flex-col gap-2 rounded-2xl bg-[var(--surface-raised)] p-3" data-catalog={props.entry.name}>
      <div class="flex items-start gap-2">
        <button type="button" class="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" aria-expanded={open()} onClick={() => setOpen(!open())}>
          <span class="block text-sm text-text">{props.entry.name}</span>
          <span class="block text-xs text-weak">{props.entry.description.toLowerCase()}</span>
        </button>
        <Show
          when={!props.installed}
          fallback={
            <span class="shrink-0 py-1.5 text-xs text-weak" data-component="catalog-installed">
              installed
            </span>
          }
        >
          <button
            type="button"
            disabled={busy() || props.waiting}
            class="h-8 shrink-0 rounded-[10px] bg-[var(--btn-bg)] px-3 text-xs text-[var(--tab-text-active)] outline-none hover:bg-[var(--btn-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
            data-action="add-from-catalog"
            onClick={() => void add()}
          >
            {props.waiting ? "review above" : busy() ? "adding" : "add"}
          </button>
        </Show>
      </div>
      <Show when={open()}>
        <Review lines={describeManifest(props.entry.bundle.manifest)} />
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
    <div class="flex flex-col overflow-hidden rounded-[12px] bg-[var(--input-bg)]" data-component="extension-code">
      <div class="flex gap-1 overflow-x-auto bg-[var(--surface-raised)] p-1 [scrollbar-width:none]" role="tablist">
        <For each={files()}>
          {(f, i) => (
            <button
              type="button"
              role="tab"
              aria-selected={i() === active()}
              class={`h-7 shrink-0 rounded-[8px] px-2 font-mono text-[11px] ${i() === active() ? "bg-[var(--tab-bg-active)] text-text" : "text-weak hover:text-text"}`}
              onClick={() => setActive(i())}
            >
              {f.name}
              <Show when={f.changed}>
                <span class="ml-1 text-[var(--accent)]">{f.was === undefined ? "new" : f.now === undefined ? "gone" : "changed"}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <pre class="max-h-[420px] overflow-auto p-3 font-mono text-[11px] leading-[1.55] text-muted" data-component="extension-code-body">
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

/** A two-state switch. The state shows before the server answers; a refusal flips it back. */
function Toggle(props: { on: boolean; label: string; onChange: (on: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      class={`relative h-6 w-10 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${props.on ? "bg-[var(--accent-fill)]" : "bg-[color-mix(in_oklch,var(--text)_24%,transparent)]"}`}
      data-action="toggle-extension"
      onClick={() => props.onChange(!props.on)}
    >
      <span class={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm ${props.on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  )
}

function PuzzleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
      <path d={SECTION_ICON.extensions} />
    </svg>
  )
}
