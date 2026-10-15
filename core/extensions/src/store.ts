import { sha256Hex } from "@kiko/durable/hash"
import {
  type AgentSlug,
  checkBundle,
  type ExtensionBundle,
  type ExtensionCatalogEntry,
  type ExtensionInfo,
  type ExtensionManifest,
  type ExtensionProposal,
  type ExtensionSource,
  hostAllowed,
  isAgentSlug,
  isRoomId,
  type RoomId,
} from "@kiko/protocol"
import { type Keyring, open, seal } from "@kiko/durable/crypto"
import { type Fetcher, safeRequest, type SafeRequest } from "@kiko/durable/safe-fetch"
import { type GuestRequest, type GuestResponse, guestRequestProblem } from "./compile"
import { triggerGapProblems } from "./triggers"

export type ExtensionEvent =
  | { t: "extension"; extension: ExtensionInfo }
  | { t: "extension_removed"; name: string }
  | { t: "extension_proposal"; proposal: ExtensionProposal }
  | { t: "extension_proposal_removed"; id: string }

export class ExtensionError extends Error {
  constructor(
    message: string,
    readonly problems?: string[],
  ) {
    super(message)
  }
}

export type TriggerPort = {
  create: (input: { text: string; rrule: string; roomId: RoomId; target: string; createdBy: string }) => Promise<void>
  cancelBy: (createdBy: string) => Promise<unknown>
  fallback: () => { roomId: RoomId; target: string } | null
}

const MAX_PROPOSALS = 20
const MAX_STATE_KEYS = 1000
const MAX_STATE_VALUE = 64 * 1024
const MAX_FETCH_BYTES = 256 * 1024
const FETCH_TIMEOUT_MS = 10_000
const SECRET_REF = /\{\{secret\.([A-Z][A-Z0-9_]{0,31})\}\}/g

type Row = {
  name: string
  hash: string
  bundle: string
  enabled: number
  agents: string | null
  source: string
  by: string | null
  room: string | null
  error: string | null
  installed_at: number
  updated_at: number
}

type ProposalRow = { id: string; name: string; hash: string; bundle: string; source: string; by: string | null; room: string | null; created_at: number }

export async function bundleHash(bundle: ExtensionBundle): Promise<string> {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canonical(x)])) : v
  return sha256Hex(JSON.stringify(canonical(bundle)))
}

const PARSED_MAX = 64

export class ExtensionStore {
  private readonly scheduled = new Map<string, Promise<unknown>>()
  // A bundle is up to a few hundred kb of JSON, and a hash names one bundle for good, so a parse is kept by hash.
  private readonly parsed = new Map<string, ExtensionBundle>()

  constructor(
    private readonly sql: SqlStorage,
    private readonly keyring: () => Keyring,
    private readonly userId: () => string,
    private readonly commit: (event: ExtensionEvent) => void,
    private readonly triggers: TriggerPort,
    private readonly catalog: () => readonly ExtensionCatalogEntry[],
    private readonly fetcher?: Fetcher,
  ) {
  }

  private row(name: string): Row | undefined {
    return this.sql.exec<Row>("SELECT * FROM extensions WHERE name = ?", name).toArray()[0]
  }

  private bundleOf(r: { hash: string; bundle: string }): ExtensionBundle {
    let bundle = this.parsed.get(r.hash)
    if (!bundle) {
      if (this.parsed.size >= PARSED_MAX) this.parsed.clear()
      bundle = JSON.parse(r.bundle) as ExtensionBundle
      this.parsed.set(r.hash, bundle)
    }
    return bundle
  }

  private secretsSet(name?: string): Map<string, Set<string>> {
    const rows = name === undefined ? this.sql.exec<{ extension: string; secret: string }>("SELECT extension, secret FROM extension_secrets") : this.sql.exec<{ extension: string; secret: string }>("SELECT extension, secret FROM extension_secrets WHERE extension = ?", name)
    const out = new Map<string, Set<string>>()
    for (const s of rows) out.set(s.extension, (out.get(s.extension) ?? new Set()).add(s.secret))
    return out
  }

