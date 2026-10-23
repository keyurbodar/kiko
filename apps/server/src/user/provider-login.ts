import type {
  AuthContext,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  CredentialStore,
  Provider,
} from "@earendil-works/pi-ai"
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth"
import { createModels } from "@earendil-works/pi-ai/models"
import type {
  ConnectMethod,
  LoginErrorReason,
  LoginEvent,
  LoginPrompt,
  ProviderInfo,
  UserToClient,
} from "@kiko/protocol"
import { runErrorDetail } from "../agent/run-error"
import { findProvider } from "../models/catalog"
import { withPasteLogin } from "./chatgpt-signin"
import { isProviderId } from "./credentials"

const MAX_LOGINS = 4

registerBunOAuthFlows()

const CANNOT_RUN = new Set(["openai-codex", "openrouter", "radius"])

const FLOWS: Record<string, { method: ConnectMethod; select?: string; wrap?: (provider: Provider) => Provider }> = {
  anthropic: { method: "paste_code", select: "copy_code" },
  openai: { method: "paste_code", wrap: withChatgptPaste },
}

function withChatgptPaste(provider: Provider): Provider {
  const oauth = provider.auth.oauth
  return oauth ? { ...provider, auth: { ...provider.auth, oauth: withPasteLogin(oauth) } } : provider
}

function hasSignIn(provider: string): boolean {
  return !CANNOT_RUN.has(provider) && findProvider(provider)?.auth.oauth !== undefined
}

export function signInMethod(provider: string): ConnectMethod | undefined {
  return hasSignIn(provider) ? (FLOWS[provider]?.method ?? "device_code") : undefined
}

const NO_AMBIENT: AuthContext = { env: async () => undefined, fileExists: async () => false }

export interface LoginDeps<Owner> {
  store: CredentialStore
  deviceId(): string
  info(provider: string): ProviderInfo | null
  send(owner: Owner, frame: UserToClient): void
  devProvider?(id: string): Promise<Provider | undefined>
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
    const provider = await this.provider(providerId)
    const oauth = provider?.auth.oauth
    if (!provider || !oauth) return refuse("unsupported", "this provider has no sign-in kiko can run. use an api key")
    for (const other of this.logins.values()) {
      if (other.provider === providerId)
        this.end(other, { reason: "cancelled", message: "a newer sign-in replaced this one" })
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
      await models.login(providerId, "oauth", interaction, {
        getDeviceId: () => this.deps.deviceId(),
        agentName: "Kiko",
      })
    } catch (error) {
      if (this.live(login)) this.end(login, { reason: "failed", message: signInFailure(error) })
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
    for (const login of this.logins.values()) if (login.owner === owner) this.end(login, null)
  }

  private async provider(id: string): Promise<Provider | undefined> {
    if (!isProviderId(id)) return undefined
    if (!hasSignIn(id)) return this.deps.devProvider?.(id)
    const provider = findProvider(id)
    const wrap = FLOWS[id]?.wrap
    return provider && wrap ? wrap(provider) : provider
  }

  private live(login: Login<Owner>): boolean {
    return this.logins.get(login.id) === login
  }

  private owned(owner: Owner, loginId: string): Login<Owner> | undefined {
    const login = this.logins.get(loginId)
    return login?.owner === owner ? login : undefined
  }

  private unknown(owner: Owner, loginId: string): void {
    this.deps.send(owner, {
      t: "login.error",
      loginId,
      reason: "unknown",
      message: "this sign-in is no longer running",
    })
  }

  private ask(login: Login<Owner>, prompt: AuthPrompt, select: string | undefined): Promise<string> {
    if (!this.live(login)) return Promise.reject(new Error("sign-in ended"))
    if (prompt.type === "select" && select && prompt.options.some((o) => o.id === select))
      return Promise.resolve(select)
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

const FAILURES: readonly (readonly [RegExp, string])[] = [
  [
    /state|pasted|callback|redirect|authorization code|client id|not a web address/i,
    "That address does not match this sign-in. Start again and paste the address from the same tab.",
  ],
  [/expired|expired_token|code .*invalid|timed? ?out/i, "The sign-in code expired. Start again and finish it sooner."],
  [
    /access_denied|denied|refused|cancel/i,
    "The provider did not approve the sign-in. Start again if that was a mistake.",
  ],
  [
    /fetch failed|network|econn|enotfound|unable to connect|could not reach/i,
    "Kiko could not reach the provider. Check the connection, then start again.",
  ],
]

function signInFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : ""
  const sentence = FAILURES.find(([pattern]) => pattern.test(raw))?.[1] ?? "The sign-in did not finish. Start again."
  const detail = runErrorDetail(raw)
  return detail ? `${sentence} ${detail}` : sentence
}
