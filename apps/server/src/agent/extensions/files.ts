import { Type } from "@earendil-works/pi-ai"
import type { Models } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, type ModelRef, type ToolRegistration } from "@earendil-works/pi-durable"
import { getOrThrow } from "@earendil-works/pi-durable/env"
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools"
import type { FsEntry } from "../../room/files"
import { baseName } from "../../room/files"
import { DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S } from "../../files/bash"
import { filesOf, SOUL_PATH } from "../../files/room-fs"
import { declareEffect } from "@yuki/agent/effects"

export const FILES = "files"
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 20 * 1024 * 1024
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

const STRICT = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })

function isBinary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true
  try {
    STRICT.decode(bytes)
    return false
  } catch {
    return true
  }
}

const text = (value: string) => [{ type: "text" as const, text: value }]
const refused = (message: string) => ({ content: text(message), isError: true })

function base64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} b`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kb`
  return `${(bytes / 1024 / 1024).toFixed(1)} mb`
}

function line(e: FsEntry): string {
  return e.kind === "directory" ? `/${e.path}/\t${e.files} files, ${size(e.size)}` : `/${e.path}\t${size(e.size)}\t${e.type}`
}

export type FilesOptions = {
  acceptsImages(model: ModelRef | undefined): boolean
}

/** Every tool works on `filesOf(api)`, the calling conversation's own view of the chat's files. */
export function filesExtension({ acceptsImages }: FilesOptions): Extension {
  const piRead = createReadTool()
  const read = defineTool({
    ...piRead,
    description: `${piRead.description} Pdfs come back as text, page by page; images come back as images when the model can see them. Paths start at / (the chat's files); what the human attached is under /attachments/.`,
    replay: "safe",
    execute: (args, api, context) => filesOf(api).within(async () => {
      const fs = filesOf(api)
      const found = await fs.stat(args.path)
      if (found.ok && found.value.kind === "file") {
        const entry = found.value
        if (IMAGE_TYPES.has(entry.type)) {
          const agent = await api.agent(context)
          if (!acceptsImages(agent.model)) return { content: text(`${args.path} is an image (${entry.type}, ${size(entry.size)}). this model cannot read images.`) }
          if (entry.size > MAX_IMAGE_BYTES) return refused(`${args.path} is an image of ${size(entry.size)}, over the ${size(MAX_IMAGE_BYTES)} limit`)
          const bytes = await fs.bytesOf(entry)
          if (!bytes) return refused(`no file at ${args.path}`)
          return { content: [{ type: "image" as const, data: base64(bytes), mimeType: entry.type }] }
        }
        if (entry.type === "application/pdf" || entry.path.toLowerCase().endsWith(".pdf")) {
          if (entry.size > MAX_PDF_BYTES) return refused(`${args.path} is a pdf of ${size(entry.size)}, over the ${size(MAX_PDF_BYTES)} limit`)
          const bytes = await fs.bytesOf(entry)
          const extracted = bytes ? await pdfText(bytes) : null
          if (!extracted) return refused(`${args.path} is a pdf whose text could not be read (it may be scanned images)`)
          return { content: text(`${args.path}: a pdf of ${extracted.pages} pages.\n\n${extracted.text}`) }
        }
      }
      if (found.ok && found.value.kind === "file") {
        // pi's read would decode any bytes as text. The bytes are cached, so pi's read fetches nothing again.
        const bytes = await fs.bytesOf(found.value)
        if (bytes && isBinary(bytes)) return refused(`${args.path} is a binary file (${found.value.type}, ${size(found.value.size)}) and cannot be read as text`)
      }
      if (found.ok && found.value.kind === "directory") return refused(`${args.path} is a folder. use ls`)
      return piRead.execute(args, api, context)
    }),
  })

  const ls = defineTool({
    name: "ls",
    description: "list a folder of the chat's files, as ls. folders end in /. with recursive, every file below it. the root is /.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "a folder or a file. default /" })),
      recursive: Type.Optional(Type.Boolean()),
    }),
    replay: "safe",
    execute: async (args, api) => {
      const path = args.path || "/"
      const out = getOrThrow(await filesOf(api).list(path, args.recursive ?? false))
      if (!out.length) return { content: text(path === "/" ? "no files yet" : `${path} is empty`) }
      const shown = out.slice(0, MAX_LISTED).map(line)
      const more = out.length > MAX_LISTED ? `\n[${out.length - MAX_LISTED} more. ls a folder inside to see them]` : ""
      return { content: text(shown.join("\n") + more) }
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
      const parts = [out.changed ? count(out.changed, "file") : "", out.folders ? count(out.folders, "folder") : ""].filter(Boolean)
      return { content: text(parts.length ? `deleted ${parts.join(" and ")}` : "nothing to delete") }
    },
  })

  const mv = defineTool({
    name: "mv",
    description:
      "move or rename a file or folder, as mv. into an existing folder, the name is kept. a file onto a file replaces it. a folder moves with everything in it. instant at any size.",
    parameters: Type.Object({ from: Type.String(), to: Type.String() }),
    replay: "safe",
    execute: async (args, api) => {
      const fs = filesOf(api)
      const dest = await fs.stat(args.to)
      const where = dest.ok && dest.value.kind === "directory" ? `${args.to.replace(/\/$/, "")}/${baseName(args.from.replace(/\/$/, ""))}` : args.to
      const out = getOrThrow(await fs.move(args.from, args.to))
      return { content: text(out.changed ? `moved ${args.from} to ${where}` : `${args.from} is already there`) }
    },
  })

  const mkdir = defineTool({
    name: "mkdir",
    description: "make a folder and any missing parents, as mkdir -p. an existing folder is fine. writing a file into a path also makes its folders.",
    parameters: Type.Object({ path: Type.String() }),
    replay: "safe",
    execute: async (args, api) => {
      const out = getOrThrow(await filesOf(api).mkdir(args.path))
      return { content: text(out.changed ? `made ${args.path}` : `${args.path} already exists`) }
    },
  })

  const cp = defineTool({
    name: "cp",
    description: "copy a file or folder, as cp. into an existing folder, the name is kept. a folder needs recursive, and its copy must not exist yet.",
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
        return { content: text(`copied ${args.from} to ${target}`) }
      }
      if (!args.recursive) return refused(`${args.from} is a folder. copy it with recursive`)
      if ((await fs.stat(target)).ok) return refused(`${target} already exists`)
      const files = getOrThrow(await fs.list(args.from, true)).filter((e) => e.kind === "file")
      if (files.length > MAX_COPIED) return refused(`${args.from} holds ${files.length} files, over the ${MAX_COPIED} a copy takes. move it, or copy a folder inside`)
      await Promise.all(
        files.map(async (f) => {
          const bytes = await fs.bytesOf(f)
          if (bytes) getOrThrow(await fs.write(`${target}/${f.path.slice(src.path.length + 1)}`, bytes, f.type))
        }),
      )
      return { content: text(`copied ${files.length} files to ${target}`) }
    },
  })

  // pi's edit asks for the file's info and then reads it: one room call for both, and the write
  const piEdit = createEditTool()
  const edit = defineTool({ ...piEdit, execute: (args, api, context) => filesOf(api).within(() => piEdit.execute(args, api, context)) })

  const bash = defineTool({
    ...createBashTool(),
    description: `run a bash command over the chat's files, as on linux: pipes, redirects, loops, globs, and grep, sed, awk, jq, sort, uniq, cut, tr, wc, head, tail, find, xargs, diff and the rest. /tmp is scratch for the one command and is not saved. / is the chat's files, /home the human's drive, /me your soul. no network, no python, no programs to install. one command is one transaction: it sees the files as they were when it started, and a write to a file someone changed since then fails, so run it again. calls in one turn run at once. output is cut to the last lines. timeout in seconds, default ${DEFAULT_TIMEOUT_S}, at most ${MAX_TIMEOUT_S}.`,
    replay: "unsafe",
  })

  const tools: ToolRegistration[] = [
    declareEffect("read", read) as ToolRegistration,
    declareEffect("write", createWriteTool()) as ToolRegistration,
    declareEffect("write", edit) as ToolRegistration,
    declareEffect("read", ls) as ToolRegistration,
    declareEffect("write", rm) as ToolRegistration,
    declareEffect("write", mv) as ToolRegistration,
    declareEffect("write", cp) as ToolRegistration,
    declareEffect("write", mkdir) as ToolRegistration,
    declareEffect("write", bash) as ToolRegistration,
  ]
  return defineExtension({ name: FILES, tools })
}

export function imageReader(models: Models | undefined) {
  return (model: ModelRef | undefined) => {
    if (!model || !models) return false
    return models.getModel(model.provider, model.modelId)?.input.includes("image") ?? false
  }
}