  private info(r: Row, secretsSet: Map<string, Set<string>> = this.secretsSet(r.name)): ExtensionInfo {
    const m = this.bundleOf(r).manifest
    const set = secretsSet.get(r.name) ?? new Set<string>()
    return {
      name: r.name,
      version: m.version,
      description: m.description,
      hash: r.hash,
      enabled: r.enabled === 1,
      agents: r.agents ? (JSON.parse(r.agents) as AgentSlug[]) : null,
      source: r.source as ExtensionSource,
      ...(r.by ? { by: r.by as AgentSlug } : {}),
      ...(r.room && isRoomId(r.room) ? { room: r.room } : {}),
      manifest: m,
      secrets: Object.keys(m.secrets ?? {}).map((name) => ({ name, set: set.has(name) })),
      ...(r.error ? { error: r.error } : {}),
      installedAt: r.installed_at,
      updatedAt: r.updated_at,
    }
  }

  private proposal(r: ProposalRow, installedHash: string | undefined): ExtensionProposal {
    const bundle = this.bundleOf(r)
    return {
      id: r.id,
      name: r.name,
      version: bundle.manifest.version,
      hash: r.hash,
      source: r.source as ExtensionSource,
      ...(r.by ? { by: r.by as AgentSlug } : {}),
      ...(r.room && isRoomId(r.room) ? { room: r.room } : {}),
      bundle,
      ...(installedHash ? { replaces: installedHash } : {}),
      createdAt: r.created_at,
    }
  }

  list(): ExtensionInfo[] {
    const secrets = this.secretsSet()
    return this.sql.exec<Row>("SELECT * FROM extensions ORDER BY name").toArray().map((r) => this.info(r, secrets))
  }

  proposals(): ExtensionProposal[] {
    const installed = new Map(this.sql.exec<{ name: string; hash: string }>("SELECT name, hash FROM extensions").toArray().map((r) => [r.name, r.hash]))
    return this.sql.exec<ProposalRow>("SELECT * FROM extension_proposals ORDER BY created_at").toArray().map((r) => this.proposal(r, installed.get(r.name)))
  }

  forAgent(slug: string): { name: string; hash: string }[] {
    return this.sql
      .exec<Row>("SELECT * FROM extensions WHERE enabled = 1 ORDER BY name")
      .toArray()
      .filter((r) => !r.agents || (JSON.parse(r.agents) as string[]).includes(slug))
      .map((r) => ({ name: r.name, hash: r.hash }))
  }

  bundles(hashes: readonly string[]): { name: string; hash: string; bundle: ExtensionBundle }[] {
    const want = new Set(hashes)
    return this.sql
      .exec<Row>("SELECT * FROM extensions")
      .toArray()
      .filter((r) => want.has(r.hash))
      .map((r) => ({ name: r.name, hash: r.hash, bundle: this.bundleOf(r) }))
  }

  source(name: string): ExtensionBundle {
    const r = this.row(name)
    if (!r) throw new ExtensionError(`no extension named ${name}`)
    return this.bundleOf(r)
  }

  async propose(input: { bundle: unknown; source: ExtensionSource; by?: string; room?: string }): Promise<ExtensionProposal> {
    const checked = checkBundle(input.bundle)
    if (!checked.ok) throw new ExtensionError("the extension has problems", checked.problems)
    const bundle = checked.bundle
    const gaps = triggerGapProblems(bundle)
    if (gaps.length) throw new ExtensionError("the extension has problems", gaps)
    const hash = await bundleHash(bundle)
    const name = bundle.manifest.name
    if (this.row(name)?.hash === hash) throw new ExtensionError(`${name} ${bundle.manifest.version} is already installed`)
    if (input.by !== undefined && !isAgentSlug(input.by)) throw new ExtensionError("bad agent")
    if (input.room !== undefined && !isRoomId(input.room)) throw new ExtensionError("bad chat")
    for (const old of this.sql.exec<{ id: string }>("SELECT id FROM extension_proposals WHERE name = ?", name).toArray()) {
      this.sql.exec("DELETE FROM extension_proposals WHERE id = ?", old.id)
      this.commit({ t: "extension_proposal_removed", id: old.id })
    }
    const count = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM extension_proposals").one().n
    if (count >= MAX_PROPOSALS) throw new ExtensionError(`${MAX_PROPOSALS} installs already wait for review; decline some first`)
    const id = `xp_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`
    this.sql.exec(
      "INSERT INTO extension_proposals (id, name, hash, bundle, source, by, room, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      name,
      hash,
      JSON.stringify(bundle),
      input.source,
      input.by ?? null,
      input.room ?? null,
      Date.now(),
    )
    const proposal = this.proposal(this.sql.exec<ProposalRow>("SELECT * FROM extension_proposals WHERE id = ?", id).one(), this.row(name)?.hash)
    this.commit({ t: "extension_proposal", proposal })
    return proposal
  }

