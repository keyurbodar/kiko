import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { IdentityAvatar } from "../../lib/IdentityAvatar";
import { motionOf, type Motion } from "./action";
import { describe } from "./create-typing-presence";
import { useApp } from "../../lib/store";
import { RunChevron } from "../run/RunChevron";
import "./typing.css";

/*
 * Kat's typing bubble, one per working agent. A reply lands as whole bubbles, so this is all
 * the reader sees of a run until a bubble arrives. The three dots say what the agent is doing
 * by how they move: kat's wave while it writes, a scan while it reads, a hop while it edits, an
 * orbit while a tool runs. A slow act also gets a muted caption. In a group each row carries
 * the agent's avatar in the gutter, the same avatar as on its messages.
 */

export interface TypingIndicatorProps {
  typists: string[];
  /** The typists' slugs, in the same order, so each avatar is the agent's own. */
  seeds?: readonly string[];
  /** What each typist is doing, in the same order, such as "editing /hello.html". */
  doings?: readonly (string | undefined)[];
  /** A group chat: each row carries its agent's avatar, as its messages do. */
  group?: boolean;
  max?: number;
  announceAfter?: number;
  class?: string;
}

const ROWS = 3;

/** How long an act runs before its caption shows, so a quick tool call never flashes words. */
const CAPTION_AFTER_MS = 2000;

/** The room reports "reading a web page"; a caption on its own line starts with a capital. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Row(props: { seed: string; doing?: string; group?: boolean }) {
  const motion = () => motionOf(props.doing);
  const [caption, setCaption] = createSignal<string>();
  createEffect(
    on(
      () => (motion() === "wave" ? undefined : props.doing),
      (doing) => {
        setCaption(undefined);
        if (!doing) return;
        const timer = setTimeout(() => setCaption(sentence(doing)), CAPTION_AFTER_MS);
        onCleanup(() => clearTimeout(timer));
      },
    ),
  );
  return (
    <div class="typing" data-component="typing-row" data-motion={motion()}>
      <Show when={props.group}>
        <IdentityAvatar seed={props.seed} size={32} class="typing-bird" />
      </Show>
      <div class="typing-bubble" aria-hidden="true">
        <span class="typing-dots">
          <span class="typing-dot" />
          <span class="typing-dot" />
          <span class="typing-dot" />
        </span>
      </div>
      <Show when={useApp.typingRun(props.seed)}>{(runId) => <RunChevron runId={runId()} class="typing-run" />}</Show>
      <span class="typing-doing" data-component="typing-doing" aria-hidden="true">
        {caption()}
      </span>
    </div>
  );
}

export function TypingIndicator(props: TypingIndicatorProps) {
  const max = () => props.max ?? 2;
  const label = createMemo(() => {
    const doing = props.doings?.[0];
    if (props.typists.length === 1 && motionOf(doing) !== "wave") return `${props.typists[0]} is ${doing}`;
    return describe(props.typists, max());
  });
  const rows = createMemo(() => props.typists.slice(0, ROWS).map((name, i) => props.seeds?.[i] ?? name));
  const more = () => props.typists.length - ROWS;

  // The screen reader text trails the typing state. It is the only label read out.
  const [announced, setAnnounced] = createSignal(label());
  createEffect(
    on(
      label,
      (text) => {
        const timer = setTimeout(() => setAnnounced(text), props.announceAfter ?? 700);
        onCleanup(() => clearTimeout(timer));
      },
      { defer: true },
    ),
  );

  return (
    <div class={`typing-stack ${props.class ?? ""}`} data-component="typing-indicator">
      <For each={rows()}>{(seed, i) => <Row seed={seed} doing={props.doings?.[i()]} group={props.group} />}</For>
      <Show when={more() > 0}>
        <span class="typing-more" data-group={props.group ? "" : undefined} aria-hidden="true">
          And {more()} {more() === 1 ? "other" : "others"}
        </span>
      </Show>
      <span class="typing-sr" role="status" aria-live="polite" aria-atomic="true">
        {announced()}
      </span>
    </div>
  );
}
