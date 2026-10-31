import "../index.css"
import type { FileRef } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import type { ViewerKind } from "./kind"
import { FileViewer } from "./viewer"

type Save = { path: string; text: string; type: string }

const api = vi.hoisted(() => ({
  reads: new Map<string, string>(),
  onSave: (_save: Save) => {},
}))

vi.mock("./api", () => ({
  PREVIEW_BYTES: 1024 * 1024,
  isTextFile: () => true,
  sha256Hex: async () => "sha",
  readText: async (_roomId: string, id: string) => {
    const text = api.reads.get(id) ?? ""
    return { kind: "text" as const, text, sha256: `sha-${id}`, truncated: false, size: text.length }
  },
  putFile: async (_roomId: string, path: string, text: string, type: string) => {
    api.onSave({ path, text, type })
    return { kind: "saved" as const, file: { id: `saved-${path}`, name: path, size: text.length, type } }
  },
}))

const ROOM = "01900000-0000-7000-8000-000000000099"

it("offers the download instead of a broken picture when the browser cannot decode an image", async () => {
  const container = document.createElement("div")
  container.style.cssText = "display:flex;width:600px;height:400px"
  await using screen = await render(
    () => (
      <FileViewer
        roomId={ROOM}
        path="attachments/scan.tiff"
        file={{
          id: "01900000-0000-7000-8000-0000000000aa",
          name: "attachments/scan.tiff",
          size: 12,
          type: "image/tiff",
        }}
        kind="image"
        rendered={false}
        wrap={false}
        reveal={null}
      />
    ),
    { container },
  )
  await expect.element(screen.getByText("No preview for this file")).toBeVisible()
})

it("opens each file in its own editor, so a file opened after an image saves to its own path", async () => {
  const alpha: FileRef = { id: "alpha-1", name: "alpha.txt", size: 10, type: "text/plain" }
  const beta: FileRef = { id: "beta-1", name: "beta.txt", size: 9, type: "text/plain" }
  const photo: FileRef = { id: "photo-1", name: "photo.png", size: 12, type: "image/png" }
  api.reads.clear()
  api.reads.set(alpha.id, "alpha body")
  api.reads.set(beta.id, "beta body")

  const [path, setPath] = createSignal("alpha.txt")
  const [file, setFile] = createSignal<FileRef>(alpha)
  const [kind, setKind] = createSignal<ViewerKind>("text")
  const [saves, setSaves] = createSignal<Save[]>([])
  api.onSave = (save) => setSaves((list) => [...list, save])

  const container = document.createElement("div")
  container.style.cssText = "display:flex;width:600px;height:400px"
  await using screen = await render(
    () => (
      <>
        <FileViewer
          roomId={ROOM}
          path={path()}
          file={file()}
          kind={kind()}
          rendered={false}
          wrap={false}
          reveal={null}
        />
        <output data-testid="saves">
          {saves()
            .map((s) => `${s.path}:${s.text}:${s.type}`)
            .join("|")}
        </output>
      </>
    ),
    { container },
  )

  await expect.element(screen.getByRole("textbox")).toHaveTextContent("alpha body")

  setPath("photo.png")
  setFile(photo)
  setKind("image")
  await expect.element(screen.getByRole("textbox")).not.toBeInTheDocument()

  setPath("beta.txt")
  setFile(beta)
  setKind("text")
  await expect.element(screen.getByRole("textbox")).toHaveTextContent("beta body")

  await screen.getByRole("textbox").click()
  await userEvent.keyboard("{End}")
  await userEvent.keyboard("!")
  await userEvent.keyboard("{Control>}s{/Control}")

  await expect.element(screen.getByTestId("saves")).toHaveTextContent("beta.txt:beta body!:text/plain")
})
