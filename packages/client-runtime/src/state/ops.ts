import type { FileOp, FileRef, Member, MemberOp, Message, MessageId, Task, TaskOp } from "@kiko/protocol"

const under = (name: string, path: string) => name === path || name.startsWith(`${path}/`)

export function applyTaskOp(tasks: ReadonlyArray<Task>, op: TaskOp): ReadonlyArray<Task> {
  if (op.op === "create") {
    const task: Task = {
      id: op.id,
      title: op.title,
      status: "todo",
      dependsOn: op.dependsOn ?? [],
      ...(op.owner ? { owner: op.owner } : {}),
    }
    return [...tasks.filter((x) => x.id !== op.id), task]
  }
  if (op.op === "delete") return tasks.filter((x) => x.id !== op.id)
  return tasks.map((x) => {
    if (x.id !== op.id) return x
    const { owner, ...rest } = x
    const nextOwner = op.owner === undefined ? owner : (op.owner ?? undefined)
    return {
      ...rest,
      ...(nextOwner ? { owner: nextOwner } : {}),
      ...(op.title !== undefined ? { title: op.title } : {}),
      ...(op.status !== undefined ? { status: op.status } : {}),
      ...(op.note !== undefined ? { note: op.note } : {}),
    }
  })
}

export function applyMemberOp(members: ReadonlyArray<Member>, op: MemberOp): ReadonlyArray<Member> {
  if (op.op === "add") {
    if (members.some((m) => m.slug === op.slug)) return members
    const member: Member = {
      slug: op.slug,
      name: op.name,
      lead: members.length === 0,
      ...(op.role ? { role: op.role } : {}),
      ...(op.model ? { model: op.model } : {}),
    }
    return [...members, member]
  }
  if (op.op === "remove") return members.filter((m) => m.slug !== op.slug)
  return members.map((m) => (m.slug === op.slug ? { ...m, name: op.name } : m))
}

export function applyFileOp(
  files: ReadonlyArray<FileRef>,
  folders: ReadonlyArray<string>,
  op: FileOp,
): ReadonlyArray<FileRef> {
  if (op.op === "mkdir") return files
  if (op.op === "rm") return files.filter((x) => !op.paths.some((path) => under(x.name, path)))
  const isFolder = folders.includes(op.to) || files.some((x) => x.name.startsWith(`${op.to}/`))
  const target = isFolder ? `${op.to}/${op.from.slice(op.from.lastIndexOf("/") + 1)}` : op.to
  if (target === op.from || target.startsWith(`${op.from}/`)) return files
  if (!files.some((x) => under(x.name, op.from))) return files
  return files
    .filter((x) => x.name !== target)
    .map((x) => (under(x.name, op.from) ? { ...x, name: target + x.name.slice(op.from.length) } : x))
}

export function applyFolderOp(folders: ReadonlyArray<string>, op: FileOp): ReadonlyArray<string> {
  if (op.op === "mkdir") {
    const add = op.path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"))
    return [...new Set([...folders, ...add])].sort()
  }
  if (op.op === "rm") return folders.filter((x) => !op.paths.some((path) => under(x, path)))
  if (!folders.some((x) => under(x, op.from))) return folders
  const target = folders.includes(op.to) ? `${op.to}/${op.from.slice(op.from.lastIndexOf("/") + 1)}` : op.to
  if (target === op.from || target.startsWith(`${op.from}/`)) return folders
  return [...new Set(folders.map((x) => (under(x, op.from) ? target + x.slice(op.from.length) : x)))].sort()
}

export function editMessage(message: Message, text: string, at: number): Message {
  const { rich: _, ...rest } = message
  return { ...rest, text, editedAt: at }
}

export function reactToMessage(message: Message, emoji: string | null): Message {
  const others = (message.reactions ?? []).filter((r) => r.by.kind !== "human")
  const reactions = emoji === null ? others : [...others, { by: { kind: "human" as const }, emoji }]
  const { reactions: _, ...rest } = message
  return reactions.length ? { ...rest, reactions } : rest
}

export const mapMessage = (
  messages: ReadonlyArray<Message>,
  id: MessageId,
  update: (message: Message) => Message | null,
): ReadonlyArray<Message> =>
  messages.flatMap((m) => {
    if (m.id !== id) return [m]
    const next = update(m)
    return next === null ? [] : [next]
  })
