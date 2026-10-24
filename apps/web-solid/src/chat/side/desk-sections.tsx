import { fileName, type FileRef, type HumanAsk, type LifeLine, type Task, type WorkerRow } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, ChevronRightIcon, ClockIcon, WorkerIcon } from "@kiko/ui/icons"
import { createContext, createMemo, For, type JSX, Show, useContext } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { agentDisplayName } from "../../lib/names"
import { room } from "../../state/room"
import type { Routine } from "../info/routines"
import { triggerLabel } from "../info/routines-model"
import { taskText } from "../info/tasks-model"
import { deskTasks, fileLook, fileTiles, helperLabel, helpers, knowns, nowProgress, waiting } from "./desk-model"
import { type FixedKind, fixedSurface, openFile, openSurface } from "./surfaces"
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
        fallback={<h3 class="flex h-7 items-center px-1 font-sans text-label font-normal text-fg3">{props.label}</h3>}
      >
        <button
          type="button"
          class={`group/head -mx-1 flex h-7 items-center rounded-control px-1 text-left text-label text-fg3 hover:bg-hover hover:text-fg ${press}`}
          data-action={`open-${props.kind}`}
          aria-label={`Open ${props.label}`}
          onClick={open}
        >
          <span class="min-w-0 flex-1 truncate">{props.label}</span>
          <span class="shrink-0 text-hint text-fg4">{props.meta}</span>
          <RemixIcon
            icon={ChevronRightIcon}
            size={13}
            class="ml-0.5 w-0 shrink-0 text-fg3 opacity-0 transition-[opacity,width,transform] duration-(--dur-hover) ease-kiko group-hover/head:w-[13px] group-hover/head:translate-x-0.5 group-hover/head:opacity-100"
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
      <div class="mt-2.5 h-1 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label="Progress">
        <div
          class="desk-bar h-full rounded-full bg-fg2"
          data-indeterminate={fraction() === null ? "" : undefined}
          style={fraction() === null ? undefined : { width: `${Math.max(6, (fraction() ?? 0) * 100)}%` }}
        />
      </div>
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
              class={`h-8 rounded-control bg-fg px-3 text-[13px] font-medium text-on-fg hover:opacity-90 ${press}`}
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
              class={`h-8 max-w-full truncate rounded-control px-3 text-[13px] font-medium ${press} ${
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

function Box(props: { status: Task["status"] }) {
  return (
    <span
      class="grid size-[18px] shrink-0 place-items-center rounded-check text-on-fg data-[status=done]:bg-fg data-[status!=done]:bg-hover"
      data-status={props.status}
    >
      <Show when={props.status === "done"}>
        <RemixIcon icon={CheckIcon} size={12} />
      </Show>
      <Show when={props.status === "doing"}>
        <span class="desk-pulse size-1.5 rounded-full bg-fg" />
      </Show>
    </span>
  )
}

export function Tasks(props: { tasks: readonly Task[]; chatId: string }) {
  const desk = createMemo(() => deskTasks(props.tasks))
  const members = () => room.roomMembers()
  return (
    <Section label="Tasks" kind="tasks" chatId={props.chatId} meta={`${desk().completed} of ${desk().total}`}>
      <ul class="flex flex-col" aria-label="Tasks">
        <For each={desk().shown}>
          {(task) => (
            <li
              class="flex min-h-9 items-center gap-2.5 px-1 py-1.5"
              data-component="card-task"
              data-status={task.status}
            >
              <Box status={task.status} />
              <span
                class={`min-w-0 flex-1 truncate text-ui ${task.status === "done" ? "text-fg4 line-through" : "text-fg"}`}
              >
                {taskText(task.title, members())}
              </span>
              <Show when={task.owner}>{(slug) => <IdentityAvatar seed={slug()} size={20} />}</Show>
            </li>
          )}
        </For>
      </ul>
      <Show when={desk().more}>
        <span class="px-1 text-hint text-fg4">{`+${desk().more} more`}</span>
      </Show>
    </Section>
  )
}

export function Helpers(props: { workers: readonly WorkerRow[]; chatId: string }) {
  const sorted = createMemo(() => helpers(props.workers))
  const running = () => sorted().filter((w) => w.status === "running" || w.status === "pending").length
  return (
    <Section
      label="Helpers"
      chatId={props.chatId}
      meta={running() ? `${running()} of ${sorted().length} working` : `${sorted().length}`}
    >
      <ul class="flex flex-wrap gap-1.5" aria-label="Helpers">
        <For each={sorted()}>
          {(worker) => (
            <li
              class="flex h-7 max-w-full items-center gap-1.5 rounded-full bg-active pr-2.5 pl-2 text-[13px] text-fg"
              data-component="card-helper"
              data-status={worker.status}
            >
              <RemixIcon icon={WorkerIcon} size={13} class="shrink-0 text-fg2" />
              <span class="truncate">{worker.task}</span>
              <span
                class={`shrink-0 text-hint ${worker.status === "done" ? "text-ok" : worker.status === "failed" ? "text-bad" : "text-fg3"}`}
              >
                {helperLabel(worker)}
              </span>
            </li>
          )}
        </For>
      </ul>
    </Section>
  )
}

export function Files(props: { files: readonly FileRef[]; chatId: string }) {
  const tiles = createMemo(() => fileTiles(props.files))
  return (
    <Section label="Files" kind="files" chatId={props.chatId} meta={`${props.files.length}`}>
      <div class="flex flex-wrap gap-2 px-px" data-component="card-files">
        <For each={tiles().shown}>
          {(file) => {
            const look = () => fileLook(file.name)
            return (
              <button
                type="button"
                class={`desk-tile grid h-10 w-9 place-items-center rounded-row bg-active text-fg2 hover:-translate-y-px ${press}`}
                style={
                  look().hue
                    ? { background: `color-mix(in srgb, ${look().hue} 12%, transparent)`, color: look().hue! }
                    : undefined
                }
                title={fileName(file.name)}
                aria-label={fileName(file.name)}
                data-action="open-file"
                onClick={() => openFile(props.chatId, file.name)}
              >
                <RemixIcon icon={look().glyph} size={18} />
              </button>
            )
          }}
        </For>
        <Show when={tiles().more}>
          <button
            type="button"
            class={`grid h-10 min-w-9 place-items-center rounded-row bg-active px-2 text-[13px] text-fg3 hover:text-fg ${press}`}
            aria-label={`${tiles().more} more files`}
            data-action="open-files"
            onClick={() => openSurface(props.chatId, fixedSurface("files"))}
          >
            {`+${tiles().more}`}
          </button>
        </Show>
      </div>
    </Section>
  )
}

export function Routines(props: { routines: readonly Routine[]; chatId: string }) {
  const active = () => props.routines.filter((r) => r.status === "active").length
  return (
    <Section
      label="Routines"
      kind="routines"
      chatId={props.chatId}
      meta={active() ? `${active()} active` : `${props.routines.length} paused`}
    >
      <ul class="flex flex-col" aria-label="Routines">
        <For each={props.routines.slice(0, 3)}>
          {(routine) => (
            <li class="flex min-h-9 items-center gap-2.5 px-1 py-1.5" data-component="card-routine">
              <RemixIcon icon={ClockIcon} size={16} class="shrink-0 text-fg2" />
              <span class="min-w-0 flex-1 truncate text-ui text-fg">{routine.name}</span>
              <span class="max-w-[45%] shrink-0 truncate text-hint text-fg4">
                {routine.status === "active" ? triggerLabel(routine.trigger, routine.tz) : "Paused"}
              </span>
            </li>
          )}
        </For>
      </ul>
    </Section>
  )
}

export function Memory(props: { lines: readonly LifeLine[]; more: boolean; whose: string; chatId: string }) {
  const known = createMemo(() => knowns(props.lines))
  const open = () => openSurface(props.chatId, fixedSurface("memory"))
  return (
    <Section
      label={`${props.whose} knows here`}
      kind="memory"
      chatId={props.chatId}
      meta={`${props.lines.filter((l) => !l.redacted).length}${props.more ? "+" : ""}`}
    >
      <div class="flex flex-wrap gap-1.5" data-component="card-memory">
        <For each={known().shown}>
          {(line) => (
            <button
              type="button"
              class={`h-7 max-w-full truncate rounded-full bg-active px-3 text-[13px] text-fg hover:bg-hover ${press}`}
              data-action="open-memory"
              title={line.text}
              onClick={open}
            >
              {line.text}
            </button>
          )}
        </For>
        <Show when={known().more}>
          <button
            type="button"
            class={`h-7 rounded-full px-2.5 text-[13px] text-fg3 hover:bg-hover hover:text-fg ${press}`}
            onClick={open}
          >
            {`+${known().more}`}
          </button>
        </Show>
      </div>
    </Section>
  )
}

export const leadName = (): string => {
  const members = room.roomMembers()
  return (members.find((m) => m.lead) ?? members[0])?.name ?? "Kiko"
}
