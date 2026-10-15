import { CollapsibleV2 as Collapsible } from "@kiko/ui/v2/collapsible-v2"
import { InteractiveHoverCard as HoverCard } from "@kiko/ui/v2/interactive-hover-card"
import { ChevronDownIcon, CircleHelpIcon, ListTodoIcon } from "lucide-solid"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { TaskList } from "../../chat/info/task-list"
import { taskProgress, taskText } from "../../chat/info/tasks-model"
import type { RoomStore } from "../../sync/room-store"
import { composerCards, type ComposerCard } from "./model"
import { QuestionPanel } from "./question-panel"
import type { QuestionInput } from "./question-input"
import "./cards.css"

function CardIcon(props: { card: ComposerCard }) {
  return <span class="composer-card-icon" aria-hidden="true"><Show when={props.card.kind === "ask"} fallback={<ListTodoIcon />}><CircleHelpIcon /></Show></span>
}

function CardSummary(props: { card: ComposerCard; room: RoomStore }) {
  const name = (slug: string) => props.room.members().find((m) => m.slug === slug)?.name ?? slug
  const progress = createMemo(() => taskProgress(props.room.tasks()))
  const kind = () => props.card.kind === "ask" ? `Question${props.room.members().length > 1 ? ` · ${name(props.card.ask.from)}` : ""}` : "Tasks"
  return <>
    <CardIcon card={props.card} />
    <span class="composer-card-title"><span class="composer-card-kind" data-owner={props.room.members().length > 1 && props.card.kind === "ask" ? "true" : undefined}>{kind()}</span><span class="truncate">{taskText(props.card.title, props.room.members())}</span></span>
    <span class="composer-card-actions">
      <Show when={props.card.kind === "tasks"}>
        <span class="composer-card-progress" data-component="task-progress">{progress().completed}/{progress().total}</span>
        <Show when={progress().total > 1 && progress().total <= 10}><span class="task-segments" aria-hidden="true"><For each={progress().steps}>{(task) => <i data-status={task.status} />}</For></span></Show>
      </Show>
      <ChevronDownIcon class="composer-card-toggle" />
    </span>
  </>
}

function CardBody(props: { card: ComposerCard; room: RoomStore }) {
  return <Show when={props.card.kind === "tasks"} fallback={<div class="composer-card-body"><p>{props.card.title}</p></div>}>
    <div class="composer-card-body" style={{ "padding-left": "0" }}><TaskList tasks={taskProgress(props.room.tasks()).steps} members={props.room.members()} /></div>
  </Show>
}

export function ComposerCards(props: { room: RoomStore; question: QuestionInput; onSelectAnswer: (value: string) => void }) {
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const [stackOpen, setStackOpen] = createSignal(false)
  const cards = createMemo(() => composerCards(props.question.ask() ? props.room.asks() : [], props.room.tasks()))
  const front = createMemo(() => cards()[0])
  const others = createMemo(() => cards().filter((c) => c.id !== front()?.id))
  const frontId = createMemo(() => front()?.id)
  const otherIds = createMemo(() => others().map((c) => c.id))
  createEffect(on(frontId, () => setExpanded(null)))
  createEffect(() => { if (!others().length) setStackOpen(false) })
  return <Show when={front()}>{(card) => <div class="composer-cards" data-component="composer-cards" data-front={card().kind}>
    <Show when={others().length > 0}>
      <HoverCard open={stackOpen()} onOpenChange={setStackOpen} openDelay={0} closeDelay={0} placement="top" gutter={4} sameWidth>
        <HoverCard.Trigger as="button" role="button" type="button" class="composer-card-peek" data-layers={others().length > 1} aria-label={`Show ${others().length} other ${others().length === 1 ? "card" : "cards"}`} aria-expanded={stackOpen()} onFocus={(e: FocusEvent) => e.preventDefault()} onClick={() => setStackOpen(true)}>
          <span>{others().length} more</span>
        </HoverCard.Trigger>
        <HoverCard.Portal><HoverCard.Content class="composer-card-choices" aria-label="Other activity" data-component="composer-card-stack">
          <div class="composer-card-stack-scroll"><For each={otherIds()}>{(id) => {
            const other = createMemo(() => others().find((c) => c.id === id))
            return <Show when={other()}>{(item) => <Collapsible class="composer-card-choice" defaultOpen={false}><Collapsible.Trigger class="composer-card-row"><CardSummary card={item()} room={props.room} /></Collapsible.Trigger><Collapsible.Content><CardBody card={item()} room={props.room} /></Collapsible.Content></Collapsible>}</Show>
          }}</For></div>
        </HoverCard.Content></HoverCard.Portal>
      </HoverCard>
    </Show>
    <Show when={card().kind === "ask"} fallback={
    <Collapsible class="composer-card-surface" open={expanded() === card().id} onOpenChange={(open) => setExpanded(open ? card().id : null)}>
      <Collapsible.Trigger class="composer-card-row" data-expanded={expanded() === card().id} aria-label={`${card().kind === "ask" ? `Question from ${props.room.members().find((m) => m.slug === (card() as Extract<ComposerCard, { kind: "ask" }>).ask.from)?.name ?? "your agent"}: ` : ""}${taskText(card().title, props.room.members())}`}>
        <CardSummary card={card()} room={props.room} />
      </Collapsible.Trigger>
      <Collapsible.Content><CardBody card={card()} room={props.room} /></Collapsible.Content>
    </Collapsible>
    }><div class="composer-card-surface"><QuestionPanel input={props.question} ownerSeed={props.room.members().length > 1 ? props.question.ask()?.from : undefined} owner={props.room.members().length > 1 ? props.room.members().find((m) => m.slug === props.question.ask()?.from)?.name : undefined} onSelect={props.onSelectAnswer} /></div></Show>
  </div>}</Show>
}
