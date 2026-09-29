import { createMemo, Show } from "solid-js";
import { Avatar } from "@kiko/ui/v2/avatar-v2";
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2";
import type { ChatMessage, RosterBot } from "../../lib/types";
import { useApp } from "../../lib/store";
import type { TimelineItem } from "../lib/grouping";
import { formatFullTimestamp, formatTimeOfDay } from "../lib/dayLabel";
import { ActionBar } from "./ActionBar";
import {
  closeReplyComposer,
  openReplyComposer,
  ReplyComposer,
  replyComposerTarget,
} from "./ReplyComposer";

export function Row(props: {
  item: Extract<TimelineItem, { kind: "message" }>;
  bot: RosterBot | undefined;
  parent: ChatMessage | undefined;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onJumpToReply: (messageId: string) => void;
}) {
  const message = () => props.item.message;
  const isUser = () => message().sender === "user";
  const name = () => (isUser() ? "You" : (props.bot?.name ?? "Unknown"));
  const parentAuthor = () =>
    props.parent?.sender === "user" ? "You" : props.bot?.name ?? "Unknown";
  const lastOfRun = () => !props.item.isFollowedByContinuation;
  const replying = createMemo(() => replyComposerTarget() === message().id);

  const submitReply = (body: string) => {
    useApp.appendReply(body, message().id, Date.now());
    closeReplyComposer(message().id);
  };

  return (
    <div
      class="chat-row"
      data-component="chat-row"
      data-continuation={String(props.item.isContinuation)}
      data-last-of-run={String(lastOfRun())}
      data-message-id={message().id}
    >
      <div class="chat-rail">
        <Show
          when={!props.item.isContinuation}
          fallback={<span>{formatTimeOfDay(message().sentAt)}</span>}
        >
          <Avatar fallback={name()} size="large" src={props.bot?.avatarImage} />
        </Show>
      </div>

      <div class="chat-cell">
        <Show when={!props.item.isContinuation}>
          <div class="chat-header">
            <span
              class="chat-author"
              classList={{ "chat-author--user": isUser() }}
              data-component="chat-author"
            >
              {name()}
            </span>
            <TooltipV2 value={formatFullTimestamp(message().sentAt)}>
              <span class="chat-time" data-component="chat-time">
                {formatTimeOfDay(message().sentAt)}
              </span>
            </TooltipV2>
          </div>
        </Show>

        <Show when={message().replyToId && props.parent}>
          <button
            type="button"
            class="chat-reply-quote"
            data-component="chat-reply-quote"
            data-reply-to={message().replyToId}
            aria-label={`Jump to the message from ${parentAuthor()}`}
            onClick={() => props.onJumpToReply(message().replyToId!)}
          >
            <span class="chat-reply-quote__author">{parentAuthor()}</span>
            <span class="chat-reply-quote__body">{props.parent?.body}</span>
          </button>
        </Show>

        <div class="chat-body" data-component="chat-body">
          {message().body}
        </div>

        <Show when={message().reactions?.length}>
          <div class="chat-reactions" data-component="chat-reactions">
            {message().reactions?.map((reaction) => (
              <button
                type="button"
                class="chat-reaction"
                data-mine={String(reaction.viewerReacted)}
                data-emoji={reaction.emoji}
                onClick={() => props.onToggleReaction(message().id, reaction.emoji)}
              >
                <span>{reaction.emoji}</span>
                <span class="chat-reaction__count">{reaction.count}</span>
              </button>
            ))}
          </div>
        </Show>

        <ActionBar
          message={message()}
          onReaction={props.onToggleReaction}
          onReply={openReplyComposer}
        />

        <Show when={replying()}>
          <ReplyComposer
            author={name()}
            quote={message().body}
            onSubmit={submitReply}
            onCancel={() => closeReplyComposer(message().id)}
          />
        </Show>
      </div>
    </div>
  );
}
