import { Type } from "@earendil-works/pi-ai"
import type { Models, ToolResultMessage } from "@earendil-works/pi-ai"
import {
  type ConversationId,
  defineExtension,
  defineTool,
  type Extension,
  type ModelRef,
  type ToolExecutionApi,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import { type ExecutionEnv, FileError, getOrThrow } from "@earendil-works/pi-durable/env"
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools"
import type { FsEntry } from "../../room/files"
import { baseName } from "../../room/files"
import { DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S } from "../../files/bash"
import { filesOf } from "../../files/room-fs"
import { encodeBase64 } from "../../lib/base64"
import { declareEffect } from "@kiko/agent/effects"
import { AgentFileMissing } from "../errors"

const FILES = "files"
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_LISTED = 500
const MAX_COPIED = 200
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number } | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf")
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const { totalPages, text: pages } = await extractText(pdf, { mergePages: false })
    const out = (pages as string[]).map((t, i) => `--- page ${i + 1} ---\n${t.trim()}`).join("\n\n")
    return out.replace(/--- page \d+ ---\s*/g, "").trim() ? { text: out, pages: totalPages } : null
  } catch {
    return null
  }
}

const SNIFF_BYTES = 8 * 1024

type ToolOutput = ToolResultMessage["content"]

function isBinary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes, { stream: true })
    return false
  } catch {
    return true
  }
}

function numbered(out: ToolOutput, offset: number | undefined): ToolOutput {
  let at = Math.max(1, Math.trunc(offset ?? 1))
  return out.map((part) => {
    if (part.type !== "text") return part
    const lines = part.text.split("\n")
    const last = lines.at(-1) === "" ? lines.pop() : undefined
    const text = lines.map((l) => `${at++}\t${l}`).join("\n")
    return { ...part, text: last === undefined ? text : `${text}\n` }
  })
}

const NUMBERED =
  " Each line comes back as its line number, a tab, then the line; the numbers are not part of the file, so never put them in an edit's oldText."

function causeOf(e: unknown): unknown {
  if (!(e instanceof Error) || !(e.cause instanceof FileError)) return e
  return new Error(`${e.message.replace(/ Error code: \w+\.$/, "")} ${e.cause.message}`)
}

const text = (value: string) => [{ type: "text" as const, text: value }]
const refused = (message: string) => ({ output: text(message), isError: true })

const roomPathOf = (api: Pick<ToolExecutionApi, "env">, path: string) => `/${getOrThrow(filesOf(api).roomPath(path))}`

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} b`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kb`
  return `${(bytes / 1024 / 1024).toFixed(1)} mb`
}

function line(e: FsEntry): string {
  return e.kind === "directory"
    ? `/${e.path}/\t${e.files} files, ${size(e.size)}`
    : `/${e.path}\t${size(e.size)}\t${e.type}`
}

export type FilesOptions = {
  acceptsImages(model: ModelRef | undefined): boolean
  touched(conversationId: ConversationId, paths: readonly string[]): void
}

