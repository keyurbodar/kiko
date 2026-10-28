import { fileName, type FileRef, type HumanAsk, type LifeLine, type Task } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, ChevronRightIcon, MemoryIcon, UploadIcon } from "@kiko/ui/icons"
import { createContext, createMemo, createSignal, For, type JSX, onCleanup, onMount, Show, useContext } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { agentDisplayName } from "../../lib/names"
import { room } from "../../state/room"
import { user } from "../../state/user"
import { type CardFile, FileCard } from "../../files/card"
import { library } from "../../files/library"
import { fileType } from "../../files/type"
import { elapsed, type HelperLane, helperWord } from "../helpers/helper-model"
import { Snowflake } from "../helpers/Snowflake"
import { taskText } from "../info/tasks-model"
import { deskTasks, fileTiles, knowns, nowProgress, taskMark, tasksLine, waiting } from "./desk-model"
import { MarkView } from "./marks"
import { type FixedKind, fixedSurface, helperSurface, openFile, openSurface } from "./surfaces"
import "./card.css"

export const DeskSettled = createContext<() => boolean>(() => true)

const press = "transition-[background-color,transform] duration-(--dur-hover) ease-kiko active:scale-[0.98]"

export function Section(props: {
  label: string
  meta?: string
  kind?: FixedKind
  chatId: string
  children: JSX.Element
}) {
  const open = () => props.kind && openSurface(props.chatId, fixedSurface(props.kind))
  const late = useContext(DeskSettled)()
  return (
    <section
      class="desk-section flex flex-col gap-1.5"
      data-section={props.kind ?? props.label.toLowerCase()}
      data-enter={late ? "" : undefined}
    >
      <Show
        when={props.kind}
        fallback={
          <h3 class="flex h-8 items-center px-1 font-sans text-hint font-normal text-[var(--text-300)]">
            <span class="min-w-0 flex-1 truncate">{props.label}</span>
            <span class="shrink-0 text-caption text-[var(--text-300)]">{props.meta}</span>
          </h3>
        }
      >
        <button
          type="button"
          class={`group/head -mx-1 flex h-8 items-center rounded-control px-1 text-left text-hint text-[var(--text-300)] hover:bg-hover hover:text-fg ${press}`}
          data-action={`open-${props.kind}`}
          aria-label={`Open ${props.label}`}
          onClick={open}
        >
          <span class="min-w-0 flex-1 truncate">{props.label}</span>
          <span class="shrink-0 text-caption text-[var(--text-300)]">{props.meta}</span>
          <RemixIcon
            icon={ChevronRightIcon}
            size={12}
            class="desk-head-chev ml-0.5 w-0 shrink-0 text-fg3 opacity-0 transition-[opacity,width,transform] duration-(--dur-hover) ease-kiko group-hover/head:w-[13px] group-hover/head:translate-x-0.5 group-hover/head:opacity-100"
          />
        </button>
      </Show>
      {props.children}
    </section>
  )
}

export function Now(props: { line: string; slug: string | undefined; tasks: readonly Task[] }) {
  const fraction = () => nowProgress(props.tasks)
  return (
    <div class="rounded-tile bg-active p-3" data-component="card-now">
      <div class="flex items-center gap-2.5">
        <Show when={props.slug}>{(slug) => <IdentityAvatar seed={slug()} size={22} class="desk-hop" />}</Show>
        <span class="desk-shimmer min-w-0 flex-1 truncate text-ui text-fg">{props.line}</span>
      </div>
      <Show when={fraction() !== null}>
        <div
          class="mt-2.5 h-1 overflow-hidden rounded-full bg-hover"
          role="progressbar"
          aria-label="Progress"
          aria-valuenow={Math.round((fraction() ?? 0) * 100)}
        >
          <div
            class="desk-bar h-full rounded-full bg-fg2"
            style={{ width: `${Math.max(6, (fraction() ?? 0) * 100)}%` }}
          />
        </div>
      </Show>
    </div>
  )
}

