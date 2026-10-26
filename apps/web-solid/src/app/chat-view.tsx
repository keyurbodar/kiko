import { Suspense, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { useNavigate } from "@tanstack/solid-router"
import { MessageList, type VirtualThreadState } from "../chat/MessageList"
import { Composer } from "../composer/composer"
import { ModelPickerButton } from "../settings/model-picker"
import { answeringMember } from "../settings/agent-model"
import { connectedProviders, connectedReady } from "../settings/connected"
import { sendBlock } from "../settings/send-block"
import { room } from "../state/room"
import { user } from "../state/user"
import { draftBook } from "../composer/draft-book"
import type { MessageId } from "@kiko/protocol"
import type { ChatMessage, RosterBot } from "../lib/types"
import { keepArray, keepSpeakers } from "../chat/lib/members"
import { jumpRequest, requestJump } from "../search/state"
import { EmptyState } from "../chat/ui/EmptyState"
import { captureLaunch, glideToDock, type Launch } from "../chat/send-motion"
import { pageIn, replay } from "../lib/motion"
import { clearUnreadMark } from "../sidebar/unread-mark"
import { roomEmpty } from "./chat-empty"
import { useRefusalToasts } from "../chat/members/members"
import QuoteOnSelect from "../chat/QuoteOnSelect"
import UpdateNotice from "./update-notice"
import { readOnly } from "./update-flow"
import BrowserChip from "../chat/BrowserChip"

const JUMP_CLASS =
  "pointer-events-auto relative grid size-[26px] place-items-center rounded-control border border-[color-mix(in_oklab,var(--fg)_15%,transparent)] bg-[color-mix(in_oklab,var(--fg)_10%,transparent)] text-fg shadow-md backdrop-blur-md"

export function ChatView() {
  useRefusalToasts()
  const navigate = useNavigate()
  const roomId = () => room.activeId()
  createEffect(
    on(roomId, (id) => {
      if (id) clearUnreadMark(id)
    }),
  )
  createEffect(() => {
    const id = roomId()
    if (!id || !user.synced() || user.chat(id)) return
    const next = user.refused(id) ?? room.resumeChat()
    if (next && next !== id) void navigate({ to: "/chat/$roomId", params: { roomId: next }, replace: true })
  })
  createEffect(
    on(roomId, (id) => {
      if (!id || window.matchMedia("(pointer: coarse)").matches) return
      requestAnimationFrame(() => {
        const active = document.activeElement
        const typing =
          active instanceof HTMLElement &&
          (active.isContentEditable || /^(input|textarea|select)$/i.test(active.tagName))
        if (typing || (active instanceof HTMLElement && active.closest('[role="tab"]'))) return
        document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus()
      })
    }),
  )
  const [replyTarget, setReplyTarget] = createSignal<string | null>(null)
  const [editTarget, setEditTarget] = createSignal<string | null>(null)
  createEffect(on(roomId, () => setEditTarget(null), { defer: true }))
  const startEdit = (id: string) => {
    setReplyTarget(null)
    setEditTarget(id)
  }
  const [quote, setQuote] = createSignal<{ target: string; text: string } | null>(null)
  const replyQuote = () => {
    const q = quote()
    return q && q.target === replyTarget() ? q.text : undefined
  }
  const [threadState, setThreadState] = createSignal<VirtualThreadState | null>(null)
  const book = () => draftBook()
  const draftKey = () => (book()?.ready() ? (roomId() ?? "") : "")
  const [draft, setDraft] = createSignal("")
  let replyKey = ""
  createEffect(
    on(draftKey, (key) => {
      setDraft(key ? (book()?.get(key)?.text ?? "") : "")
      replyKey = ""
      setReplyTarget((key && (book()?.get(key)?.replyTo ?? null)) || null)
      replyKey = key
    }),
  )
  createEffect(
    on(
      replyTarget,
      (target) => {
        if (!replyKey || replyKey !== draftKey()) return
        book()?.save(replyKey, {
          replyTo: target !== null && !target.startsWith("local:") ? (target as MessageId) : null,
        })
      },
      { defer: true },
    ),
  )
  const members = createMemo<ReadonlyMap<string, RosterBot>>((previous) => keepSpeakers(previous, room.roomMembers()))
  const memberSlugs = createMemo<readonly string[]>((previous) => keepArray(previous, [...members().keys()]))
  const answering = createMemo(() => answeringMember(room.roomMembers(), draft()))
  const block = createMemo(() =>
    sendBlock({
      known: connectedReady() && user.modelsSynced(),
      providers: connectedProviders(),
      model: answering() && user.agentModel(answering()!.slug)?.model,
      agent: answering()?.name,
    }),
  )
  const messages = createMemo(() => room.messages())
  const scrollKey = () => roomId() ?? undefined
  const speaker = (id: string): RosterBot | undefined => {
    const member = members().get(id)
    if (member) return member
    const name = id === "kiko" ? "Kiko" : user.agents().find((a) => a.slug === id)?.name
    return name ? { id, name, preview: "", updatedAt: 0, presence: "idle", unread: 0, pinned: false } : undefined
  }
  const outsiders = createMemo(() => messages().some((m) => m.botId !== undefined && !members().has(m.botId)))
  const byId = createMemo(() => new Map<string, ChatMessage>(messages().map((message) => [message.id, message])))
  const [armed, setArmed] = createSignal<ChatMessage | null>(null)
  const aim = (id: string) => {
    setArmed(byId().get(id) ?? null)
    setReplyTarget(id)
  }
  const replyTo = createMemo(() => {
    const id = replyTarget()
    if (id === null) return null
    const kept = armed()
    return byId().get(id) ?? (kept?.id === id ? kept : null)
  })
  createEffect(() => {
    const id = replyTarget()
    if (id !== null && room.messages().length > 0 && !room.showingHistory() && replyTo() === null) {
      setReplyTarget(null)
      setQuote(null)
    }
  })

  let jumpToMessage: ((messageId: string) => void) | undefined
  let scrollToLatest: (() => void) | undefined

  let landing = false
  createEffect(() => {
    const request = jumpRequest()
    if (!request || request.roomId !== roomId()) return
    requestJump(null)
    landing = true
    void room.jumpTo(request.seq).then((found) => {
      if (!found) {
        landing = false
        return
      }
      jumpToMessage?.(request.id)
      requestAnimationFrame(() => {
        jumpToMessage?.(request.id)
        requestAnimationFrame(() => (landing = false))
      })
    })
  })
  const toLatest = () => {
    if (!room.showingHistory()) return scrollToLatest?.()
    room.goLive()
    requestAnimationFrame(() => scrollToLatest?.())
  }

  const scrolled = () => {
    const state = threadState()
    if (!state) return false
    return state.scrollOffset + state.viewportSize < state.scrollSize - 1 || room.showingHistory()
  }

  let transcript: HTMLDivElement | undefined
  const mentions = () => room.unseenMentions()
  createEffect(() => {
    threadState()
    messages()
    const ids = mentions()
    if (!ids.length || !transcript) return
    requestAnimationFrame(() => {
      if (!transcript) return
      const box = transcript.getBoundingClientRect()
      const onScreen = ids.filter((id) => {
        const row = transcript!.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
        return !!row && row.bottom > box.top && row.top < box.bottom
      })
      room.seeMentions(onScreen)
    })
  })
  const jumpToMention = () => {
    const id = mentions()[0]
    if (!id) return
    jumpToMessage?.(id)
    room.seeMentions([id])
  }

  const empty = () => {
    const snapshot = room.snapshot()
    const window = snapshot && { live: room.state()?.status === "live", seq: snapshot.seq }
    return roomEmpty(window, messages(), user.chat(roomId())?.lastSeq)
  }
  const readingLatest = () => !room.tabHidden() && !scrolled()
  createEffect(() => {
    const id = roomId()
    if (id && readingLatest() && room.hasUnread()) room.markRead(id)
  })
  let dock: HTMLDivElement | undefined
  let launch: Launch | null = null
  createEffect(on(roomId, () => replay(transcript), { defer: true }))
  createEffect(
    on(empty, (now, before) => {
      if (before && !now && dock) glideToDock(dock, launch)
      launch = null
    }),
  )

  return (
    <div
      class="flex min-h-0 min-w-0 flex-1 flex-col"
      data-component="chat-shell"
      data-session-empty={empty() ? "true" : "false"}
      data-reply-target={replyTarget() ?? undefined}
      data-range={threadState() ? `${threadState()!.rangeStart}-${threadState()!.rangeEnd}` : undefined}
    >
      <div
        class="flex min-h-0 flex-1 flex-col"
        ref={(el) => {
          transcript = el
          pageIn(el)
        }}
        data-component="chat-transcript"
      >
        <MessageList
          messages={messages()}
          botById={(id) => (id === undefined ? undefined : speaker(id))}
          replyParent={(id) => (id === undefined ? undefined : byId().get(id))}
          firstUnreadMessageId={room.firstUnreadMessageId()}
          onJumpToMessage={() => {}}
          onReplyTarget={aim}
          onJumpToSeq={(id, seq) => {
            const room = roomId()
            if (room) requestJump({ roomId: room, id: id as MessageId, seq })
          }}
          scrollRef={() => {}}
          onStateChange={setThreadState}
          onNearTop={room.loadOlder}
          onAtLatest={() => landing || room.followLatest()}
          waitingNames={room.typingNames()}
          waitingSlugs={room.typingSlugs()}
          waitingDoings={room.typingDoings()}
          groupChat={members().size > 1 || outsiders()}
          memberSlugs={memberSlugs()}
          onReact={room.toggleReaction}
          onEdit={startEdit}
          onDelete={(id) => {
            if (editTarget() === id) setEditTarget(null)
            room.deleteMessage(id)
          }}
          replyTarget={replyTarget()}
          scrollKey={scrollKey()}
          scrollBook={book() ?? undefined}
          onJumpHandle={(handle) => {
            jumpToMessage = handle.jumpToMessage
            scrollToLatest = handle.scrollToLatest
          }}
          onToLatest={toLatest}
          detached={room.showingHistory()}
        />
      </div>

      <Show when={empty()}>
        <EmptyState working={room.typingNames().length > 0} />
      </Show>
      <div
        ref={dock}
        class="composer-dock"
        data-component="composer-dock"
        data-scrolled={scrolled() ? "true" : undefined}
      >
        <Show when={mentions().length > 0}>
          <div class="pointer-events-none absolute right-3 bottom-[calc(100%+8px)] z-6">
            <button
              type="button"
              class={`${JUMP_CLASS} text-label font-medium text-info`}
              data-component="composer-jump-mention"
              title="Next mention"
              aria-label="Next mention"
              onClick={jumpToMention}
            >
              <span aria-hidden="true">@</span>
              <span
                class="absolute -top-1.5 -right-1.5 h-4 min-w-4 rounded-full bg-info px-1 text-center text-hint leading-4 text-[var(--on-fg)]"
                data-component="composer-jump-count"
              >
                {mentions().length}
              </span>
            </button>
          </div>
        </Show>

        <Suspense>
          <BrowserChip slugs={memberSlugs()} />
          <QuoteOnSelect
            onQuote={(id, text) => {
              aim(id)
              setQuote({ target: id, text })
              document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus()
            }}
          />
        </Suspense>

        <Suspense>
          <UpdateNotice />
        </Suspense>
        <Composer
          room={room.active()}
          tray={<ModelPickerButton draft={draft()} />}
          disabled={readOnly()}
          sendBlock={readOnly() ? null : block()}
          sendBlockAgent={answering()?.slug}
          threadId={roomId() ?? ""}
          title={room.chatById(roomId() ?? "")?.name}
          draftKey={draftKey()}
          draftFor={(key) => book()?.get(key)?.text ?? ""}
          onDraftChange={(key, text) => {
            book()?.save(key, { text })
            setDraft(text)
            if (text !== "") room.typing()
          }}
          bots={room.members()}
          onSend={(message) => {
            const target = replyTarget()
            const fromHistory = room.showingHistory()
            const sent = target === null ? room.send(message) : room.send(message, target, replyQuote())
            if (sent === undefined) return false
            setDraft("")
            if (empty()) launch = captureLaunch(dock)
            setQuote(null)
            if (fromHistory) requestAnimationFrame(() => scrollToLatest?.())
            else scrollToLatest?.()
            return true
          }}
          replyTo={replyTo()}
          replyQuote={replyQuote()}
          onClearReply={() => (setReplyTarget(null), setQuote(null))}
          editing={editTarget() === null ? null : (byId().get(editTarget()!) ?? null)}
          onEdit={(id, text) => room.editMessage(id, text)}
          onCancelEdit={() => setEditTarget(null)}
          onEditLast={() => {
            const last = room
              .messages()
              .toReversed()
              .find((m) => m.sender === "user" && m.seq !== undefined && m.body.trim() !== "")
            if (last) startEdit(last.id)
          }}
          onJumpToReply={(messageId) => jumpToMessage?.(messageId)}
        />
      </div>
    </div>
  )
}
