import type {
  AuthContext,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  CredentialStore,
  OAuthCredential,
  Provider,
} from "@earendil-works/pi-ai"
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth"
import { createModels } from "@earendil-works/pi-ai/models"
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic"
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot"
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding"
import { metaProvider } from "@earendil-works/pi-ai/providers/meta"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai"
import type { LoginErrorReason, LoginEvent, LoginPrompt, UserToClient } from "@yuki/protocol"
import { isProviderId, type ProviderInfo } from "./credentials"

// Architecture section 11.4. `UserDO` runs pi-ai's `Models.login` and bridges its two
// interaction callbacks over the user socket: `notify` becomes a `login.notify` frame,
// and `prompt` becomes a `login.prompt` frame that a `login.answer` frame resolves.
//
// A login lives only in memory, in this object, tied to the socket that started it.
// It ends in exactly one of five ways, and each one removes all of its state: the
// credential is stored, the flow fails, the user cancels, the socket closes, or the
// 10-minute wakeup fires. A login that outlives an eviction is simply gone; its wakeup
// finds nothing and the client hears `unknown` when it answers.

export const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
/** Logins one user may run at once. One per provider, and a few providers at most. */
export const MAX_LOGINS = 4
const WAKEUP_PREFIX = "login:"

// pi-ai loads each OAuth module through a variable `import()` so bundlers skip it. A
// Worker has no files to import at run time, so register the statically bundled flows
// once. ASSUMPTION: the helper is named for Bun binaries but only fills pi-ai's loader
// table, which is what a Worker bundle needs too.
registerBunOAuthFlows()

/**
 * The sign-in flows yuki runs. Experiment 6 showed every pi-ai flow module imports on
 * Workers, but a Worker cannot listen on a loopback port. So only flows with a device
 * code or a pasted code are here. When a flow asks to choose a method, `select` is the
 * answer the server gives on the user's behalf: the one that needs no loopback server.
 * OpenRouter, OpenAI ChatGPT, and Radius need a loopback server and are left out.
 */
const FLOWS: Record<string, { provider: () => Provider; select?: string }> = {
  anthropic: { provider: anthropicProvider, select: "copy_code" },
  "github-copilot": { provider: githubCopilotProvider },
  "kimi-coding": { provider: kimiCodingProvider },
  meta: { provider: metaProvider },
  "openai-codex": { provider: openaiCodexProvider, select: "device_code" },
  xai: { provider: xaiProvider },
}

/** True when yuki can run a sign-in flow for this provider. The flag decides if it may. */
export function hasSignIn(provider: string): boolean {
  return Object.hasOwn(FLOWS, provider)
}

// The test provider. Only a development bundle offers it. Its flow uses both
// callbacks: it shows a device code, then asks for that code back.

export const FAKE_PROVIDER = "yuki-fake"
export const FAKE_CODE = "YUKI-0000"