  async proposeCatalog(name: string): Promise<ExtensionProposal> {
    const entry = this.catalog().find((e) => e.name === name)
    if (!entry) throw new ExtensionError(`the catalog has no extension named ${name}`)
    return this.propose({ bundle: entry.bundle, source: "catalog" })
  }

  decline(id: string): void {
    const r = this.sql.exec<ProposalRow>("SELECT * FROM extension_proposals WHERE id = ?", id).toArray()[0]
    if (!r) throw new ExtensionError("that install is no longer waiting")
    this.sql.exec("DELETE FROM extension_proposals WHERE id = ?", id)
    this.commit({ t: "extension_proposal_removed", id })
  }

  async install(id: string): Promise<ExtensionInfo> {
    const p = this.sql.exec<ProposalRow>("SELECT * FROM extension_proposals WHERE id = ?", id).toArray()[0]
    if (!p) throw new ExtensionError("that install is no longer waiting")
    const now = Date.now()
    const before = this.row(p.name)
    if (before) {
      this.sql.exec("UPDATE extensions SET hash = ?, bundle = ?, source = ?, by = ?, room = COALESCE(?, room), error = NULL, updated_at = ? WHERE name = ?", p.hash, p.bundle, p.source, p.by, p.room, now, p.name)
    } else {
      this.sql.exec(
        "INSERT INTO extensions (name, hash, bundle, enabled, agents, source, by, room, error, installed_at, updated_at) VALUES (?, ?, ?, 1, NULL, ?, ?, ?, NULL, ?, ?)",
        p.name,
        p.hash,
        p.bundle,
        p.source,
        p.by,
        p.room,
        now,
        now,
      )
    }
    const declared = Object.keys(this.bundleOf(p).manifest.secrets ?? {})
    for (const s of this.sql.exec<{ secret: string }>("SELECT secret FROM extension_secrets WHERE extension = ?", p.name).toArray()) {
      if (!declared.includes(s.secret)) this.sql.exec("DELETE FROM extension_secrets WHERE extension = ? AND secret = ?", p.name, s.secret)
    }
    this.sql.exec("DELETE FROM extension_proposals WHERE id = ?", id)
    this.commit({ t: "extension_proposal_removed", id })
    this.changed(p.name)
    await this.scheduleTriggers(p.name)
    const row = this.row(p.name)
    if (!row) throw new ExtensionError(`extension ${p.name} is missing right after install`)
    return this.info(row)
  }

  // Each rewrite of one extension's triggers waits for the one before it, so a quick toggle never
  // reads a switch that a later toggle has already changed. Uninstall waits in the same line.
  private chain<T>(name: string, step: () => Promise<T>): Promise<T> {
    const run = (this.scheduled.get(name) ?? Promise.resolve()).then(step)
    this.scheduled.set(name, run.catch(() => {}))
    return run
  }

  private scheduleTriggers(name: string): Promise<void> {
    return this.chain(name, () => this.rewriteTriggers(name))
  }

