import type { Task } from "../../types"
import { check, int, mulberry32, sample, verdict, writeJson } from "../helpers"
import { BROWSER_OS, LONG_LIMITS, sameJson, sorted } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

type Message = { id: string; from: string; subject: string; folder: string; labels: string[] }

const NEWS = ["Harbor", "Meadow", "Cobalt", "Summit", "Orchid", "Pepper", "Willow", "Juniper"]
const WORK = ["Budget", "Hiring", "Roadmap", "Launch", "Incident", "Pricing", "Retro", "Offsite"]
const BULK = ["Prize", "Deal", "Offer", "Bonus", "Reward", "Gift"]
const PEOPLE = ["ada", "grace", "linus", "mira", "omar", "priya", "ruth", "sven"]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const messages: Message[] = []
  let id = 1
  const add = (from: string, subject: string): void => {
    messages.push({ id: `MSG-${String(id).padStart(3, "0")}`, from, subject, folder: "inbox", labels: [] })
    id += 1
  }
  for (let index = 0; index < 12; index += 1)
    add(`${NEWS[index % NEWS.length]!.toLowerCase()}${index}@news.example`, `${NEWS[index % NEWS.length]} newsletter`)
  for (let index = 0; index < 8; index += 1)
    add("boss@work.example", `${WORK[index % WORK.length]} update ${index + 1}`)
  for (let index = 0; index < 6; index += 1)
    add(`spam${index}@bulk.test`, `You are a ${BULK[index % BULK.length]} winner`)
  for (let index = 0; index < 14; index += 1)
    add(`${PEOPLE[index % PEOPLE.length]}@work.example`, `Notes on ${WORK[(index + 3) % WORK.length]} ${index + 1}`)
  const rules = {
    archiveFrom: "@news.example",
    archiveSubject: "newsletter",
    importantFrom: "boss@work.example",
    deleteSubject: "winner",
    deleteFrom: "spam@",
  }
  const order = sample(
    rng,
    messages.map((_, index) => index),
    messages.length,
  )
  return { messages: order.map((index) => messages[index]!), rules }
}

const expected = (seed: number): Message[] => {
  const { messages, rules } = scenario(seed)
  return messages.map((message) => {
    const subject = message.subject.toLowerCase()
    if (message.from.endsWith(rules.archiveFrom) || subject.includes(rules.archiveSubject))
      return { ...message, folder: "archive", labels: [] }
    if (subject.includes(rules.deleteSubject) || message.from.startsWith(rules.deleteFrom))
      return { ...message, folder: "trash", labels: [] }
    if (message.from === rules.importantFrom) return { ...message, folder: "inbox", labels: ["important"] }
    return message
  })
}

const normalise = (messages: Message[] | undefined): unknown =>
  messages?.map((message) => ({ ...message, labels: sorted(message.labels) }))

export const inboxZero: Task = {
  id: "browser-107-inbox-zero",
  track: "browser",
  kind: "long",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Get the inbox at url.txt to zero using the rules in request.json: archive every newsletter, label every message from the boss as important, delete the spam, and leave everything else in the inbox. Do not touch messages that no rule covers.",
  limits: LONG_LIMITS,
  setup: async (m, seed) => {
    const { messages, rules } = scenario(seed)
    await writeJson(m, "request.json", rules)
    await openPage(m, "browser-107-inbox-zero", { messages, rules }, "/inbox")
  },
  oracle: (m) => runBrowserOracle(m, "browser-107-inbox-zero"),
  check: async (m, seed) => {
    const messages = (await browserState(m))?.messages as Message[] | undefined
    return verdict([
      check("all messages", messages?.length === 40, `count = ${messages?.length ?? 0}`),
      sameJson("every message", normalise(messages), normalise(expected(seed))),
    ])
  },
}
