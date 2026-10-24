import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/solid-router"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../test/render"
import { ConnectCloudflare } from "./connect"

const fakes = vi.hoisted(() => ({
  signedIn: { value: true },
  tokenOptions: [] as unknown[],
  signInToInstalledBackend: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock("./clerk", () => ({
  loadClerk: async () => ({
    session: fakes.signedIn.value
      ? {
          getToken: async (options: unknown) => {
            fakes.tokenOptions.push(options)
            return `clerk-${fakes.tokenOptions.length}`
          },
        }
      : null,
  }),
}))

vi.mock("./session", () => ({
  signInToInstalledBackend: fakes.signInToInstalledBackend,
  signOut: fakes.signOut,
}))

vi.mock("./first-run/progress", () => ({ enteringFresh: () => {}, setWorking: () => {} }))

type Reply = Response | "offline"

const INSTALLER_PATHS = new Set(["/install", "/detach", "/oauth/config", "/token-link"])
const BACKEND = "https://kiko.owner.workers.dev"
const ACCOUNTS = [
  { id: "acc-1", name: "Personal" },
  { id: "acc-2", name: "Team" },
]
const KEEPABLE = { script: "kiko", owner: { _tag: "Other", hint: "k•••@gmail.com" }, keepable: true }
const TOO_OLD = { script: "kiko-47ed", owner: { _tag: "Unknown" }, keepable: false }

const problem = (status: number, error: Record<string, unknown>): Reply =>
  Response.json({ error: { message: "Said by the installer.", ...error } }, { status })
const chooseAccount = () => problem(409, { code: "choose_account", retry: "same", accounts: ACCOUNTS })
const decide = (found: typeof KEEPABLE | typeof TOO_OLD) => problem(409, { code: "decide", retry: "same", found })
const installed = (): Reply => Response.json({ backendUrl: BACKEND, version: "2.0.0" })

function fakeInstaller(replies: Reply[]) {
  const installs: unknown[] = []
  const asked: string[] = []
  const real = globalThis.fetch.bind(globalThis)
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin)
    if (url.origin !== location.origin || !INSTALLER_PATHS.has(url.pathname)) return real(input, init)
    asked.push(url.pathname)
    if (url.pathname === "/token-link")
      return Response.json({ url: "https://dash.cloudflare.com/profile/api-tokens?x=1", permissions: ["Workers"] })
    if (url.pathname === "/oauth/config") return new Promise<Response>(() => {})
    installs.push(JSON.parse(String(init?.body)))
    const reply = replies.shift()
    if (!reply || reply === "offline") throw new TypeError("Failed to fetch")
    return reply
  })
  return {
    installs,
    asked,
    [Symbol.dispose]() {
      vi.unstubAllGlobals()
      sessionStorage.removeItem("kiko:connect")
      localStorage.removeItem("kiko:backend")
      fakes.signedIn.value = true
      fakes.tokenOptions.length = 0
      fakes.signInToInstalledBackend.mockReset()
      fakes.signOut.mockReset()
    },
  }
}

