import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type FeedPaths = { state: string; agent: string }

export type Feed = {
  connected(name: string | null): Promise<void>
  working(app: string | null): Promise<void>
}

async function write(file: string, body: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const part = `${file}.part`
  await writeFile(part, body, { mode: 0o600 })
  await rename(part, file)
}

export function createFeed(paths: FeedPaths): Feed {
  let state = ""
  let agent = ""
  let queue = Promise.resolve()

  const run = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task, task)
    return queue
  }

  return {
    connected(name) {
      const body = `${JSON.stringify(name === null ? { connected: false } : { connected: true, name })}\n`
      if (body === state) return queue
      state = body
      return run(() => write(paths.state, body))
    },
    working(app) {
      if (app === null) {
        if (agent === "") return queue
        agent = ""
        return run(() => rm(paths.agent, { force: true }))
      }
      const body = `${JSON.stringify({ app })}\n`
      if (body === agent) return queue
      agent = body
      return run(() => write(paths.agent, body))
    },
  }
}
