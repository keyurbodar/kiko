import { verifyClerkToken } from "@kiko/durable/clerk-token"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { failed, type InstallErrorCode, InstallFailed, retryOf, statusOf } from "./failure"
import type { InstallAnswer, InstallRequest } from "./install"
import { type Grant, OAUTH_SCOPES, TOKEN_PERMISSIONS, TOKEN_TEMPLATE_URL } from "./plan"

export type InstallReply = { readonly status: number; readonly body: unknown }

export type Env = {
  INSTALLER: {
    idFromName(name: string): DurableObjectId
    get(id: DurableObjectId): {
      install(request: InstallRequest): Promise<InstallReply>
      detach(sub: string): Promise<InstallReply>
    }
  }
  CF_OAUTH_CLIENT_ID: string
  CLERK_JWT_KEY: string
  CLERK_SECRET_KEY: string
  RELEASE_BASE_URL: string
  RELEASE_PUBLIC_KEY: string
  TRUSTED_ORIGINS: string
}

const CHOOSE_ACCOUNT = "This sign-in can use more than one Cloudflare account. Pick the one Kiko goes in."
const DECIDE =
  "This Cloudflare account already has a Kiko backend that this sign-in does not own. Choose whether to keep its chats or start fresh."

const InstallBody = Schema.Struct({
  clerkToken: Schema.String,
  grant: Schema.Unknown,
  accountId: Schema.optional(Schema.String),
  decision: Schema.optional(Schema.Literals(["take_over", "start_fresh"])),
})
const DetachBody = Schema.Struct({ clerkToken: Schema.String })
const decodeInstall = Schema.decodeUnknownOption(InstallBody)
const decodeDetach = Schema.decodeUnknownOption(DetachBody)

const problem = (status: number, code: InstallErrorCode | "choose_account" | "decide", fields: object) => ({
  status,
  body: { error: { code, retry: code === "choose_account" || code === "decide" ? "same" : retryOf(code), ...fields } },
})

const failureReply = (failure: InstallFailed): InstallReply =>
  problem(statusOf(failure.code), failure.code, {
    message: failure.message,
    ...(failure.detail ? { detail: failure.detail } : {}),
  })

export function answerReply(answer: InstallAnswer): InstallReply {
  switch (answer._tag) {
    case "Installed":
      return { status: 200, body: { backendUrl: answer.backendUrl, version: answer.version } }
    case "ChooseAccount":
      return problem(409, "choose_account", { message: CHOOSE_ACCOUNT, accounts: answer.accounts })
    case "Decide":
      return problem(409, "decide", { message: DECIDE, found: answer.found })
  }
}

export function exitReply<A>(exit: Exit.Exit<A, InstallFailed>, success: (value: A) => InstallReply): InstallReply {
  if (Exit.isSuccess(exit)) return success(exit.value)
  const failure = Cause.squash(exit.cause)
  return failureReply(failure instanceof InstallFailed ? failure : failed("internal", String(failure)))
}

function allowedOrigin(origin: string | null, trusted: string): string | null {
  if (!origin) return null
  return trusted
    .split(",")
    .map((o) => o.trim())
    .includes(origin)
    ? origin
    : null
}

function reply(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Vary", "Origin")
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers })
}

function cleanToken(raw: string): string {
  const bearer = /Bearer\s+([^\s"']+)/.exec(raw)
  return (bearer?.[1] ?? raw).replace(/[^\x21-\x7e]/g, "").replace(/^["']+|["']+$/g, "")
}

function parseGrant(value: unknown): Grant | null {
  const g = value as Partial<Record<string, unknown>> | null
  if (g?.kind === "token" && typeof g.token === "string" && cleanToken(g.token))
    return { kind: "token", token: cleanToken(g.token) }
  if (
    g?.kind === "oauth" &&
    typeof g.code === "string" &&
    typeof g.verifier === "string" &&
    typeof g.redirectUri === "string"
  ) {
    return { kind: "oauth", code: g.code, verifier: g.verifier, redirectUri: g.redirectUri }
  }
  return null
}

async function callerOf(env: Env, token: string): Promise<string | InstallReply> {
  const trust = {
    key: env.CLERK_JWT_KEY,
    trustedOrigins: env.TRUSTED_ORIGINS.split(",").map((origin) => origin.trim()),
  }
  const verdict = await Effect.runPromise(Effect.result(verifyClerkToken(trust, token, Date.now())))
  if (Result.isSuccess(verdict)) return verdict.success.sub
  return failureReply(failed(verdict.failure.code === "token_expired" ? "clerk_expired" : "unauthorized"))
}

const BAD_REQUEST = failureReply(failed("bad_request"))

async function installRoute(request: Request, env: Env): Promise<InstallReply> {
  const body = decodeInstall(await request.json().catch(() => null))
  const grant = Option.isSome(body) ? parseGrant(body.value.grant) : null
  if (Option.isNone(body) || !grant) return BAD_REQUEST
  const sub = await callerOf(env, body.value.clerkToken)
  if (typeof sub !== "string") return sub
  const { accountId, decision } = body.value
  return env.INSTALLER.get(env.INSTALLER.idFromName(sub)).install({
    sub,
    grant,
    ...(accountId ? { accountId } : {}),
    ...(decision ? { decision } : {}),
  })
}

async function detachRoute(request: Request, env: Env): Promise<InstallReply> {
  const body = decodeDetach(await request.json().catch(() => null))
  if (Option.isNone(body)) return BAD_REQUEST
  const sub = await callerOf(env, body.value.clerkToken)
  if (typeof sub !== "string") return sub
  return env.INSTALLER.get(env.INSTALLER.idFromName(sub)).detach(sub)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = allowedOrigin(request.headers.get("Origin"), env.TRUSTED_ORIGINS)
    if (request.headers.get("Origin") && !origin)
      return reply({ error: { code: "origin", message: "This origin is not allowed." } }, 403, null)

    if (request.method === "OPTIONS") {
      const headers = new Headers({
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      })
      if (origin) {
        headers.set("Access-Control-Allow-Origin", origin)
        headers.set("Vary", "Origin")
      }
      return new Response(null, { status: 204, headers })
    }

    if (request.method === "GET" && url.pathname === "/oauth/config") {
      return reply(
        {
          clientId: env.CF_OAUTH_CLIENT_ID,
          authorizeUrl: "https://dash.cloudflare.com/oauth2/auth",
          scopes: OAUTH_SCOPES,
        },
        200,
        origin,
      )
    }
    if (request.method === "GET" && url.pathname === "/token-link") {
      return reply({ url: TOKEN_TEMPLATE_URL, permissions: TOKEN_PERMISSIONS }, 200, origin)
    }

    if (request.method === "POST" && (url.pathname === "/install" || url.pathname === "/detach")) {
      const answer = await (url.pathname === "/install" ? installRoute(request, env) : detachRoute(request, env))
      return reply(answer.body, answer.status, origin)
    }

    return reply({ error: { code: "not_found", message: "Not found." } }, 404, origin)
  },
} satisfies ExportedHandler<Env>
