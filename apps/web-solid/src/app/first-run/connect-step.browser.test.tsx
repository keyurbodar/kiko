import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import { ConnectStep } from "./connect-step"

const fakes = vi.hoisted(() => ({ signOut: vi.fn() }))

const provider = (id: string, name: string) => ({
  id,
  name,
  connect: ["api_key"],
  signIn: { label: name },
  models: [],
})

vi.mock("../../state/runtime", () => ({
  createQuery: () => {
    const read = () => ({ providers: [provider("openai", "ChatGPT"), provider("openrouter", "OpenRouter")] })
    return Object.assign(read, { loading: false, error: undefined, refetch: async () => {} })
  },
}))
vi.mock("../../settings/catalog", () => ({ catalogQuery: () => ({}) }))
vi.mock("../../settings/connected", () => ({ connectedProviders: () => [] }))
vi.mock("../../settings/provider-kinds", () => ({ modelProviders: () => [{ provider: "openai" }] }))
vi.mock("../../settings/models", () => ({ AddProviderDialog: () => null, ConnectDialog: () => null }))
vi.mock("../session", () => ({ signOut: fakes.signOut }))
vi.mock("./progress", () => ({ move: () => {}, working: () => false }))

describe("ConnectStep", () => {
  it("keeps a connected row's note and shows Connected once", async () => {
    await using screen = await render(() => <ConnectStep />)
    const row = screen.container.querySelector<HTMLElement>('[data-provider="openai"]')!
    expect(row.querySelector(".ob-card-note")?.textContent).toBe("Use your ChatGPT Plus or Pro plan.")
    expect(row.textContent?.match(/Connected/g)).toHaveLength(1)
  })

  it("offers More providers as a row and Sign out under the primary button", async () => {
    await using screen = await render(() => <ConnectStep />)
    const more = screen.container.querySelector<HTMLElement>('[data-action="view-all-providers"]')!
    expect(more.classList.contains("ob-more")).toBe(true)
    expect(more.closest(".ob-cta")).toBeNull()
    screen.container.querySelector<HTMLButtonElement>('[data-action="sign-out"]')!.click()
    expect(fakes.signOut).toHaveBeenCalledOnce()
  })
})
