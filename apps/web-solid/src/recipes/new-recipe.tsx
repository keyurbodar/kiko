import { PlusIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { primaryButton } from "../customize/page-ui"
import { createWithKiko, startBlankRecipe } from "./create"

const item = "h-auto items-start py-2"

function Choice(props: { title: string; hint: string }) {
  return (
    <span class="flex flex-col gap-0.5 text-left">
      <span class="type-ui font-medium text-fg">{props.title}</span>
      <span class="type-label text-fg3">{props.hint}</span>
    </span>
  )
}

export function NewRecipe() {
  return (
    <MenuV2 gutter={4} placement="bottom-end">
      <MenuV2.Trigger class={primaryButton} data-action="new-recipe">
        <RemixIcon icon={PlusIcon} size={15} />
        New recipe
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="z-[80] w-70 rounded-pop">
          <MenuV2.Item class={item} data-action="create-with-kiko" onSelect={createWithKiko}>
            <Choice title="Create with Kiko" hint="Describe it in a chat" />
          </MenuV2.Item>
          <MenuV2.Item class={item} data-action="blank-recipe" onSelect={() => void startBlankRecipe()}>
            <Choice title="Start from a blank file" hint="Edit the steps yourself" />
          </MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
