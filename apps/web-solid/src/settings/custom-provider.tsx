import type { CustomApi, ProviderInfo } from "@kiko/protocol"
import { Segmented } from "@kiko/ui/v2/segmented"
import { createSignal, Show } from "solid-js"
import { cn } from "../lib/cn"
import { Dialog } from "../lib/dialog"
import { call, owner } from "../state/runtime"
import { SecretInput } from "./connect-parts"
import { Button, fieldClass } from "./kit"

const PLACEHOLDER: Record<CustomApi, string> = {
  "openai-completions": "https://api.example.com/v1",
  "anthropic-messages": "https://api.example.com",
}

const addCustomProvider = (input: {
  name: string
  api: CustomApi
  baseUrl: string
  apiKey: string
}): Promise<ProviderInfo> => call(owner.commands.credentialsAddCustom, input, "Kiko could not add that provider.")

function Field(props: { id: string; label: string; placeholder: string; ref: (el: HTMLInputElement) => void }) {
  return (
    <div class="flex flex-col gap-1.5">
      <label class="type-label text-[var(--fg3)]" for={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        ref={props.ref}
        class={cn(fieldClass, "w-full")}
        placeholder={props.placeholder}
        autocomplete="off"
        spellcheck={false}
        data-field={props.id}
      />
    </div>
  )
}

export function CustomProviderDialog(props: { open: boolean; onClose: () => void; onAdded: (name: string) => void }) {
  const [api, setApi] = createSignal<CustomApi>("openai-completions")
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  let name: HTMLInputElement | undefined
  let url: HTMLInputElement | undefined
  let key: HTMLInputElement | undefined

  const close = () => {
    setError(null)
    props.onClose()
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const input = {
      name: name?.value.trim() ?? "",
      api: api(),
      baseUrl: url?.value.trim() ?? "",
      apiKey: key?.value.trim() ?? "",
    }
    if (!input.name || !input.baseUrl || !input.apiKey) return setError("Fill in the name, base URL and key.")
    setBusy(true)
    setError(null)
    try {
      await addCustomProvider(input)
      props.onAdded(input.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kiko could not add that provider.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={close}
      title="Custom provider"
      description="Any OpenAI or Anthropic compatible endpoint. Kiko lists its models from the endpoint itself."
      onSubmit={submit}
      data-component="custom-provider"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy()} data-action="add-custom-provider">
            Add provider
          </Button>
        </>
      }
    >
      <div class="flex flex-col gap-4">
        <Segmented<CustomApi>
          label="API"
          value={api()}
          onChange={setApi}
          options={[
            { value: "openai-completions", label: "OpenAI compatible" },
            { value: "anthropic-messages", label: "Anthropic compatible" },
          ]}
        />
        <Field id="custom-name" label="Name" placeholder="My gateway" ref={(el) => (name = el)} />
        <Field id="custom-url" label="Base URL" placeholder={PLACEHOLDER[api()]} ref={(el) => (url = el)} />
        <SecretInput id="custom-key" label="API key" ref={(el) => (key = el)} />
        <Show when={error()}>
          <p class="type-label text-[var(--danger)]" role="alert" data-component="custom-provider-error">
            {error()}
          </p>
        </Show>
      </div>
    </Dialog>
  )
}
