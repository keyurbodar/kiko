import { KIKO, type FileRef, type RecipeApp, type RecipeInstall } from "@kiko/protocol"
import { parseRichText } from "@kiko/protocol/markdown"
import { ClockIcon, PlusIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createEffect, createMemo, createSignal, For, on, onMount, Show, type JSX } from "solid-js"
import { RichText } from "../chat/rich/RichText"
import { putFile, readText, sha256Hex } from "../files/api"
import { SurfaceFailure, SurfaceLoading } from "../files/chrome"
import { cn } from "../lib/cn"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { agentDisplayName } from "../lib/names"
import { room } from "../state/room"
import { user } from "../state/user"
import { parseDoc, recipeSlugOf, setAgent, setApps, setBody, setTitle, setWhen, type RecipeDoc } from "./doc"
import { AppLogo } from "./icon"
import { localizeWhen, nextRunLabel } from "./model"
import { cards, followRecipes, installsFor, setInstallPaused } from "./state"

const chip =
  "type-ui flex h-9 min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-panel px-3.5 text-fg2 outline-none transition-[background-color,color,transform] duration-(--dur-hover) hover:bg-active hover:text-fg focus-visible:bg-active active:scale-[0.97]"

type Base = { id: string; sha256: string }

function useRecipeText(props: { roomId: string; path: string; file: FileRef }) {
  const [text, setText] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  let base: Base | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const load = async (id: string) => {
    try {
      const read = await readText(props.roomId, id)
      if (read.kind !== "text") return setError("This recipe could not be read as text.")
      base = { id, sha256: read.sha256 }
      setError(null)
      setText(read.text)
    } catch (e) {
      setError(e instanceof Error ? e.message : "This recipe did not load.")
    }
  }
  createEffect(
    on(
      () => props.file.id,
      (id) => {
        if (base?.id !== id) void load(id)
      },
    ),
  )
  const persist = async (next: string) => {
    const current = base
    if (!current) return
    const res = await putFile(props.roomId, props.path, next, "text/markdown", current.sha256)
    if (res.kind === "saved") {
      base = { id: res.file.id, sha256: await sha256Hex(new TextEncoder().encode(next)) }
      return
    }
    showToastV2({
      title: res.kind === "conflict" ? "This recipe changed somewhere else" : "Could not save the recipe",
      description: res.kind === "error" ? res.message : undefined,
      variant: "error",
    })
    void load(res.kind === "conflict" ? (res.theirs?.id ?? current.id) : current.id)
  }
  const change = (edit: (text: string) => string) => {
    const before = text()
    if (before === null) return
    const next = edit(before)
    if (next === before) return
    setText(next)
    queue = queue.then(() => persist(next))
  }
  return { text, error, change, reload: () => void load(props.file.id) }
}

function Title(props: { value: string; onCommit: (value: string) => void }) {
  let input!: HTMLInputElement
  createEffect(() => {
    if (document.activeElement !== input) input.value = props.value
  })
  const commit = () => {
    const next = input.value.trim()
    if (!next) input.value = props.value
    else props.onCommit(next)
  }
  return (
    <input
      ref={input}
      class="recipe-doc-title"
      value={props.value}
      aria-label="Recipe title"
      data-component="recipe-title"
      spellcheck={false}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") input.blur()
        if (e.key === "Escape") {
          input.value = props.value
          input.blur()
        }
      }}
    />
  )
}

function WhenChip(props: { value: string; onCommit: (value: string) => void }) {
  const [editing, setEditing] = createSignal(false)
  let input: HTMLInputElement | undefined
  const finish = (save: boolean) => {
    if (save && input?.value.trim()) props.onCommit(input.value.trim())
    setEditing(false)
  }
  return (
    <Show
      when={editing()}
      fallback={
        <button
          type="button"
          class={chip}
          data-action="recipe-when"
          onClick={() => {
            setEditing(true)
            queueMicrotask(() => input?.select())
          }}
        >
          <RemixIcon icon={ClockIcon} size={16} class="shrink-0" />
          <span class="truncate">{props.value ? localizeWhen(props.value) : "When it runs"}</span>
        </button>
      }
    >
      <span class={cn(chip, "cursor-text bg-fill text-fg")}>
        <RemixIcon icon={ClockIcon} size={16} class="shrink-0" />
        <input
          ref={(el) => {
            input = el
            queueMicrotask(() => el.focus())
          }}
          class="recipe-doc-input"
          value={props.value}
          aria-label="When it runs"
          size={Math.max(14, props.value.length + 2)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") finish(true)
            if (e.key === "Escape") finish(false)
          }}
        />
      </span>
    </Show>
  )
}