function routerAt(path: string) {
  const root = createRootRoute({ component: Outlet })
  const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <p data-testid="home">home</p> })
  const start = createRoute({ getParentRoute: () => root, path: "/connect", component: ConnectCloudflare })
  const callback = createRoute({ getParentRoute: () => root, path: "/connect/callback", component: ConnectCloudflare })
  return createRouter({
    routeTree: root.addChildren([home, start, callback]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

const GRANT = () => ({
  kind: "oauth",
  code: "c0de",
  verifier: "v3rifier",
  redirectUri: `${location.origin}/connect/callback`,
})

function returnFromCloudflare(search = "?code=c0de&state=st4te") {
  sessionStorage.setItem("kiko:connect", JSON.stringify({ verifier: "v3rifier", state: "st4te", reconnect: false }))
  return routerAt(`/connect/callback${search}`)
}

describe("choosing what to do with a backend that is already there", () => {
  it("picks an account, then takes over its backend with the same Cloudflare code and a fresh token each time", async () => {
    using installer = fakeInstaller([chooseAccount(), decide(KEEPABLE), installed()])
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await screen.getByRole("button", { name: "Team" }).click()
    await expect.element(screen.getByRole("heading", { name: "This account already has Kiko" })).toBeVisible()
    await expect.element(screen.getByText(/belongs to k•••@gmail\.com/)).toBeVisible()
    await screen.getByRole("button", { name: "Keep chats (take over)" }).click()

    await expect.element(screen.getByTestId("home")).toBeVisible()
    expect(localStorage.getItem("kiko:backend")).toBe(BACKEND)
    expect(fakes.signInToInstalledBackend).toHaveBeenCalledTimes(1)
    expect(installer.installs).toEqual([
      { clerkToken: "clerk-1", grant: GRANT() },
      { clerkToken: "clerk-2", grant: GRANT(), accountId: "acc-2" },
      { clerkToken: "clerk-3", grant: GRANT(), accountId: "acc-2", decision: "take_over" },
    ])
    expect(fakes.tokenOptions).toEqual([{ skipCache: true }, { skipCache: true }, { skipCache: true }])
    expect(installer.asked).not.toContain("/oauth/config")
  })

  it("starts fresh only after the owner confirms, and offers no takeover when the chats cannot be kept", async () => {
    using installer = fakeInstaller([decide(TOO_OLD), installed()])
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.element(screen.getByText(/kiko-47ed, is from an earlier install.*too old to keep/)).toBeVisible()
    expect(screen.getByRole("button", { name: "Keep chats (take over)" }).elements()).toHaveLength(0)
    await screen.getByRole("button", { name: "Start fresh (deletes its chats)" }).click()
    await expect.element(screen.getByRole("heading", { name: "Start fresh?" })).toBeVisible()
    await expect.element(screen.getByText(/deletes kiko-47ed .*cannot be undone/)).toBeVisible()
    await screen.getByRole("button", { name: "Back" }).click()
    await screen.getByRole("button", { name: "Start fresh (deletes its chats)" }).click()
    expect(installer.installs).toHaveLength(1)
    await screen.getByRole("button", { name: "Delete and start fresh" }).click()

    await expect.element(screen.getByTestId("home")).toBeVisible()
    expect(installer.installs[1]).toEqual({ clerkToken: "clerk-2", grant: GRANT(), decision: "start_fresh" })
  })

  it("goes back to the account picker it came from to use another Cloudflare account", async () => {
    using installer = fakeInstaller([chooseAccount(), decide(KEEPABLE)])
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await screen.getByRole("button", { name: "Personal" }).click()
    await screen.getByRole("button", { name: "Use another Cloudflare account" }).click()

    await expect.element(screen.getByRole("button", { name: "Team" })).toBeVisible()
    expect(installer.installs).toHaveLength(2)
    expect(installer.asked).not.toContain("/oauth/config")
  })

  it("starts a new Cloudflare sign-in to use another account when this one had a single account", async () => {
    using installer = fakeInstaller([decide(KEEPABLE)])
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await screen.getByRole("button", { name: "Use another Cloudflare account" }).click()

    await expect.element(screen.getByRole("button", { name: "Opening Cloudflare" })).toBeVisible()
    await expect.poll(() => installer.asked).toEqual(["/install", "/oauth/config"])
  })

  it("comes back to the choice without Keep chats when a takeover finds the backend too old", async () => {
    using installer = fakeInstaller([decide(KEEPABLE), problem(409, { code: "not_keepable", retry: "same" })])
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await screen.getByRole("button", { name: "Keep chats (take over)" }).click()

    await expect.element(screen.getByRole("alert")).toMatchTextContent(/too old to keep its chats/)
    await expect.element(screen.getByRole("button", { name: "Start fresh (deletes its chats)" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Keep chats (take over)" }).elements()).toHaveLength(0)
    expect(installer.installs).toHaveLength(2)
  })
})

describe("a failed install", () => {
  it("resends the same request on Try again for an error Cloudflare may clear, and says what Cloudflare said", async () => {
    using installer = fakeInstaller([
      problem(502, { code: "cloudflare_error", retry: "same", detail: "Workers subdomain not set [10063]" }),
      installed(),
    ])
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.element(screen.getByText("Cloudflare said: Workers subdomain not set [10063]")).toBeVisible()
    await screen.getByRole("button", { name: "Try again" }).click()

    await expect.element(screen.getByTestId("home")).toBeVisible()
    expect(installer.installs).toEqual([
      { clerkToken: "clerk-1", grant: GRANT() },
      { clerkToken: "clerk-2", grant: GRANT() },
    ])
    expect(installer.asked).not.toContain("/oauth/config")
  })

  it("resends with a fresh Clerk token when the sign-in expired on the way", async () => {
    using installer = fakeInstaller([problem(401, { code: "clerk_expired", retry: "same" }), installed()])
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.element(screen.getByText(/sign-in expired before the installer could check it/)).toBeVisible()
    await screen.getByRole("button", { name: "Try again" }).click()

    await expect.element(screen.getByTestId("home")).toBeVisible()
    expect(installer.installs).toEqual([
      { clerkToken: "clerk-1", grant: GRANT() },
      { clerkToken: "clerk-2", grant: GRANT() },
    ])
    expect(fakes.tokenOptions).toEqual([{ skipCache: true }, { skipCache: true }])
  })

  it("says the installer is unreachable and resends the same request", async () => {
    using installer = fakeInstaller(["offline", installed()])
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.element(screen.getByText(/Could not reach the Kiko installer/)).toBeVisible()
    await screen.getByRole("button", { name: "Try again" }).click()

    await expect.element(screen.getByTestId("home")).toBeVisible()
    expect(installer.installs).toHaveLength(2)
  })

  it("asks for a new Cloudflare sign-in for a grant error instead of resending", async () => {
    using installer = fakeInstaller([problem(403, { code: "no_permission", retry: "new-grant" })])
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.element(screen.getByText(/did not let this sign-in do a step/)).toBeVisible()
    await screen.getByRole("button", { name: "Connect Cloudflare again" }).click()

    await expect.element(screen.getByRole("button", { name: "Opening Cloudflare" })).toBeVisible()
    await expect.poll(() => installer.asked).toEqual(["/install", "/oauth/config"])
  })

  it("offers to connect again after a cancelled Cloudflare sign-in, without calling the installer", async () => {
    using installer = fakeInstaller([])
    const router = returnFromCloudflare("?error=access_denied&state=st4te")
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.element(screen.getByText(/Cloudflare sign-in was cancelled/)).toBeVisible()
    await screen.getByRole("button", { name: "Connect Cloudflare again" }).click()

    await expect.element(screen.getByRole("button", { name: "Opening Cloudflare" })).toBeVisible()
    await expect.poll(() => installer.asked).toEqual(["/oauth/config"])
  })

  it("asks for another token after a rejected one, and keeps a token whose permissions need fixing", async () => {
    using installer = fakeInstaller([
      problem(400, { code: "bad_token", retry: "token" }),
      problem(403, { code: "cannot_create", retry: "new-grant" }),
      installed(),
    ])
    const router = routerAt("/connect")
    await using screen = await render(() => <RouterProvider router={router} />)
    const field = screen.getByRole("textbox", { name: "API token" })

    await screen.getByRole("button", { name: "Use an API token instead" }).click()
    await field.fill("tok-1")
    await screen.getByRole("button", { name: "Install" }).click()
    await expect.element(screen.getByText(/does not recognise this token/)).toBeVisible()
    await expect.element(field).toHaveValue("")
    await field.fill("tok-2")
    await screen.getByRole("button", { name: "Install" }).click()
    await expect.element(screen.getByText(/can change Workers but not create one/)).toBeVisible()
    await expect.element(field).toHaveValue("tok-2")
    await screen.getByRole("button", { name: "Install" }).click()

    await expect.element(screen.getByTestId("home")).toBeVisible()
    expect(installer.installs).toEqual([
      { clerkToken: "clerk-1", grant: { kind: "token", token: "tok-1" } },
      { clerkToken: "clerk-2", grant: { kind: "token", token: "tok-2" } },
      { clerkToken: "clerk-3", grant: { kind: "token", token: "tok-2" } },
    ])
    expect(installer.asked).not.toContain("/oauth/config")
  })

  it("offers to sign in again when the Kiko sign-in ended, without calling the installer", async () => {
    using installer = fakeInstaller([])
    fakes.signedIn.value = false
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.element(screen.getByText(/Your Kiko sign-in ended/)).toBeVisible()
    await screen.getByRole("button", { name: "Sign in again" }).click()

    expect(fakes.signOut).toHaveBeenCalledTimes(1)
    expect(installer.asked).toEqual([])
  })

  it("retries only the sign-in when the backend is installed but not reachable yet", async () => {
    using installer = fakeInstaller([installed()])
    fakes.signInToInstalledBackend.mockRejectedValueOnce(new Error("This device cannot reach kiko yet. Try again."))
    const router = returnFromCloudflare()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.element(screen.getByText("This device cannot reach kiko yet. Try again.")).toBeVisible()
    await screen.getByRole("button", { name: "Try again" }).click()

    await expect.element(screen.getByTestId("home")).toBeVisible()
    expect(fakes.signInToInstalledBackend).toHaveBeenCalledTimes(2)
    expect(installer.installs).toHaveLength(1)
  })
})
