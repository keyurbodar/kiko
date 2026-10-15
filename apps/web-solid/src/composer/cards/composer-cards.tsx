import { type ToolKind } from "@kiko/protocol"
import { Dynamic } from "solid-js/web"
import { A } from "@solidjs/router"
import { CollapsibleV2 as Collapsible } from "@kiko/ui/v2/collapsible-v2"
import { InteractiveHoverCard as HoverCard } from "@kiko/ui/v2/interactive-hover-card"
import { ArrowUpRightIcon, FileTextIcon, FilePenLineIcon, TerminalIcon, GlobeIcon, WrenchIcon, ChevronDownIcon, CircleDotIcon, CircleHelpIcon, ClockIcon, ListTodoIcon, LoaderCircleIcon, SearchIcon, SquareIcon, TriangleAlertIcon, XIcon } from "lucide-solid"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { TaskList } from "../../chat/info/task-list"
import { taskProgress } from "../../chat/info/tasks-model"
import type { RoomStore } from "../../sync/room-store"
import { composerCards, type ComposerCard } from "./model"
import { QuestionPanel } from "./question-panel"
import type { QuestionInput } from "./question-input"
import "./cards.css"

const TOOL_ICONS: Record<ToolKind, typeof SearchIcon> = { read: FileTextIcon, edit: FilePenLineIcon, search: SearchIcon, run: TerminalIcon, web: GlobeIcon, other: WrenchIcon }

function CardIcon(props: { card: ComposerCard }) {
  const activity = () => props.card.kind === "activity" ? props.card.agent.activity : undefined
  return <span class="composer-card-icon" aria-hidden="true">
    <Show when={props.card.kind === "ask"}><CircleHelpIcon /></Show>
    <Show when={props.card.kind === "tasks"}><ListTodoIcon /></Show>
    <Show when={props.card.kind === "created"}><ArrowUpRightIcon /></Show>
    <Show when={props.card.kind === "provider"}><TriangleAlertIcon /></Show>
    <Show when={props.card.kind === "activity"}>
      <Show when={activity()?.kind === "failed"} fallback={
        <Show when={activity()?.kind === "waiting"} fallback={
          <Show when={activity()?.kind === "tool" ? activity() : undefined} fallback={<LoaderCircleIcon />}>{(tool) => <Dynamic component={(() => { const a = tool(); return a.kind === "tool" ? TOOL_ICONS[a.tool] : WrenchIcon })()} />}</Show>
        }><ClockIcon /></Show>
      }><TriangleAlertIcon /></Show>
    </Show>
  </span>
}

function CardSummary(props: { card: ComposerCard; room: RoomStore }) {
  const name = (slug: string) => props.room.members().find((m) => m.slug === slug)?.name ?? slug
  const progress = createMemo(() => taskProgress(props.room.tasks()))
  const kind = () => props.card.kind === "ask" ? `Question${props.room.members().length > 1 ? ` · ${name(props.card.ask.from)}` : ""}` : props.card.kind === "tasks" ? "Tasks" : props.card.kind === "activity" ? name(props.card.agent.slug) : props.card.kind === "provider" ? "Connection" : "Chat"
  return <>
    <CardIcon card={props.card} />
    <span class="composer-card-title"><span class="composer-card-kind" data-owner={props.room.members().length > 1 && (props.card.kind === "ask" || props.card.kind === "activity") ? "true" : undefined}>{kind()}</span><span class="truncate">{props.card.title}</span></span>
    <span class="composer-card-actions">
      <Show when={props.card.kind === "tasks"}>
        <span class="composer-card-progress" data-component="task-progress">{progress().completed}/{progress().total}</span>
        <Show when={progress().total > 1 && progress().total <= 10}><span class="task-segments" aria-hidden="true"><For each={progress().steps}>{(task) => <i data-status={task.status} />}</For></span></Show>
      </Show>
      <ChevronDownIcon class="composer-card-toggle" />
    </span>
  </>
}