type Person = { name: string; handle: string }

const people = (): Person[] => [
  { name: "Kiko", handle: KIKO },
  ...user
    .agents()
    .filter((a) => a.slug !== KIKO)
    .map((a) => ({ name: a.name, handle: a.slug })),
]

function AgentChip(props: { value: RecipeDoc["agent"]; onPick: (agent: Person) => void }) {
  const current = () => props.value?.handle ?? KIKO
  const label = () => props.value?.name ?? agentDisplayName(KIKO, user.agents())
  return (
    <MenuV2 gutter={6} placement="bottom-start">
      <MenuV2.Trigger class={chip} data-action="recipe-agent" aria-label={`Agent, ${label()}`}>
        <IdentityAvatar seed={current()} size={20} />
        <span class="truncate">{label()}</span>
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-48">
          <MenuV2.Group>
            <MenuV2.GroupLabel>Who runs it</MenuV2.GroupLabel>
            <MenuV2.RadioGroup
              value={current()}
              onChange={(handle) => {
                const next = people().find((p) => p.handle === handle)
                if (next) props.onPick(next)
              }}
            >
              <For each={people()}>
                {(p) => (
                  <MenuV2.RadioItem value={p.handle}>
                    <IdentityAvatar seed={p.handle} size={18} />
                    {p.name}
                  </MenuV2.RadioItem>
                )}
              </For>
            </MenuV2.RadioGroup>
          </MenuV2.Group>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

const appSlug = (name: string) =>
  cards()
    .flatMap((c) => c.apps)
    .find((a) => a.name.toLowerCase() === name.toLowerCase())?.slug ?? name.toLowerCase().replace(/[^a-z0-9]/g, "")

const asApp = (name: string): RecipeApp => ({ name, slug: appSlug(name), connected: null })

const knownApps = createMemo(() => {
  const names = new Map<string, string>()
  for (const card of cards()) for (const app of card.apps) names.set(app.name.toLowerCase(), app.name)
  return [...names.values()].sort((a, b) => a.localeCompare(b))
})

function AppsChip(props: { value: readonly string[]; onChange: (apps: string[]) => void }) {
  const options = () => [
    ...new Map([...props.value, ...knownApps()].map((n) => [n.toLowerCase(), n] as const)).values(),
  ]
  const has = (name: string) => props.value.some((n) => n.toLowerCase() === name.toLowerCase())
  const toggle = (name: string) =>
    props.onChange(
      has(name) ? props.value.filter((n) => n.toLowerCase() !== name.toLowerCase()) : [...props.value, name],
    )
  return (
    <MenuV2 gutter={6} placement="bottom-start">
      <MenuV2.Trigger class={chip} data-action="recipe-apps" aria-label="Apps this recipe uses">
        <Show
          when={props.value.length}
          fallback={
            <>
              <RemixIcon icon={PlusIcon} size={16} />
              <span>Add an app</span>
            </>
          }
        >
          <span class="flex -space-x-1.5">
            <For each={props.value.slice(0, 3)}>{(name) => <AppLogo app={asApp(name)} size={20} />}</For>
          </span>
          <span class="truncate">{props.value.join(", ")}</span>
        </Show>
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="max-h-80 min-w-52 overflow-y-auto">
          <MenuV2.Group>
            <MenuV2.GroupLabel>Apps it uses</MenuV2.GroupLabel>
            <For each={options()}>
              {(name) => (
                <MenuV2.CheckboxItem closeOnSelect={false} checked={has(name)} onChange={() => toggle(name)}>
                  <AppLogo app={asApp(name)} size={18} />
                  {name}
                </MenuV2.CheckboxItem>
              )}
            </For>
          </MenuV2.Group>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function RunChip(props: { installs: readonly RecipeInstall[] }) {
  const active = () => props.installs.some((i) => i.routines.some((r) => r.status === "active"))
  const toggle = () => {
    const pause = active()
    for (const install of props.installs) setInstallPaused(install, pause)
  }
  return (
    <Show
      when={props.installs.length}
      fallback={
        <span
          class={cn(chip, "cursor-default text-fg3 hover:bg-panel hover:text-fg3 active:scale-100")}
          data-run="none"
        >
          Not running
        </span>
      }
    >
      <button
        type="button"
        role="switch"
        aria-checked={active()}
        class={cn(chip, active() ? "text-ok hover:text-ok" : "text-fg3")}
        data-action="recipe-toggle"
        onClick={toggle}
      >
        {active() ? "On" : "Off"}
      </button>
    </Show>
  )
}

function Prose(props: { body: string; onCommit: (body: string) => void }) {
  const [editing, setEditing] = createSignal(false)
  let area: HTMLTextAreaElement | undefined
  const fit = () => {
    if (!area) return
    area.style.height = "auto"
    area.style.height = `${area.scrollHeight}px`
  }
  const finish = (save: boolean) => {
    if (save && area && area.value.trimEnd() !== props.body) props.onCommit(area.value)
    setEditing(false)
  }
  return (
    <Show
      when={editing()}
      fallback={
        <div
          class="recipe-doc-prose"
          role="button"
          tabindex="0"
          aria-label="Edit instructions"
          data-component="recipe-instructions"
          onClick={(e) => {
            if (window.getSelection()?.toString()) return
            if ((e.target as HTMLElement).closest("a")) return
            setEditing(true)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setEditing(true)
            }
          }}
        >
          <Show when={props.body} fallback={<p class="text-fg4">Click to write what this recipe does.</p>}>
            <RichText tree={parseRichText(props.body)} />
          </Show>
        </div>
      }
    >
      <textarea
        ref={(el) => {
          area = el
          queueMicrotask(() => {
            el.focus()
            fit()
          })
        }}
        class="recipe-doc-prose recipe-doc-area"
        value={props.body}
        aria-label="Instructions"
        spellcheck
        onInput={fit}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") finish(false)
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) finish(true)
        }}
      />
    </Show>
  )
}

