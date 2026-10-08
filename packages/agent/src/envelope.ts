export type Origin = "human" | "routine" | "auto"

export type Sender = { kind: "human" } | { kind: "agent"; slug: string } | { kind: "system"; reason: string }

export type Envelope = {
  id: string
  from: Sender
  body: string
  replyTo?: string
  hop: number
  rootId: string
  tainted: boolean
  origin?: Origin
  grant?: readonly string[]
  seq: number
}
