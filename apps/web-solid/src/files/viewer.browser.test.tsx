import "../index.css"
import type { FileRef } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { expect, it } from "vitest"
import { render } from "../../test/render"
import { FileViewer } from "./viewer"

it("offers the download instead of a broken picture when the browser cannot decode an image", async () => {
  const container = document.createElement("div")
  container.style.cssText = "display:flex;width:600px;height:400px"
  await using screen = await render(
    () => (
      <FileViewer
        roomId="01900000-0000-7000-8000-000000000099"
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

const ROOM = "01900000-0000-7000-8000-000000000099"

const textFile = (id: string, name: string, type = "text/plain"): FileRef => ({ id, name, size: 5, type })

function serve(bodies: Record<string, string>) {
  const original = globalThis.fetch
  const requested: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    const id = decodeURIComponent(url.split("/").pop()!.split("?")[0]!)
    requested.push(id)
    const body = bodies[id]
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 })
  }) as typeof fetch
  return { requested, [Symbol.dispose]: () => (globalThis.fetch = original) }
}

const editorText = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-component="file-editor"] .cm-content')?.textContent ?? ""

it("shows the newly picked file when the explorer switches between text files", async () => {
  using server = serve({ "id-a": "alpha", "id-b": "bravo" })
  const [path, setPath] = createSignal("notes/a.txt")
  const files: Record<string, FileRef> = {
    "notes/a.txt": textFile("id-a", "notes/a.txt"),
    "notes/b.txt": textFile("id-b", "notes/b.txt"),
  }
  await using screen = await render(() => (
    <FileViewer
      roomId={ROOM}
      path={path()}
      file={files[path()]}
      kind="text"
      rendered={false}
      wrap={false}
      reveal={null}
    />
  ))
  await expect.poll(() => editorText(screen.container)).toBe("alpha")
  setPath("notes/b.txt")
  await expect.poll(() => editorText(screen.container)).toBe("bravo")
  expect(server.requested).toEqual(["id-a", "id-b"])
})

it("opens the source of a page the agent rewrote while it was shown rendered", async () => {
  using server = serve({ "page-v2": "<p>v2</p>" })
  const [file, setFile] = createSignal(textFile("page-v1", "site/page.html", "text/html"))
  const [rendered, setRendered] = createSignal(true)
  await using screen = await render(() => (
    <FileViewer
      roomId={ROOM}
      path="site/page.html"
      file={file()}
      kind="html"
      rendered={rendered()}
      wrap={false}
      reveal={null}
    />
  ))
  setFile(textFile("page-v2", "site/page.html", "text/html"))
  setRendered(false)
  await expect.poll(() => editorText(screen.container)).toBe("<p>v2</p>")
  expect(server.requested).not.toContain("page-v1")
})

it("paints code in the theme's syntax colours", async () => {
  using _server = serve({ "id-js": 'const name = "kiko"\n// done' })
  const root = document.documentElement.style
  root.setProperty("--syntax-keyword", "rgb(1, 2, 3)")
  root.setProperty("--syntax-string", "rgb(4, 5, 6)")
  root.setProperty("--syntax-comment", "rgb(7, 8, 9)")
  using _restore = {
    [Symbol.dispose]: () =>
      ["--syntax-keyword", "--syntax-string", "--syntax-comment"].forEach((p) => root.removeProperty(p)),
  }
  await using screen = await render(() => (
    <FileViewer
      roomId={ROOM}
      path="src/name.js"
      file={textFile("id-js", "src/name.js", "text/javascript")}
      kind="text"
      rendered={false}
      wrap={false}
      reveal={null}
    />
  ))
  const colorOf = (text: string) => {
    const spans = screen.container.querySelectorAll<HTMLElement>('[data-component="file-editor"] .cm-content span')
    const hit = [...spans].find((span) => span.textContent?.trim() === text)
    return hit ? getComputedStyle(hit).color : null
  }
  await expect.poll(() => colorOf("const")).toBe("rgb(1, 2, 3)")
  expect(colorOf("kiko")).toBe("rgb(4, 5, 6)")
  expect(colorOf("// done")).toBe("rgb(7, 8, 9)")
})
