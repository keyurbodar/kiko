import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import { Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { render } from "../../test/render"
import { createQuery } from "./runtime"

describe("createQuery", () => {
  it("renders a failed query inline and recovers on refetch", async () => {
    let calls = 0
    const usage = Atom.make(
      Effect.suspend(() =>
        ++calls === 1 ? Effect.fail(new Error("Storage is busy.")) : Effect.succeed({ objectBytes: 2048 }),
      ),
    )
    await using screen = await render(() => {
      const query = createQuery(() => usage)
      return (
        <section>
          <Show when={query.loading}>
            <p>Loading</p>
          </Show>
          <Show when={query.error}>
            {(message) => (
              <>
                <p role="alert">{message()}</p>
                <button type="button" onClick={query.refetch}>
                  Try again
                </button>
              </>
            )}
          </Show>
          <Show when={query()}>{(value) => <p>{value().objectBytes} bytes</p>}</Show>
        </section>
      )
    })

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Storage is busy.")
    await screen.getByRole("button", { name: "Try again" }).click()
    await expect.element(screen.getByText("2048 bytes")).toBeVisible()
    expect(screen.getByRole("alert").elements()).toHaveLength(0)
    expect(calls).toBe(2)
  })
})