function CardBody(props: { card: ComposerCard; room: RoomStore; portalMount?: HTMLElement; dismiss: (id: string) => void }) {
  return <>
    <Show when={props.card.kind === "provider"}><div class="composer-card-body"><p>Connect a model provider so your agent can reply.</p><div class="composer-card-footer"><A class="composer-card-button" data-primary href="/settings/models">Connect provider<ArrowUpRightIcon class="size-3" /></A></div></div></Show>
    <Show when={props.card.kind === "ask"}><div class="composer-card-body"><p>{props.card.title}</p></div></Show>
    <Show when={props.card.kind === "tasks"}>
      <div class="composer-card-body" style={{ "padding-left": "0" }}>
        <TaskList portalMount={props.portalMount} tasks={taskProgress(props.room.tasks()).steps} group={props.room.members().length > 1} onStatus={(id, status) => props.room.task({ op: "update", id, status })} />
      </div>
    </Show>
    <Show when={props.card.kind === "activity" ? props.card : undefined}>{(card) => <div class="composer-card-body">
      <p>{card().title}</p>
      <Show when={card().agent.activity?.kind === "background" ? card().agent.activity : undefined}>{(activity) => <For each={(() => { const a = activity(); return a.kind === "background" ? a.workers : [] })()}>{(worker) => <div class="flex items-center gap-2 py-1 text-sm text-muted-foreground"><CircleDotIcon class="size-3 shrink-0" /><span class="min-w-0 break-words">{worker.task}</span><Show when={worker.step}><span class="text-xs text-secondary-label">{worker.step}</span></Show></div>}</For>}</Show>
      <div class="composer-card-footer"><button type="button" class="composer-card-button" onClick={() => props.room.stop()}><SquareIcon class="size-3" />{props.room.members().length > 1 ? "Stop all agents" : "Stop work"}</button></div>
    </div>}</Show>
    <Show when={props.card.kind === "created" ? props.card : undefined}>{(card) => <div class="composer-card-body"><div class="composer-card-footer">
      <button type="button" class="composer-card-button" onClick={() => props.dismiss(card().message.id)}><XIcon class="size-3" />Dismiss</button>
      <A class="composer-card-button" data-primary href={`/chat/${card().message.goto}`}>Open chat<ArrowUpRightIcon class="size-3" /></A>
    </div></div>}</Show>
  </>
}

export function ComposerCards(props: { room: RoomStore; needsProvider?: boolean; question: QuestionInput; onSelectAnswer: (value: string) => void }) {
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const [stackOpen, setStackOpen] = createSignal(false)
  const [stackElement, setStackElement] = createSignal<HTMLElement>()
  const [dismissed, setDismissed] = createSignal<ReadonlySet<string>>(new Set())
  const cards = createMemo(() => {
    const items = composerCards(props.question.ask() ? props.room.asks() : [], props.room.tasks(), props.room.state.agents, props.room.state.messages, dismissed())
    if (props.needsProvider) {
      const at = items.findIndex((c) => c.kind !== "ask")
      items.splice(at < 0 ? items.length : at, 0, { id: "provider", kind: "provider", title: "Connect a provider to reply" })
    }
    return items
  })
  const front = createMemo(() => cards()[0])
  const others = createMemo(() => cards().filter((c) => c.id !== front()?.id))
  const frontId = createMemo(() => front()?.id)
  const otherIds = createMemo(() => others().map((c) => c.id))
  createEffect(on(frontId, () => setExpanded(null)))
  createEffect(() => { if (!others().length) setStackOpen(false) })
  const dismiss = (id: string) => setDismissed((ids) => new Set([...ids, id]))
  return <Show when={front()}>{(card) => <div class="composer-cards" data-component="composer-cards" data-front={card().kind}>
    <Show when={others().length > 0}>
      <HoverCard open={stackOpen()} onOpenChange={setStackOpen} openDelay={0} closeDelay={0} placement="top" gutter={4} sameWidth>
        <HoverCard.Trigger as="button" role="button" type="button" class="composer-card-peek" data-layers={others().length > 1} aria-label={`Show ${others().length} other ${others().length === 1 ? "card" : "cards"}`} aria-expanded={stackOpen()} onFocus={(e: FocusEvent) => e.preventDefault()} onClick={() => setStackOpen(true)}>
          <span>{others().length} more</span>
        </HoverCard.Trigger>
        <HoverCard.Portal><HoverCard.Content ref={setStackElement} class="composer-card-choices" aria-label="Other activity" data-component="composer-card-stack">
          <div class="composer-card-stack-scroll"><For each={otherIds()}>{(id) => {
            const other = createMemo(() => others().find((c) => c.id === id))
            return <Show when={other()}>{(item) => <Collapsible class="composer-card-choice" defaultOpen={item().kind === "activity" || item().kind === "created"}><Collapsible.Trigger class="composer-card-row"><CardSummary card={item()} room={props.room} /></Collapsible.Trigger><Collapsible.Content><CardBody card={item()} room={props.room} portalMount={stackElement()} dismiss={dismiss} /></Collapsible.Content></Collapsible>}</Show>
          }}</For></div>
        </HoverCard.Content></HoverCard.Portal>
      </HoverCard>
    </Show>
    <Show when={card().kind === "ask"} fallback={
    <Collapsible class="composer-card-surface" open={expanded() === card().id} onOpenChange={(open) => setExpanded(open ? card().id : null)}>
      <Collapsible.Trigger class="composer-card-row" data-expanded={expanded() === card().id} aria-label={`${card().kind === "ask" ? `Question from ${props.room.members().find((m) => m.slug === (card() as Extract<ComposerCard, { kind: "ask" }>).ask.from)?.name ?? "your agent"}: ` : ""}${card().title}`}>
        <CardSummary card={card()} room={props.room} />
      </Collapsible.Trigger>
      <Collapsible.Content><CardBody card={card()} room={props.room} dismiss={dismiss} /></Collapsible.Content>
    </Collapsible>
    }><div class="composer-card-surface"><QuestionPanel input={props.question} owner={props.room.members().length > 1 ? props.room.members().find((m) => m.slug === props.question.ask()?.from)?.name : undefined} onSelect={props.onSelectAnswer} /></div></Show>
  </div>}</Show>
}