function Ask(props: { ask: HumanAsk; choices: readonly string[]; who: string }) {
  const answer = (choice: string) => room.active()?.answer(props.ask.id, choice)
  const focus = () => document.querySelector<HTMLElement>(".composer-dock .ProseMirror")?.focus()
  return (
    <div class="flex flex-col gap-2.5 rounded-tile bg-active p-3" data-component="card-ask" data-ask={props.ask.id}>
      <div class="flex items-start gap-2.5">
        <IdentityAvatar seed={props.ask.from} size={22} class="mt-px" />
        <p class="line-clamp-3 min-w-0 flex-1 text-ui text-fg" title={props.who}>
          {props.ask.text}
        </p>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <For
          each={props.choices}
          fallback={
            <button
              type="button"
              class={`h-8 rounded-control bg-fg px-3 text-label font-medium text-on-fg hover:opacity-90 ${press}`}
              data-action="answer-ask"
              onClick={focus}
            >
              Answer
            </button>
          }
        >
          {(choice, at) => (
            <button
              type="button"
              class={`h-8 max-w-full truncate rounded-control px-3 text-label font-medium ${press} ${
                at() === 0 ? "bg-fg text-on-fg hover:opacity-90" : "bg-hover text-fg hover:bg-raise"
              }`}
              data-action="answer-choice"
              onClick={() => answer(choice)}
            >
              {choice}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

export function Waiting(props: { asks: readonly HumanAsk[]; chatId: string }) {
  const name = (slug: string) => agentDisplayName(slug, room.roomMembers())
  return (
    <Section label="Waiting on you" chatId={props.chatId}>
      <For each={waiting(props.asks)}>
        {(entry) => <Ask ask={entry.ask} choices={entry.choices} who={name(entry.ask.from)} />}
      </For>
    </Section>
  )
}

export function Tasks(props: { tasks: readonly Task[]; chatId: string; fold?: boolean }) {
  const desk = createMemo(() => deskTasks(props.tasks))
  const members = () => room.roomMembers()
  const asking = createMemo(() => new Set((room.active()?.asks() ?? []).map((ask) => ask.from)))
  const [open, setOpen] = createSignal(false)
  const folded = () => props.fold === true && !open()
  return (
    <Section label="Tasks" kind="tasks" chatId={props.chatId} meta={`${desk().completed} of ${desk().total}`}>
      <Show when={props.fold === true}>
        <button
          type="button"
          class={`-mx-1 flex min-h-11 items-center gap-2.5 rounded-row px-1 text-left hover:bg-hover ${press}`}
          data-component="card-tasks-fold"
          aria-expanded={!folded()}
          onClick={() => setOpen(!open())}
        >
          <MarkView mark="done" />
          <span class="min-w-0 flex-1 truncate text-ui text-fg3">{tasksLine(props.tasks)}</span>
          <RemixIcon icon={folded() ? ChevronRightIcon : ChevronDownIcon} size={16} class="shrink-0 text-fg4" />
        </button>
      </Show>
      <Show when={!folded()}>
        <ul class="flex flex-col" aria-label="Tasks">
          <For each={desk().shown}>
            {(task) => (
              <li
                class="flex min-h-11 items-center gap-2.5 px-1 py-1.5"
                data-component="card-task"
                data-status={task.status}
                data-mark={taskMark(task, asking())}
              >
                <MarkView mark={taskMark(task, asking())} />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class={`truncate text-ui ${task.status === "done" ? "text-fg3" : "text-fg"}`}>
                    {taskText(task.title, members())}
                  </span>
                  <Show when={task.status === "doing" && task.owner && members().length > 1}>
                    <span class="truncate text-hint text-fg4">{agentDisplayName(task.owner!, members())}</span>
                  </Show>
                </span>
              </li>
            )}
          </For>
        </ul>
        <Show when={desk().more}>
          <span class="px-1 text-hint text-fg4">{`+${desk().more} more`}</span>
        </Show>
      </Show>
    </Section>
  )
}

export function Helpers(props: { lanes: readonly HelperLane[]; chatId: string }) {
  const working = () => props.lanes.filter((lane) => lane.state === "working").length
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))
  const group = () => room.roomMembers().length > 1
  return (
    <Section
      label="Helpers"
      chatId={props.chatId}
      meta={working() ? `${working()} of ${props.lanes.length} working` : `${props.lanes.length}`}
    >
      <ul class="flex flex-col" aria-label="Helpers">
        <For each={props.lanes}>
          {(lane) => (
            <li>
              <button
                type="button"
                class={`-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-row px-1 py-1.5 text-left hover:bg-hover ${press}`}
                data-component="card-helper"
                data-state={lane.state}
                onClick={() => openSurface(props.chatId, helperSurface(lane.id, lane.window))}
              >
                <Snowflake seed={lane.id} size={20} state={lane.state} parent={group() ? lane.slug : undefined} />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class={`truncate text-ui ${lane.state === "working" ? "text-fg" : "text-fg3"}`}>
                    {lane.title}
                  </span>
                  <span class="truncate text-hint text-fg4">
                    {lane.state === "working"
                      ? `${lane.line}`
                      : `${helperWord(lane.state)}, ${lane.count} ${lane.count === 1 ? "step" : "steps"}`}
                  </span>
                </span>
                <Show when={lane.state === "working"}>
                  <span class="shrink-0 text-hint text-fg4">{elapsed(now() - lane.startedAt)}</span>
                </Show>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Section>
  )
}

export function Files(props: { files: readonly FileRef[]; chatId: string }) {
  onMount(library.want)
  const facts = createMemo(() => new Map(library.files().map((f) => [f.file.id, f])))
  const tiles = createMemo(() => fileTiles(props.files))
  const where = () => room.chatById(props.chatId)?.name ?? "this chat"
  const card = (file: FileRef): CardFile => {
    const fact = facts().get(file.id)
    const madeBy = fact?.madeBy ?? null
    const name = fileName(file.name)
    const type = fileType({ name, type: file.type })
    return {
      space: props.chatId,
      file,
      name,
      type,
      madeBy,
      maker: madeBy ? agentDisplayName(madeBy, user.agents()) : null,
      at: fact?.at ?? null,
      where: where(),
    }
  }
  return (
    <Section label="Outputs" kind="files" chatId={props.chatId} meta={`${props.files.length}`}>
      <div class="grid grid-cols-2 gap-2" data-component="card-files">
        <For each={tiles().shown}>
          {(file) => (
            <FileCard
              compact
              entry={card(file)}
              onOpen={() => openFile(props.chatId, file.name)}
              attrs={{ "data-action": "open-file" }}
            />
          )}
        </For>
      </div>
      <Show when={tiles().more}>
        <button
          type="button"
          class={`-mx-1 flex h-7 items-center rounded-control px-1 text-left text-label text-fg3 hover:bg-hover hover:text-fg ${press}`}
          aria-label={`${tiles().more} more files`}
          data-action="open-files"
          onClick={() => openSurface(props.chatId, fixedSurface("files"))}
        >
          {`${tiles().more} more`}
        </button>
      </Show>
    </Section>
  )
}

function UsedRow(props: { icon: typeof MemoryIcon; label: string; value: string; action: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      class={`-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-row px-1 text-left hover:bg-hover ${press}`}
      data-component="card-used"
      data-action={props.action}
      onClick={props.onOpen}
    >
      <RemixIcon icon={props.icon} size={16} class="shrink-0 text-fg2" />
      <span class="shrink-0 text-ui text-fg">{props.label}</span>
      <span class="min-w-0 flex-1 truncate text-right text-hint text-fg4">{props.value}</span>
    </button>
  )
}

export function Used(props: { files: readonly FileRef[]; lines: readonly LifeLine[]; chatId: string }) {
  onMount(library.want)
  const yours = createMemo(() => {
    const made = new Map(library.files().map((f) => [f.file.id, f.madeBy]))
    return props.files.filter((file) => made.has(file.id) && made.get(file.id) === null)
  })
  const known = createMemo(() => knowns(props.lines).shown.slice(0, 2))
  const uploads = () =>
    yours()
      .map((file) => fileName(file.name))
      .join(", ")
  return (
    <Show when={yours().length > 0 || known().length > 0}>
      <Section label="Used in this chat" chatId={props.chatId}>
        <Show when={yours().length > 0}>
          <UsedRow
            icon={UploadIcon}
            label="Uploads"
            value={uploads()}
            action="open-uploads"
            onOpen={() => openSurface(props.chatId, fixedSurface("files"))}
          />
        </Show>
        <Show when={known().length > 0}>
          <UsedRow
            icon={MemoryIcon}
            label="Memory"
            value={known()
              .map((line) => line.text)
              .join(", ")}
            action="open-memory"
            onOpen={() => openSurface(props.chatId, fixedSurface("memory"))}
          />
        </Show>
      </Section>
    </Show>
  )
}
