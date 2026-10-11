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

export const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
export const MAX_LOGINS = 4
const WAKEUP_PREFIX = "login:"

// Workers cannot dynamically import pi-ai's OAuth modules, so the flows are registered statically here.
registerBunOAuthFlows()

// Flows that need a loopback server are left out, since a Worker cannot listen on a port.
const FLOWS: Record<string, { provider: () => Provider; select?: string }> = {
  anthropic: { provider: anthropicProvider, select: "copy_code" },
  "github-copilot": { provider: githubCopilotProvider },
  "kimi-coding": { provider: kimiCodingProvider },
  meta: { provider: metaProvider },
  "openai-codex": { provider: openaiCodexProvider, select: "device_code" },
  xai: { provider: xaiProvider },
}

export function hasSignIn(provider: string): boolean {
  return Object.hasOwn(FLOWS, provider)
}

// The test provider only; a development bundle offers it. Its flow shows a device code, then asks for it back.

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

const NO_AMBIENT: AuthContext = { env: async () => undefined, fileExists: async () => false }

export interface LoginDeps<Owner> {
  store: CredentialStore
  info(provider: string): ProviderInfo | null
  send(owner: Owner, frame: UserToClient): void
  setWakeup(key: string, at: number): Promise<void>
  clearWakeup(key: string): Promise<void>
  subscriptions: boolean
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

export class ProviderLogins<Owner> {
  private readonly logins = new Map<string, Login<Owner>>()

  constructor(private readonly deps: LoginDeps<Owner>) {}

  get size(): number {
    return this.logins.size
  }

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
      // Errors are short and hold no secret, but are never logged.
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
    if (!login || !waiter) {
      this.unknown(owner, loginId)
      return
    }
    login.prompts.delete(promptId)
    waiter.resolve(value)
  }

  cancel(owner: Owner, loginId: string): void {
    const login = this.owned(owner, loginId)
    if (!login) {
      this.unknown(owner, loginId)
      return
    }
    this.end(login, { reason: "cancelled", message: "sign-in cancelled" })
  }

  dropOwner(owner: Owner): void {
    for (const login of [...this.logins.values()]) if (login.owner === owner) this.end(login, null)
  }

  expire(dueKeys: readonly string[]): void {
    for (const key of dueKeys) {
      if (!key.startsWith(WAKEUP_PREFIX)) continue
      const login = this.logins.get(key.slice(WAKEUP_PREFIX.length))
      if (login) this.end(login, { reason: "timeout", message: "sign-in timed out after 10 minutes" })
    }
  }

  private provider(id: string): Provider | undefined {
    if (id === FAKE_PROVIDER) return this.deps.fake ? fakeProvider() : undefined
    if (!isProviderId(id) || !hasSignIn(id)) return undefined
    return FLOWS[id]?.provider()
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

function failure(error: unknown): string {
  const message = error instanceof Error ? error.message : ""
  return (message || "sign-in failed").slice(0, 200).toLowerCase()
}
