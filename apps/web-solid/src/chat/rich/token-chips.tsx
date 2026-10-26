import { For, Show, type JSX } from "solid-js"
import { EmojiText } from "../../lib/emoji"
import { TokenGlyph } from "../../composer/prompt-input/chip"
import "../../composer/prompt-input/prompt-input.css"
import { skillNames, titleOf, type Token } from "../../composer/tokens"
import { cards } from "../../recipes/state"
import { user } from "../../state/user"
import { slashPieces } from "./slash"

function slashToken(name: string): Token | undefined {
  const card = cards().find((c) => c.slug === name)
  if (card) return { kind: "recipe", id: `recipe:${name}`, name, title: card.title, hint: card.when }
  if (skillNames(user.homeFiles().map((file) => file.name)).includes(name))
    return { kind: "skill", id: `skill:${name}`, name, title: titleOf(name), hint: "Your skill" }
  return undefined
}

export function appToken(slug: string): Token | undefined {
  for (const card of cards())
    for (const app of card.apps)
      if (app.slug === slug) return { kind: "app", id: `app:${slug}`, slug, title: app.name, hint: app.name }
  return undefined
}

export function TokenChip(props: { token: Token }): JSX.Element {
  return (
    <span class="token-chip" data-kind={props.token.kind} data-component="chat-token" title={props.token.hint}>
      <TokenGlyph token={props.token} size={16} />
      <span class="token-chip-label">{props.token.title}</span>
    </span>
  )
}

export function TokenText(props: { text: string }): JSX.Element {
  return (
    <For each={slashPieces(props.text, slashToken)}>
      {(piece) => (
        <Show when={"token" in piece && piece.token} fallback={<EmojiText text={(piece as { text: string }).text} />}>
          {(token) => <TokenChip token={token()} />}
        </Show>
      )}
    </For>
  )
}
