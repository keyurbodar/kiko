import { createServer, type Server } from "node:http"

export interface FixtureServer {
  readonly url: string
  readonly clicked: Promise<number>
  clickCount(): number
  close(): Promise<void>
}

const PAGE = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>kiko bench fixture</title></head>
  <body>
    <h1>kiko bench fixture</h1>
    <button id="go" type="button" onclick="fetch('/click', { method: 'POST' })">Click me</button>
    <p id="result">not clicked</p>
  </body>
</html>
`

export const startFixture = async (): Promise<FixtureServer> => {
  let count = 0
  let resolveClicked: (count: number) => void = () => undefined
  const clicked = new Promise<number>((resolve) => {
    resolveClicked = resolve
  })
  const server: Server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/click") {
      count += 1
      resolveClicked(count)
      response.writeHead(204).end()
      return
    }
    if (request.url === "/clicks") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ count }))
      return
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    server.close()
    throw new Error("fixture server did not bind a port")
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    clicked,
    clickCount: () => count,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
