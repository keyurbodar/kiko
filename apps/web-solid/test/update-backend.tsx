import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/solid-router"
import { vi } from "vitest"
import { readOnly } from "../src/app/update-flow"
import UpdateNotice from "../src/app/update-notice"
import UpdatePill from "../src/app/update-pill"
import { Composer } from "../src/composer/composer"
import type { SendBlock } from "../src/settings/send-block"

export type FakeBackend = Disposable & { descriptor: unknown; readonly started: string[] }

export function fakeBackend(descriptor: unknown): FakeBackend {
  const backend: FakeBackend = {
    descriptor,
    started: [],
    [Symbol.dispose]: () => {
      vi.unstubAllGlobals()
    },
  }
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input), location.origin).pathname
    if (path === "/api/version") return Response.json(backend.descriptor)
    if (path === "/api/update" && init?.method === "POST") {
      const { version } = JSON.parse(String(init.body)) as { version: string }
      backend.started.push(version)
      return Response.json({ stage: "uploading", to: version }, { status: 202 })
    }
    if (path === "/api/update") return Response.json({ stage: "uploading", to: backend.started.at(-1) })
    return new Response("not found", { status: 404 })
  })
  return backend
}

const ROOM = "01900000-0000-7000-8000-000000000004"
const MODEL_BLOCK: SendBlock = { reason: "Connect a model provider to chat.", actions: ["open_settings"] }

function ChatComposer() {
  return (
    <>
      <UpdatePill />
      <UpdateNotice />
      <Composer
        threadId={ROOM}
        bots={[]}
        onSend={() => true}
        disabled={readOnly()}
        sendBlock={readOnly() ? null : MODEL_BLOCK}
      />
    </>
  )
}

export function chatRouter() {
  const root = createRootRoute({ component: Outlet })
  const chat = createRoute({ getParentRoute: () => root, path: "/", component: ChatComposer })
  const connect = createRoute({ getParentRoute: () => root, path: "/connect" })
  return createRouter({
    routeTree: root.addChildren([chat, connect]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
}

export const editable = (container: HTMLElement) =>
  container.querySelector('[data-component="prompt-input"]')?.getAttribute("contenteditable") ?? null