  private async rewriteTriggers(name: string): Promise<void> {
    const by = `ext:${name}`
    try {
      await this.triggers.cancelBy(by)
    } catch (e) {
      const r = this.row(name)
      if (r) this.setError(name, r.hash, `triggers: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    const r = this.row(name)
    if (r?.enabled !== 1) return
    const m = this.bundleOf(r).manifest
    if (!m.triggers?.length) return
    const fallback = this.triggers.fallback()
    const roomId = r.room && isRoomId(r.room) ? r.room : fallback?.roomId
    const target = r.by ?? fallback?.target
    if (!roomId || !target) return
    for (const t of m.triggers) {
      if (this.row(name)?.enabled !== 1) return
      try {
        await this.triggers.create({ text: `[${name}] ${t.send}`, rrule: t.rrule, roomId, target, createdBy: by })
      } catch (e) {
        this.setError(name, r.hash, `trigger ${t.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  async setEnabled(name: string, enabled: boolean): Promise<ExtensionInfo> {
    if (!this.row(name)) throw new ExtensionError(`no extension named ${name}`)
    this.sql.exec("UPDATE extensions SET enabled = ?, updated_at = ? WHERE name = ?", enabled ? 1 : 0, Date.now(), name)
    await this.scheduleTriggers(name)
    return this.changed(name)
  }

  setAgents(name: string, agents: readonly string[] | null): ExtensionInfo {
    if (!this.row(name)) throw new ExtensionError(`no extension named ${name}`)
    if (agents && !agents.every(isAgentSlug)) throw new ExtensionError("bad agent")
    this.sql.exec("UPDATE extensions SET agents = ?, updated_at = ? WHERE name = ?", agents ? JSON.stringify([...new Set(agents)]) : null, Date.now(), name)
    return this.changed(name)
  }

  async setSecret(name: string, secret: string, value: string | null): Promise<ExtensionInfo> {
    const r = this.row(name)
    if (!r) throw new ExtensionError(`no extension named ${name}`)
    const m = this.bundleOf(r).manifest
    if (!m.secrets?.[secret]) throw new ExtensionError(`${name} declares no secret ${secret}`)
    if (value === null) {
      this.sql.exec("DELETE FROM extension_secrets WHERE extension = ? AND secret = ?", name, secret)
    } else {
      const trimmed = value.trim()
      if (!trimmed || trimmed.length > 4096 || /[\r\n]/.test(trimmed)) throw new ExtensionError("a secret is one line of at most 4096 characters")
      const sealed = await seal(this.keyring(), this.userId(), `ext:${name}:${secret}`, trimmed)
      this.sql.exec(
        "INSERT INTO extension_secrets (extension, secret, kek_version, iv, ciphertext) VALUES (?, ?, ?, ?, ?) ON CONFLICT(extension, secret) DO UPDATE SET kek_version = excluded.kek_version, iv = excluded.iv, ciphertext = excluded.ciphertext",
        name,
        secret,
        sealed.kekVersion,
        sealed.iv,
        sealed.ciphertext,
      )
    }
    return this.changed(name)
  }

  async uninstall(name: string): Promise<void> {
    if (!this.row(name)) throw new ExtensionError(`no extension named ${name}`)
    await this.chain(name, async () => {
      await this.triggers.cancelBy(`ext:${name}`)
      this.sql.exec("DELETE FROM extensions WHERE name = ?", name)
      this.sql.exec("DELETE FROM extension_secrets WHERE extension = ?", name)
      this.sql.exec("DELETE FROM extension_state WHERE extension = ?", name)
      this.commit({ t: "extension_removed", name })
    })
  }

  setError(name: string, hash: string, error: string): void {
    const r = this.row(name)
    if (!r || r.hash !== hash || r.error === error) return
    this.sql.exec("UPDATE extensions SET error = ? WHERE name = ?", error.slice(0, 500), name)
    this.changed(name)
  }

  private changed(name: string): ExtensionInfo {
    const row = this.row(name)
    if (!row) throw new ExtensionError(`extension ${name} is missing`)
    const info = this.info(row)
    this.commit({ t: "extension", extension: info })
    return info
  }

  private live(name: string): ExtensionManifest {
    const r = this.sql.exec<{ hash: string; enabled: number }>("SELECT hash, enabled FROM extensions WHERE name = ?", name).toArray()[0]
    if (r?.enabled !== 1) throw new ExtensionError(`extension ${name} is not installed and on`)
    const cached = this.parsed.get(r.hash)
    if (cached) return cached.manifest
    const row = this.row(name)
    if (!row) throw new ExtensionError(`extension ${name} is not installed and on`)
    return this.bundleOf(row).manifest
  }

  state(name: string, scope: string, op: "get" | "set" | "delete" | "list", key: string, value?: unknown): unknown {
    const manifest = this.live(name)
    if (!manifest.state) throw new ExtensionError(`kiko.state needs "state" in extension.json`)
    if (key.length > 200) throw new ExtensionError("a state key is at most 200 characters")
    if (op === "get") {
      const r = this.sql.exec<{ value: string }>("SELECT value FROM extension_state WHERE extension = ? AND scope = ? AND key = ?", name, scope, key).toArray()[0]
      return r ? JSON.parse(r.value) : null
    }
    if (op === "delete") {
      this.sql.exec("DELETE FROM extension_state WHERE extension = ? AND scope = ? AND key = ?", name, scope, key)
      return null
    }
    if (op === "list") {
      return this.sql
        .exec<{ key: string }>("SELECT key FROM extension_state WHERE extension = ? AND scope = ? AND substr(key, 1, ?) = ? ORDER BY key LIMIT 200", name, scope, key.length, key)
        .toArray()
        .map((r) => r.key)
    }
    const text = JSON.stringify(value ?? null)
    if (text.length > MAX_STATE_VALUE) throw new ExtensionError("a state value is at most 64 kb")
    const exists = this.sql.exec("SELECT 1 FROM extension_state WHERE extension = ? AND scope = ? AND key = ?", name, scope, key).toArray().length > 0
    if (!exists) {
      const n = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM extension_state WHERE extension = ?", name).one().n
      if (n >= MAX_STATE_KEYS) throw new ExtensionError(`an extension keeps at most ${MAX_STATE_KEYS} state keys`)
    }
    this.sql.exec(
      "INSERT INTO extension_state (extension, scope, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(extension, scope, key) DO UPDATE SET value = excluded.value",
      name,
      scope,
      key,
      text,
    )
    return null
  }

  async fetch(name: string, request: GuestRequest): Promise<GuestResponse> {
    const manifest = this.live(name)
    const problem = guestRequestProblem(manifest, request)
    if (problem) throw new ExtensionError(problem)
    const url = new URL(request.url)
    const host = url.hostname.toLowerCase()
    const method = (request.method ?? (request.body !== undefined || request.json !== undefined ? "POST" : "GET")).toUpperCase()
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(request.headers ?? {})) headers[k.toLowerCase()] = v
    let body = request.body
    if (request.json !== undefined) {
      body = JSON.stringify(request.json)
      headers["content-type"] ??= "application/json"
    }

    const secrets = manifest.secrets ?? {}
    const fill = async (text: string): Promise<string> => {
      const refs = [...text.matchAll(SECRET_REF)].flatMap((m) => m[1] ?? [])
      let out = text
      for (const ref of new Set(refs)) {
        const declared = secrets[ref]
        if (!declared) throw new ExtensionError(`secret ${ref} is not declared in extension.json`)
        if (!hostAllowed(host, declared.hosts)) throw new ExtensionError(`secret ${ref} is never sent to ${host}`)
        const value = await this.secret(name, ref)
        if (value === null) throw new ExtensionError(`the human has not set ${ref} yet; ask them to add it in Settings → extensions → ${name}`)
        out = out.replaceAll(`{{secret.${ref}}}`, value)
      }
      return out
    }
    const filledUrl = await fill(url.href.replace(/%7B%7Bsecret\.([A-Z0-9_]+)%7D%7D/g, "{{secret.$1}}"))
    if (new URL(filledUrl).hostname.toLowerCase() !== host) throw new ExtensionError("a secret cannot change the host")
    for (const [k, v] of Object.entries(headers)) headers[k] = await fill(v)
    if (body?.includes("{{secret.")) body = await fill(body)

    const req: SafeRequest = { method: method as SafeRequest["method"], headers, ...(body !== undefined ? { body } : {}) }
    const out = await safeRequest(filledUrl, req, this.fetcher, { maxBytes: MAX_FETCH_BYTES, timeoutMs: FETCH_TIMEOUT_MS, userAgent: `kiko-extension/${name}` })
    if (!out.ok) throw new ExtensionError(`the request failed: ${out.reason}`)
    const known: [string, string][] = []
    for (const ref of Object.keys(secrets)) {
      const value = await this.secret(name, ref)
      if (value) known.push([ref, value])
    }
    const scrub = (s: string): string => known.reduce((acc, [ref, value]) => acc.replaceAll(value, `{{secret.${ref}}}`), s)
    const text = scrub(new TextDecoder().decode(out.body))
    const responseHeaders: Record<string, string> = {}
    out.headers.forEach((v, k) => {
      if (!/^(set-cookie|authorization)$/i.test(k)) responseHeaders[k] = scrub(v)
    })
    let json: unknown
    if (/json/i.test(out.headers.get("content-type") ?? "")) {
      try {
        json = JSON.parse(text)
      } catch {
      }
    }
    return { status: out.status, headers: responseHeaders, text, ...(json !== undefined ? { json } : {}), ...(out.truncated ? { truncated: true } : {}) }
  }

  private async secret(name: string, secret: string): Promise<string | null> {
    const r = this.sql
      .exec<{ kek_version: number; iv: ArrayBuffer; ciphertext: ArrayBuffer }>("SELECT kek_version, iv, ciphertext FROM extension_secrets WHERE extension = ? AND secret = ?", name, secret)
      .toArray()[0]
    if (!r) return null
    return open(this.keyring(), this.userId(), `ext:${name}:${secret}`, { kekVersion: r.kek_version, iv: new Uint8Array(r.iv), ciphertext: new Uint8Array(r.ciphertext) })
  }
}
