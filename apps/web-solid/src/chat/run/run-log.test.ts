import { describe, expect, it } from "vitest"
import { extraInput, iconOf, liveLabel, sourcesOf, summarizeSteps } from "./run-log"

const step = (name: string, input?: string, label = `Used ${name}`) => ({
  tool: "other" as const,
  name,
  label,
  status: "done" as const,
  ...(input === undefined ? {} : { input }),
})

describe("liveLabel", () => {
  it("names the agent a deleted agent tool call removed", () => {
    expect(liveLabel(step("delete_agent", '{"handle":"ping"}'))).toBe("Deleted Ping")
  })

  it("says what a tool did when the server only knew its raw name", () => {
    expect(liveLabel(step("connect_app", '{"app":"gmail"}'))).toBe("Connected Gmail")
    expect(liveLabel(step("computer_read", '{"path":"/Users/me/notes.md"}'))).toBe("Read /Users/me/notes.md")
    expect(liveLabel(step("delete_group", '{"room_id":"r1"}'))).toBe("Deleted a group")
  })

  it("never shows a raw snake_case tool name", () => {
    expect(liveLabel(step("delete_agent"))).toBe("Deleted an agent")
    expect(liveLabel(step("mystery_tool", "{}"))).toBe("Used mystery tool")
  })

  it("keeps a label the server already wrote for people", () => {
    expect(liveLabel(step("create_task", '{"title":"x"}', "Added task x"))).toBe("Added task x")
  })

  it("puts a running humanized call in the present tense", () => {
    expect(liveLabel({ ...step("delete_agent", '{"handle":"ping"}'), status: "running" })).toBe("Deleting Ping")
  })
})

describe("shell and app steps", () => {
  const shell = (command: string, status: "done" | "running" = "done") => ({
    tool: "run" as const,
    name: "bash",
    label: `Ran ${command}`,
    input: command,
    status,
  })

  it("names a certain shell command and keeps the full command for the detail", () => {
    const read = shell("cd /tmp && head -c 300 feed.json")
    expect(liveLabel(read)).toBe("Read feed.json")
    expect(iconOf(read)).toBe("file-view")
    expect(extraInput({ ...read, label: "Read feed.json" })).toBe("cd /tmp && head -c 300 feed.json")
  })

  it("puts a running shell step in the present tense", () => {
    expect(liveLabel(shell("cd /tmp && head -c 300 feed.json", "running"))).toBe("Reading feed.json")
    expect(liveLabel(shell("cd /tmp && jq -r . feed.json", "running"))).toBe("Running jq")
  })

  it("says what an app tool did", () => {
    expect(liveLabel(step("app_list", "{}"))).toBe("Listed your apps")
    expect(liveLabel(step("app_deploy", '{"name":"hn-live"}'))).toBe("Deployed hn-live")
    expect(liveLabel(step("app_inspect", '{"name":"hn-live","what":"logs"}'))).toBe("Checked hn-live logs")
    expect(iconOf({ ...step("app_deploy", "{}"), app: undefined })).toBe("deploy")
  })
})

describe("summarizeSteps", () => {
  const bash = (command: string, status: "done" | "failed" = "done") => ({
    tool: "run" as const,
    name: "bash",
    label: `Ran ${command}`,
    input: command,
    status,
  })
  const URL_ = "https://open-signal.lakebed.app"

  it("leads with the most frequent kinds of work and counts the rest", () => {
    expect(
      summarizeSteps([
        step("app_list", "{}"),
        bash(`curl -s -o /dev/null -w "%{http_code}" ${URL_}`),
        bash("cd /home/hn-feeds && jq -r '.at' feed.json"),
        bash(`curl -sL ${URL_}`),
        step("app_inspect", '{"name":"hn-live","what":"logs"}'),
        bash(`curl -s ${URL_}/api/feed`),
        bash('cd /home/apps/hn-live && grep -n "PAPER\\s*=" index.html'),
      ]),
    ).toBe("Fetched 3 pages, ran 2 commands, and 2 more steps")
  })

  it("puts what changed first and names a single step when it is short", () => {
    expect(
      summarizeSteps([
        step("app_deploy", '{"name":"hn-live"}'),
        bash(`curl -sL ${URL_}`),
        bash("cd /tmp && head -c 300 feed.json", "failed"),
        step("app_inspect", '{"name":"hn-live","what":"tables"}'),
      ]),
    ).toBe("Deployed hn-live, fetched open-signal.lakebed.app, and 2 more steps")
  })

  it("never quotes a raw command", () => {
    expect(summarizeSteps([bash("python3 build.py --fast")])).toBe("Ran a command")
    expect(summarizeSteps([bash("bun test"), bash("bun run build")])).toBe("Ran 2 commands")
  })

  it("counts helpers once each, however many steps they took", () => {
    const worker = { id: "w1", task: "Layouts" }
    expect(summarizeSteps([bash("cat a.md"), { ...bash("cat b.md"), worker }, { ...bash("cat c.md"), worker }])).toBe(
      "Read a.md and started a helper",
    )
  })
})

describe("sourcesOf", () => {
  it("lists each site a web step read once, without www", () => {
    expect(
      sourcesOf(
        step(
          "browse",
          '{"urls":["https://www.kyohaku.go.jp/en/","https://japan-guide.com/a","https://japan-guide.com/b"]}',
        ),
      ),
    ).toEqual(["kyohaku.go.jp", "japan-guide.com"])
  })

  it("reads a single url and ignores input that is not a link", () => {
    expect(sourcesOf(step("fetch", '{"url":"https://nishiki-ichiba.jp"}'))).toEqual(["nishiki-ichiba.jp"])
    expect(sourcesOf(step("bash", "ls -la"))).toEqual([])
  })
})
