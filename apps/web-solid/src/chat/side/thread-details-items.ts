export const THREAD_DETAILS_ITEMS = [
  { id: "now", label: "Now", defaultVisible: true },
  { id: "waiting", label: "Waiting on you", defaultVisible: true },
  { id: "progress", label: "Progress", defaultVisible: true },
  { id: "helpers", label: "Helpers", defaultVisible: true },
  { id: "outputs", label: "Outputs", defaultVisible: true },
  { id: "used", label: "Used in this session", defaultVisible: true },
  { id: "memory", label: "Kiko knows here", defaultVisible: true },
] as const

export type ThreadDetailsItemId = (typeof THREAD_DETAILS_ITEMS)[number]["id"]
export type ThreadDetailsItem = (typeof THREAD_DETAILS_ITEMS)[number]
export type ThreadDetailsVisibility = Readonly<Record<ThreadDetailsItemId, boolean>>
export type ThreadDetailsChoice = Readonly<Partial<Record<ThreadDetailsItemId, boolean>>>

export function resolveThreadDetailsVisibility(choice: ThreadDetailsChoice): ThreadDetailsVisibility {
  const out = {} as Record<ThreadDetailsItemId, boolean>
  for (const item of THREAD_DETAILS_ITEMS) out[item.id] = choice[item.id] ?? item.defaultVisible
  return out
}

export function readThreadDetailsChoice(value: unknown): ThreadDetailsChoice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const out: Partial<Record<ThreadDetailsItemId, boolean>> = {}
  for (const item of THREAD_DETAILS_ITEMS) if (typeof raw[item.id] === "boolean") out[item.id] = raw[item.id] as boolean
  return out
}

export function setThreadDetailsItem(
  choice: ThreadDetailsChoice,
  item: ThreadDetailsItem,
  visible: boolean,
): ThreadDetailsChoice {
  const { [item.id]: _previous, ...rest } = choice
  return visible === item.defaultVisible ? rest : { ...rest, [item.id]: visible }
}

export function isDefaultThreadDetailsVisibility(visibility: ThreadDetailsVisibility): boolean {
  return THREAD_DETAILS_ITEMS.every((item) => visibility[item.id] === item.defaultVisible)
}

export const RESET_THREAD_DETAILS: ThreadDetailsChoice = {}