function NextRun(props: { installs: readonly RecipeInstall[] }) {
  const upcoming = createMemo(() => {
    const live = props.installs.flatMap((i) => i.routines.filter((r) => r.status === "active").map((r) => ({ i, r })))
    return live.sort((a, b) => a.r.dueUtc - b.r.dueUtc)[0]
  })
  const chatName = (install: RecipeInstall) =>
    room.chatById(install.roomId)?.name ?? user.chat(install.roomId)?.title ?? "a chat"
  return (
    <section
      class="flex items-center gap-4 rounded-card bg-panel px-5 py-4"
      aria-label="Next run"
      data-component="recipe-next-run"
    >
      <Show
        when={props.installs.length}
        fallback={<p class="type-ui text-fg3">Not added to a chat yet. Add it from Recipes to start it.</p>}
      >
        <Show when={upcoming()} fallback={<p class="type-ui text-fg3">Paused. Turn it on to run again.</p>}>
          {(next) => (
            <>
              <IdentityAvatar seed={next().i.agent} size={32} />
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="type-ui truncate text-fg">{nextRunLabel(next().r.dueUtc, Date.now(), next().r.tz)}</span>
                <span class="type-label truncate text-fg3">In {chatName(next().i)}</span>
              </div>
            </>
          )}
        </Show>
      </Show>
    </section>
  )
}

function Document(props: {
  doc: RecipeDoc
  installs: readonly RecipeInstall[]
  change: (edit: (text: string) => string) => void
}) {
  return (
    <article class="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 py-8 @min-[640px]/file:px-10 @min-[640px]/file:py-10">
      <Title value={props.doc.title} onCommit={(title) => props.change((t) => setTitle(t, title))} />
      <div class="flex flex-wrap items-center gap-2" data-component="recipe-chips">
        <WhenChip value={props.doc.when} onCommit={(when) => props.change((t) => setWhen(t, when))} />
        <AgentChip value={props.doc.agent} onPick={(agent) => props.change((t) => setAgent(t, agent))} />
        <AppsChip value={props.doc.apps} onChange={(apps) => props.change((t) => setApps(t, apps))} />
        <RunChip installs={props.installs} />
      </div>
      <Prose body={props.doc.body} onCommit={(body) => props.change((t) => setBody(t, body))} />
      <NextRun installs={props.installs} />
    </article>
  )
}

export default function RecipeDocument(props: { roomId: string; path: string; file: FileRef; fallback: JSX.Element }) {
  onMount(followRecipes)
  const recipe = useRecipeText(props)
  const doc = createMemo(() => {
    const text = recipe.text()
    return text === null ? null : parseDoc(text)
  })
  const installs = () => installsFor(recipeSlugOf(props.path) ?? "")
  return (
    <div class="min-h-0 flex-1 overflow-auto" data-component="recipe-document">
      <Show when={!recipe.error()} fallback={<SurfaceFailure message={recipe.error()!} onRetry={recipe.reload} />}>
        <Show when={recipe.text() !== null} fallback={<SurfaceLoading />}>
          <Show when={doc()} fallback={props.fallback}>
            {(value) => <Document doc={value()} installs={installs()} change={recipe.change} />}
          </Show>
        </Show>
      </Show>
    </div>
  )
}