export function fakeProvider(): Provider {
  return {
    id: FAKE_PROVIDER,
    name: "yuki fake",
    auth: {
      oauth: {
        name: "yuki fake sign-in",
        async login(interaction): Promise<OAuthCredential> {
          interaction.notify({
            type: "device_code",
            userCode: FAKE_CODE,
            verificationUri: "https://example.invalid/device",
            expiresInSeconds: LOGIN_TIMEOUT_MS / 1000,
          })
          const code = await interaction.prompt({ type: "manual_code", message: "type the code shown above" })
          if (code.trim() !== FAKE_CODE) throw new Error("that code is wrong")
          interaction.notify({ type: "progress", message: "code accepted" })
          return { type: "oauth", access: `fake-${crypto.randomUUID()}`, refresh: "fake", expires: Date.now() + 3_600_000 }
        },
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
    getModels: () => [],
    stream: noModels,
    streamSimple: noModels,
  }
}

function noModels(): never {
  throw new Error("the fake provider only signs in")
}

/** A login reads no environment and no files. The vault is the only credential source. */
const NO_AMBIENT: AuthContext = { env: async () => undefined, fileExists: async () => false }

export interface LoginDeps<Owner> {
  store: CredentialStore
  /** The row the credentials list shows. Never a secret. */
  info(provider: string): ProviderInfo | null
  send(owner: Owner, frame: UserToClient): void
  setWakeup(key: string, at: number): Promise<void>
  clearWakeup(key: string): Promise<void>
  /** The `PROVIDER_OAUTH` flag. Subscription sign-in runs only when it is on. */
  subscriptions: boolean
  /** Offer the fake provider. Development only. */
  fake: boolean
  now?: () => number
}

type Waiter = { resolve(value: string): void; reject(error: Error): void }

type Login<Owner> = {
  id: string
  provider: string
  owner: Owner
  controller: AbortController
  prompts: Map<string, Waiter>
  promptCount: number
}

type Ending = { reason: LoginErrorReason; message: string } | null

/** Every running login of one user. `Owner` is the socket, so a test can use any value. */
export class ProviderLogins<Owner> {
  private readonly logins = new Map<string, Login<Owner>>()

  constructor(private readonly deps: LoginDeps<Owner>) {}

  /** How many logins hold state. Zero when nothing is running. */
  get size(): number {
    return this.logins.size
  }

  /** Runs one login to its end. Resolves when it has ended, however it ended. */
  async start(owner: Owner, loginId: string, providerId: string): Promise<void> {
    const refuse = (reason: LoginErrorReason, message: string) =>
      this.deps.send(owner, { t: "login.error", loginId, reason, message })
    if (this.logins.has(loginId)) return refuse("failed", "this sign-in is already running")
    const provider = this.provider(providerId)
    const oauth = provider?.auth.oauth
    if (!provider || !oauth) return refuse("unsupported", "this provider has no sign-in yuki can run. use an api key")
    if (oauth.isSubscription && !this.deps.subscriptions) {
      return refuse("disabled", "subscription sign-in is off on this server. use an api key")
    }
    for (const other of [...this.logins.values()]) {
      if (other.provider === providerId) this.end(other, { reason: "cancelled", message: "a newer sign-in replaced this one" })
    }
    if (this.logins.size >= MAX_LOGINS) return refuse("failed", "too many sign-ins are running")

    const login: Login<Owner> = {
      id: loginId,
      provider: providerId,
      owner,
      controller: new AbortController(),
      prompts: new Map(),
      promptCount: 0,
    }
    this.logins.set(loginId, login)
    const now = this.deps.now?.() ?? Date.now()
    await this.deps.setWakeup(WAKEUP_PREFIX + loginId, now + LOGIN_TIMEOUT_MS)

    const models = createModels({ credentials: this.deps.store, authContext: NO_AMBIENT })
    models.setProvider(provider)
    const select = FLOWS[providerId]?.select
    const interaction: AuthInteraction = {
      signal: login.controller.signal,
      notify: (event) => {
        if (this.live(login)) this.deps.send(owner, { t: "login.notify", loginId, event: wireEvent(event) })
      },
      prompt: (prompt) => this.ask(login, prompt, select),
    }
    try {
      await models.login(providerId, "oauth", interaction)
    } catch (error) {
      // An ended login already told the client why. The flow's error text is short and
      // holds no secret, but it is never logged.
      if (this.live(login)) this.end(login, { reason: "failed", message: failure(error) })
      return
    }
    if (!this.live(login)) return
    this.end(login, null)
    const info = this.deps.info(providerId)
    if (info) this.deps.send(owner, { t: "login.done", loginId, provider: info })
    else this.deps.send(owner, { t: "login.error", loginId, reason: "failed", message: "the sign-in was not saved" })
  }

  answer(owner: Owner, loginId: string, promptId: string, value: string): void {
    const login = this.owned(owner, loginId)
    const waiter = login?.prompts.get(promptId)
    if (!login || !waiter) return this.unknown(owner, loginId)
    login.prompts.delete(promptId)
    waiter.resolve(value)
  }

  cancel(owner: Owner, loginId: string): void {
    const login = this.owned(owner, loginId)
    if (!login) return this.unknown(owner, loginId)
    this.end(login, { reason: "cancelled", message: "sign-in cancelled" })
  }

  /** The socket closed. Its logins end without a word, since nobody is listening. */
  dropOwner(owner: Owner): void {
    for (const login of [...this.logins.values()]) if (login.owner === owner) this.end(login, null)
  }

  /** The alarm's due keys. A key for a login that already ended does nothing. */
  expire(dueKeys: readonly string[]): void {
    for (const key of dueKeys) {
      if (!key.startsWith(WAKEUP_PREFIX)) continue
      const login = this.logins.get(key.slice(WAKEUP_PREFIX.length))
      if (login) this.end(login, { reason: "timeout", message: "sign-in timed out after 10 minutes" })
    }
  }

  // Internals.

  private provider(id: string): Provider | undefined {
    if (id === FAKE_PROVIDER) return this.deps.fake ? fakeProvider() : undefined
    if (!isProviderId(id) || !hasSignIn(id)) return undefined
    return FLOWS[id]!.provider()
  }

  private live(login: Login<Owner>): boolean {
    return this.logins.get(login.id) === login
  }

  private owned(owner: Owner, loginId: string): Login<Owner> | undefined {
    const login = this.logins.get(loginId)
    return login?.owner === owner ? login : undefined
  }

  private unknown(owner: Owner, loginId: string): void {
    this.deps.send(owner, { t: "login.error", loginId, reason: "unknown", message: "this sign-in is no longer running" })
  }

  private ask(login: Login<Owner>, prompt: AuthPrompt, select: string | undefined): Promise<string> {
    if (!this.live(login)) return Promise.reject(new Error("sign-in ended"))
    if (prompt.type === "select" && select && prompt.options.some((o) => o.id === select)) return Promise.resolve(select)
    const promptId = String(++login.promptCount)
    return new Promise<string>((resolve, reject) => {
      // pi-ai withdraws a prompt through its own signal when something else answered it.
      const withdraw = () => {
        login.prompts.delete(promptId)
        reject(new Error("prompt withdrawn"))
      }
      prompt.signal?.addEventListener("abort", withdraw, { once: true })
      login.prompts.set(promptId, {
        resolve: (value) => {
          prompt.signal?.removeEventListener("abort", withdraw)
          resolve(value)
        },
        reject,
      })
      this.deps.send(login.owner, { t: "login.prompt", loginId: login.id, promptId, prompt: wirePrompt(prompt) })
    })
  }

  /** Removes every piece of the login's state, then says why it ended when there is a reason. */
  private end(login: Login<Owner>, ending: Ending): void {
    if (!this.live(login)) return
    this.logins.delete(login.id)
    login.controller.abort(new Error("sign-in ended"))
    for (const waiter of login.prompts.values()) waiter.reject(new Error("sign-in ended"))
    login.prompts.clear()
    void this.deps.clearWakeup(WAKEUP_PREFIX + login.id).catch(() => {})
    if (ending) this.deps.send(login.owner, { t: "login.error", loginId: login.id, ...ending })
  }
}

function wireEvent(event: AuthEvent): LoginEvent {
  return event
}

function wirePrompt(prompt: AuthPrompt): LoginPrompt {
  const { signal: _, ...rest } = prompt
  if (rest.type === "select") return { type: "select", message: rest.message, options: rest.options }
  return rest.placeholder === undefined
    ? { type: rest.type, message: rest.message }
    : { type: rest.type, message: rest.message, placeholder: rest.placeholder }
}

/** A short, lowercase reason for the client. */
function failure(error: unknown): string {
  const message = error instanceof Error ? error.message : ""
  return (message || "sign-in failed").slice(0, 200).toLowerCase()
}