export function filesExtension({ acceptsImages, touched }: FilesOptions): Extension {
  const saved = (api: Pick<ToolExecutionApi, "conversationId">, paths: readonly string[]) => {
    if (paths.length) touched(api.conversationId, paths)
  }
  const piRead = createReadTool()
  const read = defineTool({
    ...piRead,
    description: `${piRead.description}${NUMBERED} Pdfs come back as text, page by page; images come back as images when the model can see them. Paths start at / (the chat's files); what the human attached is under /attachments/.`,
    replay: "safe",
    execute: (args, api, context) =>
      filesOf(api).within(async () => {
        const fs = filesOf(api)
        const found = await fs.stat(args.path)
        const readMedia = async (
          entry: Extract<Awaited<ReturnType<typeof fs.stat>>, { ok: true }>["value"] & { kind: "file" },
        ) => {
          const readImage = async () => {
            const agent = await api.agent(context)
            if (!acceptsImages(agent.model))
              return {
                output: text(
                  `${args.path} is an image (${entry.type}, ${size(entry.size)}). this model cannot read images.`,
                ),
              }
            if (entry.size > MAX_IMAGE_BYTES)
              return refused(`${args.path} is an image of ${size(entry.size)}, over the ${size(MAX_IMAGE_BYTES)} limit`)
            const bytes = await fs.bytesOf(entry)
            if (!bytes) return refused(`no file at ${args.path}`)
            return { output: [{ type: "image" as const, data: encodeBase64(bytes), mimeType: entry.type }] }
          }
          if (IMAGE_TYPES.has(entry.type)) return readImage()
          if (entry.type === "application/pdf" || entry.path.toLowerCase().endsWith(".pdf")) {
            if (entry.size > MAX_PDF_BYTES)
              return refused(`${args.path} is a pdf of ${size(entry.size)}, over the ${size(MAX_PDF_BYTES)} limit`)
            const bytes = await fs.bytesOf(entry)
            const extracted = bytes ? await pdfText(bytes) : null
            if (!extracted)
              return refused(`${args.path} is a pdf whose text could not be read (it may be scanned images)`)
            return { output: text(`${args.path}: a pdf of ${extracted.pages} pages.\n\n${extracted.text}`) }
          }
        }
        if (found.ok && found.value.kind === "file") {
          const media = await readMedia(found.value)
          if (media) return media
          const head = await fs.bytesOf(found.value, SNIFF_BYTES)
          if (head && isBinary(head))
            return refused(
              `${args.path} is a binary file (${found.value.type}, ${size(found.value.size)}) and cannot be read as text`,
            )
        }
        if (found.ok && found.value.kind === "directory") return refused(`${args.path} is a folder. use ls`)
        const out = await piRead.execute(args, api, context)
        return out.output ? { ...out, output: numbered(out.output, args.offset) } : out
      }),
  })

  const ls = defineTool({
    name: "ls",
    description:
      "list a folder of the chat's files, as ls. folders end in /. with recursive, every file below it. the root is /.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "a folder or a file. default /" })),
      recursive: Type.Optional(Type.Boolean()),
    }),
    replay: "safe",
    execute: async (args, api) => {
      const path = args.path || "/"
      const out = getOrThrow(await filesOf(api).list(path, args.recursive ?? false))
      if (!out.length) return { output: text(path === "/" ? "no files yet" : `${path} is empty`) }
      const shown = out.slice(0, MAX_LISTED).map(line)
      const more = out.length > MAX_LISTED ? `\n[${out.length - MAX_LISTED} more. ls a folder inside to see them]` : ""
      return { output: text(shown.join("\n") + more) }
    },
  })

  const rm = defineTool({
    name: "rm",
    description:
      "delete files or folders, as rm. an empty folder goes as with rmdir; one with things in it needs recursive. nothing is deleted if any path is missing, or if a file is attached to a message in the chat. there is no undo.",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), { minItems: 1 }),
      recursive: Type.Optional(Type.Boolean()),
    }),
    replay: "safe",
    execute: async (args, api) => {
      const out = getOrThrow(await filesOf(api).removeAll(args.paths, args.recursive ?? false))
      const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
      const parts = [
        out.changed ? count(out.changed, "file") : "",
        out.folders ? count(out.folders, "folder") : "",
      ].filter(Boolean)
      saved(api, parts.length ? out.paths : [])
      return {
        output: text(parts.length ? `deleted ${parts.join(" and ")}` : "nothing to delete"),
      }
    },
  })

  const mv = defineTool({
    name: "mv",
    description:
      "move or rename a file or folder, as mv. into an existing folder, the name is kept. a file onto a file replaces it. a folder moves with everything in it. instant at any size.",
    parameters: Type.Object({ from: Type.String(), to: Type.String() }),
    replay: "safe",
    execute: async (args, api) => {
      const out = getOrThrow(await filesOf(api).move(args.from, args.to))
      if (!out.changed) return { output: text(`${args.from} is already there`) }
      saved(api, [out.to])
      return { output: text(`moved ${args.from} to ${out.to.slice(1)}`) }
    },
  })

  const mkdir = defineTool({
    name: "mkdir",
    description:
      "make a folder and any missing parents, as mkdir -p. an existing folder is fine. writing a file into a path also makes its folders.",
    parameters: Type.Object({ path: Type.String() }),
    replay: "safe",
    execute: async (args, api) => {
      const out = getOrThrow(await filesOf(api).mkdir(args.path))
      saved(api, out.changed ? [roomPathOf(api, args.path)] : [])
      return { output: text(out.changed ? `made ${args.path}` : `${args.path} already exists`) }
    },
  })

  const cp = defineTool({
    name: "cp",
    description:
      "copy a file or folder, as cp. into an existing folder, the name is kept. a folder needs recursive, and its copy must not exist yet.",
    parameters: Type.Object({ from: Type.String(), to: Type.String(), recursive: Type.Optional(Type.Boolean()) }),
    replay: "safe",
    execute: async (args, api) => {
      const fs = filesOf(api)
      const src = getOrThrow(await fs.stat(args.from))
      const dest = await fs.stat(args.to)
      const into = dest.ok && dest.value.kind === "directory"
      const target = into ? `${args.to.replace(/\/$/, "")}/${baseName(src.path)}` : args.to
      if (src.kind === "file") {
        const bytes = await fs.bytesOf(src)
        if (!bytes) return refused(`no file at ${args.from}`)
        getOrThrow(await fs.write(target, bytes, src.type))
        saved(api, [roomPathOf(api, target)])
        return { output: text(`copied ${args.from} to ${target}`) }
      }
      if (!args.recursive) return refused(`${args.from} is a folder. copy it with recursive`)
      if ((await fs.stat(target)).ok) return refused(`${target} already exists`)
      const files = getOrThrow(await fs.list(args.from, true)).filter((e) => e.kind === "file")
      if (files.length > MAX_COPIED)
        return refused(
          `${args.from} holds ${files.length} files, over the ${MAX_COPIED} a copy takes. move it, or copy a folder inside`,
        )
      const copies = await Promise.allSettled(
        files.map(async (f) => {
          const to = `${target}/${f.path.slice(src.path.length + 1)}`
          const bytes = await fs.bytesOf(f)
          if (!bytes) throw new AgentFileMissing({ path: f.path, message: `no file at ${f.path}` })
          getOrThrow(await fs.write(to, bytes, f.type))
          return roomPathOf(api, to)
        }),
      )
      const done = copies.flatMap((c) => (c.status === "fulfilled" ? [c.value] : []))
      const failed = copies.flatMap((c) =>
        c.status === "rejected" ? [c.reason instanceof Error ? c.reason.message : String(c.reason)] : [],
      )
      const content = failed.length
        ? `copied ${done.length} of ${files.length} files to ${target}. ${failed.length} not copied: ${failed[0]}`
        : `copied ${files.length} files to ${target}`
      saved(api, done)
      return { output: text(content), isError: failed.length > 0 }
    },
  })

  const piWrite = createWriteTool()
  const write = defineTool({
    ...piWrite,
    description: `${piWrite.description} To change parts of a file that exists, use edit with one entry per change instead of writing it all again.`,
    execute: async (args, api, context) => {
      const out = await piWrite.execute(args, api, context)
      if (!out.isError) saved(api, [roomPathOf(api, args.path)])
      return out
    },
  })
  const piEdit = createEditTool()
  const edit = defineTool({
    ...piEdit,
    execute: (args, api, context) =>
      filesOf(api).within(async () => {
        const out = await piEdit.execute(args, api, context).catch((e: unknown) => {
          throw causeOf(e)
        })
        if (!out.isError) saved(api, [roomPathOf(api, args.path)])
        return out
      }),
  })

  const piBash = createBashTool()
  const bash = defineTool({
    ...piBash,
    description: `Run a bash command over the chat's files (/), the human's drive (/home) and your soul (/me): pipes, loops, globs, grep, sed, awk, jq, find, xargs, diff and the rest. Only shell runs here, and nothing can be installed. Check JSON with jq. Each call starts at /, so use absolute paths. Use read (with offset/limit) to view a file; use bash to search (grep -rn, find) and to run things. /tmp is scratch that lasts between your commands and is never saved. curl fetches https:// urls only, and a few fetches per step share the run's budget. sleep really waits and counts toward the timeout: seconds, default ${DEFAULT_TIMEOUT_S}, at most ${MAX_TIMEOUT_S}. Each space saves when the command ends: writes first, deletions only if every write saved; the output names what was not saved. A write fails if the file changed after the command started; look again and rerun. Calls that write run one after another. Output is cut to the last lines.`,
    replay: "unsafe",
    execute: (args, api, context) => {
      const files = filesOf(api)
      const exec: ExecutionEnv["exec"] = async (command, options, ctx) => {
        const out = await files.exec(command, options, ctx)
        if (out.ok && out.value.changed.length) touched(api.conversationId, out.value.changed)
        return out
      }
      return piBash.execute(args, { ...api, env: Object.create(files, { exec: { value: exec } }) }, context)
    },
  })

  const tools: ToolRegistration[] = [
    declareEffect("read", read) as ToolRegistration,
    declareEffect("write", write) as ToolRegistration,
    declareEffect("write", edit) as ToolRegistration,
    declareEffect("read", ls) as ToolRegistration,
    declareEffect("write", rm) as ToolRegistration,
    declareEffect("write", mv) as ToolRegistration,
    declareEffect("write", cp) as ToolRegistration,
    declareEffect("write", mkdir) as ToolRegistration,
    declareEffect("write", bash, { stoppable: true }) as ToolRegistration,
  ]
  return defineExtension({ name: FILES, tools })
}

export function imageReader(models: Models | undefined) {
  return (model: ModelRef | undefined) => {
    if (!model || !models) return false
    return models.getModel(model.provider, model.modelId)?.input.includes("image") ?? false
  }
}
